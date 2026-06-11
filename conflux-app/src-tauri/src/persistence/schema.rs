// ===== Conflux SQLite Schema 初始化 =====
// 负责打开/创建数据库并执行所有 CREATE TABLE 语句
// 所有表使用 IF NOT EXISTS 确保幂等性

use rusqlite::{params, Connection};

use crate::adapter::registry::AdapterRegistry;
use crate::core::{AdapterConfig, ConfluxError};

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
    timestamp INTEGER NOT NULL,
    -- 控制面语义层 P1（F1 契约 §2.2）：统一 AgentEvent 持久化字段
    event_id TEXT,          -- 事件唯一 ID（PersistedEvent.event_id）
    source_kind TEXT,       -- hook|pty|runtime|user_action|system
    correlation_id TEXT     -- 关联 interaction/audit
    -- HIGH-05 修复：移除 FK 约束，因为 DiscussionMessage 等事件使用 "system" 作为
    -- instance_id，而 agent_instances 表中无对应行。通过应用层保证引用完整性。
);
CREATE INDEX IF NOT EXISTS idx_session_events_instance_ts ON session_events(instance_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(event_type);
CREATE INDEX IF NOT EXISTS idx_session_events_corr ON session_events(correlation_id);

-- 控制面语义层 P1（F1 契约 §7.2 + §13.6）：不可变审计事件表（append-only）
CREATE TABLE IF NOT EXISTS audit_events (
    audit_event_id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    instance_id TEXT,
    source_event_id TEXT,
    interaction_id TEXT,
    injection_source TEXT,
    result TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    rationale_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_events_instance_ts ON audit_events(instance_id, created_at);

-- 不可变触发器（MF-7，§13.6）：审计表仅 INSERT，拒绝 UPDATE/DELETE
CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit_events is append-only');
END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit_events is append-only');
END;

-- 控制面语义层 P2（F1 契约 §4.1）：注意力队列项（可变状态——非 append-only）
-- 后端 owned 的唯一注意力队列的持久化镜像；resolve/defer/ignore/restore 走 UPDATE。
CREATE TABLE IF NOT EXISTS attention_items (
    attention_item_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    priority TEXT NOT NULL,
    source_event_id TEXT,
    interaction_id TEXT,
    payload_summary TEXT NOT NULL,
    available_actions TEXT NOT NULL,    -- JSON 数组（InteractionAction[]）
    jump_back_target_id TEXT,           -- P4 占位字段
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolution TEXT,                    -- NULL = active；非 NULL = 已处置
    audit_event_id TEXT,
    permission_context TEXT,            -- JSON 数组（PermissionRequest.raw_context），仅 kind=Permission
    timeout_seconds INTEGER             -- PermissionRequest.timeout_seconds，仅 kind=Permission
);
CREATE INDEX IF NOT EXISTS idx_attention_items_active ON attention_items(resolution, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_attention_items_instance_kind ON attention_items(instance_id, kind, resolution);

-- 控制面语义层 P4（F1 契约 §5.1）：精确回场对象（JumpBackTarget）。
-- 由 AttentionQueue::ingest 在生成 AttentionItem 时同步生成并链接（attention_items.jump_back_target_id）。
-- 落点生成后不可变（仅 INSERT + SELECT），与 attention 一致可重启恢复。
-- §13.8（MF-9）：仅内部聚焦——表结构不含任何 external_uri / file_ref 列；cwd 仅展示。
CREATE TABLE IF NOT EXISTS jump_back_targets (
    jump_back_target_id TEXT PRIMARY KEY,
    target_kind TEXT NOT NULL,          -- card|terminal|terminal_range|artifact|discussion_message|fallback_context
    instance_id TEXT,
    card_id TEXT,
    terminal_range TEXT,                -- JSON {start_line,end_line}（仅 terminal_range 有值）
    cwd TEXT,                           -- 仅展示 fallback，绝不作 shell.open 入参（§13.8）
    fallback_summary TEXT,              -- FallbackContext 必非空（不静默失败）
    confidence TEXT NOT NULL            -- high|medium|low
);
CREATE INDEX IF NOT EXISTS idx_jump_back_targets_instance ON jump_back_targets(instance_id);

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

    // 控制面语义层 P1：存量库幂等迁移（给旧 session_events 补新列）
    migrate_session_events(&conn)?;
    // 控制面语义层 P5：给旧 attention_items 补权限 payload 列（permission_context/timeout_seconds）
    migrate_attention_items(&conn)?;

    log::debug!("SQLite 数据库初始化完成: {}", path);
    Ok(conn)
}

/// 给存量 `session_events` 表幂等补齐控制面 P1 新列（F1 契约 §2.2）
///
/// 新建库已在 CREATE TABLE 时带上 `event_id`/`source_kind`/`correlation_id`，
/// 此函数针对**旧 schema**（不含这三列）的存量库做 `ALTER TABLE ADD COLUMN`。
/// 通过 `PRAGMA table_info` 检测列是否存在，缺哪列补哪列；重复调用不报错（幂等）。
pub fn migrate_session_events(conn: &Connection) -> Result<(), ConfluxError> {
    let existing = session_events_columns(conn)?;

    // (列名, 列定义) — 均为可空 TEXT，向后兼容旧数据
    let new_columns = [
        ("event_id", "TEXT"),
        ("source_kind", "TEXT"),
        ("correlation_id", "TEXT"),
    ];

    for (col, ty) in new_columns {
        if !existing.iter().any(|c| c == col) {
            conn.execute_batch(&format!(
                "ALTER TABLE session_events ADD COLUMN {} {};",
                col, ty
            ))
            .map_err(|e| ConfluxError::DatabaseError {
                message: format!("session_events 迁移失败（ADD COLUMN {}）: {}", col, e),
            })?;
        }
    }

    // correlation_id 索引（IF NOT EXISTS 幂等；列存在后再建保证安全）
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_session_events_corr ON session_events(correlation_id);",
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("idx_session_events_corr 创建失败: {}", e),
    })?;

    Ok(())
}

