// ===== conmux InjectionHook 实现（cutover ③）=====
//
// 把原 core/injection.rs 的 policy 闸 + fail-closed 审计从「inject_with_policy 内联代码」
// 下沉为 conmux 钩子——「审计先于字节抵达 PTY」从项目约定升级为库级不变量（MF-6：
// 任一 before_inject Err ⇒ conmux 保证 write_all 不被调用）。
//
// 注册顺序 `[PolicyHook, AuditHook]`（PaneRuntime 构造时固定）：
//   policy 先拒 ⇒ AuditHook.before 未跑（无 Ok 审计）⇒ AuditHook.after 收到
//   Err(InjectionRejected) 补写 Rejected 审计——与原实现「policy 拒绝写 Rejected、
//   不写 Ok」语义一致。
//
// 钩子运行语境：conmux 已保证钩子**不在全局 panes 表锁内**调用（D-1a），
// 故此处拿 db / policy / counter 锁不构成跨锁死锁。

use std::collections::HashMap;
use std::sync::Arc;

use conmux::{ConmuxError, InjectionContext, InjectionHook};

use crate::core::audit::AuditResult;
use crate::core::injection::{
    build_injection_audit, check_and_record_rate_limit, check_content_policy,
    should_enforce_stdin_injection_policy,
};
use crate::core::{ConfluxError, StdinInjectionPolicy};
use crate::persistence::audit::insert_audit_event;

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 从 ConfluxError 提取裸消息（避免 Display 前缀在 InjectionRejected→OrchestrationError
/// 往返中叠加成「编排错误: 编排错误: …」）。
fn bare_message(e: &ConfluxError) -> String {
    match e {
        ConfluxError::OrchestrationError { message } => message.clone(),
        other => other.to_string(),
    }
}

/// 内容策略 + per-pane 限速闸（原 inject_with_policy 第 2/3 步，MF-3/MF-5）。
///
/// 仅对 `should_enforce_stdin_injection_policy` 为 true 的来源（OrchestrationAuto /
/// DiscussionUserMessage）强制；UserDirect / PermissionResponse 直通（逐键输入不被误伤）。
pub struct PolicyHook {
    policy: Arc<parking_lot::RwLock<StdinInjectionPolicy>>,
    rate_counter: Arc<parking_lot::RwLock<HashMap<String, Vec<u64>>>>,
}

impl PolicyHook {
    pub fn new(
        policy: Arc<parking_lot::RwLock<StdinInjectionPolicy>>,
        rate_counter: Arc<parking_lot::RwLock<HashMap<String, Vec<u64>>>>,
    ) -> Self {
        Self {
            policy,
            rate_counter,
        }
    }
}

impl InjectionHook for PolicyHook {
    fn before_inject(&self, ctx: &InjectionContext) -> Result<(), ConmuxError> {
        if !should_enforce_stdin_injection_policy(&ctx.source) {
            return Ok(());
        }

        // 内容检查（长度 + forbidden_patterns）。注入内容源头是 &str（inject_with_policy
        // 入参），UTF-8 必然成立；防御性 lossy 兜底。
        let content = String::from_utf8_lossy(ctx.content);
        {
            let policy = self.policy.read();
            check_content_policy(&policy, &content).map_err(|e| {
                ConmuxError::InjectionRejected {
                    reason: bare_message(&e),
                }
            })?;
        }

        // per-pane 限速（1 分钟滑动窗口，MF-3）。先读 policy（独立锁）再拿计数器，
        // 避免持计数器锁期间再取另一把锁（与原实现同纪律）。
        let max_rate = self.policy.read().rate_limit_per_minute;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut counters = self.rate_counter.write();
        check_and_record_rate_limit(&mut counters, &ctx.pane_id.0, now, max_rate).map_err(
            |count| ConmuxError::InjectionRejected {
                reason: format!(
                    "注入速率超限: 实例 {} 过去 1 分钟内已注入 {} 次（限制 {}）",
                    ctx.pane_id.0, count, max_rate
                ),
            },
        )
    }
}

/// UserDirect 合批 flush 时间窗（D3 (b-2) 会签条件：≤500ms 且遇 `\r` 立即 flush）。
const USER_DIRECT_FLUSH_WINDOW_MS: i64 = 500;

