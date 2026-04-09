// ===== Conflux 通用查询层 =====
// 负责工作台布局、讨论会话、讨论消息的 CRUD 操作
// 所有 SQL 语句使用参数化查询（?N 占位符）防止注入

use rusqlite::{params, Connection};

use crate::core::{
    ConfluxError, DiscussionId, DiscussionMessage, DiscussionMessageData, DiscussionSession,
    DiscussionStatus, InstanceId, MessageSender, WorkspaceLayout,
};

// ===== 工作台布局 =====

/// 保存工作台布局（插入新记录）
///
/// 每次保存都追加一行新记录，`load_workspace_layout` 只取最新的。
/// 布局数据以 JSON 字符串存储在 `layout_data` 列。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `layout`: 工作台布局数据
pub fn save_workspace_layout(
    conn: &Connection,
    layout: &WorkspaceLayout,
) -> Result<(), ConfluxError> {
    let layout_json =
        serde_json::to_string(layout).map_err(|e| ConfluxError::SerializationError {
            message: format!("布局序列化失败: {}", e),
        })?;

    conn.execute(
        "INSERT INTO workspace_layouts (layout_data, updated_at) VALUES (?1, ?2)",
        params![layout_json, layout.updated_at],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("workspace_layouts 写入失败: {}", e),
    })?;

    Ok(())
}

/// 加载最新的工作台布局
///
/// 取 workspace_layouts 表中 updated_at 最大的一条记录。
/// 如果表为空则返回 None。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
///
/// # 返回
/// 最新的布局数据，或 None（数据库中无记录时）
pub fn load_workspace_layout(
    conn: &Connection,
) -> Result<Option<WorkspaceLayout>, ConfluxError> {
    let mut stmt = conn
        .prepare("SELECT layout_data FROM workspace_layouts ORDER BY updated_at DESC LIMIT 1")
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("load_workspace_layout 查询准备失败: {}", e),
        })?;

    let mut rows = stmt
        .query_map([], |row| {
            let json_str: String = row.get(0)?;
            Ok(json_str)
        })
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("load_workspace_layout 查询执行失败: {}", e),
        })?;

    match rows.next() {
        Some(row_result) => {
            let json_str = row_result.map_err(|e| ConfluxError::DatabaseError {
                message: format!("load_workspace_layout 行解析失败: {}", e),
            })?;
            let layout: WorkspaceLayout =
                serde_json::from_str(&json_str).map_err(|e| ConfluxError::SerializationError {
                    message: format!("布局反序列化失败: {}", e),
                })?;
            Ok(Some(layout))
        }
        None => Ok(None),
    }
}

// ===== 讨论会话 =====

/// 插入一个新的讨论会话
///
/// 将 DiscussionSession 写入 discussions 表。
/// participant_ids 以 JSON 数组字符串存储。
/// status 以 serde 序列化后的小写字符串存储（如 "active"、"completed"）。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `session`: 讨论会话数据
pub fn insert_discussion(
    conn: &Connection,
    session: &DiscussionSession,
) -> Result<(), ConfluxError> {
    let participant_ids_json = serde_json::to_string(&session.participant_ids).map_err(|e| {
        ConfluxError::SerializationError {
            message: format!("participant_ids 序列化失败: {}", e),
        }
    })?;

    let status_str = serialize_discussion_status(&session.status);

    conn.execute(
        "INSERT INTO discussions (discussion_id, topic, participant_ids, max_rounds, current_round, status, created_at, ended_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            session.id.0,
            session.topic,
            participant_ids_json,
            session.max_rounds,
            session.current_round,
            status_str,
            session.created_at,
            session.ended_at,
        ],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("discussions 写入失败: {}", e),
    })?;

    Ok(())
}

/// 更新讨论会话状态
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `id`: 讨论 ID
/// - `status`: 新状态字符串（"active" / "completed" / "cancelled"）
/// - `ended_at`: 结束时间戳（仅状态为 completed/cancelled 时设置）
pub fn update_discussion_status(
    conn: &Connection,
    id: &str,
    status: &str,
    ended_at: Option<i64>,
) -> Result<(), ConfluxError> {
    let affected = conn
        .execute(
            "UPDATE discussions SET status = ?1, ended_at = ?2 WHERE discussion_id = ?3",
            params![status, ended_at, id],
        )
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("discussions 状态更新失败: {}", e),
        })?;

    if affected == 0 {
        return Err(ConfluxError::DiscussionNotFound {
            discussion_id: id.to_string(),
        });
    }

    Ok(())
}

