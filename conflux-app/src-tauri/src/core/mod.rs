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

/// 控制面语义层 P1: 不可变审计事件（AuditEvent 及枚举）
pub mod audit;

/// 控制面语义层 P2/P3: 待处理交互共享枚举（PendingInteraction 体系）
pub mod interaction;

/// 控制面 P1.5: stdin 注入唯一入口（MF-1 / CRIT-01，契约 §13.1）
pub mod injection;

/// 控制面语义层 P4: 精确回场对象（JumpBackTarget 及枚举）
pub mod jumpback;

// ===== Re-exports（方便外部模块直接使用） =====

// 标识符类型
pub use types::AdapterId;
pub use types::DiscussionId;
pub use types::InstanceId;

// Agent 状态相关
pub use types::AgentInstanceInfo;
pub use types::AgentMode;
pub use types::AgentState;
pub use types::AgentStateDetail;
pub use types::AgentStatus;

// Sub-Agent 相关
pub use types::AgentTree;
pub use types::SubAgentInfo;

// 讨论相关
pub use types::DiscussionMessage;
pub use types::DiscussionMessageData;
pub use types::DiscussionSession;
pub use types::DiscussionStatus;
pub use types::DiscussionSummary;
pub use types::MessageSender;

// 通知与权限
pub use types::NotificationAction;
pub use types::NotificationActionType;
pub use types::NotificationItem;
pub use types::NotificationLevel;
pub use types::PermissionDecision;
pub use types::PermissionRequest;
pub use types::PermissionStatus;

// 灵动岛
pub use types::IslandMode;

// 布局
pub use types::AutoPackConfig;
pub use types::CardLayout;
pub use types::CardSizePreset;
pub use types::CardSizeSlot;
pub use types::LayoutMode;
pub use types::PackSortStrategy;
pub use types::Position;
pub use types::Size;
pub use types::WorkspaceLayout;
pub use types::SNAP_GRID_PX;

// 会话记录
pub use types::SessionEvent;
pub use types::SessionSummary;

// 适配器
pub use types::AdapterAuthStatus;
pub use types::AdapterCapabilities;
pub use types::AdapterConfig;
pub use types::AdapterInfo;
pub use types::StatusPatterns;

// 安全补丁类型（附录 B）
pub use types::ErrorSeverity;
pub use types::EventPriority;
pub use types::InjectionSource;
pub use types::StdinInjectionPolicy;

// 控制面语义层 P1
pub use audit::AuditAction;
pub use audit::AuditActor;
pub use audit::AuditEvent;
pub use audit::AuditResult;
pub use types::SourceKind;

// 控制面语义层 P2/P3：待处理交互共享枚举 + PendingInteraction
pub use interaction::InteractionAction;
pub use interaction::InteractionKind;
pub use interaction::InteractionResolution;
pub use interaction::PendingInteraction;

// 注入唯一入口（控制面 P1.5 / MF-1）
pub use injection::inject_with_policy;
pub use injection::should_enforce_stdin_injection_policy;

// 控制面语义层 P4：精确回场对象
pub use jumpback::JumpBackTarget;
pub use jumpback::JumpConfidence;
pub use jumpback::JumpKind;
pub use jumpback::TerminalRange;

// 事件
pub use event::ConfluxEvent;

// 错误
pub use error::ConfluxError;