/// 单 pane 的 UserDirect 待批缓冲（D3 (b-2)）。
struct UserDirectBatch {
    /// 完整字节序列（payload 保全文，base64 落库）
    bytes: Vec<u8>,
    /// 批内击键（inject 调用）数
    key_count: u64,
    /// 首键时刻（ms）——时间窗起点 + payload.first_key_ts
    first_key_ts: i64,
    /// 本批序号（per-pane 单调，崩溃后可检测审计缺口）
    seq: u64,
}

/// 审计钩子（MF-2/MF-6 + D3 (b-2) UserDirect 合批，红队会签条件版）。
///
/// **非 UserDirect**（PermissionResponse/OrchestrationAuto/DiscussionUserMessage）：
/// 维持**逐次审计-先于-注入**——`before_inject` 写 `result=Ok` 审计，INSERT 失败 ⇒
/// Err ⇒ conmux 保证字节绝不抵达 PTY（fail-closed，会签条件 2）。
///
/// **UserDirect（D3 (b-2)，用户 2026-06-10 裁决档位）**：逐键注入按 per-pane 缓冲
/// 合批为一条审计（payload 保完整字节序列 base64 + 键数 + 时间区间 + 单调 seq）。
/// **双触发 flush**：内容含 `\r`/`\n` 立即 flush；否则 ticker 在 ≤500ms 窗口内 flush。
/// graceful shutdown 必 flush（`flush_all`，lib.rs RunEvent::Exit 调用）。
/// 有界 fail-open 边界（显式声明，红队会签）：UserDirect 字节先于其批审计落库
/// ≤500ms——actor 按定义即用户本人，伪造/抵赖风险最低；崩溃丢失窗口由 seq 缺口可检测。
///
/// `after_inject`：`Err(InjectionRejected)` ⇒ 补写 Rejected；其它 `Err`（PTY 写失败）⇒
/// UserDirect flush 当批标 Failed（批内含失败键，payload 可追溯），其它 source 追加
/// Failed。补写均 best-effort（失败仅记日志，不掩盖原始错误）。
pub struct AuditHook {
    db: Arc<parking_lot::Mutex<rusqlite::Connection>>,
    /// per-pane UserDirect 待批缓冲（D3）
    batches: parking_lot::Mutex<HashMap<String, UserDirectBatch>>,
    /// per-pane 下一批序号（单调；session 内不复用）
    seqs: parking_lot::Mutex<HashMap<String, u64>>,
}

impl AuditHook {
    pub fn new(db: Arc<parking_lot::Mutex<rusqlite::Connection>>) -> Self {
        Self {
            db,
            batches: parking_lot::Mutex::new(HashMap::new()),
            seqs: parking_lot::Mutex::new(HashMap::new()),
        }
    }

    fn write_audit(&self, instance_id: &str, source: &conmux::InjectionSource, result: AuditResult) {
        let audit = build_injection_audit(instance_id, source, result, now_millis());
        let conn = self.db.lock();
        if let Err(e) = insert_audit_event(&conn, &audit) {
            log::warn!("注入审计补写失败（best-effort）: {e}");
        }
    }

    /// UserDirect：append 进 per-pane 批缓冲；返回是否应立即 flush（含 `\r`/`\n`）。
    fn append_user_direct(&self, pane_id: &str, content: &[u8], now_ms: i64) -> bool {
        let mut batches = self.batches.lock();
        let batch = batches.entry(pane_id.to_string()).or_insert_with(|| {
            let mut seqs = self.seqs.lock();
            let seq = seqs.entry(pane_id.to_string()).or_insert(0);
            *seq += 1;
            UserDirectBatch {
                bytes: Vec::new(),
                key_count: 0,
                first_key_ts: now_ms,
                seq: *seq,
            }
        });
        batch.bytes.extend_from_slice(content);
        batch.key_count += 1;
        content.iter().any(|&b| b == b'\r' || b == b'\n')
    }

