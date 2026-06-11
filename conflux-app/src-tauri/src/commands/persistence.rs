// ===== Conflux 持久化操作 Tauri Commands =====
// 8 个 IPC 命令：会话查询 + 讨论查询 + 布局管理 + AutoPack
//
// 所有命令代理到 persistence 层的查询函数。
// auto_pack_layout 包含 bin-packing 算法实现。
//
// 注意：AppState 需要 orchestrator 后续添加 `db` 字段（使用 parking_lot 一致性）：
//   pub db: parking_lot::Mutex<rusqlite::Connection>

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::core::{
    AutoPackConfig, CardLayout, CardSizePreset, CardSizeSlot, ConfluxError, DiscussionId,
    DiscussionMessage, DiscussionSession, InstanceId, LayoutMode, PackSortStrategy, Position,
    SessionEvent, SessionSummary, Size, WorkspaceLayout,
};
use crate::persistence::{query as db_query, session as db_session};
use crate::AppState;

/// 列出会话摘要
///
/// 从 agent_instances 表聚合查询，统计每个实例的事件总数。
///
/// # 参数
/// - `limit`: 返回数量上限（默认 50）
/// - `offset`: 跳过前 N 条记录（默认 0）
///
/// # 返回
/// 按创建时间降序排列的 SessionSummary 列表
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<SessionSummary>, ConfluxError> {
    let db = state.db.lock();
    db_session::list_sessions(&db, limit.unwrap_or(50), offset.unwrap_or(0))
}

