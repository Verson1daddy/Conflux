// ===== Conflux 编排操作 Tauri Commands =====
// 5 个 IPC 命令：讨论管理 + 主框架设置
//
// 讨论操作同时更新内存（DiscussionEngine）和数据库（persistence 层），
// 确保崩溃恢复时数据不丢失。
//
// 注意：AppState 需要 orchestrator 后续添加 `db` 和 `discussion_engine` 字段。
// 本模块假设这两个字段存在于 AppState 中（使用 parking_lot 一致性）：
//   pub db: parking_lot::Mutex<rusqlite::Connection>
//   pub discussion_engine: parking_lot::RwLock<DiscussionEngine>

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::core::event_emit::emit_conflux_event;
use crate::core::{
    AgentMode, ConfluxError, ConfluxEvent, DiscussionId, DiscussionMessage, DiscussionSession,
    DiscussionSummary, InstanceId, MessageSender,
};
use crate::persistence::query as db_query;
use crate::AppState;

/// 创建新的多 Agent 讨论
///
/// 同时在内存（DiscussionEngine）和数据库中创建讨论记录。
/// 包含一条系统开场消息。
///
/// # 参数
/// - `topic`: 讨论主题
/// - `participant_ids`: 参与者 Agent 实例 ID 列表
/// - `max_rounds`: 最大讨论轮次（默认 5）
///
/// # 返回
/// 新创建的 DiscussionSession
/// IPC 输入长度上限——topic（HIGH-01 修复）
const MAX_TOPIC_LENGTH: usize = 1_000;
/// IPC 输入长度上限——消息内容（HIGH-01 修复）
const MAX_CONTENT_LENGTH: usize = 50_000;

#[tauri::command]
pub async fn start_discussion(
    app: AppHandle,
    state: State<'_, AppState>,
    topic: String,
    participant_ids: Vec<InstanceId>,
    max_rounds: Option<u32>,
) -> Result<DiscussionSession, ConfluxError> {
    // HIGH-01 修复：输入长度验证
    if topic.len() > MAX_TOPIC_LENGTH {
        return Err(ConfluxError::OrchestrationError {
            message: format!("topic 长度 {} 超过上限 {}", topic.len(), MAX_TOPIC_LENGTH),
        });
    }
    let rounds = max_rounds.unwrap_or(5);

    // B3.1 Contract 2: For each participant, spawn a hidden sandbox instance
    let mut sandbox_instance_ids: Vec<InstanceId> = Vec::new();

    for participant_id in &participant_ids {
        // Look up the adapter_id from the workspace instance
        let adapter_id = {
            let map = state.instance_adapter_map.read();
            map.get(&participant_id.0)
                .cloned()
                .ok_or_else(|| ConfluxError::InstanceNotFound {
                    instance_id: participant_id.0.clone(),
                })?
        };

        // Get adapter config + trait object
        let (adapter_config, adapter_arc) = {
            let registry = state.adapter_registry.read();
            let config = registry.get_config(&adapter_id).cloned().ok_or_else(|| {
                ConfluxError::AdapterNotFound {
                    adapter_id: adapter_id.clone(),
                }
            })?;
            let adapter =
                registry
                    .get(&adapter_id)
                    .ok_or_else(|| ConfluxError::AdapterNotFound {
                        adapter_id: adapter_id.clone(),
                    })?;
            (config, adapter)
        };

        // Get the workspace instance's working_dir to reuse
        let work_dir = state
            .pty_manager
            .get_instance_state(&participant_id.0)
            .map(|detail| detail.working_dir)
            .unwrap_or_else(|_| ".".to_string());

        // Build sandbox args: default_args + sandbox_args
        let mut spawn_args = adapter_config.default_args.clone();
        spawn_args.extend(adapter_config.sandbox_args.clone());

        // Build event dispatcher
        let app_handle = app.clone();
        let dispatcher: crate::pty::manager::EventDispatcher =
            Arc::new(move |event: &ConfluxEvent| {
                emit_conflux_event(&app_handle, event);
            });

        // Spawn hidden sandbox instance
        let sandbox_id_str = state.pty_manager.spawn(
            &adapter_config.command,
            &spawn_args,
            &work_dir,
            &adapter_id,
            &adapter_config.name,
            Some(adapter_arc),
            Some(dispatcher),
            AgentMode::Sandbox,
            true, // hidden = true
            None, // display_name: sandbox 实例不需要别名
        )?;

        let sandbox_id = InstanceId(sandbox_id_str);

        // Record instance_id -> adapter_id mapping
        {
            let mut map = state.instance_adapter_map.write();
            map.insert(sandbox_id.0.clone(), adapter_id.clone());
        }

        sandbox_instance_ids.push(sandbox_id);
    }

    // 1. 在内存中创建讨论（带 sandbox_instance_ids）
    let (session, system_msg) = {
        let mut engine = state.discussion_engine.write();
        let session = engine.start(topic, participant_ids, sandbox_instance_ids, rounds);
        // 获取系统开场消息用于写入数据库
        let msgs = engine
            .get_messages(&session.id.0)
            .cloned()
            .unwrap_or_default();
        let system_msg = msgs.into_iter().next();
        (session, system_msg)
    };

    // 2. 持久化到数据库
    {
        let db = state.db.lock();
        db_query::insert_discussion(&db, &session)?;

        // 同步写入系统开场消息
        if let Some(msg) = &system_msg {
            db_query::insert_discussion_message(&db, msg)?;
        }
    }

    log::debug!(
        "讨论已创建: id={}, topic={}, sandbox_instances={}",
        session.id.0,
        session.topic,
        session.sandbox_instance_ids.len()
    );
    Ok(session)
}

