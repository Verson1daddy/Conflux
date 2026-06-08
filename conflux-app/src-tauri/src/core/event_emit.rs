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
//   超过 10 分钟的事件自动淘汰；
//   若 Coordinator::should_coordinate() 返回 true，
//   则从 ContextAggregator 聚合上下文，构建协调指令，
//   通过唯一注入入口 inject_with_policy(OrchestrationAuto) 注入到目标 PTY，
//   并发出 CoordinationCommand 事件。

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
    /// 控制面 P2：注意力队列活跃项变更（前端订阅刷新 attention 列表）
    pub const ATTENTION_UPDATED: &str = "conflux://attention-updated";
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

    // 控制面 P2：把必上浮事件 ingest 进唯一注意力队列，新增项时 emit attention_updated
    if let Some(state) = app.try_state::<crate::AppState>() {
        ingest_into_attention_queue(app, &state, event);
    }

    // C-Δ1 Coordinator 激活：事件缓冲 + 协调检测 + 指令注入
    if let Some(state) = app.try_state::<crate::AppState>() {
        trigger_coordinator(app, &state, event);
    }
}

/// 控制面 P2：把事件 ingest 进注意力队列；若产生新活跃项则 emit `attention_updated`。
///
/// 锁顺序（防死锁）：先 `attention_queue`(write) 再 `db`(Mutex)，与 commands/attention.rs
/// 一致。两把锁在本函数内**同时持有的临界区仅包住 ingest 一次落库**，emit 在释放锁后进行。
fn ingest_into_attention_queue(
    app: &AppHandle,
    state: &crate::AppState,
    event: &ConfluxEvent,
) {
    // 跳过高频 PtyOutput——map 阶段也会返回 None，这里提前短路省去取锁
    if matches!(event, ConfluxEvent::PtyOutput { .. }) {
        return;
    }

    let new_item = {
        let mut queue = state.attention_queue.write();
        let conn = state.db.lock();
        match queue.ingest(&conn, event) {
            Ok(item) => item,
            Err(e) => {
                log::warn!("注意力队列 ingest 失败: {e}");
                None
            }
        }
    };

    if new_item.is_some() {
        emit_attention_updated(app);
    }
}

/// emit 注意力队列活跃项快照到前端（释放队列锁后调用，避免 emit 期间持锁）。
pub fn emit_attention_updated(app: &AppHandle) {
    let active = if let Some(state) = app.try_state::<crate::AppState>() {
        let queue = state.attention_queue.read();
        queue.list_active()
    } else {
        return;
    };

    let payload: Vec<serde_json::Value> = active
        .iter()
        .map(crate::orchestration::attention::attention_item_to_json)
        .collect();

    if let Err(e) = app.emit(channels::ATTENTION_UPDATED, &payload) {
        log::warn!("emit attention_updated failed: {}", e);
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
fn to_agent_state_detail(
    state: &crate::AppState,
    info: &crate::core::types::AgentInstanceInfo,
) -> crate::core::AgentStateDetail {
    if let Ok(mut detail) = state.pty_manager.get_instance_state(&info.instance_id.0) {
        detail.is_pinned = state.pinned_instances.read().contains(&info.instance_id.0);
        return detail;
    }

    crate::core::AgentStateDetail {
        instance_id: info.instance_id.clone(),
        adapter_id: info.adapter_id.clone(),
        adapter_name: info.adapter_name.clone(),
        display_name: info.display_name.clone(),
        status: info.status.clone(),
        working_dir: info.working_dir.clone(),
        is_pinned: info.is_pinned,
        created_at: info.created_at,
        last_activity_at: info.last_activity_at,
        ended_at: info.ended_at,
        mode: info.mode.clone(),
        hidden: info.hidden,
        sub_agents: vec![],
    }
}

/// C-Δ1: 协调器触发主函数
///
/// 在每个事件 emit 后调用：
/// 1. 缓冲事件（每 10 分钟窗口，超过则淘汰）
/// 2. 检查是否满足协调条件（Coordinator::should_coordinate）
/// 3. 若满足，聚合上下文并构建调度指令
/// 4. 通过唯一注入入口 inject_with_policy(OrchestrationAuto) 注入到目标 PTY
/// 5. 发出 CoordinationCommand 事件
fn trigger_coordinator(app: &AppHandle, state: &crate::AppState, event: &ConfluxEvent) {
    if matches!(event, ConfluxEvent::CoordinationCommand { .. }) {
        return;
    }

    let now = now_secs();
    let window_secs = 10 * 60;

    {
        let mut buf = state.recent_events.write();
        buf.retain(|(ts, _)| now.saturating_sub(*ts) < window_secs);
        let ts = extract_event_timestamp(event);
        buf.push((ts, event.clone()));
    }

    let events_to_check = {
        let buf = state.recent_events.read();
        buf.iter().map(|(_, e)| e.clone()).collect::<Vec<_>>()
    };

    if !Coordinator::should_coordinate(&events_to_check) {
        return;
    }

    if !Coordinator::auto_injection_enabled() {
        log::debug!("Coordinator: 自动 stdin 注入已关闭，跳过本次协调注入");
        return;
    }

    let target_instance = match state.find_coordination_target() {
        Some(id) => id,
        None => {
            log::debug!("Coordinator: 无可用 PTY 实例作为协调目标");
            return;
        }
    };

    let instances = state.pty_manager.list_instances();
    let details: Vec<_> = instances
        .iter()
        .map(|info| to_agent_state_detail(state, info))
        .collect();
    let context = crate::orchestration::context::ContextAggregator::aggregate_with_events(
        &details,
        &events_to_check,
    );
    if context.trim().is_empty() {
        log::debug!("Coordinator: 聚合上下文为空，跳过本次协调注入");
        return;
    }

    let template = "请根据以下状态安排任务：\n{context}\n请输出调度计划。";
    let command_text = Coordinator::build_coordination_prompt(&context, template);

    let input = format!("{command_text}\n");
    // MF-1 / CRIT-01（契约 §13.1）：coordinator 自动注入改走唯一入口 `inject_with_policy`
    // （source=OrchestrationAuto，受 StdinInjectionPolicy 闸 + 速率限制 + 后续 P3 审计），
    // **不再裸调** `pty_manager.inject_stdin`。注意：本路径仍受 env-gated 开关保护
    // （`auto_injection_enabled()` 默认 off，上方已检查），开关语义不变。
    if let Err(e) = crate::core::injection::inject_with_policy(
        app,
        state,
        &target_instance,
        &input,
        crate::core::InjectionSource::OrchestrationAuto,
    ) {
        log::warn!(
            "Coordinator: inject_with_policy 到 {} 失败: {e}",
            target_instance
        );
        return;
    }

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

    emit_conflux_event(app, &coord_event);
}
