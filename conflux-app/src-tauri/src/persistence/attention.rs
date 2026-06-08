// ===== Conflux 持久化层: 注意力队列项 =====
// 负责 attention_items 表的写入/更新/查询（F1 控制面契约 §4.1）。
//
// 与 audit_events（append-only）不同，attention_items 是**可变状态镜像**：
//   - insert: ingest 派生新 item
//   - update: resolve/defer/ignore/restore 改 resolution/resolved_at/audit_event_id
//   - query:  list_active（resolution IS NULL）/ list_ignored（resolution='ignored'）
//
// 枚举 ↔ TEXT 列映射采用与 serde snake_case 一致的小写串。
// available_actions 以 JSON 数组存储（serde_json）。

use rusqlite::{params, Connection};

use crate::core::interaction::{InteractionAction, InteractionKind, InteractionResolution};
use crate::core::types::{EventPriority, InstanceId};
use crate::core::ConfluxError;
use crate::orchestration::attention::AttentionItem;

/// 插入一条注意力队列项
pub fn insert_attention_item(conn: &Connection, item: &AttentionItem) -> Result<(), ConfluxError> {
    let actions_json = serde_json::to_string(&item.available_actions)?;
    conn.execute(
        "INSERT INTO attention_items (\
            attention_item_id, instance_id, kind, priority, source_event_id, \
            interaction_id, payload_summary, available_actions, jump_back_target_id, \
            created_at, resolved_at, resolution, audit_event_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            item.attention_item_id,
            item.instance_id.0,
            kind_to_str(&item.kind),
            priority_to_str(&item.priority),
            item.source_event_id,
            item.interaction_id,
            item.payload_summary,
            actions_json,
            item.jump_back_target_id,
            item.created_at,
            item.resolved_at,
            item.resolution.as_ref().map(resolution_to_str),
            item.audit_event_id,
        ],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("attention_items 写入失败: {}", e),
    })?;
    Ok(())
}

/// 全量更新一条注意力队列项（mirror 内存态；resolve/defer/ignore/restore 后调用）
pub fn update_attention_item(conn: &Connection, item: &AttentionItem) -> Result<(), ConfluxError> {
    let actions_json = serde_json::to_string(&item.available_actions)?;
    let affected = conn
        .execute(
            "UPDATE attention_items SET \
                instance_id = ?2, kind = ?3, priority = ?4, source_event_id = ?5, \
                interaction_id = ?6, payload_summary = ?7, available_actions = ?8, \
                jump_back_target_id = ?9, created_at = ?10, resolved_at = ?11, \
                resolution = ?12, audit_event_id = ?13 \
             WHERE attention_item_id = ?1",
            params![
                item.attention_item_id,
                item.instance_id.0,
                kind_to_str(&item.kind),
                priority_to_str(&item.priority),
                item.source_event_id,
                item.interaction_id,
                item.payload_summary,
                actions_json,
                item.jump_back_target_id,
                item.created_at,
                item.resolved_at,
                item.resolution.as_ref().map(resolution_to_str),
                item.audit_event_id,
            ],
        )
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("attention_items 更新失败: {}", e),
        })?;
    if affected == 0 {
        return Err(ConfluxError::DatabaseError {
            message: format!(
                "attention_items 更新影响 0 行（id={} 不存在）",
                item.attention_item_id
            ),
        });
    }
    Ok(())
}

/// 查询全部活跃项（resolution IS NULL），按 priority 升序（Critical=0 最高）+ created_at 升序
pub fn list_active_attention_items(conn: &Connection) -> Result<Vec<AttentionItem>, ConfluxError> {
    query_items(
        conn,
        "SELECT attention_item_id, instance_id, kind, priority, source_event_id, \
         interaction_id, payload_summary, available_actions, jump_back_target_id, \
         created_at, resolved_at, resolution, audit_event_id \
         FROM attention_items WHERE resolution IS NULL \
         ORDER BY priority ASC, created_at ASC",
    )
}

