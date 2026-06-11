// ===== stdin 注入唯一入口（MF-1 / CRIT-01 修复，契约 §13.1） =====
//
// 全代码库**唯一**的 stdin 注入路径。`pane_runtime.inject_stdin` 只允许在
// `inject_with_policy` 内被调用一次（command 包装、coordinator 自动注入等所有
// 路径统一收敛于此），构成单一 chokepoint。任何旁路裸调 `inject_stdin` 都违反
// 契约 §13.1，会在 X4 安全闸被拒。
//
// cutover ③：policy 闸（长度/forbidden_patterns/per-pane 速率）与 fail-closed 审计
// 已下沉为 conmux 注入钩子（`pty/hooks.rs::PolicyHook/AuditHook`，AppState 装配时
// 注册）——「审计先于字节抵达 PTY」从项目约定升级为 conmux 库级保证（MF-6），且
// 可写 PTY 句柄被 conmux 类型级密封（绕过本入口在类型上不可达）。本模块保留：
//   1. 实例存在性校验 + 唯一通道调用
//   2. emit `StdinInjected` 事件
//   3. 钩子复用的纯函数（policy 判定 / 限速 / 审计构造——单测无 Tauri 依赖）
//
// 注意：`forbidden_patterns` 仅为 defense-in-depth 黑名单，**不是唯一防线、不提供
// 安全保证**（契约 §13.5，已知可被引号拼接 / 空格 / 编码 / 同义命令绕过）。真正的
// 安全模型是「风险分级 + 默认确认」，由 P3 的确认闸（MF-4）落地。

use tauri::AppHandle;

use crate::core::audit::{AuditAction, AuditActor, AuditEvent, AuditResult};
use crate::core::event_emit::emit_conflux_event;
use crate::core::{ConfluxError, ConfluxEvent, InjectionSource, InstanceId, StdinInjectionPolicy};
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
/// 收敛 `pane_runtime.inject_stdin` 实际注入 + `StdinInjected` emit。
/// 所有需要写 agent stdin 的路径（IPC command、coordinator 自动注入、讨论消息）
/// 必须经此函数，不得旁路裸调 `inject_stdin`。
///
/// cutover ③：policy 闸 / per-pane 限速 / fail-closed 审计在 conmux 钩子链内发生
/// （`before_inject` 全过才写 PTY，任一 Err ⇒ 字节绝不抵达——库级 MF-6），本层不再
/// 内联这些步骤。拒绝以 `ConmuxError::InjectionRejected` 返回 → 映射为
/// `OrchestrationError`（消息与原实现同源）。
///
/// `source` 由后端命令边界按命令身份硬编码赋值，前端永不能自标
/// `OrchestrationAuto`（契约 §13.2）。
///
/// # 参数
/// - `app`: Tauri AppHandle，用于 emit `StdinInjected`
/// - `state`: 全局状态（pane_runtime / instance_adapter_map）
/// - `instance_id`: 目标实例标识
/// - `content`: 要注入的文本内容
/// - `source`: 注入来源分类（钩子据此做审计归属与策略判断）
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

    let now_ms = || {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    };

    // 2. 唯一通道：PolicyHook（内容+限速）→ AuditHook（Ok 审计先于字节）→ 写 PTY
    //    → after 钩子（Rejected/Failed 审计），全序由 conmux 保证（MF-6）。
    state
        .pane_runtime
        .inject_stdin(instance_id, content, source.clone())?;

    // 3. emit StdinInjected 事件（B3 契约 1）
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

    // ===== P3 MF-2 / MF-6：审计归属硬编码 =====
    //（fail-closed / Rejected / Failed 时序测试已随实现迁至 pty/hooks.rs::tests——
    // cutover ③ 后审计-注入顺序由 conmux 钩子链承担。）

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
