// ===== stdin 注入唯一入口（MF-1 / CRIT-01 修复，契约 §13.1） =====
//
// 全代码库**唯一**的 stdin 注入路径。`pty_manager.inject_stdin` 只允许在
// `inject_with_policy` 内被调用一次（command 包装、coordinator 自动注入等所有
// 路径统一收敛于此），构成单一 chokepoint。任何旁路裸调 `inject_stdin` 都违反
// 契约 §13.1，会在 X4 安全闸被拒。
//
// 本模块收敛：
//   1. StdinInjectionPolicy 检查（长度 / forbidden_patterns / per-window 速率）
//   2. 实际 `pty_manager.inject_stdin` 调用（唯一真实注入点）
//   3. emit `StdinInjected` 事件
//
// 注意：`forbidden_patterns` 仅为 defense-in-depth 黑名单，**不是唯一防线、不提供
// 安全保证**（契约 §13.5，已知可被引号拼接 / 空格 / 编码 / 同义命令绕过）。真正的
// 安全模型是「风险分级 + 默认确认」，由 P3 的确认闸（MF-4）落地。

use tauri::AppHandle;

use crate::core::audit::{AuditAction, AuditActor, AuditEvent, AuditResult};
use crate::core::event_emit::emit_conflux_event;
use crate::core::{ConfluxError, ConfluxEvent, InjectionSource, InstanceId, StdinInjectionPolicy};
use crate::persistence::audit::insert_audit_event;
use crate::AppState;

/// 后端硬编码：把注入来源映射为审计 (actor, action)（MF-6 / §13.2）。
///
/// `actor` / `action` **只能由后端按 `InjectionSource` 硬编码**，绝不接受前端/IPC
/// 入参指定——前端永不能自标 `System`/`Coordinator`。映射规则（契约 §13.2）：
///   - UserDirect          → actor=User,        action=Reply
///   - PermissionResponse  → actor=User,        action=Reply
///   - DiscussionUserMessage → actor=User,      action=DiscussionInjection
///   - OrchestrationAuto   → actor=Coordinator, action=AutoInjection
pub fn audit_identity_for_source(source: &InjectionSource) -> (AuditActor, AuditAction) {
    match source {
        InjectionSource::UserDirect => (AuditActor::User, AuditAction::Reply),
        InjectionSource::PermissionResponse => (AuditActor::User, AuditAction::Reply),
        InjectionSource::DiscussionUserMessage => {
            (AuditActor::User, AuditAction::DiscussionInjection)
        }
        InjectionSource::OrchestrationAuto => (AuditActor::Coordinator, AuditAction::AutoInjection),
    }
}

/// 构造一条注入审计事件（后端硬编码 actor/action/injection_source，MF-6）。
/// `pub(crate)`：cutover ③ 起 `pty/hooks.rs::AuditHook` 复用同一构造。
pub(crate) fn build_injection_audit(
    instance_id: &str,
    source: &InjectionSource,
    result: AuditResult,
    now_ms: i64,
) -> AuditEvent {
    let (actor, action) = audit_identity_for_source(source);
    AuditEvent {
        audit_event_id: AuditEvent::new_id(),
        actor,
        action,
        instance_id: Some(InstanceId(instance_id.to_string())),
        source_event_id: None,
        interaction_id: None,
        // injection_source 由后端硬编码，前端永不能指定（MF-6）
        injection_source: Some(source.clone()),
        result,
        created_at: now_ms,
        rationale_ref: None,
    }
}

/// 写一条注入审计（在 `state.db` 锁内执行 INSERT）。
///
/// 返回 `Ok` 表示审计已落库；`Err` 表示审计写入失败，调用方据此 fail-closed。
fn write_injection_audit(state: &AppState, event: &AuditEvent) -> Result<(), ConfluxError> {
    let conn = state.db.lock();
    insert_audit_event(&conn, event)
}

