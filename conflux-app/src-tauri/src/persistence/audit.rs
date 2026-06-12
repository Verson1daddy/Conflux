// ===== Conflux 持久化层: 不可变审计事件 =====
// 负责 audit_events 表的写入与查询（F1 控制面契约 §7.2）。
//
// 不可变（MF-7，§13.6）：仅 INSERT + SELECT，无 UPDATE/DELETE 路径；
// DB 触发器 audit_events_no_update / audit_events_no_delete 兜底拒绝改删。
//
// 枚举 ↔ TEXT 列映射：采用与 serde `snake_case` 一致的小写串
// （与 query.rs 既有 serialize_*/deserialize_* 风格对齐）。

use rusqlite::{params, Connection};

use crate::core::audit::{AuditAction, AuditActor, AuditEvent, AuditResult};
use crate::core::types::{InjectionSource, InstanceId};
use crate::core::ConfluxError;

/// 插入一条审计事件（纯 INSERT，append-only）
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `event`: 审计事件
pub fn insert_audit_event(conn: &Connection, event: &AuditEvent) -> Result<(), ConfluxError> {
    conn.execute(
        "INSERT INTO audit_events (\
            audit_event_id, actor, action, instance_id, source_event_id, \
            interaction_id, injection_source, result, created_at, rationale_ref, payload) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            event.audit_event_id,
            actor_to_str(&event.actor),
            action_to_str(&event.action),
            event.instance_id.as_ref().map(|i| i.0.clone()),
            event.source_event_id,
            event.interaction_id,
            event.injection_source.as_ref().map(injection_source_to_str),
            result_to_str(&event.result),
            event.created_at,
            event.rationale_ref,
            event.payload,
        ],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("audit_events 写入失败: {}", e),
    })?;

    Ok(())
}

/// 查询审计事件，按 created_at 降序（最新在前）
///
/// # 参数
/// - `conn`: SQLite 数据库连接引用
/// - `instance_id`: 可选过滤，仅返回该实例的审计；None 返回全部
/// - `limit`: 可选返回数量上限；None 不限制
pub fn list_audit_events(
    conn: &Connection,
    instance_id: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<AuditEvent>, ConfluxError> {
    // 动态拼接 WHERE / LIMIT，但值仍走参数化绑定（防注入）
    let mut sql = String::from(
        "SELECT audit_event_id, actor, action, instance_id, source_event_id, \
         interaction_id, injection_source, result, created_at, rationale_ref, payload \
         FROM audit_events",
    );
    if instance_id.is_some() {
        sql.push_str(" WHERE instance_id = ?1");
    }
    sql.push_str(" ORDER BY created_at DESC");
    if let Some(n) = limit {
        sql.push_str(&format!(" LIMIT {}", n));
    }

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("list_audit_events 查询准备失败: {}", e),
        })?;

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<AuditEvent> {
        let instance_id: Option<String> = row.get(3)?;
        let injection_source: Option<String> = row.get(6)?;
        Ok(AuditEvent {
            audit_event_id: row.get(0)?,
            actor: actor_from_str(&row.get::<_, String>(1)?),
            action: action_from_str(&row.get::<_, String>(2)?),
            instance_id: instance_id.map(InstanceId),
            source_event_id: row.get(4)?,
            interaction_id: row.get(5)?,
            injection_source: injection_source
                .as_deref()
                .and_then(injection_source_from_str),
            result: result_from_str(&row.get::<_, String>(7)?),
            created_at: row.get(8)?,
            rationale_ref: row.get(9)?,
            payload: row.get(10)?,
        })
    };

    let rows = if let Some(id) = instance_id {
        stmt.query_map(params![id], map_row)
    } else {
        stmt.query_map([], map_row)
    }
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("list_audit_events 查询执行失败: {}", e),
    })?;

    let mut events = Vec::new();
    for r in rows {
        events.push(r.map_err(|e| ConfluxError::DatabaseError {
            message: format!("list_audit_events 行解析失败: {}", e),
        })?);
    }
    Ok(events)
}

