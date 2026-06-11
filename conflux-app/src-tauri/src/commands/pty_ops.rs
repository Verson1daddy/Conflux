// ===== PTY 操作命令层 =====
// 提供 stdin 注入和终端尺寸调整的 Tauri IPC 命令
// 包含 StdinInjectionPolicy 安全检查（附录 B1）

use tauri::{AppHandle, State};

use crate::core::audit::AuditAction;
use crate::core::event_emit::emit_attention_updated;
use crate::core::injection::inject_with_policy;
use crate::core::interaction::InteractionResolution;
use crate::core::{ConfluxError, InjectionSource, InstanceId, PermissionDecision};
use crate::AppState;

/// 向 Agent 实例的 stdin 注入内容（IPC command）——**用户直接输入通道**。
///
/// MF-1（§13.1）：经唯一入口 `inject_with_policy`，不裸调 `pty_manager.inject_stdin`。
/// **MF-2（§13.2 / §4.4）：注入源由后端固定为 `UserDirect`，不接受前端入参**——
/// 前端永不能自标 `OrchestrationAuto` / `System` 等特权源（否则可伪造审计 actor）。
/// 讨论消息注入走专门命令 `inject_discussion_message`（后端固定 DiscussionUserMessage）；
/// coordinator 自动注入走 `inject_with_policy(OrchestrationAuto)`（后端，不经本命令）。
///
/// # 参数
/// - `instance_id`: 目标实例标识
/// - `input`: 要注入的文本（展开终端直接打字 / reply / send-to）
#[tauri::command]
pub async fn inject_stdin(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: InstanceId,
    input: String,
) -> Result<(), ConfluxError> {
    // 源由命令身份硬编码——此命令即"用户直接输入"通道。
    inject_with_policy(
        &app,
        &state,
        &instance_id.0,
        &input,
        InjectionSource::UserDirect,
    )
}

/// 讨论消息注入（MF-2 / §13.9）——**讨论用户消息通道**。
///
/// 注入源由后端固定为 `DiscussionUserMessage`，前端不能自标。经唯一入口
/// `inject_with_policy`，自动写 actor=User / action=DiscussionInjection 审计（MF-6），
/// 并受 StdinInjectionPolicy 闸（内容/速率 per-instance）。替代原先前端
/// `injectStdin(id, content, "discussion_user_message")` 的自标 source 路径。
///
/// # 参数
/// - `instance_id`: 目标参与 agent 实例
/// - `input`: 讨论中需注入该 agent stdin 的用户消息内容
#[tauri::command]
pub async fn inject_discussion_message(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: InstanceId,
    input: String,
) -> Result<(), ConfluxError> {
    inject_with_policy(
        &app,
        &state,
        &instance_id.0,
        &input,
        InjectionSource::DiscussionUserMessage,
    )
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
    state.pane_runtime.resize(&instance_id.0, cols, rows)
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
        let detail = state.pane_runtime.get_instance_state(&instance_id.0)?;
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
    //
    // 注入审计（result=Ok，actor=User，injection_source=PermissionResponse）由
    // `inject_with_policy` 内部按 source 硬编码写入（MF-2/MF-6）。
    inject_with_policy(
        &app,
        &state,
        &instance_id.0,
        input,
        InjectionSource::PermissionResponse,
    )?;

    // P3 权限流闭环：注入成功后 resolve 对应的活跃 AttentionItem（kind=Permission，
    // interaction_id == permission_id），形成
    // 「事件 → attention item → 用户 approve/deny → 注入 → 审计 → resolve」闭环。
    //
    // 语义各写各的（避免重复/遗漏审计）：
    //   - 注入审计由上面的 `inject_with_policy` 写（injection_source=PermissionResponse）；
    //   - resolve 审计由下面的 `AttentionQueue::resolve` 写（action=Approve/Deny，
    //     与注入审计是两条不同语义的审计）。
    //
    // 找不到对应活跃项不视为错误（item 可能已被去重/defer/ignore，或事件未上浮）——
    // 注入本身已生效，仅记日志。
    let (resolution, action) = match decision {
        PermissionDecision::Approve => (InteractionResolution::Approved, AuditAction::Approve),
        PermissionDecision::Deny => (InteractionResolution::Denied, AuditAction::Deny),
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let resolved = {
        let mut queue = state.attention_queue.write();
        // 找到匹配的活跃 Permission 项（按 interaction_id == permission_id）
        let target_id = queue.list_active().into_iter().find_map(|it| {
            if it.interaction_id.as_deref() == Some(permission_id.as_str()) {
                Some(it.attention_item_id)
            } else {
                None
            }
        });

        match target_id {
            Some(ai_id) => {
                let conn = state.db.lock();
                match queue.resolve(&conn, &ai_id, resolution, action, now_ms) {
                    Ok(_) => true,
                    Err(e) => {
                        log::warn!(
                            "respond_to_permission: resolve 注意力项失败 (permission_id={}): {e}",
                            permission_id
                        );
                        false
                    }
                }
            }
            None => {
                log::debug!(
                    "respond_to_permission: 无匹配活跃注意力项 (permission_id={})，仅注入未 resolve",
                    permission_id
                );
                false
            }
        }
    };

    if resolved {
        emit_attention_updated(&app);
    }

    Ok(())
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
