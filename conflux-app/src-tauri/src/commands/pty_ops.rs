// ===== PTY 操作命令层 =====
// 提供 stdin 注入和终端尺寸调整的 Tauri IPC 命令
// 包含 StdinInjectionPolicy 安全检查（附录 B1）

use tauri::{AppHandle, State};

use crate::core::injection::inject_with_policy;
use crate::core::{ConfluxError, InjectionSource, InstanceId, PermissionDecision};
use crate::AppState;

/// 向 Agent 实例的 stdin 注入内容（IPC command）。
///
/// MF-1（契约 §13.1）：本命令是 `inject_with_policy` 唯一入口的**薄包装**，
/// 行为不变。policy 检查（长度 / forbidden_patterns / 速率）、实际注入、
/// `StdinInjected` emit 全部收敛在 `inject_with_policy` 内。
///
/// 自动/批量注入（OrchestrationAuto / DiscussionUserMessage）走 StdinInjectionPolicy；
/// 用户在展开终端里直接打字（UserDirect）不走该策略——否则逐键输入会被自动注入的
/// 限速误伤。
///
/// # 参数
/// - `instance_id`: 目标实例标识
/// - `input`: 要注入的文本内容
/// - `source`: 注入来源分类（用于审计和策略判断）
#[tauri::command]
pub async fn inject_stdin(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: InstanceId,
    input: String,
    source: Option<InjectionSource>,
) -> Result<(), ConfluxError> {
    let source_resolved = source.unwrap_or(InjectionSource::UserDirect);
    inject_with_policy(&app, &state, &instance_id.0, &input, source_resolved)
}

/// 调整 Agent 实例的 PTY 终端尺寸
///
/// # 参数
/// - `instance_id`: 目标实例标识
/// - `cols`: 列数
/// - `rows`: 行数
#[tauri::command]
pub async fn resize_pty(
    state: State<'_, AppState>,
    instance_id: InstanceId,
    cols: u16,
    rows: u16,
) -> Result<(), ConfluxError> {
    // 验证实例存在
    {
        let map = state.instance_adapter_map.read();
        if !map.contains_key(&instance_id.0) {
            return Err(ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            });
        }
    }

    // 执行 resize
    state.pty_manager.resize(&instance_id.0, cols, rows)
}

/// 响应权限请求（F-02 修复：前端 PermissionDialog 调用此命令）
///
/// B3 契约 2：按 instance_id 直接匹配，不再遍历所有实例。
/// 根据用户决定（Approve/Deny）向 Agent 的 stdin 注入对应的响应。
/// Approve → 注入 "Y\n"，Deny → 注入 "N\n"
///
/// # 参数
/// - `instance_id`: 目标实例标识
/// - `permission_id`: 权限请求 ID（用于审计日志）
/// - `decision`: 用户决定（approve 或 deny）
#[tauri::command]
pub async fn respond_to_permission(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: InstanceId,
    permission_id: String,
    decision: PermissionDecision,
) -> Result<(), ConfluxError> {
    // 1. 验证实例存在且状态为 WaitingPermission
    {
        let detail = state.pty_manager.get_instance_state(&instance_id.0)?;
        if detail.status != crate::core::AgentStatus::WaitingPermission {
            log::warn!(
                "respond_to_permission: 实例 {} 状态不是 WaitingPermission（当前: {:?}），permission_id={}",
                instance_id.0,
                detail.status,
                permission_id
            );
            // 不阻止注入——Agent 可能已经超时自行切换状态，但用户的响应仍然有效
        }
    }

    let input = match decision {
        PermissionDecision::Approve => "Y\r",
        PermissionDecision::Deny => "N\r",
    };

    log::debug!(
        "respond_to_permission: instance={}, decision={:?}, permission_id={}",
        instance_id.0,
        decision,
        permission_id
    );

    // MF-1（契约 §13.1）：固定 Y/N 响应也经唯一入口 `inject_with_policy`，不裸调
    // `pty_manager.inject_stdin`。source=PermissionResponse 不触发 StdinInjectionPolicy
    // （内容固定为 "Y\r"/"N\r"），行为与原直调一致；同时保证全代码库注入 chokepoint 唯一。
    // 若未来扩展为接受用户自定义内容，应改用受 policy 的 source。
    inject_with_policy(
        &app,
        &state,
        &instance_id.0,
        input,
        InjectionSource::PermissionResponse,
    )
}

#[cfg(test)]
mod tests {
    use crate::core::injection::should_enforce_stdin_injection_policy;
    use crate::core::InjectionSource;

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
}