/// 给存量 `attention_items` 表幂等补齐 P5 权限 payload 列（F1 §6 投影完整性）。
///
/// 新建库已在 CREATE TABLE 时带上 `permission_context`/`timeout_seconds`；
/// 此函数针对**旧 schema**（不含这两列）的存量库做 `ALTER TABLE ADD COLUMN`。
/// 通过 `PRAGMA table_info` 检测列是否存在，缺哪列补哪列；重复调用不报错（幂等）。
pub fn migrate_attention_items(conn: &Connection) -> Result<(), ConfluxError> {
    let existing = attention_items_columns(conn)?;
    let new_columns = [
        ("permission_context", "TEXT"),
        ("timeout_seconds", "INTEGER"),
    ];
    for (col, ty) in new_columns {
        if !existing.iter().any(|c| c == col) {
            conn.execute_batch(&format!(
                "ALTER TABLE attention_items ADD COLUMN {} {};",
                col, ty
            ))
            .map_err(|e| ConfluxError::DatabaseError {
                message: format!("attention_items 迁移失败（ADD COLUMN {}）: {}", col, e),
            })?;
        }
    }
    Ok(())
}

/// 读取 `attention_items` 表的当前列名集合（PRAGMA table_info）
fn attention_items_columns(conn: &Connection) -> Result<Vec<String>, ConfluxError> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(attention_items)")
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("PRAGMA table_info(attention_items) 准备失败: {}", e),
        })?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("PRAGMA table_info(attention_items) 查询失败: {}", e),
        })?;
    let mut cols = Vec::new();
    for r in rows {
        cols.push(r.map_err(|e| ConfluxError::DatabaseError {
            message: format!("attention_items 列名解析失败: {}", e),
        })?);
    }
    Ok(cols)
}

