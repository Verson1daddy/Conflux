// ===== Conflux 控制面语义层 P2/P3: 待处理交互 =====
// 本文件定义 PendingInteraction 体系的共享枚举（F1 契约 §3.1）+ PendingInteraction
// 结构体本身（P3 落地）。
//
// 对应 F1 控制面契约 §3（PendingInteraction，包住 PermissionRequest）。
// serde rename_all = "snake_case"，与前端 src/types/interaction.ts 字段镜像对齐。
//
// 单一真相源（§3 + §4）：PendingInteraction **不另起持久化表**，而是由后端 owned 的
// AttentionQueue 中 kind∈{Permission,NeedsInput,ErrorRecovery,ReviewRequired} 的活跃项
// **投影**得到（见 `from_attention_item`），保持 AttentionQueue 为唯一真相源。
// `PermissionRequest`（现有）作为 kind=Permission 的 payload 语义，被 payload_summary 包住。

use serde::{Deserialize, Serialize};

use crate::core::types::{EventPriority, InstanceId};

/// 待处理交互的种类（F1 契约 §3.1）
///
/// V1 必做：`Permission` / `NeedsInput` / `ErrorRecovery` / `ReviewRequired`
/// （对应 §11.2 必上浮事件）。`PlanReview` / `ToolApproval` 后置到 hook 深接。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionKind {
    /// 权限确认请求（包住现有 PermissionRequest）
    Permission,
    /// 需要用户输入（hook 深接后启用）
    NeedsInput,
    /// 计划评审（hook 深接后启用）
    PlanReview,
    /// 工具调用审批（自动注入确认闸，§13.3）
    ToolApproval,
    /// 错误恢复（致命/错误/异常退出）
    ErrorRecovery,
    /// 需要复核（任务完成等低优先上浮）
    ReviewRequired,
}

/// 用户对交互可执行的动作（F1 契约 §3.1）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionAction {
    /// 批准
    Approve,
    /// 拒绝
    Deny,
    /// 回复（注入用户文本）
    Reply,
    /// 跳回事件落点（JumpBackTarget，P4 落地）
    Jump,
    /// 延后处理（必带 remind_at）
    Defer,
    /// 忽略（持久保留 + 可 restore）
    Ignore,
}

/// 交互的最终处置结果（F1 契约 §3.1）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionResolution {
    /// 已批准
    Approved,
    /// 已拒绝
    Denied,
    /// 已回复
    Replied,
    /// 已延后
    Deferred,
    /// 已忽略（持久保留，可 restore）
    Ignored,
    /// 已超时
    Expired,
}

/// 待处理交互（F1 契约 §3.1）。
///
/// 「所有需要用户处理的事件」的统一视图；现有 `PermissionRequest` 是它
/// `kind=Permission` 的一种（其语义被 `payload_summary` 包住，不另建表）。
///
/// **不是独立持久化对象**：由 AttentionQueue 的活跃项投影得到（见命令层
/// `commands/interaction.rs::pending_from_attention_item`），AttentionQueue 是唯一真相源。
///
/// 字段顺序与命名对齐 F1 §3.1 与前端 `src/types/interaction.ts`（serde snake_case）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PendingInteraction {
    /// 交互唯一 ID（投影自 AttentionItem.attention_item_id，uuid）
    pub interaction_id: String,
    /// 关联的 agent 实例（= session_id）
    pub instance_id: InstanceId,
    /// 交互种类
    pub kind: InteractionKind,
    /// 标题（面向 UI 的简短标签）
    pub title: String,
    /// payload 摘要（包住 PermissionRequest 等语义内容）
    pub payload_summary: String,
    /// 关联的源事件 ID（PersistedEvent.event_id，可空）
    pub source_event_id: Option<String>,
    /// 可执行动作集合
    pub actions: Vec<InteractionAction>,
    /// 优先级（复用 EventPriority）
    pub priority: EventPriority,
    /// 跳回事件落点（JumpBackTarget，P4 落地，当前投影为 None）
    pub jump_back_target_id: Option<String>,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
    /// 处置时间（未处置为 None）
    pub resolved_at: Option<i64>,
    /// 处置结果（None = 活跃）
    pub resolution: Option<InteractionResolution>,
    /// 处置时绑定的审计事件 ID（可空）
    pub audit_event_id: Option<String>,
}

impl InteractionKind {
    /// 该 kind 是否进入 PendingInteraction 投影（V1 必做四类）。
    ///
    /// V1：Permission / NeedsInput / ErrorRecovery / ReviewRequired。
    /// PlanReview / ToolApproval 后置（hook 深接 / 自动注入确认闸 P5）。
    pub fn is_v1_pending(&self) -> bool {
        matches!(
            self,
            InteractionKind::Permission
                | InteractionKind::NeedsInput
                | InteractionKind::ErrorRecovery
                | InteractionKind::ReviewRequired
        )
    }
}