/// **审计-注入核心**（fail-closed 不变量，MF-2 / §13.2）——与 Tauri 运行时解耦的可测试种子。
///
/// 顺序严格固定，保证「绝不出现未审计的注入」：
///   1. **先**写一条 `result=Ok` 审计；审计 INSERT 失败 ⇒ 立即返回 Err，
///      **绝不调用 `do_inject`**（fail-closed：无注入）。
///   2. 审计成功后才调用 `do_inject` 真正写 stdin。
///   3. 注入本身失败 ⇒ 追加一条 `result=Failed` 审计（Ok 审计保留以体现已尝试），
///      再向上抛错。
///
/// `actor` / `action` / `injection_source` 均由 `build_injection_audit` 按 `source`
/// 后端硬编码（MF-6），调用方无法绕过。
///
/// 返回 `Ok(audit_event_id)`——已落库的 Ok 审计 ID（供调用方关联）。
fn audited_inject<F>(
    conn: &rusqlite::Connection,
    instance_id: &str,
    source: &InjectionSource,
    now_ms: i64,
    do_inject: F,
) -> Result<String, ConfluxError>
where
    F: FnOnce() -> Result<(), ConfluxError>,
{
    // 1. 先审计（fail-closed 关键步）
    let ok_audit = build_injection_audit(instance_id, source, AuditResult::Ok, now_ms);
    insert_audit_event(conn, &ok_audit)?; // 审计失败 ⇒ ? 早返回，do_inject 永不执行

    // 2. 审计成功后才注入
    if let Err(e) = do_inject() {
        // 3. 注入失败 ⇒ 追加 Failed 审计（best-effort，不掩盖原始注入错误）
        let failed_audit = build_injection_audit(instance_id, source, AuditResult::Failed, now_ms);
        if let Err(ae) = insert_audit_event(conn, &failed_audit) {
            log::warn!("注入失败且 Failed 审计写入失败: {ae}");
        }
        return Err(e);
    }

    Ok(ok_audit.audit_event_id)
}

/// 判断该注入来源是否需要执行 StdinInjectionPolicy 安全检查。
///
/// 用户在展开终端里直接打字（UserDirect）以及固定 Y/N 的权限响应
/// （PermissionResponse）不走该策略；否则逐键输入会被自动注入的限速误伤。
/// 自动调度（OrchestrationAuto）与讨论批量消息（DiscussionUserMessage）必须走策略。
pub fn should_enforce_stdin_injection_policy(source: &InjectionSource) -> bool {
    matches!(
        source,
        InjectionSource::OrchestrationAuto | InjectionSource::DiscussionUserMessage
    )
}

/// 纯函数：对 payload 执行长度 + forbidden_patterns 校验（不含速率、无副作用）。
///
/// 拆出为纯函数以便不依赖 Tauri AppHandle 做单元测试。命中即返回 `Err`，
/// 调用方据此 fail-closed（不写 stdin）。
pub fn check_content_policy(
    policy: &StdinInjectionPolicy,
    input: &str,
) -> Result<(), ConfluxError> {
    // 长度检查
    if input.len() > policy.max_injection_length {
        return Err(ConfluxError::OrchestrationError {
            message: format!(
                "注入内容超过最大长度限制: {} > {}",
                input.len(),
                policy.max_injection_length
            ),
        });
    }

    // 禁止模式检查（case-insensitive，defense-in-depth）
    for pattern in &policy.forbidden_patterns {
        if input.to_lowercase().contains(&pattern.to_lowercase()) {
            return Err(ConfluxError::OrchestrationError {
                message: format!("注入内容包含禁止模式: '{}'", pattern),
            });
        }
    }

    Ok(())
}

/// 纯函数：对单个 instance 的 1 分钟滑动窗口做限速判定（MF-3：**per-instance**）。
///
/// 拆出为纯函数以便不依赖 Tauri AppHandle / AppState 做单元测试。
/// 放行时记录本次 `now` 并返回 `Ok(())`；超限时**不记录**、返回 `Err(当前窗口内计数)`。
/// 各 instance 互不影响——单 pane 刷注入不会饿死其它 pane。
/// `pub(crate)`：cutover ③ 起 `pty/hooks.rs::PolicyHook` 复用同一判定。
pub(crate) fn check_and_record_rate_limit(
    counters: &mut std::collections::HashMap<String, Vec<u64>>,
    instance_id: &str,
    now: u64,
    max_rate: u32,
) -> Result<(), usize> {
    let window_start = now.saturating_sub(60);
    let counter = counters.entry(instance_id.to_string()).or_default();
    counter.retain(|&ts| ts > window_start);
    if counter.len() as u32 >= max_rate {
        return Err(counter.len());
    }
    counter.push(now);
    Ok(())
}

