// ===== Conflux 控制面语义层 P2: 注意力队列 Tauri Commands =====
// 4 个 IPC 命令：list / resolve / defer / restore（F1 控制面契约 §4 + §11）。
//
// 安全约束：
//   - MF-6（§13.2）：审计 actor / action 由后端命令边界**硬编码**，前端只能传
//     attention_item_id 与（resolve 时的）业务语义动作，绝不能自标 System/Coordinator。
//   - MF-8（§13.6）：每次处置与审计写入原子绑定（在 AttentionQueue 内部事务保证），
//     审计失败 fail-closed。
//
// 锁顺序（防死锁，与 core/event_emit.rs::ingest_into_attention_queue 一致）：
//   先 attention_queue(write) 再 db(Mutex)。emit 在释放锁后进行。

use tauri::{AppHandle, State};

use crate::core::audit::AuditAction;
use crate::core::event_emit::emit_attention_updated;
use crate::core::interaction::InteractionResolution;
use crate::core::ConfluxError;
use crate::orchestration::attention::AttentionItem;
use crate::AppState;

/// 前端发起 resolve 时允许指定的处置语义（白名单——排除 Deferred/Ignored）。
///
/// MF-6：前端只能在这个受限集合里选；actor/action 仍由后端硬编码映射。
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolveKind {
    Approve,
    Deny,
    Reply,
}

impl ResolveKind {
    fn parts(self) -> (InteractionResolution, AuditAction) {
        match self {
            ResolveKind::Approve => (InteractionResolution::Approved, AuditAction::Approve),
            ResolveKind::Deny => (InteractionResolution::Denied, AuditAction::Deny),
            ResolveKind::Reply => (InteractionResolution::Replied, AuditAction::Reply),
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 列出当前活跃的注意力项（按优先级 + 时间排序）。
#[tauri::command]
pub async fn list_attention_items(
    state: State<'_, AppState>,
) -> Result<Vec<AttentionItem>, ConfluxError> {
    let queue = state.attention_queue.read();
    Ok(queue.list_active())
}

/// 处置一条注意力项（approve / deny / reply）。
///
/// resolution + 审计原子落库（MF-8）；成功后 emit attention_updated。
#[tauri::command]
pub async fn resolve_attention_item(
    app: AppHandle,
    state: State<'_, AppState>,
    attention_item_id: String,
    kind: ResolveKind,
) -> Result<AttentionItem, ConfluxError> {
    let (resolution, action) = kind.parts();

    let item = {
        let mut queue = state.attention_queue.write();
        let conn = state.db.lock();
        queue.resolve(&conn, &attention_item_id, resolution, action, now_ms())?
    };

    emit_attention_updated(&app);
    Ok(item)
}

/// 延后一条注意力项（必须带 remind_at；缺失则后端返回 Err）。
#[tauri::command]
pub async fn defer_attention_item(
    app: AppHandle,
    state: State<'_, AppState>,
    attention_item_id: String,
    remind_at: Option<i64>,
) -> Result<AttentionItem, ConfluxError> {
    let item = {
        let mut queue = state.attention_queue.write();
        let conn = state.db.lock();
        queue.defer(&conn, &attention_item_id, remind_at, now_ms())?
    };

    emit_attention_updated(&app);
    Ok(item)
}

/// 忽略一条注意力项（持久保留，可 restore）。
#[tauri::command]
pub async fn ignore_attention_item(
    app: AppHandle,
    state: State<'_, AppState>,
    attention_item_id: String,
) -> Result<AttentionItem, ConfluxError> {
    let item = {
        let mut queue = state.attention_queue.write();
        let conn = state.db.lock();
        queue.ignore(&conn, &attention_item_id, now_ms())?
    };

    emit_attention_updated(&app);
    Ok(item)
}

/// 恢复一条被忽略的注意力项（回到活跃，写 Restore 审计）。
#[tauri::command]
pub async fn restore_attention_item(
    app: AppHandle,
    state: State<'_, AppState>,
    attention_item_id: String,
) -> Result<AttentionItem, ConfluxError> {
    let item = {
        let mut queue = state.attention_queue.write();
        let conn = state.db.lock();
        queue.restore(&conn, &attention_item_id, now_ms())?
    };

    emit_attention_updated(&app);
    Ok(item)
}