/// 查询指定实例的会话事件
///
/// # 参数
/// - `instance_id`: 实例 ID
/// - `from_ts`: 起始时间戳（Unix ms），None 表示不限
/// - `to_ts`: 结束时间戳（Unix ms），None 表示不限
/// - `limit`: 返回数量上限，None 表示不限
///
/// # 返回
/// 按时间戳升序排列的 SessionEvent 列表
#[tauri::command]
pub async fn query_session_events(
    state: State<'_, AppState>,
    instance_id: InstanceId,
    from_ts: Option<i64>,
    to_ts: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<SessionEvent>, ConfluxError> {
    let db = state.db.lock();
    db_session::query_session_events(&db, &instance_id.0, from_ts, to_ts, limit)
}

/// 列出讨论会话列表
///
/// # 参数
/// - `limit`: 返回数量上限（默认 50）
/// - `offset`: 跳过前 N 条记录（默认 0）
///
/// # 返回
/// 按创建时间降序排列的 DiscussionSession 列表
#[tauri::command]
pub async fn list_discussions(
    state: State<'_, AppState>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<DiscussionSession>, ConfluxError> {
    let db = state.db.lock();
    db_query::list_discussions(&db, limit.unwrap_or(50), offset.unwrap_or(0))
}

/// 查询指定讨论的所有消息
///
/// # 参数
/// - `discussion_id`: 讨论 ID
///
/// # 返回
/// 按 (轮次, 时间) 排列的 DiscussionMessage 列表
#[tauri::command]
pub async fn get_discussion_messages(
    state: State<'_, AppState>,
    discussion_id: DiscussionId,
) -> Result<Vec<DiscussionMessage>, ConfluxError> {
    let db = state.db.lock();
    db_query::get_discussion_messages(&db, &discussion_id.0)
}

/// 保存工作台布局
///
/// # 参数
/// - `layout`: 工作台布局数据
#[tauri::command]
pub async fn save_workspace_layout(
    state: State<'_, AppState>,
    layout: WorkspaceLayout,
) -> Result<(), ConfluxError> {
    let db = state.db.lock();
    db_query::save_workspace_layout(&db, &layout)
}

/// 加载最新的工作台布局
///
/// # 返回
/// 最新的布局数据，如果从未保存则返回 None
#[tauri::command]
pub async fn load_workspace_layout(
    state: State<'_, AppState>,
) -> Result<Option<WorkspaceLayout>, ConfluxError> {
    let db = state.db.lock();
    db_query::load_workspace_layout(&db)
}

/// AutoPack 智能布局算法
///
/// 根据 AutoPackConfig 配置，为当前所有活跃 Agent 实例计算最优卡片布局。
///
/// 算法流程:
/// 1. 获取所有活跃实例
/// 2. 根据 sort_strategy 对实例排序
/// 3. 根据 size_preset 为每个实例分配 CardSizeSlot
/// 4. 按像素面积降序排列
/// 5. 行优先 bin-packing：从左到右、从上到下放置，gap=8px
///
/// # 参数
/// - `config`: AutoPack 布局配置
///
/// # 返回
/// 计算后的 WorkspaceLayout
#[tauri::command]
pub async fn auto_pack_layout(
    state: State<'_, AppState>,
    config: AutoPackConfig,
) -> Result<WorkspaceLayout, ConfluxError> {
    // 1. 获取所有活跃实例
    let instances = state.pane_runtime.list_instances();

    if instances.is_empty() {
        let now = now_millis();
        return Ok(WorkspaceLayout {
            cards: vec![],
            layout_mode: LayoutMode::AutoPack,
            auto_pack_config: Some(config),
            updated_at: now,
        });
    }

    // 2. 根据 sort_strategy 排序实例
    let mut sorted_instances = instances.clone();
    match config.sort_strategy {
        PackSortStrategy::ByActivity => {
            sorted_instances.sort_by(|a, b| {
                let a_score = activity_score(&a.status);
                let b_score = activity_score(&b.status);
                b_score.cmp(&a_score) // 活跃度高的在前
            });
        }
        PackSortStrategy::ByCreatedTime => {
            sorted_instances.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        }
        PackSortStrategy::ByFrameworkGroup => {
            sorted_instances.sort_by(|a, b| a.adapter_name.cmp(&b.adapter_name));
        }
    }

    // 3. 为每个实例分配 CardSizeSlot
    let pinned_set = {
        let pinned = state.pinned_instances.read();
        pinned.clone()
    };

    let sized_items: Vec<(InstanceId, CardSizeSlot)> = sorted_instances
        .iter()
        .map(|inst| {
            let slot = match config.size_preset {
                CardSizePreset::Smart => {
                    let is_primary = pinned_set.contains(&inst.instance_id.0);
                    smart_size_slot(&inst.status, is_primary)
                }
                CardSizePreset::Uniform => CardSizeSlot::Mini,
                CardSizePreset::Shuffle => shuffle_size_slot(&inst.instance_id.0),
            };
            (inst.instance_id.clone(), slot)
        })
        .collect();

    // 4. 按像素面积降序排列（bin-packing 启发式：大块先放）
    let mut sized_items = sized_items;
    sized_items.sort_by(|a, b| {
        let area_a = slot_pixel_area(&a.1);
        let area_b = slot_pixel_area(&b.1);
        area_b.cmp(&area_a) // 面积大的在前
    });

    // 5. 行优先 bin-packing（简化版 Shelf Algorithm）
    // 画布宽度使用合理默认值（1200px）
    let canvas_width: f64 = 1200.0;
    let gap: f64 = 8.0;

    let cards = shelf_pack(&sized_items, canvas_width, gap);

    let now = now_millis();
    Ok(WorkspaceLayout {
        cards,
        layout_mode: LayoutMode::AutoPack,
        auto_pack_config: Some(config),
        updated_at: now,
    })
}

// ===== AutoPack 辅助函数 =====

/// CardSizeSlot -> (width_px, height_px)
/// 基于合约定义：1 格基准 = 200x140px, gap 8px
fn slot_to_pixels(slot: &CardSizeSlot) -> (f64, f64) {
    match slot {
        CardSizeSlot::Mini => (200.0, 140.0),   // 1x1
        CardSizeSlot::Small => (200.0, 288.0),  // 1x2
        CardSizeSlot::Medium => (408.0, 288.0), // 2x2
        CardSizeSlot::Large => (408.0, 436.0),  // 2x3
        CardSizeSlot::Wide => (616.0, 288.0),   // 3x2
    }
}

/// 获取 CardSizeSlot 的像素面积（用于排序）
fn slot_pixel_area(slot: &CardSizeSlot) -> u64 {
    let (w, h) = slot_to_pixels(slot);
    (w * h) as u64
}

/// Agent 状态 -> 活跃度分数（用于 ByActivity 排序）
fn activity_score(status: &crate::core::AgentStatus) -> u32 {
    match status {
        crate::core::AgentStatus::Thinking => 5,
        crate::core::AgentStatus::Coding => 4,
        crate::core::AgentStatus::WaitingPermission => 3,
        crate::core::AgentStatus::Idle => 2,
        crate::core::AgentStatus::Error => 1,
        crate::core::AgentStatus::Done => 0,
    }
}

/// Smart 模式下根据状态和是否主框架分配尺寸
fn smart_size_slot(status: &crate::core::AgentStatus, is_primary: bool) -> CardSizeSlot {
    if is_primary {
        return CardSizeSlot::Large;
    }
    match status {
        crate::core::AgentStatus::Thinking | crate::core::AgentStatus::Coding => {
            CardSizeSlot::Medium
        }
        crate::core::AgentStatus::WaitingPermission => CardSizeSlot::Medium,
        crate::core::AgentStatus::Idle => CardSizeSlot::Small,
        crate::core::AgentStatus::Done => CardSizeSlot::Mini,
        crate::core::AgentStatus::Error => CardSizeSlot::Small,
    }
}

/// Shuffle 模式下基于 instance_id 哈希确定性地分配尺寸
/// 使用简单哈希而非 rand crate，保证可重现且不增加依赖
fn shuffle_size_slot(instance_id: &str) -> CardSizeSlot {
    // 简单字符串哈希
    let hash: u32 = instance_id
        .bytes()
        .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));

    // 不低于 Mini，在 Mini~Large 间分配
    match hash % 5 {
        0 => CardSizeSlot::Mini,
        1 => CardSizeSlot::Small,
        2 => CardSizeSlot::Medium,
        3 => CardSizeSlot::Large,
        _ => CardSizeSlot::Wide,
    }
}