/// **唯一注入入口**（MF-1 / CRIT-01，契约 §13.1）。
///
/// 收敛 policy 检查 + `pty_manager.inject_stdin` 实际注入 + `StdinInjected` emit。
/// 所有需要写 agent stdin 的路径（IPC command、coordinator 自动注入、讨论消息）
/// 必须经此函数，不得旁路裸调 `pty_manager.inject_stdin`。
///
/// `source` 由后端命令边界按命令身份硬编码赋值，前端永不能自标
/// `OrchestrationAuto`（契约 §13.2）。
///
/// # 参数
/// - `app`: Tauri AppHandle，用于 emit `StdinInjected`
/// - `state`: 全局状态（policy / 速率计数器 / pty_manager）
/// - `instance_id`: 目标实例标识
/// - `content`: 要注入的文本内容
/// - `source`: 注入来源分类（用于审计和策略判断）
pub fn inject_with_policy(
    app: &AppHandle,
    state: &AppState,
    instance_id: &str,
    content: &str,
    source: InjectionSource,
) -> Result<(), ConfluxError> {
    // 1. 验证实例存在
    {
        let map = state.instance_adapter_map.read();
        if !map.contains_key(instance_id) {
            return Err(ConfluxError::InstanceNotFound {
                instance_id: instance_id.to_string(),
            });
        }
    }

    let enforce_policy = should_enforce_stdin_injection_policy(&source);

    let now_ms = || {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    };

    // 2. 内容策略检查（长度 + forbidden_patterns）
    // policy 拒绝 ⇒ 写一条 result=Rejected 审计后返回 Err（不注入）。MF-2/§13.2。
    if enforce_policy {
        let policy = state.stdin_policy.read();
        if let Err(e) = check_content_policy(&policy, content) {
            drop(policy);
            let audit =
                build_injection_audit(instance_id, &source, AuditResult::Rejected, now_ms());
            // Rejected 路径本就不注入；审计 best-effort（失败仅记日志，仍返回拒绝 Err）。
            if let Err(ae) = write_injection_audit(state, &audit) {
                log::warn!("注入被策略拒绝且 Rejected 审计写入失败: {ae}");
            }
            return Err(e);
        }
    }

    // 3. 速率限制检查（1 分钟滑动窗口，MF-3：**per-instance**；判定见 check_and_record_rate_limit）
    if enforce_policy {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        // 先读 policy（独立锁），再拿计数器，避免持计数器锁期间再取另一把锁。
        let max_rate = state.stdin_policy.read().rate_limit_per_minute;

        let mut counters = state.injection_rate_counter.write();
        if let Err(count) = check_and_record_rate_limit(&mut counters, instance_id, now, max_rate) {
            drop(counters);
            let audit =
                build_injection_audit(instance_id, &source, AuditResult::Rejected, now_ms());
            if let Err(ae) = write_injection_audit(state, &audit) {
                log::warn!("注入速率超限且 Rejected 审计写入失败: {ae}");
            }
            return Err(ConfluxError::OrchestrationError {
                message: format!(
                    "注入速率超限: 实例 {} 过去 1 分钟内已注入 {} 次（限制 {}）",
                    instance_id, count, max_rate
                ),
            });
        }
    }

    // 4. 审计-注入核心（fail-closed，MF-2 / §13.2 + chokepoint §13.1）。
    // 在单个 db 锁关键区内：**先**写 Ok 审计，审计失败 ⇒ 不注入直接返回 Err；
    // 审计成功后才经 `pty_manager.inject_stdin`（全代码库唯一真实 stdin 注入点）注入。
    // actor / injection_source 由 source 后端硬编码（MF-6）。
    {
        let conn = state.db.lock();
        audited_inject(&conn, instance_id, &source, now_ms(), || {
            state.pty_manager.inject_stdin(instance_id, content)
        })?;
    }

    // 5. emit StdinInjected 事件（B3 契约 1）
    // UTF-8 安全截断：避免在多字节字符中间切断导致 panic
    let preview = if content.len() > 200 {
        match content.char_indices().take_while(|(i, _)| *i < 200).last() {
            Some((i, c)) => content[..i + c.len_utf8()].to_string(),
            None => String::new(),
        }
    } else {
        content.to_string()
    };
    let event = ConfluxEvent::StdinInjected {
        instance_id: InstanceId(instance_id.to_string()),
        source,
        content_preview: preview,
        content_length: content.len(),
        timestamp: now_ms(),
    };
    emit_conflux_event(app, &event);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_direct_bypasses_automated_injection_policy() {
        assert!(!should_enforce_stdin_injection_policy(
            &InjectionSource::UserDirect
        ));
    }

    #[test]
    fn permission_response_bypasses_automated_injection_policy() {
        assert!(!should_enforce_stdin_injection_policy(
            &InjectionSource::PermissionResponse
        ));
    }

    #[test]
    fn orchestration_auto_keeps_automated_injection_policy() {
        assert!(should_enforce_stdin_injection_policy(
            &InjectionSource::OrchestrationAuto
        ));
    }

    #[test]
    fn discussion_user_message_keeps_bulk_injection_policy() {
        assert!(should_enforce_stdin_injection_policy(
            &InjectionSource::DiscussionUserMessage
        ));
    }

    #[test]
    fn forbidden_pattern_payload_is_rejected_before_injection() {
        let policy = StdinInjectionPolicy::default();
        // "rm -rf /" 在默认 forbidden_patterns 中。
        let result = check_content_policy(&policy, "please run rm -rf / now");
        assert!(
            result.is_err(),
            "命中 forbidden_pattern 的 payload 必须被拒（不写 stdin）"
        );
        let msg = format!("{:?}", result.unwrap_err());
        assert!(msg.contains("禁止模式"), "拒绝原因应为禁止模式: {msg}");
    }

    #[test]
    fn forbidden_pattern_check_is_case_insensitive() {
        let policy = StdinInjectionPolicy::default();
        // "DROP TABLE" 在默认 forbidden_patterns 中，使用小写应同样命中。
        assert!(check_content_policy(&policy, "drop table users;").is_err());
    }

    #[test]
    fn benign_payload_passes_content_policy() {
        let policy = StdinInjectionPolicy::default();
        assert!(check_content_policy(&policy, "echo hello world\n").is_ok());
    }

    #[test]
    fn oversized_payload_is_rejected() {
        let policy = StdinInjectionPolicy::default();
        let huge = "a".repeat(policy.max_injection_length + 1);
        let result = check_content_policy(&policy, &huge);
        assert!(result.is_err(), "超长 payload 必须被拒");
        let msg = format!("{:?}", result.unwrap_err());
        assert!(msg.contains("最大长度"), "拒绝原因应为长度超限: {msg}");
    }

    // ===== P3 MF-2 / MF-6：审计-注入 fail-closed 测试 =====
    // 用与 Tauri 运行时解耦的 `audited_inject` 种子验证不变量，
    // 不依赖真实 PTY / AppHandle（成功路径的实际 inject 由 do_inject 闭包模拟）。

    use crate::persistence::audit::list_audit_events;
    use crate::persistence::schema::init_database;
    use std::cell::Cell;

    /// actor / action 由 source 后端硬编码（MF-6）——前端无法影响归属。
    #[test]
    fn audit_identity_is_hardcoded_per_source() {
        assert_eq!(
            audit_identity_for_source(&InjectionSource::UserDirect),
            (AuditActor::User, AuditAction::Reply)
        );
        assert_eq!(
            audit_identity_for_source(&InjectionSource::PermissionResponse),
            (AuditActor::User, AuditAction::Reply)
        );
        assert_eq!(
            audit_identity_for_source(&InjectionSource::DiscussionUserMessage),
            (AuditActor::User, AuditAction::DiscussionInjection)
        );
        assert_eq!(
            audit_identity_for_source(&InjectionSource::OrchestrationAuto),
            (AuditActor::Coordinator, AuditAction::AutoInjection)
        );
    }

    /// 成功注入后 audit_events 多一条 result=Ok，且 actor/injection_source 按 source 正确。
    #[test]
    fn audited_inject_writes_ok_audit_on_success() {
        let conn = init_database(":memory:").unwrap();
        let injected = Cell::new(false);

        let id = audited_inject(
            &conn,
            "inst-a",
            &InjectionSource::OrchestrationAuto,
            1_000,
            || {
                injected.set(true);
                Ok(())
            },
        )
        .expect("成功路径应返回 Ok");

        assert!(injected.get(), "审计成功后必须真正注入");

        let audits = list_audit_events(&conn, None, None).unwrap();
        assert_eq!(audits.len(), 1, "成功注入应恰好写一条审计");
        let a = &audits[0];
        assert_eq!(a.audit_event_id, id);
        assert_eq!(a.result, AuditResult::Ok);
        // actor / injection_source 后端硬编码（OrchestrationAuto → Coordinator）
        assert_eq!(a.actor, AuditActor::Coordinator);
        assert_eq!(a.action, AuditAction::AutoInjection);
        assert_eq!(a.injection_source, Some(InjectionSource::OrchestrationAuto));
    }

    /// **fail-closed 核心**：审计 INSERT 失败 ⇒ 返回 Err 且 **do_inject 永不被调用**
    /// （绝不出现未审计的注入）。
    #[test]
    fn audited_inject_fail_closed_when_audit_insert_fails() {
        let conn = init_database(":memory:").unwrap();
        // 令审计 INSERT 必然失败：删除 audit_events 表。
        conn.execute("DROP TABLE audit_events", []).unwrap();

        let injected = Cell::new(false);
        let res = audited_inject(
            &conn,
            "inst-a",
            &InjectionSource::OrchestrationAuto,
            1_000,
            || {
                injected.set(true);
                Ok(())
            },
        );

        assert!(res.is_err(), "审计写入失败时必须返回 Err");
        assert!(
            !injected.get(),
            "fail-closed：审计失败时绝不能注入（do_inject 不得被调用）"
        );
    }

    /// 注入本身失败 ⇒ Ok 审计已落库 + 追加一条 result=Failed 审计，并向上抛错。
    #[test]
    fn audited_inject_appends_failed_audit_when_injection_fails() {
        let conn = init_database(":memory:").unwrap();

        let res = audited_inject(
            &conn,
            "inst-a",
            &InjectionSource::PermissionResponse,
            2_000,
            || {
                Err(ConfluxError::PtyError {
                    message: "stdin 写入失败".to_string(),
                })
            },
        );
        assert!(res.is_err(), "注入失败应向上抛错");

        let audits = list_audit_events(&conn, None, None).unwrap();
        // 一条 Ok（注入前）+ 一条 Failed（注入失败后）
        assert_eq!(audits.len(), 2);
        assert!(audits.iter().any(|a| a.result == AuditResult::Ok));
        assert!(audits.iter().any(|a| a.result == AuditResult::Failed));
        // 两条都按 source 硬编码归属（PermissionResponse → User）
        assert!(audits.iter().all(|a| a.actor == AuditActor::User
            && a.injection_source == Some(InjectionSource::PermissionResponse)));
    }

    // ===== MF-3：per-instance 限速 =====

    /// 限速 per-instance——instance A 打满不影响 instance B。
    #[test]
    fn rate_limit_is_per_instance() {
        let mut counters = std::collections::HashMap::new();
        // A 在同一秒内注入到上限 3
        assert!(check_and_record_rate_limit(&mut counters, "inst-a", 1000, 3).is_ok());
        assert!(check_and_record_rate_limit(&mut counters, "inst-a", 1000, 3).is_ok());
        assert!(check_and_record_rate_limit(&mut counters, "inst-a", 1000, 3).is_ok());
        // A 第 4 次超限（窗口内已 3 次）
        assert_eq!(
            check_and_record_rate_limit(&mut counters, "inst-a", 1000, 3),
            Err(3)
        );
        // B 不受 A 影响，仍可注入（旧实现的全局计数器会在此误伤 B）
        assert!(check_and_record_rate_limit(&mut counters, "inst-b", 1000, 3).is_ok());
    }

    /// 滑出 60s 窗口的旧时间戳被回收，计数恢复。
    #[test]
    fn rate_limit_window_slides() {
        let mut counters = std::collections::HashMap::new();
        assert!(check_and_record_rate_limit(&mut counters, "inst-a", 1000, 1).is_ok());
        // 同窗口第 2 次超限（max=1）
        assert!(check_and_record_rate_limit(&mut counters, "inst-a", 1000, 1).is_err());
        // 61s 后旧时间戳滑出窗口，恢复放行
        assert!(check_and_record_rate_limit(&mut counters, "inst-a", 1062, 1).is_ok());
    }
}
