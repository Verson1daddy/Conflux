// ===== Conflux 持久化层: 精确回场对象 JumpBackTarget =====
// 负责 jump_back_targets 表的写入与查询（F1 控制面契约 §5.1）。
//
// 与 attention_items 一致地持久化（可重启恢复）：ingest 生成落点时 INSERT，
// `get_jump_back_target` 命令按 id SELECT。落点对象生成后不再变更，
// 故仅 INSERT + SELECT（无 UPDATE 路径）。
//
// 枚举 ↔ TEXT 列映射：与 serde snake_case 一致的小写串。
// terminal_range 以 JSON 存储（serde_json，可空）。
//
// §13.8（MF-9）：表结构**不含**任何 external_uri / file_ref 列；cwd 仅展示。

use rusqlite::{params, Connection};

use crate::core::jumpback::{JumpBackTarget, JumpConfidence, JumpKind, TerminalRange};
#[cfg(test)]
use crate::core::jumpback::CoordSpace;
use crate::core::types::InstanceId;
use crate::core::ConfluxError;

/// 插入一条回场落点（纯 INSERT；落点生成后不可变）。
pub fn insert_jump_back_target(
    conn: &Connection,
    target: &JumpBackTarget,
) -> Result<(), ConfluxError> {
    let range_json = match &target.terminal_range {
        Some(r) => Some(serde_json::to_string(r)?),
        None => None,
    };
    conn.execute(
        "INSERT INTO jump_back_targets (\
            jump_back_target_id, target_kind, instance_id, card_id, \
            terminal_range, cwd, fallback_summary, confidence) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            target.jump_back_target_id,
            kind_to_str(&target.target_kind),
            target.instance_id.as_ref().map(|i| i.0.clone()),
            target.card_id,
            range_json,
            target.cwd,
            target.fallback_summary,
            confidence_to_str(&target.confidence),
        ],
    )
    .map_err(|e| ConfluxError::DatabaseError {
        message: format!("jump_back_targets 写入失败: {}", e),
    })?;
    Ok(())
}

/// 按 id 取回一条回场落点；不存在返回 `Ok(None)`（命令层据此给出 fallback/Err）。
pub fn get_jump_back_target(
    conn: &Connection,
    id: &str,
) -> Result<Option<JumpBackTarget>, ConfluxError> {
    let mut stmt = conn
        .prepare(
            "SELECT jump_back_target_id, target_kind, instance_id, card_id, \
             terminal_range, cwd, fallback_summary, confidence \
             FROM jump_back_targets WHERE jump_back_target_id = ?1",
        )
        .map_err(|e| ConfluxError::DatabaseError {
            message: format!("get_jump_back_target 查询准备失败: {}", e),
        })?;

    let mut rows =
        stmt.query_map(params![id], map_row)
            .map_err(|e| ConfluxError::DatabaseError {
                message: format!("get_jump_back_target 查询执行失败: {}", e),
            })?;

    match rows.next() {
        Some(r) => Ok(Some(r.map_err(|e| ConfluxError::DatabaseError {
            message: format!("get_jump_back_target 行解析失败: {}", e),
        })?)),
        None => Ok(None),
    }
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<JumpBackTarget> {
    let instance_id: Option<String> = row.get(2)?;
    let range_json: Option<String> = row.get(4)?;
    let terminal_range: Option<TerminalRange> = range_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    Ok(JumpBackTarget {
        jump_back_target_id: row.get(0)?,
        target_kind: kind_from_str(&row.get::<_, String>(1)?),
        instance_id: instance_id.map(InstanceId),
        card_id: row.get(3)?,
        terminal_range,
        cwd: row.get(5)?,
        fallback_summary: row.get(6)?,
        confidence: confidence_from_str(&row.get::<_, String>(7)?),
    })
}

// ===== 枚举 ↔ TEXT 映射（与 serde snake_case 对齐） =====

fn kind_to_str(kind: &JumpKind) -> &'static str {
    match kind {
        JumpKind::Card => "card",
        JumpKind::Terminal => "terminal",
        JumpKind::TerminalRange => "terminal_range",
        JumpKind::Artifact => "artifact",
        JumpKind::DiscussionMessage => "discussion_message",
        JumpKind::FallbackContext => "fallback_context",
    }
}