/// 读取 `session_events` 表的当前列名集合（PRAGMA table_info）
fn session_events_columns(conn: &Connection) -> Result<Vec<String>, ConfluxError> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(session_events)")
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("PRAGMA table_info(session_events) 准备失败: {}", e),
        })?;

    // PRAGMA table_info 列序：cid(0), name(1), type(2), notnull(3), dflt_value(4), pk(5)
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("PRAGMA table_info(session_events) 查询失败: {}", e),
        })?;

    let mut cols = Vec::new();
    for r in rows {
        cols.push(r.map_err(|e| ConfluxError::DatabaseError {
            message: format!("PRAGMA table_info(session_events) 行解析失败: {}", e),
        })?);
    }
    Ok(cols)
}

pub fn sync_adapter_configs_from_registry(
    conn: &Connection,
    registry: &AdapterRegistry,
) -> Result<(), ConfluxError> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("adapter_configs sync transaction failed: {e}"),
        })?;
    for (adapter_id, config, is_builtin) in registry.registered_configs() {
        upsert_adapter_config(&tx, &adapter_id, &config, is_builtin)?;
    }
    tx.commit().map_err(|e| ConfluxError::DatabaseError {
        message: format!("adapter_configs sync commit failed: {e}"),
    })?;
    Ok(())
}

pub fn ensure_adapter_config(
    conn: &Connection,
    adapter_id: &str,
    config: &AdapterConfig,
    is_builtin: bool,
) -> Result<(), ConfluxError> {
    upsert_adapter_config(conn, adapter_id, config, is_builtin)
}