/// 查询全部被忽略项（resolution = 'ignored'），按 created_at 升序
pub fn list_ignored_attention_items(conn: &Connection) -> Result<Vec<AttentionItem>, ConfluxError> {
    query_items(
        conn,
        "SELECT attention_item_id, instance_id, kind, priority, source_event_id, \
         interaction_id, payload_summary, available_actions, jump_back_target_id, \
         created_at, resolved_at, resolution, audit_event_id \
         FROM attention_items WHERE resolution = 'ignored' \
         ORDER BY created_at ASC",
    )
}

fn query_items(conn: &Connection, sql: &str) -> Result<Vec<AttentionItem>, ConfluxError> {
    let mut stmt = conn.prepare(sql).map_err(|e| ConfluxError::DatabaseError {
        message: format!("attention_items 查询准备失败: {}", e),
    })?;

    let rows = stmt
        .query_map([], map_row)
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("attention_items 查询执行失败: {}", e),
        })?;

    let mut items = Vec::new();
    for r in rows {
        items.push(r.map_err(|e| ConfluxError::DatabaseError {
            message: format!("attention_items 行解析失败: {}", e),
        })?);
    }
    Ok(items)
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<AttentionItem> {
    let actions_json: String = row.get(7)?;
    let available_actions: Vec<InteractionAction> =
        serde_json::from_str(&actions_json).unwrap_or_default();
    let resolution: Option<String> = row.get(11)?;
    Ok(AttentionItem {
        attention_item_id: row.get(0)?,
        instance_id: InstanceId(row.get::<_, String>(1)?),
        kind: kind_from_str(&row.get::<_, String>(2)?),
        priority: priority_from_str(&row.get::<_, String>(3)?),
        source_event_id: row.get(4)?,
        interaction_id: row.get(5)?,
        payload_summary: row.get(6)?,
        available_actions,
        jump_back_target_id: row.get(8)?,
        created_at: row.get(9)?,
        resolved_at: row.get(10)?,
        resolution: resolution.as_deref().and_then(resolution_from_str),
        audit_event_id: row.get(12)?,
    })
}

// ===== 枚举 ↔ TEXT 映射（与 serde snake_case 对齐） =====

fn kind_to_str(kind: &InteractionKind) -> &'static str {
    match kind {
        InteractionKind::Permission => "permission",
        InteractionKind::NeedsInput => "needs_input",
        InteractionKind::PlanReview => "plan_review",
        InteractionKind::ToolApproval => "tool_approval",
        InteractionKind::ErrorRecovery => "error_recovery",
        InteractionKind::ReviewRequired => "review_required",
    }
}

fn kind_from_str(s: &str) -> InteractionKind {
    match s {
        "permission" => InteractionKind::Permission,
        "needs_input" => InteractionKind::NeedsInput,
        "plan_review" => InteractionKind::PlanReview,
        "tool_approval" => InteractionKind::ToolApproval,
        "error_recovery" => InteractionKind::ErrorRecovery,
        // 未知值降级为 ReviewRequired（最低副作用的上浮类别）
        _ => InteractionKind::ReviewRequired,
    }
}

fn priority_to_str(p: &EventPriority) -> &'static str {
    match p {
        EventPriority::Critical => "critical",
        EventPriority::High => "high",
        EventPriority::Normal => "normal",
        EventPriority::Low => "low",
    }
}

fn priority_from_str(s: &str) -> EventPriority {
    match s {
        "critical" => EventPriority::Critical,
        "high" => EventPriority::High,
        "low" => EventPriority::Low,
        // 未知值降级为 Normal
        _ => EventPriority::Normal,
    }
}

fn resolution_to_str(r: &InteractionResolution) -> &'static str {
    match r {
        InteractionResolution::Approved => "approved",
        InteractionResolution::Denied => "denied",
        InteractionResolution::Replied => "replied",
        InteractionResolution::Deferred => "deferred",
        InteractionResolution::Ignored => "ignored",
        InteractionResolution::Expired => "expired",
    }
}

fn resolution_from_str(s: &str) -> Option<InteractionResolution> {
    match s {
        "approved" => Some(InteractionResolution::Approved),
        "denied" => Some(InteractionResolution::Denied),
        "replied" => Some(InteractionResolution::Replied),
        "deferred" => Some(InteractionResolution::Deferred),
        "ignored" => Some(InteractionResolution::Ignored),
        "expired" => Some(InteractionResolution::Expired),
        _ => None,
    }
}
