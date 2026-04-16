// ===== 事件派发到 Tauri 前端 =====
// 将 ConfluxEvent 变体路由到前端约定的通道名，与
// `src/lib/event-listener.ts` 里的 EVENT_CHANNELS 一一对应。
//
// 每个事件会发到两个通道：
//   1. 统一通道 `conflux://event`（包含完整 ConfluxEvent，便于审计/录制）
//   2. 分类型通道（只包含内部 payload 字段），前端的 on* hooks 使用
//
// C-Δ1 Coordinator 激活：
//   每次 emit 后，将事件缓冲到 AppState.recent_events，
//   超过 5 分钟的事件自动淘汰；
//   若 Coordinator::should_coordinate() 返回 true，
//   则从 ContextAggregator 聚合上下文，构建协调指令，
//   通过 inject_stdin 注入到目标 PTY，并发出 CoordinationCommand 事件。

use tauri::{AppHandle, Emitter, Manager};

use super::event::ConfluxEvent;
use crate::orchestration::coordinator::Coordinator;

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

    // C-Δ1 Coordinator 激活：事件缓冲 + 协调检测 + 指令注入
    if let Some(state) = app.try_state::<crate::AppState>() {
        trigger_coordinator(app, &state, event);
    }
}

/// 从 ConfluxEvent 中提取时间戳（秒级，UNIX epoch）
fn extract_event_timestamp(event: &ConfluxEvent) -> u64 {
    let ms = match event {
        ConfluxEvent::AgentStatusChanged { timestamp, .. } => *timestamp,
        ConfluxEvent::PermissionRequested { timestamp, .. } => *timestamp,
        ConfluxEvent::SubAgentSpawned { timestamp, .. } => *timestamp,
        ConfluxEvent::SubAgentCompleted { timestamp, .. } => *timestamp,
        ConfluxEvent::TaskCompleted { timestamp, .. } => *timestamp,
        ConfluxEvent::ErrorOccurred { timestamp, .. } => *timestamp,
        ConfluxEvent::DiscussionMessage { timestamp, .. } => *timestamp,
        ConfluxEvent::CoordinationCommand { timestamp, .. } => *timestamp,
        ConfluxEvent::PtyOutput { timestamp, .. } => *timestamp,
        ConfluxEvent::StdinInjected { timestamp, .. } => *timestamp,
        ConfluxEvent::ProcessExited { timestamp, .. } => *timestamp,
    };
    ms as u64 / 1000
}

/// 获取当前 UNIX 时间戳（秒级）
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 将 AgentInstanceInfo 转换为 AgentStateDetail（用于 ContextAggregator）
fn to_agent_state_detail(info: &crate::core::types::AgentInstanceInfo) -> crate::core::AgentStateDetail {
    crate::core::AgentStateDetail {
        instance_id: info.instance_id.clone(),
        adapter_id: info.adapter_id.clone(),
        adapter_name: info.adapter_name.clone(),
        display_name: info.display_name.clone(),
        status: info.status.clone(),
        working_dir: info.working_dir.clone(),
        is_pinned: info.is_pinned,
        created_at: info.created_at,
        last_activity_at: info.created_at, // AgentInstanceInfo 无 last_activity_at，用 created_at 近似
        mode: info.mode.clone(),
        hidden: info.hidden,
        sub_agents: vec![],
    }
}

/// C-Δ1: 协调器触发主函数
///
/// 在每个事件 emit 后调用：
/// 1. 缓冲事件（每 5 分钟窗口，超过则淘汰）
/// 2. 检查是否满足协调条件（Coordinator::should_coordinate）
/// 3. 若满足，聚合上下文并构建调度指令
/// 4. 通过 inject_stdin 注入到目标 PTY
/// 5. 发出 CoordinationCommand 事件
fn trigger_coordinator(app: &AppHandle, state: &crate::AppState, event: &ConfluxEvent) {
    let now = now_secs();
    let window_secs = 5 * 60; // 5 分钟窗口

    // 1. 缓冲 + 淘汰旧事件（HIGH-04 修复：只持有 RwLock，锁粒度最小）
    {
        let mut buf = state.recent_events.write();
        // 淘汰超过 5 分钟的事件
        buf.retain(|(ts, _)| now.saturating_sub(*ts) < window_secs);
        // 追加当前事件
        let ts = extract_event_timestamp(event);
        buf.push((ts, event.clone()));
    }

    // 2. 检查协调条件（复制 buffer 避免长持锁）
    let events_to_check = {
        let buf = state.recent_events.read();
        buf.iter().map(|(_, e)| e.clone()).collect::<Vec<_>>()
    };

    if !Coordinator::should_coordinate(&events_to_check) {
        return;
    }

    // 3. 找到协调目标 PTY
    let target_instance = match state.find_coordination_target() {
        Some(id) => id,
        None => {
            log::debug!("Coordinator: 无可用 PTY 实例作为协调目标");
            return;
        }
    };

    // 4. 聚合上下文
    let instances = state.pty_manager.list_instances();
    let details: Vec<_> = instances.iter().map(to_agent_state_detail).collect();
    let context = crate::orchestration::context::ContextAggregator::aggregate(&details);

    // 5. 构建调度指令提示词（使用默认模板，包含 {context} 占位符）
    let template = "请根据以下状态安排任务：\n{context}\n请输出调度计划。";
    let command_text = Coordinator::build_coordination_prompt(&context, template);

    // 6. 通过 inject_stdin 注入（使用 OrchestrationAuto 源）
    let input = format!("{command_text}\n");
    if let Err(e) = state.pty_manager.inject_stdin(&target_instance, &input) {
        log::warn!("Coordinator: inject_stdin 到 {} 失败: {e}", target_instance);
        return;
    }

    // 7. 发出 CoordinationCommand 事件（用于前端监听和 UI 展示）
    let ts_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let coord_event = ConfluxEvent::CoordinationCommand {
        target_instance_id: crate::core::InstanceId(target_instance),
        command_text,
        source_discussion_id: None,
        timestamp: ts_ms,
    };

    // 递归调用 emit_conflux_event 发出事件（会再次触发 trigger_coordinator，
    // 但由于 events_to_check 中已有 CoordinationCommand，should_coordinate 在
    // 此轮已经返回 true，递归到此即止——避免无限循环的关键：此轮已处理完）
    emit_conflux_event(app, &coord_event);
}
