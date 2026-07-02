// ===== Conflux 会话事件持久化 =====
// 负责将 ConfluxEvent 序列化写入 session_events 表
// 以及按实例/时间范围/数量查询事件记录和会话摘要

use rusqlite::{params, Connection};

use crate::core::{
    ConfluxError, ConfluxEvent, InjectionSource, InstanceId, SessionEvent, SessionSummary,
};

/// source_kind 粗粒度归类（schema §2.2 约定值：hook|pty|runtime|user_action|system）。
///
/// D-0702-002 死接线收口：event_id/source_kind 两列此前建而不写（恒 NULL，事件
/// 关联/去重链断）。诚实原则：变体自身能确定的才归类；歧义的（PermissionRequested
/// 可能来自 hook relay 或 PTY 刮屏，事件体不携带来源）→ None（NULL，不猜）。
fn source_kind_of(event: &ConfluxEvent) -> Option<&'static str> {
    match event {
        ConfluxEvent::PtyOutput { .. } | ConfluxEvent::ProcessExited { .. } => Some("pty"),
        ConfluxEvent::AgentStatusChanged { .. }
        | ConfluxEvent::TaskCompleted { .. }
        | ConfluxEvent::ErrorOccurred { .. }
        | ConfluxEvent::SubAgentSpawned { .. }
        | ConfluxEvent::SubAgentCompleted { .. } => Some("runtime"),
        ConfluxEvent::PermissionRequested { .. } => None, // hook 或刮屏均可能，不猜。
        ConfluxEvent::StdinInjected { source, .. } => Some(match source {
            InjectionSource::UserDirect
            | InjectionSource::PermissionResponse
            | InjectionSource::DiscussionUserMessage => "user_action",
            InjectionSource::OrchestrationAuto => "system",
        }),
        // 当前唯一生产路径 = 用户 send_discussion_message（MessageSender 硬编码 User）。
        ConfluxEvent::DiscussionMessage { .. } => Some("user_action"),
        ConfluxEvent::CoordinationCommand { .. } => Some("system"),
    }
}

/// 将一个 ConfluxEvent 序列化后写入 session_events 表
///
/// 事件的 `instance_id` 从 `ConfluxEvent::instance_id()` 提取。
/// 对于没有关联 instance_id 的事件（如 DiscussionMessage），使用 "system" 作为占位。
/// 事件数据以 JSON 字符串形式存储在 `data` 列。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `event`: 要持久化的 ConfluxEvent
///
/// # 错误
/// JSON 序列化失败或 SQL 执行出错时返回 `ConfluxError`
pub fn insert_session_event(conn: &Connection, event: &ConfluxEvent) -> Result<(), ConfluxError> {
    let instance_id = event
        .instance_id()
        .map(|id| id.0.clone())
        .unwrap_or_else(|| "system".to_string());

    let event_type = event.event_type_name().to_string();

    let data = serde_json::to_string(event).map_err(|e| ConfluxError::SerializationError {
        message: format!("事件序列化失败: {}", e),
    })?;

    let timestamp = extract_timestamp(event);

    // D-0702-002：event_id 落真值（uuid，供去重/关联）；source_kind 按变体诚实归类
    // （歧义 NULL）；correlation_id 暂无上游关联真源 → 诚实 NULL（不填造值）。
    let event_id = uuid::Uuid::new_v4().to_string();
    let source_kind = source_kind_of(event);

    conn.execute(
        "INSERT INTO session_events (instance_id, event_type, data, timestamp, event_id, source_kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![instance_id, event_type, data, timestamp, event_id, source_kind],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("session_events 写入失败: {}", e),
    })?;

    Ok(())
}

