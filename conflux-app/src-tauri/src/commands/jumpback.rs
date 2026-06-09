// ===== Conflux 控制面语义层 P4: 精确回场对象 Tauri Commands =====
// 命令 `get_jump_back_target`：按 id 取回 JumpBackTarget（F1 控制面契约 §5 + §9）。
//
// 落点对象由 AttentionQueue::ingest 生成并持久化（jump_back_targets 表），
// 这里只做按 id 的只读查询，从 DB 取回。
//
// 安全约束 §13.8（MF-9）：返回的 JumpBackTarget **只用于 app 内部聚焦**
// （card/terminal），结构上不含任何可驱动 shell.open / 外部 URI 的字段；前端据此
// 仅能做内部导航。本命令为只读，无审计副作用。
//
// 未知 id 行为（已选定并文档化）：**不返回 Err、不 panic**，而是合成一个
// FallbackContext 落点（confidence Low + 说明性 summary），保证前端拿到可用对象、
// 给用户一个"这条线索已失效"的兜底上下文（§5「不静默失败」精神）。

use tauri::State;

use crate::core::jumpback::JumpBackTarget;
use crate::core::ConfluxError;
use crate::persistence::jumpback as db_jumpback;
use crate::AppState;

/// 按 id 取回精确回场落点。
///
/// 命中 → 返回该落点。未命中 → 返回一个合成的 `FallbackContext` 落点
/// （confidence Low，fallback_summary 说明该落点不存在/已失效），**不 panic、不 Err**。
#[tauri::command]
pub async fn get_jump_back_target(
    state: State<'_, AppState>,
    jump_back_target_id: String,
) -> Result<JumpBackTarget, ConfluxError> {
    let found = {
        let conn = state.db.lock();
        db_jumpback::get_jump_back_target(&conn, &jump_back_target_id)?
    };

    Ok(found.unwrap_or_else(|| {
        // 未知 id：合成兜底落点（不静默失败——给用户可见上下文）。
        JumpBackTarget::fallback(
            format!("回场落点不存在或已失效 (id={})", jump_back_target_id),
            None,
            None,
        )
    }))
}

#[cfg(test)]
mod tests {
    use crate::core::jumpback::{JumpBackTarget, JumpConfidence, JumpKind, TerminalRange};
    use crate::core::types::InstanceId;
    use crate::persistence::jumpback as db_jumpback;
    use crate::persistence::schema::init_database;

    /// 命中：插入后按 id 取回，字段一致。
    #[test]
    fn test_get_existing_target_roundtrip() {
        let conn = init_database(":memory:").unwrap();
        let target = JumpBackTarget::card(InstanceId("inst-a".to_string()), None);
        db_jumpback::insert_jump_back_target(&conn, &target).unwrap();

        let got = db_jumpback::get_jump_back_target(&conn, &target.jump_back_target_id)
            .unwrap()
            .expect("应命中");
        assert_eq!(got, target);
    }

    /// 未知 id：合成 FallbackContext（不 panic、不 Err），confidence Low，summary 非空。
    #[test]
    fn test_unknown_id_yields_fallback_not_panic() {
        let conn = init_database(":memory:").unwrap();
        let found = db_jumpback::get_jump_back_target(&conn, "no-such-id").unwrap();
        assert!(found.is_none(), "DB 层未知 id 返回 None");

        // 命令层把 None 合成兜底落点（与 get_jump_back_target 命令体一致的逻辑）
        let fallback = found.unwrap_or_else(|| {
            JumpBackTarget::fallback(
                "回场落点不存在或已失效 (id=no-such-id)".to_string(),
                None,
                None,
            )
        });
        assert_eq!(fallback.target_kind, JumpKind::FallbackContext);
        assert_eq!(fallback.confidence, JumpConfidence::Low);
        assert!(fallback.fallback_summary.is_some());
        assert!(!fallback.fallback_summary.unwrap().is_empty());
    }

    /// TerminalRange 落点能被 DB 完整往返（保留行号字段）。
    #[test]
    fn test_terminal_range_target_roundtrip() {
        let conn = init_database(":memory:").unwrap();
        let target = JumpBackTarget::terminal_range(
            InstanceId("inst-t".to_string()),
            TerminalRange { start_line: 3, end_line: 9 },
            None,
        );
        db_jumpback::insert_jump_back_target(&conn, &target).unwrap();
        let got = db_jumpback::get_jump_back_target(&conn, &target.jump_back_target_id)
            .unwrap()
            .unwrap();
        assert_eq!(got.terminal_range, Some(TerminalRange { start_line: 3, end_line: 9 }));
        assert_eq!(got.confidence, JumpConfidence::High);
    }
}
