// ===== Conflux SQLite Schema 初始化 =====
// 负责打开/创建数据库并执行所有 CREATE TABLE 语句
// 所有表使用 IF NOT EXISTS 确保幂等性

use rusqlite::Connection;

use crate::core::ConfluxError;

/// 所有建表 SQL 语句（按依赖顺序排列）
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS adapter_configs (
    adapter_id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    command TEXT NOT NULL,
    default_args TEXT NOT NULL DEFAULT '[]',
    status_patterns TEXT NOT NULL DEFAULT '{}',
    permission_pattern TEXT,
    sub_agent_spawn_pattern TEXT,
    sub_agent_complete_pattern TEXT,
    can_coordinate INTEGER NOT NULL DEFAULT 0,
    coordination_template TEXT,
    can_parse_tree INTEGER NOT NULL DEFAULT 0,
    can_detect_permission INTEGER NOT NULL DEFAULT 0,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_instances (
    instance_id TEXT PRIMARY KEY,
    adapter_id TEXT NOT NULL,
    adapter_name TEXT NOT NULL,
    working_dir TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    ended_at INTEGER,
    FOREIGN KEY (adapter_id) REFERENCES adapter_configs(adapter_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status);
CREATE INDEX IF NOT EXISTS idx_agent_instances_adapter ON agent_instances(adapter_id);

CREATE TABLE IF NOT EXISTS session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp INTEGER NOT NULL
    -- HIGH-05 修复：移除 FK 约束，因为 DiscussionMessage 等事件使用 "system" 作为
    -- instance_id，而 agent_instances 表中无对应行。通过应用层保证引用完整性。
);
CREATE INDEX IF NOT EXISTS idx_session_events_instance_ts ON session_events(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(event_type);

CREATE TABLE IF NOT EXISTS discussions (
    discussion_id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    participant_ids TEXT NOT NULL,
    max_rounds INTEGER NOT NULL DEFAULT 5,
    current_round INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_discussions_status ON discussions(status);

CREATE TABLE IF NOT EXISTS discussion_messages (
    id TEXT PRIMARY KEY,
    discussion_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    sender_value TEXT,
    content TEXT NOT NULL,
    round INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (discussion_id) REFERENCES discussions(discussion_id)
);
CREATE INDEX IF NOT EXISTS idx_discussion_messages_discussion ON discussion_messages(discussion_id, round);

CREATE TABLE IF NOT EXISTS workspace_layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    layout_data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
"#;

/// 打开或创建 SQLite 数据库并初始化 Schema
///
/// 执行所有 CREATE TABLE IF NOT EXISTS 语句和索引创建。
/// 使用 WAL 模式提升并发读写性能。
///
/// # 参数
/// - `path`: 数据库文件路径（如 "conflux.db"），传 ":memory:" 可创建内存数据库
///
/// # 返回
/// 初始化完成的 `rusqlite::Connection`
///
/// # 错误
/// 数据库打开失败或 SQL 执行出错时返回 `ConfluxError::DatabaseError`
pub fn init_database(path: &str) -> Result<Connection, ConfluxError> {
    let conn = Connection::open(path).map_err(|e| ConfluxError::DatabaseError {
        message: format!("数据库打开失败 (path={}): {}", path, e),
    })?;

    // 启用 WAL 模式以提升并发读写性能
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("PRAGMA journal_mode=WAL 失败: {}", e),
        })?;

    // 启用外键约束
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("PRAGMA foreign_keys=ON 失败: {}", e),
        })?;

    // 执行所有建表 SQL
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("Schema 初始化失败: {}", e),
        })?;

    log::debug!("SQLite 数据库初始化完成: {}", path);
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_database_creates_all_tables() {
        let conn = init_database(":memory:").expect("内存数据库初始化应成功");

        // 验证所有 6 张表都存在
        let expected_tables = [
            "adapter_configs",
            "agent_instances",
            "session_events",
            "discussions",
            "discussion_messages",
            "workspace_layouts",
        ];

        for table_name in &expected_tables {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                    rusqlite::params![table_name],
                    |row| row.get(0),
                )
                .expect("查询 sqlite_master 应成功");
            assert!(exists, "表 {} 应当存在", table_name);
        }
    }

    #[test]
    fn test_init_database_is_idempotent() {
        let conn = init_database(":memory:").expect("首次初始化应成功");
        // 重复执行 schema SQL 应当不报错（IF NOT EXISTS）
        conn.execute_batch(SCHEMA_SQL)
            .expect("重复执行 Schema SQL 应成功（幂等性）");
    }
}