    /// flush 单 pane 待批（无批则 no-op）。批审计行：action=Reply / actor=User /
    /// injection_source=UserDirect / payload=JSON{data_base64,key_count,first_key_ts,
    /// flush_ts,seq}。写入 best-effort（失败记日志；批已取出即丢——seq 缺口可检测）。
    fn flush_pane(&self, pane_id: &str, flush_ts: i64, result: AuditResult) {
        let batch = match self.batches.lock().remove(pane_id) {
            Some(b) => b,
            None => return,
        };
        use base64::Engine;
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(&batch.bytes);
        let payload = serde_json::json!({
            "data_base64": data_base64,
            "key_count": batch.key_count,
            "first_key_ts": batch.first_key_ts,
            "flush_ts": flush_ts,
            "seq": batch.seq,
        });
        let mut audit = build_injection_audit(
            pane_id,
            &conmux::InjectionSource::UserDirect,
            result,
            flush_ts,
        );
        audit.payload = Some(payload.to_string());
        let conn = self.db.lock();
        if let Err(e) = insert_audit_event(&conn, &audit) {
            log::warn!(
                "UserDirect 批审计写入失败（seq={} 将成缺口，可检测）: {e}",
                batch.seq
            );
        }
    }

    /// ticker 驱动：flush 所有超时间窗（≤500ms）的待批（D3 双触发之时间触发）。
    pub fn flush_due(&self, now_ms: i64) {
        let due: Vec<String> = self
            .batches
            .lock()
            .iter()
            .filter(|(_, b)| now_ms - b.first_key_ts >= USER_DIRECT_FLUSH_WINDOW_MS)
            .map(|(k, _)| k.clone())
            .collect();
        for pane_id in due {
            self.flush_pane(&pane_id, now_ms, AuditResult::Ok);
        }
    }

    /// graceful shutdown：flush 全部待批（D3 会签条件——退出不留未审计窗口）。
    pub fn flush_all(&self) {
        let all: Vec<String> = self.batches.lock().keys().cloned().collect();
        let now = now_millis();
        for pane_id in all {
            self.flush_pane(&pane_id, now, AuditResult::Ok);
        }
    }

    /// 实例销毁时清理其批缓冲 + seq 计数（红队 C-3 / C8 同类无界增长防护）。
    /// 先 flush 未落库的待批（destroy 前的击键仍需审计完整），再清 seq 计数——
    /// 否则 seqs map 随实例销毁单调累积（轻微泄漏）。destroy 路径调用。
    pub fn forget_pane(&self, pane_id: &str) {
        self.flush_pane(pane_id, now_millis(), AuditResult::Ok);
        self.seqs.lock().remove(pane_id);
    }
}

impl InjectionHook for AuditHook {
    fn before_inject(&self, ctx: &InjectionContext) -> Result<(), ConmuxError> {
        // D3 (b-2)：仅 UserDirect 合批（有界 fail-open，会签条件 1/2）。
        if ctx.source == conmux::InjectionSource::UserDirect {
            let now = now_millis();
            if self.append_user_direct(&ctx.pane_id.0, ctx.content, now) {
                self.flush_pane(&ctx.pane_id.0, now, AuditResult::Ok); // 遇 \r/\n 立即 flush
            }
            return Ok(());
        }
        // 其它 source：逐次审计-先于-注入（fail-closed 不变量不变）。
        let audit = build_injection_audit(&ctx.pane_id.0, &ctx.source, AuditResult::Ok, now_millis());
        let conn = self.db.lock();
        insert_audit_event(&conn, &audit).map_err(|e| ConmuxError::InjectionRejected {
            reason: format!("注入审计写入失败，已 fail-closed 拒绝注入: {e}"),
        })
    }