/// Shelf bin-packing 算法（行优先，从左到右、从上到下）
///
/// 逐个将卡片放入画布。每个"架子"（shelf）的高度由该行中最高的卡片决定。
/// 当一张卡片放不下当前行（x + width > canvas_width）时，换到下一行。
///
/// # 参数
/// - `items`: (InstanceId, CardSizeSlot) 列表，已按面积降序排列
/// - `canvas_width`: 画布总宽度
/// - `gap`: 卡片间距（px）
///
/// # 返回
/// 计算后的 CardLayout 列表
fn shelf_pack(
    items: &[(InstanceId, CardSizeSlot)],
    canvas_width: f64,
    gap: f64,
) -> Vec<CardLayout> {
    let mut cards = Vec::new();

    // 当前行的 x 光标和 y 基线
    let mut cursor_x: f64 = 0.0;
    let mut cursor_y: f64 = 0.0;
    // 当前行的最大高度
    let mut shelf_height: f64 = 0.0;
    let mut z_index: u32 = 1;

    for (instance_id, slot) in items {
        let (w, h) = slot_to_pixels(slot);

        // 检查是否需要换行
        if cursor_x + w > canvas_width && cursor_x > 0.0 {
            // 换行：y 下移 shelf_height + gap，x 归零
            cursor_y += shelf_height + gap;
            cursor_x = 0.0;
            shelf_height = 0.0;
        }

        cards.push(CardLayout {
            instance_id: instance_id.clone(),
            position: Position {
                x: cursor_x,
                y: cursor_y,
            },
            size: Size {
                width: w,
                height: h,
            },
            z_index,
        });

        // 更新光标
        cursor_x += w + gap;
        if h > shelf_height {
            shelf_height = h;
        }
        z_index += 1;
    }

    cards
}

