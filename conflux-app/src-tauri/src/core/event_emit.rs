// ===== 事件派发到 Tauri 前端 =====
// 将 ConfluxEvent 变体路由到前端约定的通道名，与
// `src/lib/event-listener.ts` 里的 EVENT_CHANNELS 一一对应。
//
// 每个事件会发到两个通道：
//   1. 统一通道 `conflux://event`（包含完整 ConfluxEvent，便于审计/录制）
//   2. 分类型通道（只包含内部 payload 字段），前端的 on* hooks 使用

use tauri::{AppHandle, Emitter, Manager};

use super::event::ConfluxEvent;

pub mod channels {
    pub const UNIFIED: &str = "conflux://event";
    pub const AGENT_STATUS_CHANGED: &str = "conflux://agent-status-changed";
    pub const PERMISSION_REQUESTED: &str = "conflux://permission-requested";
    pub const SUB_AGENT_SPAWNED: &str = "conflux://sub-agent-spawned";
    pub const SUB_AGENT_COMPLETED: &str = "conflux://sub-agent-completed";
    pub const TASK_COMPLETED: &str = "conflux://task-completed";
    pub const ERROR_OCCURRED: &str = "conflux://error-occurred";
    pub const DISCUSSION_MESSAGE: &str = "conflux://discussion-message";
    pub const COORDINATION_COMMAND: &str = "conflux://coordination-command";
    pub const PTY_OUTPUT: &str = "conflux://pty-output";
    pub const STDIN_INJECTED: &str = "conflux://stdin-injected";
    pub const PROCESS_EXITED: &str = "conflux://process-exited";
}

/// 将 ConfluxEvent 派发到统一通道 + 对应的分类型通道
///
/// emit 失败只记录日志，不 panic——通道断开（例如前端 reload 中）不应影响 PTY 读取线程。
pub fn emit_conflux_event(app: &AppHandle, event: &ConfluxEvent) {
    // 统一通道
    if let Err(e) = app.emit(channels::UNIFIED, event) {
        log::warn!("emit unified event failed: {}", e);
    }

    // 分类型通道——payload 是事件内部字段的 serde_json::Value
    let (channel, payload) = match event {
        ConfluxEvent::AgentStatusChanged {
            instance_id,
            old_status,
            new_status,
            timestamp,
        } => (
            channels::AGENT_STATUS_CHANGED,
            serde_json::json!({
                "instance_id": instance_id,
                "old_status": old_status,
                "new_status": new_status,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::PermissionRequested {
            instance_id,
            request,
            timestamp,
        } => (
            channels::PERMISSION_REQUESTED,
            serde_json::json!({
                "instance_id": instance_id,
                "request": request,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::SubAgentSpawned {
            instance_id,
            sub_agent,
            timestamp,
        } => (
            channels::SUB_AGENT_SPAWNED,
            serde_json::json!({
                "instance_id": instance_id,
                "sub_agent": sub_agent,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::SubAgentCompleted {
            instance_id,
            sub_agent_id,
            result_summary,
            timestamp,
        } => (
            channels::SUB_AGENT_COMPLETED,
            serde_json::json!({
                "instance_id": instance_id,
                "sub_agent_id": sub_agent_id,
                "result_summary": result_summary,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::TaskCompleted {
            instance_id,
            summary,
            timestamp,
        } => (
            channels::TASK_COMPLETED,
            serde_json::json!({
                "instance_id": instance_id,
                "summary": summary,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::ErrorOccurred {
            instance_id,
            error_message,
            severity,
            timestamp,
        } => (
            channels::ERROR_OCCURRED,
            serde_json::json!({
                "instance_id": instance_id,
                "error_message": error_message,
                "severity": severity,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::DiscussionMessage {
            discussion_id,
            message,
            timestamp,
        } => (
            channels::DISCUSSION_MESSAGE,
            serde_json::json!({
                "discussion_id": discussion_id,
                "message": message,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::CoordinationCommand {
            target_instance_id,
            command_text,
            source_discussion_id,
            timestamp,
        } => (
            channels::COORDINATION_COMMAND,
            serde_json::json!({
                "target_instance_id": target_instance_id,
                "command_text": command_text,
                "source_discussion_id": source_discussion_id,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::PtyOutput {
            instance_id,
            data,
            timestamp,
        } => (
            channels::PTY_OUTPUT,
            serde_json::json!({
                "instance_id": instance_id,
                "data": data,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::StdinInjected {
            instance_id,
            source,
            content_preview,
            content_length,
            timestamp,
        } => (
            channels::STDIN_INJECTED,
            serde_json::json!({
                "instance_id": instance_id,
                "source": source,
                "content_preview": content_preview,
                "content_length": content_length,
                "timestamp": timestamp,
            }),
        ),
        ConfluxEvent::ProcessExited {
            instance_id,
            adapter_id,
            exit_code,
            signal,
            timestamp,
        } => (
            channels::PROCESS_EXITED,
            serde_json::json!({
                "instance_id": instance_id,
                "adapter_id": adapter_id,
                "exit_code": exit_code,
                "signal": signal,
                "timestamp": timestamp,
            }),
        ),
    };

    if let Err(e) = app.emit(channel, &payload) {
        log::warn!("emit typed channel '{}' failed: {}", channel, e);
    }

    // DB 录制——跳过 PtyOutput（高频，每秒数十次）
    if !matches!(event, ConfluxEvent::PtyOutput { .. }) {
        if let Some(state) = app.try_state::<crate::AppState>() {
            let conn = state.db.lock();
            if let Err(e) = crate::persistence::session::insert_session_event(&conn, event) {
                log::warn!("session_event 写入失败: {e}");
            }
        }
    }
}
