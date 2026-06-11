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

/// fail-closed 审计钩子（原 audited_inject，MF-2/MF-6）。
///
/// - `before_inject`：写 `result=Ok` 审计；INSERT 失败 ⇒ Err ⇒ conmux 保证字节绝不抵达 PTY。
/// - `after_inject`：按结果判别——`Err(InjectionRejected)`（policy 拒，自己的 before 未跑或
///   审计自身失败）⇒ 补写 Rejected；其它 `Err`（PTY 写失败，Ok 审计已落）⇒ 追加 Failed；
///   `Ok` ⇒ no-op。审计补写均 best-effort（失败仅记日志，不掩盖原始错误）。
pub struct AuditHook {
    db: Arc<parking_lot::Mutex<rusqlite::Connection>>,
}

impl AuditHook {
    pub fn new(db: Arc<parking_lot::Mutex<rusqlite::Connection>>) -> Self {
        Self { db }
    }

    fn write_audit(&self, instance_id: &str, source: &conmux::InjectionSource, result: AuditResult) {
        let audit = build_injection_audit(instance_id, source, result, now_millis());
        let conn = self.db.lock();
        if let Err(e) = insert_audit_event(&conn, &audit) {
            log::warn!("注入审计补写失败（best-effort）: {e}");
        }
    }
}

impl InjectionHook for AuditHook {
    fn before_inject(&self, ctx: &InjectionContext) -> Result<(), ConmuxError> {
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
        let ctx = InjectionContext::new(&id, InjectionSource::UserDirect, b"x");
        // before_inject Err ⇒ conmux 层保证 write_all 不被调用（pane.rs 已有 fail-closed 测试）。
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
        let ctx = InjectionContext::new(&id, InjectionSource::UserDirect, b"x");
        hook.before_inject(&ctx).unwrap();
        hook.after_inject(&ctx, &Ok(()));
        let audits = list_audit_events(&db.lock(), None, None).unwrap();
        assert_eq!(audits.len(), 1, "成功路径恰好一条 Ok 审计（before 写）");
        assert_eq!(audits[0].result, AuditResult::Ok);
    }
}