/// 获取当前时间戳（Unix 毫秒）
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slot_to_pixels() {
        assert_eq!(slot_to_pixels(&CardSizeSlot::Mini), (200.0, 140.0));
        assert_eq!(slot_to_pixels(&CardSizeSlot::Small), (200.0, 288.0));
        assert_eq!(slot_to_pixels(&CardSizeSlot::Medium), (408.0, 288.0));
        assert_eq!(slot_to_pixels(&CardSizeSlot::Large), (408.0, 436.0));
        assert_eq!(slot_to_pixels(&CardSizeSlot::Wide), (616.0, 288.0));
    }

    #[test]
    fn test_shelf_pack_basic() {
        let items = vec![
            (InstanceId("a".to_string()), CardSizeSlot::Medium), // 408x288
            (InstanceId("b".to_string()), CardSizeSlot::Medium), // 408x288
            (InstanceId("c".to_string()), CardSizeSlot::Mini),   // 200x140
        ];

        // canvas_width=1200, gap=8
        let cards = shelf_pack(&items, 1200.0, 8.0);
        assert_eq!(cards.len(), 3);

        // 第一个卡片在 (0, 0)
        assert_eq!(cards[0].position.x, 0.0);
        assert_eq!(cards[0].position.y, 0.0);

        // 第二个卡片在 (408+8, 0) = (416, 0)
        assert_eq!(cards[1].position.x, 416.0);
        assert_eq!(cards[1].position.y, 0.0);

        // 第三个卡片在 (416+408+8, 0) = (832, 0) — 还能放下
        assert_eq!(cards[2].position.x, 832.0);
        assert_eq!(cards[2].position.y, 0.0);
    }

    #[test]
    fn test_shelf_pack_line_wrap() {
        let items = vec![
            (InstanceId("a".to_string()), CardSizeSlot::Wide), // 616x288
            (InstanceId("b".to_string()), CardSizeSlot::Wide), // 616x288 — 放不下同行
            (InstanceId("c".to_string()), CardSizeSlot::Mini), // 200x140
        ];

        // canvas_width=1200, gap=8
        // a: (0, 0), width=616
        // b: 616+8=624, 624+616=1240 > 1200 => 换行
        //    b: (0, 288+8) = (0, 296)
        // c: (616+8, 296) = (624, 296)
        let cards = shelf_pack(&items, 1200.0, 8.0);
        assert_eq!(cards.len(), 3);

        assert_eq!(cards[0].position.x, 0.0);
        assert_eq!(cards[0].position.y, 0.0);

        assert_eq!(cards[1].position.x, 0.0);
        assert_eq!(cards[1].position.y, 296.0);

        assert_eq!(cards[2].position.x, 624.0);
        assert_eq!(cards[2].position.y, 296.0);
    }

    #[test]
    fn test_smart_size_slot() {
        assert_eq!(
            smart_size_slot(&crate::core::AgentStatus::Thinking, false),
            CardSizeSlot::Medium
        );
        assert_eq!(
            smart_size_slot(&crate::core::AgentStatus::Idle, false),
            CardSizeSlot::Small
        );
        assert_eq!(
            smart_size_slot(&crate::core::AgentStatus::Done, false),
            CardSizeSlot::Mini
        );
        assert_eq!(
            smart_size_slot(&crate::core::AgentStatus::Idle, true),
            CardSizeSlot::Large
        );
    }

    #[test]
    fn test_activity_score() {
        assert!(
            activity_score(&crate::core::AgentStatus::Thinking)
                > activity_score(&crate::core::AgentStatus::Idle)
        );
        assert!(
            activity_score(&crate::core::AgentStatus::Idle)
                > activity_score(&crate::core::AgentStatus::Done)
        );
    }

    #[test]
    fn test_shuffle_deterministic() {
        // shuffle 应该对同一 id 总返回相同结果
        let s1 = shuffle_size_slot("test-id-123");
        let s2 = shuffle_size_slot("test-id-123");
        assert_eq!(s1, s2);
    }
}
