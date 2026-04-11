// ===== Conflux 核心模块 =====
// 本模块包含所有共享类型、事件定义和错误类型
// 是整个后端的类型基础层，其他所有模块（pty、adapter、orchestration、persistence）均依赖此模块

/// 核心数据类型（标识符、状态枚举、数据结构体）
pub mod types;

/// 统一事件类型（ConfluxEvent enum 及事件优先级映射）
pub mod event;

/// 事件派发到 Tauri 前端（通道路由）
pub mod event_emit;

/// 统一错误类型（ConfluxError enum）
pub mod error;

// ===== Re-exports（方便外部模块直接使用） =====

// 标识符类型
pub use types::InstanceId;
pub use types::AdapterId;
pub use types::DiscussionId;

// Agent 状态相关
pub use types::AgentStatus;
pub use types::AgentState;
pub use types::AgentStateDetail;
pub use types::AgentInstanceInfo;

// Sub-Agent 相关
pub use types::SubAgentInfo;
pub use types::AgentTree;

// 讨论相关
pub use types::DiscussionStatus;
pub use types::DiscussionSession;
pub use types::DiscussionMessageData;
pub use types::DiscussionMessage;
pub use types::DiscussionSummary;
pub use types::MessageSender;

// 通知与权限
pub use types::NotificationLevel;
pub use types::NotificationActionType;
pub use types::NotificationAction;
pub use types::NotificationItem;
pub use types::PermissionRequest;
pub use types::PermissionDecision;
pub use types::PermissionStatus;

// 灵动岛
pub use types::IslandMode;

// 布局
pub use types::Position;
pub use types::Size;
pub use types::CardLayout;
pub use types::LayoutMode;
pub use types::PackSortStrategy;
pub use types::CardSizePreset;
pub use types::CardSizeSlot;
pub use types::AutoPackConfig;
pub use types::WorkspaceLayout;
pub use types::SNAP_GRID_PX;

// 会话记录
pub use types::SessionSummary;
pub use types::SessionEvent;

// 适配器
pub use types::AdapterCapabilities;
pub use types::AdapterConfig;
pub use types::StatusPatterns;
pub use types::AdapterInfo;

// 安全补丁类型（附录 B）
pub use types::InjectionSource;
pub use types::StdinInjectionPolicy;
pub use types::EventPriority;
pub use types::ErrorSeverity;

// 事件
pub use event::ConfluxEvent;

// 错误
pub use error::ConfluxError;
