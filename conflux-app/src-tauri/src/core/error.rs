// ===== Conflux 统一错误类型 =====
// 所有 Tauri command 的 Result 返回类型统一使用 ConfluxError
// 前端收到的是 JSON 序列化后的错误信息
// 使用 thiserror::Error derive 宏自动实现 Display trait

use serde::{Deserialize, Serialize};

/// 统一错误类型（10 种变体）
/// 所有 Tauri command 均返回 Result<T, ConfluxError>
/// 前端通过 JSON 反序列化获取错误类型和消息
#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
pub enum ConfluxError {
    /// 实例不存在
    #[error("实例不存在: {instance_id}")]
    InstanceNotFound {
        /// 未找到的实例 ID
        instance_id: String,
    },

    /// 适配器不存在
    #[error("适配器不存在: {adapter_id}")]
    AdapterNotFound {
        /// 未找到的适配器 ID
        adapter_id: String,
    },

    /// 讨论不存在
    #[error("讨论不存在: {discussion_id}")]
    DiscussionNotFound {
        /// 未找到的讨论 ID
        discussion_id: String,
    },

    /// PTY 操作错误
    #[error("PTY 错误: {message}")]
    PtyError {
        /// 错误详情
        message: String,
    },

    /// 进程已终止
    #[error("进程已终止: {instance_id}")]
    ProcessExited {
        /// 已终止的实例 ID
        instance_id: String,
    },

    /// 适配器配置无效
    #[error("适配器配置无效: {message}")]
    InvalidConfig {
        /// 配置验证错误详情
        message: String,
    },

    /// 数据库操作错误
    #[error("数据库错误: {message}")]
    DatabaseError {
        /// 数据库错误详情
        message: String,
    },

    /// 窗口管理错误
    #[error("窗口管理错误: {message}")]
    WindowError {
        /// 窗口操作错误详情
        message: String,
    },

    /// 编排操作错误
    #[error("编排错误: {message}")]
    OrchestrationError {
        /// 编排错误详情
        message: String,
    },

    /// 序列化/反序列化错误
    #[error("序列化错误: {message}")]
    SerializationError {
        /// 序列化错误详情
        message: String,
    },
}

// ===== 便捷转换实现 =====

impl From<serde_json::Error> for ConfluxError {
    fn from(err: serde_json::Error) -> Self {
        ConfluxError::SerializationError {
            message: err.to_string(),
        }
    }
}

/// 机制层错误 → IPC 边界错误（cutover ③）。
/// `InjectionRejected` 携带的 reason 由 conflux 钩子产生（policy/限速/审计 fail-closed），
/// 与原 inject_with_policy 的拒绝消息同源，故归 OrchestrationError 保持前端语义不变。
impl From<conmux::ConmuxError> for ConfluxError {
    fn from(err: conmux::ConmuxError) -> Self {
        match err {
            conmux::ConmuxError::PaneNotFound { pane_id } => ConfluxError::InstanceNotFound {
                instance_id: pane_id,
            },
            conmux::ConmuxError::InjectionRejected { reason } => ConfluxError::OrchestrationError {
                message: reason,
            },
            other => ConfluxError::PtyError {
                message: other.to_string(),
            },
        }
    }
}