    fn after_inject(&self, ctx: &InjectionContext, result: &Result<(), ConmuxError>) {
        match result {
            Ok(()) => {}
            Err(ConmuxError::InjectionRejected { .. }) => {
                self.write_audit(&ctx.pane_id.0, &ctx.source, AuditResult::Rejected);
            }
            Err(_) if ctx.source == conmux::InjectionSource::UserDirect => {
                // PTY 写失败：当批立即 flush 并标 Failed（批内含失败键，payload 可追溯）。
                self.flush_pane(&ctx.pane_id.0, now_millis(), AuditResult::Failed);
            }
            Err(_) => {
                self.write_audit(&ctx.pane_id.0, &ctx.source, AuditResult::Failed);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::audit::{AuditActor, AuditResult};
    use crate::core::InjectionSource;
    use crate::persistence::audit::list_audit_events;
    use crate::persistence::schema::init_database;
    use conmux::PaneId;

    fn mem_db() -> Arc<parking_lot::Mutex<rusqlite::Connection>> {
        Arc::new(parking_lot::Mutex::new(init_database(":memory:").unwrap()))
    }

    fn policy_hook() -> PolicyHook {
        PolicyHook::new(
            Arc::new(parking_lot::RwLock::new(StdinInjectionPolicy::default())),
            Arc::new(parking_lot::RwLock::new(HashMap::new())),
        )
    }

    // ===== PolicyHook =====

    #[test]
    fn policy_hook_passes_user_direct_without_checks() {
        let hook = policy_hook();
        let id = PaneId("i1".into());
        // UserDirect 直通——即使内容命中 forbidden_pattern 也不拦（与原实现一致）。
        let ctx = InjectionContext::new(&id, InjectionSource::UserDirect, b"rm -rf /");
        assert!(hook.before_inject(&ctx).is_ok());
    }

    #[test]
    fn policy_hook_rejects_forbidden_pattern_for_enforced_source() {
        let hook = policy_hook();
        let id = PaneId("i1".into());
        let ctx = InjectionContext::new(&id, InjectionSource::OrchestrationAuto, b"run rm -rf / now");
        let err = hook.before_inject(&ctx).unwrap_err();
        match err {
            ConmuxError::InjectionRejected { reason } => {
                assert!(reason.contains("禁止模式"), "拒绝原因应为禁止模式: {reason}");
                assert!(!reason.contains("编排错误"), "裸消息不应叠加 Display 前缀: {reason}");
            }
            other => panic!("应为 InjectionRejected，实际 {other:?}"),
        }
    }

    #[test]
    fn policy_hook_rate_limit_is_per_pane() {
        let policy = Arc::new(parking_lot::RwLock::new(StdinInjectionPolicy {
            rate_limit_per_minute: 1,
            ..StdinInjectionPolicy::default()
        }));
        let hook = PolicyHook::new(policy, Arc::new(parking_lot::RwLock::new(HashMap::new())));
        let a = PaneId("a".into());
        let b = PaneId("b".into());
        let ok = |id: &PaneId, hook: &PolicyHook| {
            hook.before_inject(&InjectionContext::new(
                id,
                InjectionSource::DiscussionUserMessage,
                b"hi",
            ))
        };
        assert!(ok(&a, &hook).is_ok());
        assert!(matches!(
            ok(&a, &hook),
            Err(ConmuxError::InjectionRejected { .. })
        ));
        // pane b 不受 a 影响（MF-3 per-pane）。
        assert!(ok(&b, &hook).is_ok());
    }

    // ===== AuditHook =====

    #[test]
    fn audit_hook_writes_ok_audit_before_inject() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        let ctx = InjectionContext::new(&id, InjectionSource::OrchestrationAuto, b"x");
        hook.before_inject(&ctx).expect("审计成功应放行");

        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].result, AuditResult::Ok);
        assert_eq!(audits[0].actor, AuditActor::Coordinator); // OrchestrationAuto 硬编码归属
        assert_eq!(
            audits[0].injection_source,
            Some(InjectionSource::OrchestrationAuto)
        );
    }

    #[test]
    fn audit_hook_fail_closed_when_insert_fails() {
        let db = mem_db();
        db.lock().execute("DROP TABLE audit_events", []).unwrap();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        // 非 UserDirect（逐次审计-先于-注入）：INSERT 失败 ⇒ before_inject Err ⇒
        // conmux 层保证 write_all 不被调用（pane.rs 已有 fail-closed 测试）。
        let ctx = InjectionContext::new(&id, InjectionSource::PermissionResponse, b"Y\r");
        assert!(matches!(
            hook.before_inject(&ctx),
            Err(ConmuxError::InjectionRejected { .. })
        ));
    }