// ===== 枚举 ↔ TEXT 映射（与 serde snake_case 对齐） =====

fn actor_to_str(actor: &AuditActor) -> &'static str {
    match actor {
        AuditActor::User => "user",
        AuditActor::System => "system",
        AuditActor::Coordinator => "coordinator",
    }
}

fn actor_from_str(s: &str) -> AuditActor {
    match s {
        "user" => AuditActor::User,
        "coordinator" => AuditActor::Coordinator,
        // 未知值降级为 System（最保守的非用户归属）
        _ => AuditActor::System,
    }
}

fn action_to_str(action: &AuditAction) -> &'static str {
    match action {
        AuditAction::Approve => "approve",
        AuditAction::Deny => "deny",
        AuditAction::Reply => "reply",
        AuditAction::Defer => "defer",
        AuditAction::Ignore => "ignore",
        AuditAction::SendContext => "send_context",
        AuditAction::DiscussionInjection => "discussion_injection",
        AuditAction::AutoInjection => "auto_injection",
        AuditAction::Interrupt => "interrupt",
        AuditAction::Terminate => "terminate",
        AuditAction::Restore => "restore",
        AuditAction::Expire => "expire",
        AuditAction::Remind => "remind",
        AuditAction::CaptureDump => "capture_dump",
    }
}

fn action_from_str(s: &str) -> AuditAction {
    match s {
        "approve" => AuditAction::Approve,
        "deny" => AuditAction::Deny,
        "reply" => AuditAction::Reply,
        "defer" => AuditAction::Defer,
        "ignore" => AuditAction::Ignore,
        "send_context" => AuditAction::SendContext,
        "discussion_injection" => AuditAction::DiscussionInjection,
        "auto_injection" => AuditAction::AutoInjection,
        "interrupt" => AuditAction::Interrupt,
        "terminate" => AuditAction::Terminate,
        "restore" => AuditAction::Restore,
        "expire" => AuditAction::Expire,
        "remind" => AuditAction::Remind,
        "capture_dump" => AuditAction::CaptureDump,
        // 未知值降级为 Interrupt 是不安全的语义；落库值由后端硬编码控制，
        // 此处理论上不可达；保守降级为 Ignore（不产生新副作用）。
        _ => AuditAction::Ignore,
    }
}

fn result_to_str(result: &AuditResult) -> &'static str {
    match result {
        AuditResult::Ok => "ok",
        AuditResult::Rejected => "rejected",
        AuditResult::Failed => "failed",
    }
}

fn result_from_str(s: &str) -> AuditResult {
    match s {
        "ok" => AuditResult::Ok,
        "rejected" => AuditResult::Rejected,
        // 未知值降级为 Failed（最保守，避免误判为成功）
        _ => AuditResult::Failed,
    }
}

fn injection_source_to_str(src: &InjectionSource) -> &'static str {
    match src {
        InjectionSource::UserDirect => "user_direct",
        InjectionSource::PermissionResponse => "permission_response",
        InjectionSource::OrchestrationAuto => "orchestration_auto",
        InjectionSource::DiscussionUserMessage => "discussion_user_message",
    }
}

