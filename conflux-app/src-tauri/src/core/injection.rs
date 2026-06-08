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

use crate::core::event_emit::emit_conflux_event;
use crate::core::{ConfluxError, ConfluxEvent, InjectionSource, InstanceId, StdinInjectionPolicy};
use crate::AppState;

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
pub fn check_content_policy(policy: &StdinInjectionPolicy, input: &str) -> Result<(), ConfluxError> {
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

    // 2. 内容策略检查（长度 + forbidden_patterns）
    if enforce_policy {
        let policy = state.stdin_policy.read();
        check_content_policy(&policy, content)?;
    }

    // 3. 速率限制检查（1 分钟滑动窗口）
    if enforce_policy {
        let mut counter = state.injection_rate_counter.write();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let window_start = now.saturating_sub(60);
        counter.retain(|&ts| ts > window_start);

        let max_rate = state.stdin_policy.read().rate_limit_per_minute;
        if counter.len() as u32 >= max_rate {
            return Err(ConfluxError::OrchestrationError {
                message: format!(
                    "注入速率超限: 过去 1 分钟内已注入 {} 次（限制 {}）",
                    counter.len(),
                    max_rate
                ),
            });
        }

        counter.push(now);
    }

    // TODO(P3 MF-2): 此处写 AuditEvent(insert_audit_event) + actor 后端硬编码 +
    // fail-closed。每次注入（含 UserDirect/PermissionResponse/OrchestrationAuto/
    // DiscussionUserMessage）必写一条 AuditEvent；审计写入失败 ⇒ 注入 fail-closed
    // （return Err 在写 stdin 之前，result=Failed/Rejected）。actor 与 injection_source
    // 只能由后端命令边界按命令身份硬编码赋值，拒绝前端/IPC 入参指定（契约 §13.2）。
    // 本批次（P1.5）不接 DB 审计，避免 DB 线程化扩面。

    // 4. 执行注入（**全代码库唯一真实 stdin 注入点**，chokepoint）
    state.pty_manager.inject_stdin(instance_id, content)?;

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
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let event = ConfluxEvent::StdinInjected {
        instance_id: InstanceId(instance_id.to_string()),
        source,
        content_preview: preview,
        content_length: content.len(),
        timestamp: now_ms,
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
}
