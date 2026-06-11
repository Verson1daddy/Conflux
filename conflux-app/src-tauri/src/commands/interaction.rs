// ===== Conflux 控制面语义层 P3: PendingInteraction Tauri Commands =====
// 命令 `list_pending_interactions`：从后端 owned 的 AttentionQueue 活跃项
// **投影**出统一的 PendingInteraction 视图（F1 控制面契约 §3 + §4）。
//
// 单一真相源：PendingInteraction 不另建持久化表，AttentionQueue 是唯一真相源。
// 这里只做 AttentionItem → PendingInteraction 的字段投影 + V1 kind 过滤
// （Permission/NeedsInput/ErrorRecovery/ReviewRequired）。
//
// MF-6（§13.2）：本命令为只读投影，不写审计、不接受任何 actor/source 入参；
// actor 硬编码语义在注入/处置命令边界保证（见 injection.rs / commands/attention.rs）。

use tauri::State;

use crate::core::interaction::PendingInteraction;
use crate::core::ConfluxError;
use crate::orchestration::attention::AttentionItem;
use crate::AppState;

/// 把一个 AttentionItem 投影为 PendingInteraction（字段映射，无副作用）。
///
/// `title` 由 kind 派生一个稳定的人类可读标签；`payload_summary` 直接沿用
/// AttentionItem 的摘要（已包住 PermissionRequest 等语义）。
pub fn pending_from_attention_item(item: &AttentionItem) -> PendingInteraction {
    PendingInteraction {
        interaction_id: item.attention_item_id.clone(),
        instance_id: item.instance_id.clone(),
        kind: item.kind,
        title: title_for_kind(item.kind),
        payload_summary: item.payload_summary.clone(),
        source_event_id: item.source_event_id.clone(),
        actions: item.available_actions.clone(),
        priority: item.priority.clone(),
        jump_back_target_id: item.jump_back_target_id.clone(),
        created_at: item.created_at,
        resolved_at: item.resolved_at,
        resolution: item.resolution,
        audit_event_id: item.audit_event_id.clone(),
    }
}

/// 为每种 kind 提供一个稳定的标题标签（面向 UI）。
fn title_for_kind(kind: crate::core::interaction::InteractionKind) -> String {
    use crate::core::interaction::InteractionKind::*;
    match kind {
        Permission => "权限确认请求",
        NeedsInput => "需要用户输入",
        PlanReview => "计划评审",
        ToolApproval => "工具调用审批",
        ErrorRecovery => "错误恢复",
        ReviewRequired => "需要复核",
    }
    .to_string()
}

/// 列出待处理交互（PendingInteraction）。
///
/// 从 AttentionQueue 活跃项投影；按 `instance_id` 可选过滤。仅返回 V1 必做四类
/// kind（Permission/NeedsInput/ErrorRecovery/ReviewRequired），PlanReview/ToolApproval
/// 后置。排序沿用 AttentionQueue::list_active（优先级 + 时间）。
///
/// 注意：命令签名**不含** actor/source 参数——前端永不能指定审计归属（MF-6，编译期保证）。
#[tauri::command]
pub async fn list_pending_interactions(
    state: State<'_, AppState>,
    instance_id: Option<String>,
) -> Result<Vec<PendingInteraction>, ConfluxError> {
    let queue = state.attention_queue.read();
    let pending = queue
        .list_active()
        .into_iter()
        .filter(|item| item.kind.is_v1_pending())
        .filter(|item| match &instance_id {
            Some(want) => &item.instance_id.0 == want,
            None => true,
        })
        .map(|item| pending_from_attention_item(&item))
        .collect();
    Ok(pending)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::interaction::{InteractionAction, InteractionKind, InteractionResolution};
    use crate::core::types::{EventPriority, InstanceId};

    fn item(kind: InteractionKind, instance: &str) -> AttentionItem {
        AttentionItem {
            attention_item_id: "ai-1".to_string(),
            instance_id: InstanceId(instance.to_string()),
            kind,
            priority: EventPriority::Critical,
            source_event_id: Some("evt-1".to_string()),
            interaction_id: Some("req-1".to_string()),
            payload_summary: "权限请求: write_file — 写 config".to_string(),
            available_actions: vec![InteractionAction::Approve, InteractionAction::Deny],
            jump_back_target_id: None,
            created_at: 1_000,
            resolved_at: None,
            resolution: None,
            audit_event_id: None,
            permission_context: None,
            timeout_seconds: None,
            remind_at: None,
            signal_source: None,
        }
    }

    /// 投影：AttentionItem(Permission) → PendingInteraction(kind=Permission)，字段映射正确。
    #[test]
    fn projects_permission_item_to_pending_interaction() {
        let p = pending_from_attention_item(&item(InteractionKind::Permission, "inst-a"));
        assert_eq!(p.kind, InteractionKind::Permission);
        assert_eq!(p.interaction_id, "ai-1");
        assert_eq!(p.instance_id.0, "inst-a");
        assert_eq!(p.title, "权限确认请求");
        assert_eq!(p.source_event_id.as_deref(), Some("evt-1"));
        assert!(p.actions.contains(&InteractionAction::Approve));
        assert_eq!(p.priority, EventPriority::Critical);
        assert_eq!(p.resolution, None::<InteractionResolution>);
    }

    /// V1 kind 过滤：四类进入投影，PlanReview/ToolApproval 不进。
    #[test]
    fn v1_pending_kind_filter() {
        assert!(InteractionKind::Permission.is_v1_pending());
        assert!(InteractionKind::NeedsInput.is_v1_pending());
        assert!(InteractionKind::ErrorRecovery.is_v1_pending());
        assert!(InteractionKind::ReviewRequired.is_v1_pending());
        assert!(!InteractionKind::PlanReview.is_v1_pending());
        assert!(!InteractionKind::ToolApproval.is_v1_pending());
    }
}