fn injection_source_from_str(s: &str) -> Option<InjectionSource> {
    match s {
        "user_direct" => Some(InjectionSource::UserDirect),
        "permission_response" => Some(InjectionSource::PermissionResponse),
        "orchestration_auto" => Some(InjectionSource::OrchestrationAuto),
        "discussion_user_message" => Some(InjectionSource::DiscussionUserMessage),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::audit::AuditEvent;
    use crate::persistence::schema::init_database;

    fn sample_event(id: &str, instance: Option<&str>, created_at: i64) -> AuditEvent {
        AuditEvent {
            audit_event_id: id.to_string(),
            actor: AuditActor::User,
            action: AuditAction::Approve,
            instance_id: instance.map(|s| InstanceId(s.to_string())),
            source_event_id: Some("evt-1".to_string()),
            interaction_id: Some("intr-1".to_string()),
            injection_source: Some(InjectionSource::PermissionResponse),
            result: AuditResult::Ok,
            created_at,
            rationale_ref: Some("rationale://approve".to_string()),
            payload: Some(r#"{"key_count":1}"#.to_string()),
        }
    }

    #[test]
    fn test_insert_and_list_audit_event_roundtrip() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");
        let ev = sample_event("audit-001", Some("inst-a"), 1_000);

        insert_audit_event(&conn, &ev).expect("审计事件插入应成功");

        let listed = list_audit_events(&conn, None, None).expect("审计查询应成功");
        assert_eq!(listed.len(), 1);
        let got = &listed[0];
        assert_eq!(got.audit_event_id, "audit-001");
        assert_eq!(got.actor, AuditActor::User);
        assert_eq!(got.action, AuditAction::Approve);
        assert_eq!(
            got.instance_id.as_ref().map(|i| i.0.as_str()),
            Some("inst-a")
        );
        assert_eq!(got.source_event_id.as_deref(), Some("evt-1"));
        assert_eq!(got.interaction_id.as_deref(), Some("intr-1"));
        assert_eq!(
            got.injection_source,
            Some(InjectionSource::PermissionResponse)
        );
        assert_eq!(got.result, AuditResult::Ok);
        assert_eq!(got.created_at, 1_000);
        assert_eq!(got.rationale_ref.as_deref(), Some("rationale://approve"));
    }

    #[test]
    fn test_list_audit_events_filter_and_order() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");
        insert_audit_event(&conn, &sample_event("a1", Some("inst-a"), 1_000)).unwrap();
        insert_audit_event(&conn, &sample_event("a2", Some("inst-a"), 3_000)).unwrap();
        insert_audit_event(&conn, &sample_event("b1", Some("inst-b"), 2_000)).unwrap();

        // 全量按 created_at DESC
        let all = list_audit_events(&conn, None, None).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].audit_event_id, "a2"); // 3000
        assert_eq!(all[1].audit_event_id, "b1"); // 2000
        assert_eq!(all[2].audit_event_id, "a1"); // 1000

        // 按 instance 过滤
        let only_a = list_audit_events(&conn, Some("inst-a"), None).unwrap();
        assert_eq!(only_a.len(), 2);
        assert!(only_a
            .iter()
            .all(|e| e.instance_id.as_ref().unwrap().0 == "inst-a"));

        // limit
        let limited = list_audit_events(&conn, None, Some(1)).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].audit_event_id, "a2");
    }

    #[test]
    fn test_audit_events_update_is_rejected_by_trigger() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");
        insert_audit_event(&conn, &sample_event("audit-u", Some("inst-a"), 1_000)).unwrap();

        // MF-7 / §13.6：UPDATE 必须被触发器 ABORT
        let res = conn.execute(
            "UPDATE audit_events SET result = 'failed' WHERE audit_event_id = 'audit-u'",
            [],
        );
        assert!(res.is_err(), "audit_events 的 UPDATE 必须被触发器拒绝");
    }

    #[test]
    fn test_audit_events_delete_is_rejected_by_trigger() {
        let conn = init_database(":memory:").expect("数据库初始化应成功");
        insert_audit_event(&conn, &sample_event("audit-d", Some("inst-a"), 1_000)).unwrap();

        // MF-7 / §13.6：DELETE 必须被触发器 ABORT
        let res = conn.execute(
            "DELETE FROM audit_events WHERE audit_event_id = 'audit-d'",
            [],
        );
        assert!(res.is_err(), "audit_events 的 DELETE 必须被触发器拒绝");

        // 确认行仍在
        let still = list_audit_events(&conn, None, None).unwrap();
        assert_eq!(still.len(), 1);
    }

    #[test]
    fn test_uuid_new_id_is_unique() {
        let a = AuditEvent::new_id();
        let b = AuditEvent::new_id();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36); // uuid v4 标准带连字符格式
    }
}