/// 向指定讨论发送消息
///
/// 消息同时写入内存和数据库。轮次由 DiscussionEngine 自动管理。
///
/// # 参数
/// - `discussion_id`: 讨论 ID
/// - `content`: 消息内容
///
/// # 返回
/// 创建的 DiscussionMessage
#[tauri::command]
pub async fn send_discussion_message(
    app: AppHandle,
    state: State<'_, AppState>,
    discussion_id: DiscussionId,
    content: String,
) -> Result<DiscussionMessage, ConfluxError> {
    // HIGH-01 修复：输入长度验证
    if content.len() > MAX_CONTENT_LENGTH {
        return Err(ConfluxError::OrchestrationError {
            message: format!(
                "content 长度 {} 超过上限 {}",
                content.len(),
                MAX_CONTENT_LENGTH
            ),
        });
    }
    // 1. 在内存中发送消息
    let (msg, current_round) = {
        let mut engine = state.discussion_engine.write();
        let msg = engine.send_message(&discussion_id.0, content, MessageSender::User)?;
        let round = engine
            .get_session(&discussion_id.0)
            .map(|s| s.current_round)
            .unwrap_or(0);
        (msg, round)
    };

    // 2. 持久化到数据库
    {
        let db = state.db.lock();
        db_query::insert_discussion_message(&db, &msg)?;
        // 同步更新轮次
        db_query::update_discussion_round(&db, &discussion_id.0, current_round)?;
    }

    // 3. Emit DiscussionMessage 事件到前端
    let event = ConfluxEvent::DiscussionMessage {
        discussion_id: discussion_id.clone(),
        message: msg.clone(),
        timestamp: msg.created_at,
    };
    emit_conflux_event(&app, &event);

    Ok(msg)
}

/// 结束指定讨论
///
/// 在内存中结束讨论（生成摘要），并更新数据库状态。
///
/// # 参数
/// - `discussion_id`: 讨论 ID
///
/// # 返回
/// 讨论摘要 DiscussionSummary
#[tauri::command]
pub async fn end_discussion(
    state: State<'_, AppState>,
    discussion_id: DiscussionId,
) -> Result<DiscussionSummary, ConfluxError> {
    // B3.1 Contract 2: Get sandbox_instance_ids BEFORE ending
    // (ending removes the session from memory)
    let (summary, sandbox_ids) = {
        let mut engine = state.discussion_engine.write();
        let sandbox_ids = engine
            .get_session(&discussion_id.0)
            .map(|s| s.sandbox_instance_ids.clone())
            .unwrap_or_default();
        let summary = engine.end(&discussion_id.0)?;
        (summary, sandbox_ids)
    };

    // 2. Destroy all sandbox instances
    for sandbox_id in &sandbox_ids {
        if let Err(e) = state.pty_manager.kill(&sandbox_id.0) {
            log::warn!(
                "end_discussion: failed to kill sandbox instance {}: {:?}",
                sandbox_id.0,
                e
            );
            // Non-fatal: instance may have already exited
        }
        // Clean up instance_adapter_map
        {
            let mut map = state.instance_adapter_map.write();
            map.remove(&sandbox_id.0);
        }
    }

    // 3. 更新数据库状态
    {
        let db = state.db.lock();
        db_query::update_discussion_status(
            &db,
            &discussion_id.0,
            "completed",
            Some(summary.ended_at),
        )?;
    }

    log::debug!(
        "讨论已结束: id={}, rounds={}, sandbox instances destroyed: {}",
        discussion_id.0,
        summary.total_rounds,
        sandbox_ids.len()
    );
    Ok(summary)
}

/// 切换实例的钉选状态（Pin 多选）
///
/// 如果实例已钉选则取消，否则添加。支持同时钉选多个实例。
///
/// # 参数
/// - `instance_id`: 要切换钉选状态的实例 ID
///
/// # 返回
/// 切换后该实例是否处于钉选状态
#[tauri::command]
pub async fn toggle_pin_instance(
    state: State<'_, AppState>,
    instance_id: InstanceId,
) -> Result<bool, ConfluxError> {
    // 验证实例存在
    {
        let map = state.instance_adapter_map.read();
        if !map.contains_key(&instance_id.0) {
            return Err(ConfluxError::InstanceNotFound {
                instance_id: instance_id.0.clone(),
            });
        }
    }

    // 切换钉选
    let is_now_pinned = {
        let mut pinned = state.pinned_instances.write();
        if pinned.contains(&instance_id.0) {
            pinned.remove(&instance_id.0);
            false
        } else {
            pinned.insert(instance_id.0.clone());
            true
        }
    };

    log::debug!(
        "Pin 切换: {} → {}",
        instance_id.0,
        if is_now_pinned { "pinned" } else { "unpinned" }
    );
    Ok(is_now_pinned)
}

/// 获取所有钉选实例 ID 列表
///
/// # 返回
/// 当前所有钉选实例的 ID 列表
#[tauri::command]
pub async fn get_pinned_instances(
    state: State<'_, AppState>,
) -> Result<Vec<InstanceId>, ConfluxError> {
    let pinned = state.pinned_instances.read();
    Ok(pinned.iter().map(|id| InstanceId(id.clone())).collect())
}