/// 更新讨论的当前轮次
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `id`: 讨论 ID
/// - `current_round`: 新的当前轮次数
pub fn update_discussion_round(
    conn: &Connection,
    id: &str,
    current_round: u32,
) -> Result<(), ConfluxError> {
    let affected = conn
        .execute(
            "UPDATE discussions SET current_round = ?1 WHERE discussion_id = ?2",
            params![current_round, id],
        )
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("discussions 轮次更新失败: {}", e),
        })?;

    if affected == 0 {
        return Err(ConfluxError::DiscussionNotFound {
            discussion_id: id.to_string(),
        });
    }

    Ok(())
}

/// 插入一条讨论消息
///
/// 将 DiscussionMessageData 写入 discussion_messages 表。
/// MessageSender 拆分为 sender_type + sender_value 两列存储：
///   - User => ("user", None)
///   - Agent(id) => ("agent", Some(id.0))
///   - System => ("system", None)
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `msg`: 讨论消息数据
pub fn insert_discussion_message(
    conn: &Connection,
    msg: &DiscussionMessageData,
) -> Result<(), ConfluxError> {
    let (sender_type, sender_value) = serialize_sender(&msg.sender);

    conn.execute(
        "INSERT INTO discussion_messages (id, discussion_id, sender_type, sender_value, content, round, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            msg.id,
            msg.discussion_id.0,
            sender_type,
            sender_value,
            msg.content,
            msg.round,
            msg.created_at,
        ],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("discussion_messages 写入失败: {}", e),
    })?;

    Ok(())
}

/// 列出讨论会话列表
///
/// 结果按创建时间降序排列（最新的在前）。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `limit`: 返回数量上限
/// - `offset`: 跳过前 N 条记录（用于分页）
///
/// # 返回
/// 按创建时间降序排列的 DiscussionSession 列表
pub fn list_discussions(
    conn: &Connection,
    limit: u32,
    offset: u32,
) -> Result<Vec<DiscussionSession>, ConfluxError> {
    let sql = r#"
        SELECT discussion_id, topic, participant_ids, max_rounds, current_round, status, created_at, ended_at
        FROM discussions
        ORDER BY created_at DESC
        LIMIT ?1 OFFSET ?2
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| ConfluxError::DatabaseError {
        message: format!("list_discussions 查询准备失败: {}", e),
    })?;

    let rows = stmt
        .query_map(params![limit, offset], |row| {
            let participant_ids_json: String = row.get(2)?;
            let status_str: String = row.get(5)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                participant_ids_json,
                row.get::<_, u32>(3)?,
                row.get::<_, u32>(4)?,
                status_str,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<i64>>(7)?,
            ))
        })
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("list_discussions 查询执行失败: {}", e),
        })?;

    let mut discussions = Vec::new();
    for row_result in rows {
        let (id, topic, participant_ids_json, max_rounds, current_round, status_str, created_at, ended_at) =
            row_result.map_err(|e| ConfluxError::DatabaseError {
                message: format!("list_discussions 行解析失败: {}", e),
            })?;

        let participant_ids: Vec<InstanceId> =
            serde_json::from_str(&participant_ids_json).map_err(|e| {
                ConfluxError::SerializationError {
                    message: format!("participant_ids 反序列化失败: {}", e),
                }
            })?;

        let status = deserialize_discussion_status(&status_str);

        discussions.push(DiscussionSession {
            id: DiscussionId(id),
            topic,
            participant_ids,
            max_rounds,
            current_round,
            status,
            created_at,
            ended_at,
        });
    }

    Ok(discussions)
}