/// 查询指定实例的会话事件
///
/// 支持按时间范围过滤和数量限制。结果按时间戳升序排列。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `instance_id`: 要查询的实例 ID
/// - `from_ts`: 起始时间戳（Unix ms，包含），None 表示不限
/// - `to_ts`: 结束时间戳（Unix ms，包含），None 表示不限
/// - `limit`: 返回数量上限，None 表示不限
///
/// # 返回
/// 按时间戳升序排列的 SessionEvent 列表
pub fn query_session_events(
    conn: &Connection,
    instance_id: &str,
    from_ts: Option<i64>,
    to_ts: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<SessionEvent>, ConfluxError> {
    // 动态构建 WHERE 子句（始终使用参数化查询）
    let mut sql = String::from(
        "SELECT id, instance_id, event_type, data, timestamp FROM session_events WHERE instance_id = ?1",
    );
    let mut param_idx = 2u32;
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params_vec.push(Box::new(instance_id.to_string()));

    if let Some(from) = from_ts {
        sql.push_str(&format!(" AND timestamp >= ?{}", param_idx));
        params_vec.push(Box::new(from));
        param_idx += 1;
    }

    if let Some(to) = to_ts {
        sql.push_str(&format!(" AND timestamp <= ?{}", param_idx));
        params_vec.push(Box::new(to));
        param_idx += 1;
    }

    sql.push_str(" ORDER BY timestamp ASC");

    if let Some(lim) = limit {
        sql.push_str(&format!(" LIMIT ?{}", param_idx));
        params_vec.push(Box::new(lim as i64));
    }

    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("session_events 查询准备失败: {}", e),
        })?;

    let rows = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(SessionEvent {
                id: row.get(0)?,
                instance_id: InstanceId(row.get(1)?),
                event_type: row.get(2)?,
                data: row.get(3)?,
                timestamp: row.get(4)?,
            })
        })
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("session_events 查询执行失败: {}", e),
        })?;

    let mut events = Vec::new();
    for row_result in rows {
        let event = row_result.map_err(|e| ConfluxError::DatabaseError {
            message: format!("session_events 行解析失败: {}", e),
        })?;
        events.push(event);
    }

    Ok(events)
}

/// 查询会话摘要列表
///
/// 从 agent_instances 表聚合查询，统计每个实例的事件总数。
/// 结果按创建时间降序排列（最新的在前）。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `limit`: 返回数量上限
/// - `offset`: 跳过前 N 条记录（用于分页）
///
/// # 返回
/// 按创建时间降序排列的 SessionSummary 列表
pub fn list_sessions(
    conn: &Connection,
    limit: u32,
    offset: u32,
) -> Result<Vec<SessionSummary>, ConfluxError> {
    let sql = r#"
        SELECT
            ai.instance_id,
            ai.adapter_name,
            ai.working_dir,
            ai.created_at,
            ai.ended_at,
            COALESCE(
                (SELECT COUNT(*) FROM session_events se WHERE se.instance_id = ai.instance_id),
                0
            ) as event_count
        FROM agent_instances ai
        ORDER BY ai.created_at DESC
        LIMIT ?1 OFFSET ?2
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| ConfluxError::DatabaseError {
        message: format!("list_sessions 查询准备失败: {}", e),
    })?;

    let rows = stmt
        .query_map(params![limit, offset], |row| {
            Ok(SessionSummary {
                instance_id: InstanceId(row.get(0)?),
                adapter_name: row.get(1)?,
                working_dir: row.get(2)?,
                started_at: row.get(3)?,
                ended_at: row.get(4)?,
                event_count: row.get::<_, i64>(5)? as u32,
            })
        })
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("list_sessions 查询执行失败: {}", e),
        })?;

    let mut summaries = Vec::new();
    for row_result in rows {
        let summary = row_result.map_err(|e| ConfluxError::DatabaseError {
            message: format!("list_sessions 行解析失败: {}", e),
        })?;
        summaries.push(summary);
    }

    Ok(summaries)
}

/// 插入新 agent 实例记录到 agent_instances 表
///
/// 使用 INSERT OR REPLACE 语义，保证幂等。初始状态为 'idle'，is_primary = 0。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `instance_id`: 实例唯一标识
/// - `adapter_id`: 适配器 ID
/// - `adapter_name`: 适配器显示名称
/// - `working_dir`: 工作目录
/// - `created_at`: 创建时间戳（Unix ms）
pub fn insert_agent_instance(
    conn: &Connection,
    instance_id: &str,
    adapter_id: &str,
    adapter_name: &str,
    working_dir: &str,
    created_at: i64,
) -> Result<(), ConfluxError> {
    conn.execute(
        "INSERT OR REPLACE INTO agent_instances (instance_id, adapter_id, adapter_name, working_dir, status, is_primary, created_at) VALUES (?1, ?2, ?3, ?4, 'idle', 0, ?5)",
        params![instance_id, adapter_id, adapter_name, working_dir, created_at],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("insert_agent_instance: {e}"),
    })?;
    Ok(())
}

