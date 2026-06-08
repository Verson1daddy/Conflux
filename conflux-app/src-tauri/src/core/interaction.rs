// ===== Conflux 控制面语义层 P2/P3: 待处理交互共享枚举 =====
// 本文件仅定义 PendingInteraction 体系的**共享枚举**（F1 契约 §3.1）。
// PendingInteraction 结构体本身留给 P3；P2 的 AttentionQueue 复用此处枚举。
//
// 对应 F1 控制面契约 §3（PendingInteraction，包住 PermissionRequest）。
// serde rename_all = "snake_case"，与前端 src/types/interaction.ts 字段镜像对齐。

use serde::{Deserialize, Serialize};

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