/// 查询指定讨论的所有消息
///
/// 结果按 (round ASC, created_at ASC) 排列。
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `discussion_id`: 讨论 ID
///
/// # 返回
/// 按轮次和时间排列的 DiscussionMessage 列表
pub fn get_discussion_messages(
    conn: &Connection,
    discussion_id: &str,
) -> Result<Vec<DiscussionMessage>, ConfluxError> {
    let sql = r#"
        SELECT id, discussion_id, sender_type, sender_value, content, round, created_at
        FROM discussion_messages
        WHERE discussion_id = ?1
        ORDER BY round ASC, created_at ASC
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| ConfluxError::DatabaseError {
        message: format!("get_discussion_messages 查询准备失败: {}", e),
    })?;

    let rows = stmt
        .query_map(params![discussion_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, u32>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("get_discussion_messages 查询执行失败: {}", e),
        })?;

    let mut messages = Vec::new();
    for row_result in rows {
        let (id, disc_id, sender_type, sender_value, content, round, created_at) =
            row_result.map_err(|e| ConfluxError::DatabaseError {
                message: format!("get_discussion_messages 行解析失败: {}", e),
            })?;

        let sender = deserialize_sender(&sender_type, sender_value.as_deref());

        messages.push(DiscussionMessageData {
            id,
            discussion_id: DiscussionId(disc_id),
            sender,
            content,
            round,
            created_at,
        });
    }

    Ok(messages)
}

// ===== 辅助函数 =====

/// 将 MessageSender 拆分为 (sender_type, sender_value) 用于数据库存储
fn serialize_sender(sender: &MessageSender) -> (String, Option<String>) {
    match sender {
        MessageSender::User => ("user".to_string(), None),
        MessageSender::Agent(id) => ("agent".to_string(), Some(id.0.clone())),
        MessageSender::System => ("system".to_string(), None),
    }
}

/// 从 (sender_type, sender_value) 还原 MessageSender
fn deserialize_sender(sender_type: &str, sender_value: Option<&str>) -> MessageSender {
    match sender_type {
        "user" => MessageSender::User,
        "agent" => {
            let id = sender_value.unwrap_or("unknown").to_string();
            MessageSender::Agent(InstanceId(id))
        }
        "system" => MessageSender::System,
        _ => MessageSender::System, // 未知类型降级为 System
    }
}

/// DiscussionStatus -> 数据库存储字符串
fn serialize_discussion_status(status: &DiscussionStatus) -> String {
    match status {
        DiscussionStatus::Active => "active".to_string(),
        DiscussionStatus::Completed => "completed".to_string(),
        DiscussionStatus::Cancelled => "cancelled".to_string(),
    }
}