fn upsert_adapter_config(
    conn: &Connection,
    adapter_id: &str,
    config: &AdapterConfig,
    is_builtin: bool,
) -> Result<(), ConfluxError> {
    let default_args = serde_json::to_string(&config.default_args).map_err(|e| {
        ConfluxError::SerializationError {
            message: format!("adapter default_args serialize failed: {e}"),
        }
    })?;
    let status_patterns = serde_json::to_string(&config.status_patterns).map_err(|e| {
        ConfluxError::SerializationError {
            message: format!("adapter status_patterns serialize failed: {e}"),
        }
    })?;

    conn.execute(
        r#"
        INSERT INTO adapter_configs (
            adapter_id,
            name,
            command,
            default_args,
            status_patterns,
            permission_pattern,
            sub_agent_spawn_pattern,
            sub_agent_complete_pattern,
            can_coordinate,
            coordination_template,
            can_parse_tree,
            can_detect_permission,
            is_builtin,
            created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(adapter_id) DO UPDATE SET
            name = excluded.name,
            command = excluded.command,
            default_args = excluded.default_args,
            status_patterns = excluded.status_patterns,
            permission_pattern = excluded.permission_pattern,
            sub_agent_spawn_pattern = excluded.sub_agent_spawn_pattern,
            sub_agent_complete_pattern = excluded.sub_agent_complete_pattern,
            can_coordinate = excluded.can_coordinate,
            coordination_template = excluded.coordination_template,
            can_parse_tree = excluded.can_parse_tree,
            can_detect_permission = excluded.can_detect_permission,
            is_builtin = excluded.is_builtin
        "#,
        params![
            adapter_id,
            config.name,
            config.command,
            default_args,
            status_patterns,
            config.permission_pattern,
            config.sub_agent_spawn_pattern,
            config.sub_agent_complete_pattern,
            bool_to_int(config.capabilities.can_coordinate),
            config.capabilities.coordination_template,
            bool_to_int(config.capabilities.can_parse_tree),
            bool_to_int(config.capabilities.can_detect_permission),
            bool_to_int(is_builtin),
            now_ms(),
        ],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("adapter_configs upsert failed for {adapter_id}: {e}"),
    })?;

    Ok(())
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::{builtin, registry::AdapterRegistry};
    use crate::persistence::session::insert_agent_instance;

    #[test]
    fn test_ensure_single_adapter_config_allows_first_agent_instance() {
        let conn = init_database(":memory:").expect("database init should succeed");
        let mut registry = AdapterRegistry::new();
        builtin::register_builtins(&mut registry);
        let config = registry
            .get_config("codex")
            .expect("builtin codex config should exist")
            .clone();

        ensure_adapter_config(&conn, "codex", &config, registry.is_builtin("codex"))
            .expect("single adapter config should upsert");

        insert_agent_instance(
            &conn,
            "inst-codex-001",
            "codex",
            "Codex",
            r"C:\Users",
            1_000,
        )
        .expect("first agent instance insert should pass after single adapter upsert");
    }

    /// 读取 session_events 当前列名集合（测试辅助）
    fn columns_of(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .expect("PRAGMA 准备应成功");
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("PRAGMA 查询应成功");
        rows.map(|r| r.expect("行解析应成功")).collect()
    }

    #[test]
    fn test_init_database_creates_all_tables() {
        let conn = init_database(":memory:").expect("内存数据库初始化应成功");

        // 验证所有表都存在（含新增 audit_events）
        let expected_tables = [
            "adapter_configs",
            "agent_instances",
            "session_events",
            "discussions",
            "discussion_messages",
            "workspace_layouts",
            "audit_events",
            "attention_items",
            "jump_back_targets",
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

    #[test]
    fn test_sync_builtin_adapter_configs_allows_first_agent_instance() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");
        let mut registry = AdapterRegistry::new();
        builtin::register_builtins(&mut registry);

        sync_adapter_configs_from_registry(&conn, &registry)
            .expect("内置 adapter 配置应同步到 adapter_configs");

        insert_agent_instance(
            &conn,
            "inst-claude-001",
            "claude-code",
            "Claude Code",
            r"C:\Users",
            1_000,
        )
        .expect("同步内置 adapter 后首个 agent instance 插入应成功");
    }

    #[test]
    fn test_new_db_has_session_events_control_plane_columns() {
        let conn = init_database(":memory:").expect("内存数据库初始化应成功");
        let cols = columns_of(&conn, "session_events");
        for expected in ["event_id", "source_kind", "correlation_id"] {
            assert!(
                cols.iter().any(|c| c == expected),
                "新建库 session_events 应含列 {}",
                expected
            );
        }
    }

    #[test]
    fn test_migrate_session_events_upgrades_old_schema() {
        // 模拟旧 schema：手动建不含控制面新列的 session_events
        let conn = Connection::open(":memory:").expect("打开内存库应成功");
        conn.execute_batch(
            r#"
            CREATE TABLE session_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instance_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                data TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );
            INSERT INTO session_events (instance_id, event_type, data, timestamp)
            VALUES ('inst-old', 'status_changed', '{}', 100);
            "#,
        )
        .expect("旧 schema 建表 + 插入应成功");

        // 迁移前：不含新列
        let before = columns_of(&conn, "session_events");
        for missing in ["event_id", "source_kind", "correlation_id"] {
            assert!(!before.iter().any(|c| c == missing));
        }

        // 执行迁移
        migrate_session_events(&conn).expect("session_events 迁移应成功");

        // 迁移后：三列已补齐，旧数据保留
        let after = columns_of(&conn, "session_events");
        for expected in ["event_id", "source_kind", "correlation_id"] {
            assert!(
                after.iter().any(|c| c == expected),
                "迁移后 session_events 应含列 {}",
                expected
            );
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_events", [], |r| r.get(0))
            .expect("计数应成功");
        assert_eq!(count, 1, "迁移不应丢失旧数据");
    }

    #[test]
    fn test_migrate_session_events_is_idempotent() {
        let conn = init_database(":memory:").expect("内存数据库初始化应成功");
        // init_database 已调用一次迁移；重复调用必须不报错
        migrate_session_events(&conn).expect("重复迁移应成功（幂等）");
        migrate_session_events(&conn).expect("第三次迁移应成功（幂等）");

        let cols = columns_of(&conn, "session_events");
        // 三列仅各一份，不应重复添加
        for expected in ["event_id", "source_kind", "correlation_id"] {
            let n = cols.iter().filter(|c| *c == expected).count();
            assert_eq!(n, 1, "列 {} 不应被重复添加", expected);
        }
    }
}