    #[test]
    fn audit_hook_after_writes_rejected_on_policy_rejection() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        let ctx = InjectionContext::new(&id, InjectionSource::DiscussionUserMessage, b"x");
        let rejected: Result<(), ConmuxError> = Err(ConmuxError::InjectionRejected {
            reason: "policy".into(),
        });
        hook.after_inject(&ctx, &rejected);

        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 1, "policy 拒绝只写一条 Rejected（无 Ok）");
        assert_eq!(audits[0].result, AuditResult::Rejected);
    }

    #[test]
    fn audit_hook_appends_failed_after_write_failure() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        let ctx = InjectionContext::new(&id, InjectionSource::PermissionResponse, b"Y\r");
        // 模拟完整时序：before 写 Ok 审计 → 写 PTY 失败 → after 追加 Failed。
        hook.before_inject(&ctx).unwrap();
        let failed: Result<(), ConmuxError> = Err(ConmuxError::PtyError {
            message: "stdin 写入失败".into(),
        });
        hook.after_inject(&ctx, &failed);

        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 2);
        assert!(audits.iter().any(|a| a.result == AuditResult::Ok));
        assert!(audits.iter().any(|a| a.result == AuditResult::Failed));
        assert!(audits
            .iter()
            .all(|a| a.injection_source == Some(InjectionSource::PermissionResponse)));
    }

    #[test]
    fn audit_hook_after_noop_on_success() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        // 非 UserDirect：成功路径恰好一条 Ok 审计（before 写，after no-op）。
        let ctx = InjectionContext::new(&id, InjectionSource::DiscussionUserMessage, b"x");
        hook.before_inject(&ctx).unwrap();
        hook.after_inject(&ctx, &Ok(()));
        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 1, "成功路径恰好一条 Ok 审计（before 写）");
        assert_eq!(audits[0].result, AuditResult::Ok);
    }

    // ===== D3 (b-2)：UserDirect 审计合批（V1-4 写放大基线 + 会签条件） =====

    fn batch_payload(audit: &crate::core::audit::AuditEvent) -> serde_json::Value {
        serde_json::from_str(audit.payload.as_deref().expect("批审计必带 payload")).unwrap()
    }

    /// V1-4 基线：模拟 1000 次击键（每 10 键一个 `\r`）→ 审计行数 = 100 ≤ 键数/10，
    /// 且 payload 字节拼接 == 输入全文（保全文可追溯）+ seq 单调无缺口。
    #[test]
    fn d3_thousand_keys_batch_to_at_most_tenth_rows_with_full_payload() {
        use base64::Engine;
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());

        let mut expected_bytes: Vec<u8> = Vec::new();
        for i in 0..1000u32 {
            let key: &[u8] = if i % 10 == 9 { b"\r" } else { b"k" };
            expected_bytes.extend_from_slice(key);
            let ctx = InjectionContext::new(&id, InjectionSource::UserDirect, key);
            hook.before_inject(&ctx).unwrap();
            hook.after_inject(&ctx, &Ok(()));
        }

        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 100, "1000 键（每 10 键一 \\r）→ 100 条批审计");
        assert!(audits.len() <= 1000 / 10, "V1-4：审计行数 ≤ 键数/10");

        // payload 重组 == 输入全文（按 seq 升序拼接）
        let mut batches: Vec<(u64, Vec<u8>, u64)> = audits
            .iter()
            .map(|a| {
                let p = batch_payload(a);
                (
                    p["seq"].as_u64().unwrap(),
                    base64::engine::general_purpose::STANDARD
                        .decode(p["data_base64"].as_str().unwrap())
                        .unwrap(),
                    p["key_count"].as_u64().unwrap(),
                )
            })
            .collect();
        batches.sort_by_key(|(seq, _, _)| *seq);
        let reassembled: Vec<u8> = batches.iter().flat_map(|(_, b, _)| b.clone()).collect();
        assert_eq!(reassembled, expected_bytes, "批 payload 拼接必须等于输入字节序");
        assert_eq!(
            batches.iter().map(|(_, _, k)| k).sum::<u64>(),
            1000,
            "key_count 总和 == 击键数"
        );
        // seq 单调无缺口（崩溃缺口可检测的前提）
        let seqs: Vec<u64> = batches.iter().map(|(s, _, _)| *s).collect();
        assert_eq!(seqs, (1..=100).collect::<Vec<u64>>());
        // 全部归属 UserDirect / Reply（MF-6 硬编码不变）
        assert!(audits.iter().all(|a| a.injection_source
            == Some(InjectionSource::UserDirect)
            && a.action == crate::core::audit::AuditAction::Reply));
    }

    /// 时间窗触发：无 `\r` 的击键不立即落库；flush_due 超 500ms 窗口后落一条批审计。
    #[test]
    fn d3_window_flush_via_flush_due() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        for key in [b"a", b"b", b"c"] {
            let ctx = InjectionContext::new(&id, InjectionSource::UserDirect, key);
            hook.before_inject(&ctx).unwrap();
        }
        assert!(
            list_audit_events(&db.lock(), None, None).unwrap().is_empty(),
            "无 \\r 且窗口未到：不落库（有界 fail-open）"
        );

        // 窗口未到：flush_due 不动
        hook.flush_due(now_millis() + 100);
        assert!(list_audit_events(&db.lock(), None, None).unwrap().is_empty());

        // 窗口已过（≥500ms）：落一条批审计含 3 键全文
        hook.flush_due(now_millis() + 600);
        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 1);
        let p = batch_payload(&audits[0]);
        assert_eq!(p["key_count"], 3);
    }

    /// graceful shutdown：flush_all 清空全部 pane 的待批（会签条件——退出不留窗口）。
    #[test]
    fn d3_flush_all_drains_all_panes() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        for pane in ["p1", "p2"] {
            let id = PaneId(pane.into());
            let ctx = InjectionContext::new(&id, InjectionSource::UserDirect, b"x");
            hook.before_inject(&ctx).unwrap();
        }
        hook.flush_all();
        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 2, "两个 pane 各 flush 一条");
        hook.flush_all(); // 幂等：再次 flush 无新行
        assert_eq!(list_audit_events(&db.lock(), None, None).unwrap().len(), 2);
    }

    /// PTY 写失败：当批立即 flush 并标 Failed（批内含失败键，payload 可追溯）。
    #[test]
    fn d3_write_failure_flushes_batch_as_failed() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        let ctx = InjectionContext::new(&id, InjectionSource::UserDirect, b"x");
        hook.before_inject(&ctx).unwrap();
        let failed: Result<(), ConmuxError> = Err(ConmuxError::PtyError {
            message: "stdin 写入失败".into(),
        });
        hook.after_inject(&ctx, &failed);
        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].result, AuditResult::Failed);
        assert!(audits[0].payload.is_some(), "Failed 批仍保全文 payload");
    }

    /// 非 UserDirect 不合批：逐次审计-先于-注入不变（会签条件 2 回归）。
    #[test]
    fn d3_non_user_direct_sources_remain_per_injection() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        for src in [
            InjectionSource::PermissionResponse,
            InjectionSource::OrchestrationAuto,
            InjectionSource::DiscussionUserMessage,
        ] {
            let ctx = InjectionContext::new(&id, src, b"x");
            hook.before_inject(&ctx).unwrap();
        }
        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 3, "三次注入三条审计（不合批）");
        assert!(audits.iter().all(|a| a.payload.is_none()));
    }

    /// 红队 C-3：forget_pane 先 flush 未落批（审计完整）再清 seq 计数（无界增长防护）。
    #[test]
    fn d3_forget_pane_flushes_pending_and_clears_seq() {
        let db = mem_db();
        let hook = AuditHook::new(Arc::clone(&db));
        let id = PaneId("i1".into());
        // 留一个未 flush 的待批（无 \r）
        let ctx = InjectionContext::new(&id, InjectionSource::UserDirect, b"x");
        hook.before_inject(&ctx).unwrap();
        assert!(
            list_audit_events(&db.lock(), None, None).unwrap().is_empty(),
            "无 \\r：未 flush"
        );

        hook.forget_pane("i1");
        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 1, "forget 前的待批应被 flush（审计完整）");
        assert_eq!(batch_payload(&audits[0])["seq"], 1);

        // seq 计数已清：同 id 再起一批 seq 重新从 1（无残留累积）
        let ctx2 = InjectionContext::new(&id, InjectionSource::UserDirect, b"y\r");
        hook.before_inject(&ctx2).unwrap(); // \r 立即 flush
        let audits2 = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits2.len(), 2);
        assert!(
            audits2
                .iter()
                .all(|a| batch_payload(a)["seq"].as_u64().unwrap() == 1),
            "forget 清 seq 计数后两批 seq 均为 1"
        );
    }

    fn now_millis() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }
}
