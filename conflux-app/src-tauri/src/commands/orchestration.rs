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

use tauri::State;

use crate::core::{
    ConfluxError, DiscussionId, DiscussionMessage, DiscussionSession, DiscussionSummary,
    InstanceId,
};
use crate::AppState;
use crate::persistence::query as db_query;

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

    // 1. 在内存中创建讨论
    let (session, system_msg) = {
        let mut engine = state.discussion_engine.write();
        let session = engine.start(topic, participant_ids, rounds);
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
        "讨论已创建: id={}, topic={}",
        session.id.0,
        session.topic
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
    state: State<'_, AppState>,
    discussion_id: DiscussionId,
    content: String,
) -> Result<DiscussionMessage, ConfluxError> {
    // HIGH-01 修复：输入长度验证
    if content.len() > MAX_CONTENT_LENGTH {
        return Err(ConfluxError::OrchestrationError {
            message: format!("content 长度 {} 超过上限 {}", content.len(), MAX_CONTENT_LENGTH),
        });
    }
    // 1. 在内存中发送消息
    let (msg, current_round) = {
        let mut engine = state.discussion_engine.write();
        let msg = engine.send_message(&discussion_id.0, content)?;
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
    // 1. 在内存中结束讨论
    let summary = {
        let mut engine = state.discussion_engine.write();
        engine.end(&discussion_id.0)?
    };

    // 2. 更新数据库状态
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
        "讨论已结束: id={}, rounds={}",
        discussion_id.0,
        summary.total_rounds
    );
    Ok(summary)
}

/// 设置灵动岛主框架
///
/// 指定一个 Agent 实例作为灵动岛的主框架（负责接收调度指令）。
/// 同一时间只能有一个主框架。
///
/// # 参数
/// - `instance_id`: 要设为主框架的实例 ID
#[tauri::command]
pub async fn set_pinned_instance(
    state: State<'_, AppState>,
    instance_id: InstanceId,
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

    // 设置主框架
    {
        let mut primary = state.pinned_instance.write();
        *primary = Some(instance_id.clone());
    }

    log::debug!("主框架已设置: {}", instance_id.0);
    Ok(())
}

/// 获取当前灵动岛主框架
///
/// # 返回
/// 当前主框架的实例 ID，如果未设置则返回 None
#[tauri::command]
pub async fn get_pinned_instance(
    state: State<'_, AppState>,
) -> Result<Option<InstanceId>, ConfluxError> {
    let primary = state.pinned_instance.read();
    Ok(primary.clone())
}
