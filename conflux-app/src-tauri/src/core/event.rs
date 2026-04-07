// ===== Conflux 统一事件类型 =====
// 三层架构（PTY/Adapter -> 编排 -> UI）之间通过此事件流串联
// 使用 serde tag+content 序列化方式，便于 JSON 传输和前端解析
// 对应前端 TypeScript 类型定义（位于 src/types/events.ts）

use serde::{Deserialize, Serialize};

use super::types::{
    AgentStatus, DiscussionId, DiscussionMessageData, ErrorSeverity, EventPriority,
    InjectionSource, InstanceId, PermissionRequest, SubAgentInfo,
};

/// 统一事件类型 — 三层之间通过此事件流串联
/// 9 种原始变体 + StdinInjected 审计事件（附录 B1）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ConfluxEvent {
    /// Agent 状态变化
    AgentStatusChanged {
        /// 变化的实例 ID
        instance_id: InstanceId,
        /// 旧状态
        old_status: AgentStatus,
        /// 新状态
        new_status: AgentStatus,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// 权限确认请求
    PermissionRequested {
        /// 请求来源实例 ID
        instance_id: InstanceId,
        /// 权限请求详情
        request: PermissionRequest,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// 子代理被创建
    SubAgentSpawned {
        /// 父实例 ID
        instance_id: InstanceId,
        /// 新创建的子代理信息
        sub_agent: SubAgentInfo,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// 子代理完成任务
    SubAgentCompleted {
        /// 父实例 ID
        instance_id: InstanceId,
        /// 完成的子代理 ID
        sub_agent_id: String,
        /// 结果摘要（可能为空）
        result_summary: Option<String>,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// 任务完成
    TaskCompleted {
        /// 完成任务的实例 ID
        instance_id: InstanceId,
        /// 任务摘要
        summary: String,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// 错误发生
    ErrorOccurred {
        /// 出错的实例 ID
        instance_id: InstanceId,
        /// 错误消息
        error_message: String,
        /// 错误严重级别
        severity: ErrorSeverity,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// 讨论消息
    DiscussionMessage {
        /// 讨论 ID
        discussion_id: DiscussionId,
        /// 消息数据
        message: DiscussionMessageData,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// 调度指令（编排层 -> Agent）
    CoordinationCommand {
        /// 目标实例 ID
        target_instance_id: InstanceId,
        /// 指令文本
        command_text: String,
        /// 来源讨论 ID（如果是讨论触发的调度）
        source_discussion_id: Option<DiscussionId>,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// PTY 原始输出（用于终端渲染和录制）
    /// 注意：data 字段使用 base64 编码 String（MED-05 修复），不使用 Vec<u8>
    PtyOutput {
        /// 输出来源实例 ID
        instance_id: InstanceId,
        /// base64 编码的原始输出数据（MED-05 修复）
        data: String,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },

    /// stdin 注入审计事件（附录 B1——每次 stdin 注入时产生）
    StdinInjected {
        /// 被注入的实例 ID
        instance_id: InstanceId,
        /// 注入来源分类
        source: InjectionSource,
        /// 注入内容预览（前 200 字符）
        content_preview: String,
        /// 注入内容完整长度
        content_length: usize,
        /// 时间戳（Unix 时间戳 ms）
        timestamp: i64,
    },
}

impl ConfluxEvent {
    /// 获取事件的优先级（附录 B4——事件优先级映射）
    /// 用于事件总线双通道分发和 SQLite 写入策略
    pub fn priority(&self) -> EventPriority {
        match self {
            // 最高优先级：权限请求、致命错误
            ConfluxEvent::PermissionRequested { .. } => EventPriority::Critical,
            ConfluxEvent::ErrorOccurred { severity, .. } => match severity {
                ErrorSeverity::Fatal => EventPriority::Critical,
                ErrorSeverity::Error => EventPriority::High,
                ErrorSeverity::Warning => EventPriority::Normal,
            },

            // 高优先级：状态变更、讨论消息
            ConfluxEvent::AgentStatusChanged { .. } => EventPriority::High,
            ConfluxEvent::DiscussionMessage { .. } => EventPriority::High,
            ConfluxEvent::CoordinationCommand { .. } => EventPriority::High,

            // 普通优先级：sub-agent 事件、任务完成、stdin 审计
            ConfluxEvent::SubAgentSpawned { .. } => EventPriority::Normal,
            ConfluxEvent::SubAgentCompleted { .. } => EventPriority::Normal,
            ConfluxEvent::TaskCompleted { .. } => EventPriority::Normal,
            ConfluxEvent::StdinInjected { .. } => EventPriority::Normal,

            // 低优先级：PTY 原始输出
            ConfluxEvent::PtyOutput { .. } => EventPriority::Low,
        }
    }

    /// 获取事件类型名称（用于 session_events 表的 event_type 字段）
    pub fn event_type_name(&self) -> &'static str {
        match self {
            ConfluxEvent::AgentStatusChanged { .. } => "AgentStatusChanged",
            ConfluxEvent::PermissionRequested { .. } => "PermissionRequested",
            ConfluxEvent::SubAgentSpawned { .. } => "SubAgentSpawned",
            ConfluxEvent::SubAgentCompleted { .. } => "SubAgentCompleted",
            ConfluxEvent::TaskCompleted { .. } => "TaskCompleted",
            ConfluxEvent::ErrorOccurred { .. } => "ErrorOccurred",
            ConfluxEvent::DiscussionMessage { .. } => "DiscussionMessage",
            ConfluxEvent::CoordinationCommand { .. } => "CoordinationCommand",
            ConfluxEvent::PtyOutput { .. } => "PtyOutput",
            ConfluxEvent::StdinInjected { .. } => "StdinInjected",
        }
    }

    /// 获取关联的实例 ID（如果有）
    /// 用于事件路由和 session_events 表写入
    pub fn instance_id(&self) -> Option<&InstanceId> {
        match self {
            ConfluxEvent::AgentStatusChanged { instance_id, .. } => Some(instance_id),
            ConfluxEvent::PermissionRequested { instance_id, .. } => Some(instance_id),
            ConfluxEvent::SubAgentSpawned { instance_id, .. } => Some(instance_id),
            ConfluxEvent::SubAgentCompleted { instance_id, .. } => Some(instance_id),
            ConfluxEvent::TaskCompleted { instance_id, .. } => Some(instance_id),
            ConfluxEvent::ErrorOccurred { instance_id, .. } => Some(instance_id),
            ConfluxEvent::DiscussionMessage { .. } => None,
            ConfluxEvent::CoordinationCommand {
                target_instance_id, ..
            } => Some(target_instance_id),
            ConfluxEvent::PtyOutput { instance_id, .. } => Some(instance_id),
            ConfluxEvent::StdinInjected { instance_id, .. } => Some(instance_id),
        }
    }
}