/// 标记 agent 实例结束（设置 ended_at 时间戳）
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `instance_id`: 要标记结束的实例 ID
pub fn close_agent_instance(conn: &Connection, instance_id: &str) -> Result<(), ConfluxError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "UPDATE agent_instances SET ended_at = ?1 WHERE instance_id = ?2",
        params![now, instance_id],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("close_agent_instance: {e}"),
    })?;
    Ok(())
}

/// 从 ConfluxEvent 提取时间戳
fn extract_timestamp(event: &ConfluxEvent) -> i64 {
    match event {
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::{AgentStatus, ErrorSeverity};
    use crate::persistence::schema::init_database;

    fn make_test_event(instance_id: &str, timestamp: i64) -> ConfluxEvent {
        ConfluxEvent::AgentStatusChanged {
            instance_id: InstanceId(instance_id.to_string()),
            old_status: AgentStatus::Idle,
            new_status: AgentStatus::Thinking,
            timestamp,
        }
    }

    #[test]
    fn test_insert_and_query_session_events() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");

        let event1 = make_test_event("inst-001", 1000);
        let event2 = make_test_event("inst-001", 2000);
        let event3 = make_test_event("inst-002", 3000);

        insert_session_event(&conn, &event1).expect("插入事件1应成功");
        insert_session_event(&conn, &event2).expect("插入事件2应成功");
        insert_session_event(&conn, &event3).expect("插入事件3应成功");

        // 查询 inst-001 的所有事件
        let results =
            query_session_events(&conn, "inst-001", None, None, None).expect("查询应成功");
        assert_eq!(results.len(), 2, "inst-001 应有2条事件");
        assert_eq!(results[0].timestamp, 1000);
        assert_eq!(results[1].timestamp, 2000);

        // 带时间范围查询
        let results =
            query_session_events(&conn, "inst-001", Some(1500), None, None).expect("查询应成功");
        assert_eq!(results.len(), 1, "from_ts=1500 后应只有1条事件");
        assert_eq!(results[0].timestamp, 2000);

        // 带 limit 查询
        let results =
            query_session_events(&conn, "inst-001", None, None, Some(1)).expect("查询应成功");
        assert_eq!(results.len(), 1, "limit=1 应只返回1条");
    }

    #[test]
    fn test_insert_event_without_instance_id() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");

        // DiscussionMessage 没有关联的 instance_id
        let event = ConfluxEvent::DiscussionMessage {
            discussion_id: crate::core::DiscussionId("disc-001".to_string()),
            message: crate::core::DiscussionMessageData {
                id: "msg-001".to_string(),
                discussion_id: crate::core::DiscussionId("disc-001".to_string()),
                sender: crate::core::MessageSender::System,
                content: "Hello".to_string(),
                round: 1,
                created_at: 5000,
            },
            timestamp: 5000,
        };

        insert_session_event(&conn, &event).expect("无 instance_id 的事件插入也应成功");

        let results = query_session_events(&conn, "system", None, None, None).expect("查询应成功");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].event_type, "DiscussionMessage");
    }

    #[test]
    fn test_error_event_insert_and_query() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");

        let event = ConfluxEvent::ErrorOccurred {
            instance_id: InstanceId("inst-err".to_string()),
            error_message: "something failed".to_string(),
            severity: ErrorSeverity::Error,
            timestamp: 9999,
        };

        insert_session_event(&conn, &event).expect("错误事件插入应成功");

        let results =
            query_session_events(&conn, "inst-err", None, None, None).expect("查询应成功");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].event_type, "ErrorOccurred");
        assert_eq!(results[0].timestamp, 9999);
    }
}