/// 数据库存储字符串 -> DiscussionStatus
fn deserialize_discussion_status(status_str: &str) -> DiscussionStatus {
    match status_str {
        "active" => DiscussionStatus::Active,
        "completed" => DiscussionStatus::Completed,
        "cancelled" => DiscussionStatus::Cancelled,
        _ => DiscussionStatus::Active, // 未知状态降级为 Active
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::{
        CardLayout, LayoutMode, Position, Size, AutoPackConfig,
    };
    use crate::persistence::schema::init_database;

    #[test]
    fn test_save_and_load_workspace_layout() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");

        let layout = WorkspaceLayout {
            cards: vec![CardLayout {
                instance_id: InstanceId("inst-001".to_string()),
                position: Position { x: 10.0, y: 20.0 },
                size: Size {
                    width: 200.0,
                    height: 140.0,
                },
                z_index: 1,
            }],
            layout_mode: LayoutMode::Free,
            auto_pack_config: None,
            updated_at: 1000,
        };

        save_workspace_layout(&conn, &layout).expect("保存布局应成功");

        let loaded = load_workspace_layout(&conn)
            .expect("加载布局应成功")
            .expect("应有布局数据");

        assert_eq!(loaded.cards.len(), 1);
        assert_eq!(loaded.cards[0].instance_id.0, "inst-001");
        assert_eq!(loaded.updated_at, 1000);
    }

    #[test]
    fn test_load_latest_workspace_layout() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");

        let layout1 = WorkspaceLayout {
            cards: vec![],
            layout_mode: LayoutMode::Free,
            auto_pack_config: None,
            updated_at: 1000,
        };
        let layout2 = WorkspaceLayout {
            cards: vec![],
            layout_mode: LayoutMode::Grid,
            auto_pack_config: None,
            updated_at: 2000,
        };

        save_workspace_layout(&conn, &layout1).expect("保存布局1应成功");
        save_workspace_layout(&conn, &layout2).expect("保存布局2应成功");

        let loaded = load_workspace_layout(&conn)
            .expect("加载布局应成功")
            .expect("应有布局数据");

        // 应该拿到最新的（updated_at=2000 的那条）
        assert_eq!(loaded.updated_at, 2000);
    }

    #[test]
    fn test_load_empty_workspace_layout() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");
        let result = load_workspace_layout(&conn).expect("查询应成功");
        assert!(result.is_none(), "空数据库应返回 None");
    }

    #[test]
    fn test_discussion_crud() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");

        // 创建讨论
        let session = DiscussionSession {
            id: DiscussionId("disc-001".to_string()),
            topic: "测试讨论".to_string(),
            participant_ids: vec![
                InstanceId("inst-a".to_string()),
                InstanceId("inst-b".to_string()),
            ],
            max_rounds: 5,
            current_round: 0,
            status: DiscussionStatus::Active,
            created_at: 1000,
            ended_at: None,
        };

        insert_discussion(&conn, &session).expect("插入讨论应成功");

        // 列出讨论
        let discussions = list_discussions(&conn, 10, 0).expect("列表查询应成功");
        assert_eq!(discussions.len(), 1);
        assert_eq!(discussions[0].topic, "测试讨论");
        assert_eq!(discussions[0].participant_ids.len(), 2);

        // 插入消息
        let msg = DiscussionMessageData {
            id: "msg-001".to_string(),
            discussion_id: DiscussionId("disc-001".to_string()),
            sender: MessageSender::Agent(InstanceId("inst-a".to_string())),
            content: "你好".to_string(),
            round: 1,
            created_at: 1100,
        };
        insert_discussion_message(&conn, &msg).expect("插入消息应成功");

        // 查询消息
        let messages =
            get_discussion_messages(&conn, "disc-001").expect("查询消息应成功");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "你好");

        // 验证 sender 正确还原
        match &messages[0].sender {
            MessageSender::Agent(id) => assert_eq!(id.0, "inst-a"),
            _ => panic!("sender 应为 Agent"),
        }

        // 更新状态
        update_discussion_status(&conn, "disc-001", "completed", Some(2000))
            .expect("更新状态应成功");

        let discussions = list_discussions(&conn, 10, 0).expect("列表查询应成功");
        assert_eq!(discussions[0].status, DiscussionStatus::Completed);
        assert_eq!(discussions[0].ended_at, Some(2000));
    }

    #[test]
    fn test_update_nonexistent_discussion() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");

        let result = update_discussion_status(&conn, "nonexistent", "completed", None);
        assert!(result.is_err(), "更新不存在的讨论应返回错误");
    }

    #[test]
    fn test_discussion_message_ordering() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");

        // 先插入讨论
        let session = DiscussionSession {
            id: DiscussionId("disc-order".to_string()),
            topic: "排序测试".to_string(),
            participant_ids: vec![],
            max_rounds: 3,
            current_round: 0,
            status: DiscussionStatus::Active,
            created_at: 1000,
            ended_at: None,
        };
        insert_discussion(&conn, &session).expect("插入讨论应成功");

        // 插入多条消息（故意乱序插入）
        let msgs = vec![
            ("msg-3", 2, 3000),  // round 2
            ("msg-1", 1, 1000),  // round 1, 较早
            ("msg-2", 1, 2000),  // round 1, 较晚
        ];

        for (id, round, ts) in &msgs {
            let msg = DiscussionMessageData {
                id: id.to_string(),
                discussion_id: DiscussionId("disc-order".to_string()),
                sender: MessageSender::System,
                content: format!("消息 {}", id),
                round: *round,
                created_at: *ts,
            };
            insert_discussion_message(&conn, &msg).expect("插入消息应成功");
        }

        // 查询应按 round ASC, created_at ASC 排序
        let messages =
            get_discussion_messages(&conn, "disc-order").expect("查询消息应成功");
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].id, "msg-1"); // round=1, ts=1000
        assert_eq!(messages[1].id, "msg-2"); // round=1, ts=2000
        assert_eq!(messages[2].id, "msg-3"); // round=2, ts=3000
    }
}
