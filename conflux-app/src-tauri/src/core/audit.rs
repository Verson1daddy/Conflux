// ===== Conflux 控制面语义层 P1: 不可变审计事件 =====
// 本文件定义 AuditEvent 及其枚举（actor / action / result）。
// 对应 F1 控制面契约 §7（AuditEvent + audit_events 表）与 §13.6（审计不可变）。
//
// 安全约束（MF-6，§13.2）：
//   actor / injection_source 在语义上**只能由后端命令边界按命令身份硬编码赋值**，
//   拒绝前端/IPC 入参指定（前端永不能自标 System/Coordinator）。
//   P1 仅定义类型与持久化结构；命令层的硬编码赋值在 P3 落地。
//
// 不可变性（MF-7，§13.6）：audit_events 表仅 INSERT，UPDATE/DELETE 由 DB 触发器拒绝。

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::core::types::InjectionSource;
use crate::core::types::InstanceId;

/// 审计动作发起者（§7.1）
///
/// **后端硬编码**：由命令边界按命令身份赋值，不接受前端入参（MF-6）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditActor {
    /// 用户在 UI 主动发起
    User,
    /// 系统内部（运行时/策略闸）
    System,
    /// 编排器（coordinator 自动调度）
    Coordinator,
}

/// 被审计的关键控制动作（§7.1）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    /// 批准（权限/工具调用）
    Approve,
    /// 拒绝
    Deny,
    /// 回复（注入用户文本）
    Reply,
    /// 延后处理（defer）
    Defer,
    /// 忽略
    Ignore,
    /// 发送上下文（Send to...）
    SendContext,
    /// 讨论消息注入
    DiscussionInjection,
    /// 自动注入（OrchestrationAuto）
    AutoInjection,
    /// 打断
    Interrupt,
    /// 终止 agent 实例
    Terminate,
    /// 恢复（被忽略 item 的 restore）
    Restore,
}

/// 审计动作结果（§7.1）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditResult {
    /// 成功
    Ok,
    /// 被策略/确认闸拒绝
    Rejected,
    /// 执行失败（如审计写入失败 fail-closed）
    Failed,
}

/// 不可变审计事件（§7.1）
///
/// 每条对应一次关键控制动作；落库后只读（DB 触发器拒绝 UPDATE/DELETE）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AuditEvent {
    /// 审计事件唯一 ID（uuid v4）
    pub audit_event_id: String,
    /// 动作发起者（**后端硬编码**，MF-6）
    pub actor: AuditActor,
    /// 动作类型
    pub action: AuditAction,
    /// 关联的 agent 实例（可空，如系统级动作）
    pub instance_id: Option<InstanceId>,
    /// 关联的源事件 ID（PersistedEvent.event_id）
    pub source_event_id: Option<String>,
    /// 关联的待处理交互 ID（PendingInteraction.interaction_id）
    pub interaction_id: Option<String>,
    /// 注入来源（仅注入类动作有值，**后端硬编码**，MF-6）
    pub injection_source: Option<InjectionSource>,
    /// 动作结果
    pub result: AuditResult,
    /// 创建时间（Unix 时间戳 ms）
    pub created_at: i64,
    /// 决策依据引用（可空）
    pub rationale_ref: Option<String>,
}

impl AuditEvent {
    /// 生成一个新的 uuid v4 审计事件 ID
    pub fn new_id() -> String {
        Uuid::new_v4().to_string()
    }
}
