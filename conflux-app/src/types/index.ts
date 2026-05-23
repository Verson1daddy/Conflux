// ===== Conflux 类型入口（统一 re-export） =====
// 所有前端代码从此文件导入类型，保持导入路径统一

// Agent/Adapter 相关类型
export type {
  // 标识符
  InstanceId,
  AdapterId,
  DiscussionId,
  // Agent 运行模式
  AgentMode,
  // Agent 状态
  AgentStatus,
  AgentStateDetail,
  AgentState,
  // Sub-Agent
  SubAgentInfo,
  AgentTree,
  // 适配器
  AdapterCapabilities,
  AdapterConfig,
  StatusPatterns,
  AdapterInfo,
  AdapterAuthStatus,
  AgentInstanceInfo,
  // 会话记录
  SessionSummary,
  SessionEvent,
  // 权限
  PermissionRequest,
  PermissionDecision,
  PermissionStatus,
  // 错误
  ErrorSeverity,
  ConfluxError,
  // 安全补丁类型（附录 B）
  InjectionSource,
  StdinInjectionPolicy,
  EventPriority,
} from "./agent";

// 事件类型
export type {
  // 联合类型
  ConfluxEvent,
  ConfluxEventType,
  // 各事件 Payload
  AgentStatusChangedPayload,
  PermissionRequestedPayload,
  SubAgentSpawnedPayload,
  SubAgentCompletedPayload,
  TaskCompletedPayload,
  ErrorOccurredPayload,
  DiscussionMessagePayload,
  CoordinationCommandPayload,
  PtyOutputPayload,
  StdinInjectedPayload,
  ProcessExitedPayload,
} from "./events";

// 讨论相关类型
export type {
  DiscussionStatus,
  DiscussionSession,
  MessageSender,
  DiscussionMessageData,
  DiscussionMessage,
  DiscussionSummary,
  CodeBlock,
} from "./discussion";

// 布局相关类型
export type {
  Position,
  Size,
  LayoutMode,
  PackSortStrategy,
  CardSizePreset,
  CardSizeSlot,
  AutoPackConfig,
  CardLayout,
  WorkspaceLayout,
} from "./layout";

// 灵动岛相关类型
export type {
  CloseAction,
  IslandMode,
  NotificationLevel,
  NotificationActionType,
  NotificationAction,
  NotificationItem,
} from "./island";