fn kind_from_str(s: &str) -> JumpKind {
    match s {
        "card" => JumpKind::Card,
        "terminal" => JumpKind::Terminal,
        "terminal_range" => JumpKind::TerminalRange,
        "artifact" => JumpKind::Artifact,
        "discussion_message" => JumpKind::DiscussionMessage,
        // 未知值降级为 FallbackContext（最保守，仅内部展示）
        _ => JumpKind::FallbackContext,
    }
}

fn confidence_to_str(c: &JumpConfidence) -> &'static str {
    match c {
        JumpConfidence::High => "high",
        JumpConfidence::Medium => "medium",
        JumpConfidence::Low => "low",
    }
}

fn confidence_from_str(s: &str) -> JumpConfidence {
    match s {
        "high" => JumpConfidence::High,
        "medium" => JumpConfidence::Medium,
        // 未知值降级为 Low（最保守）
        _ => JumpConfidence::Low,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::schema::init_database;

    #[test]
    fn test_insert_and_get_card_target_roundtrip() {
        let conn = init_database(":memory:").unwrap();
        let target =
            JumpBackTarget::card(InstanceId("inst-a".to_string()), Some("/work".to_string()));
        insert_jump_back_target(&conn, &target).unwrap();

        let got = get_jump_back_target(&conn, &target.jump_back_target_id)
            .unwrap()
            .expect("应取回落点");
        assert_eq!(got, target);
        assert_eq!(got.target_kind, JumpKind::Card);
        assert_eq!(got.confidence, JumpConfidence::Medium);
        assert_eq!(got.card_id.as_deref(), Some("inst-a"));
        assert_eq!(got.cwd.as_deref(), Some("/work"));
    }

    #[test]
    fn test_insert_and_get_terminal_range_roundtrip() {
        let conn = init_database(":memory:").unwrap();
        let target = JumpBackTarget::terminal_range(
            InstanceId("inst-b".to_string()),
            TerminalRange {
                start_line: 12,
                end_line: 18,
                coord_space: CoordSpace::Xterm,
            },
            None,
        );
        insert_jump_back_target(&conn, &target).unwrap();

        let got = get_jump_back_target(&conn, &target.jump_back_target_id)
            .unwrap()
            .expect("应取回落点");
        assert_eq!(got, target);
        assert_eq!(got.target_kind, JumpKind::TerminalRange);
        assert_eq!(got.confidence, JumpConfidence::High);
        assert_eq!(
            got.terminal_range,
            Some(TerminalRange {
                start_line: 12,
                end_line: 18,
                coord_space: CoordSpace::Xterm,
            })
        );
    }

    #[test]
    fn test_insert_and_get_fallback_roundtrip() {
        let conn = init_database(":memory:").unwrap();
        let target = JumpBackTarget::fallback("讨论消息".to_string(), None, None);
        insert_jump_back_target(&conn, &target).unwrap();

        let got = get_jump_back_target(&conn, &target.jump_back_target_id)
            .unwrap()
            .expect("应取回落点");
        assert_eq!(got, target);
        assert_eq!(got.target_kind, JumpKind::FallbackContext);
        assert_eq!(got.confidence, JumpConfidence::Low);
        assert_eq!(got.fallback_summary.as_deref(), Some("讨论消息"));
        assert!(got.instance_id.is_none());
    }

    #[test]
    fn test_get_unknown_id_returns_none() {
        let conn = init_database(":memory:").unwrap();
        let got = get_jump_back_target(&conn, "no-such-id").unwrap();
        assert!(got.is_none());
    }
}
