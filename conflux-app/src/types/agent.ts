// ===== Agent/Adapter 相关类型 =====
// 对应 Rust 端 src-tauri/src/core/types.rs 中的 Agent/Adapter 相关结构体
// 所有字段名、类型、枚举值与 Rust 侧一一对应（serde rename_all = "snake_case"）

// ===== 标识符类型 =====
// Rust 侧使用 newtype 模式（如 pub struct InstanceId(pub String)）
// TypeScript 侧使用 type alias，序列化后均为 string

/** Agent 实例唯一标识 — 对应 Rust InstanceId(String) */
export type InstanceId = string;

/** 适配器唯一标识 — 对应 Rust AdapterId(String) */
export type AdapterId = string;

/** 讨论会话唯一标识 — 对应 Rust DiscussionId(String) */
export type DiscussionId = string;

// ===== Agent 状态 =====

/**
 * Agent 运行状态枚举
 * 对应 Rust AgentStatus，serde rename_all = "snake_case"
 * Rust Idle -> "idle", WaitingPermission -> "waiting_permission"
 */
export type AgentStatus =
  | "idle"
  | "thinking"
  | "coding"
  | "waiting_permission"
  | "done"
  | "error";

/**
 * Agent 状态详情（含上下文信息）
 * 对应 Rust AgentStateDetail
 */
export interface AgentStateDetail {
  /** 实例唯一 ID */
  instance_id: InstanceId;
  /** 所属适配器 ID */
  adapter_id: AdapterId;
  /** 适配器显示名称 */
  adapter_name: string;
  /** 当前运行状态 */
  status: AgentStatus;
  /** 工作目录 */
  working_dir: string;
  /** 是否为灵动岛主框架 */
  is_primary_framework: boolean;
  /** 创建时间（Unix 时间戳 ms） */
  created_at: number;
  /** 最后活动时间（Unix 时间戳 ms） */
  last_activity_at: number;
}

/**
 * Agent 状态（简化版，用于 AgentInstance trait）
 * 对应 Rust AgentState
 */
export interface AgentState {
  /** 当前运行状态 */
  status: AgentStatus;
  /** 最后活动时间（Unix 时间戳 ms） */
  last_activity_at: number;
}

// ===== Sub-Agent =====

/**
 * Sub-agent 信息
 * 对应 Rust SubAgentInfo
 */
export interface SubAgentInfo {
  /** Sub-agent 标识（框架内部 ID） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 当前状态 */
  status: AgentStatus;
  /** 父 agent ID（顶级 agent 为 null） */
  parent_id: string | null;
}

/**
 * Agent 树结构（递归）
 * 对应 Rust AgentTree
 */
export interface AgentTree {
  /** 根节点信息 */
  root: SubAgentInfo;
  /** 子节点列表（递归） */
  children: AgentTree[];
}

// ===== 适配器信息 =====

/**
 * 适配器能力声明
 * 对应 Rust AdapterCapabilities
 */
export interface AdapterCapabilities {
  /** 是否支持接收复杂调度指令 */
  can_coordinate: boolean;
  /** 调度提示词模板（仅 can_coordinate=true 时有意义） */
  coordination_template: string | null;
  /** 是否支持 sub-agent 树解析 */
  can_parse_tree: boolean;
  /** 是否支持权限请求检测 */
  can_detect_permission: boolean;
}

/**
 * 适配器配置（对应 TOML 文件解析结果）
 * 对应 Rust AdapterConfig
 */
export interface AdapterConfig {
  /** 适配器唯一名称 */
  name: string;
  /** 启动命令模板 */
  command: string;
  /** 命令默认参数 */
  default_args: string[];
  /** 状态检测正则模式 */
  status_patterns: StatusPatterns;
  /** 权限请求检测正则 */
  permission_pattern: string | null;
  /** sub-agent 生成检测正则 */
  sub_agent_spawn_pattern: string | null;
  /** sub-agent 完成检测正则 */
  sub_agent_complete_pattern: string | null;
  /** 能力声明 */
  capabilities: AdapterCapabilities;
}

/**
 * 状态检测正则模式集合
 * 对应 Rust StatusPatterns
 */
export interface StatusPatterns {
  /** 思考中检测正则 */
  thinking: string | null;
  /** 编码中检测正则 */
  coding: string | null;
  /** 完成检测正则 */
  done: string | null;
  /** 错误检测正则 */
  error: string | null;
  /** 等待权限检测正则 */
  waiting_permission: string | null;
}

/**
 * 适配器列表展示信息
 * 对应 Rust AdapterInfo
 */
export interface AdapterInfo {
  /** 适配器 ID */
  id: AdapterId;
  /** 适配器名称 */
  name: string;
  /** 启动命令 */
  command: string;
  /** 能力声明 */
  capabilities: AdapterCapabilities;
  /** 是否为内置适配器 */
  is_builtin: boolean;
}

/**
 * Agent 实例列表展示信息
 * 对应 Rust AgentInstanceInfo
 */
export interface AgentInstanceInfo {
  /** 实例 ID */
  instance_id: InstanceId;
  /** 所属适配器 ID */
  adapter_id: AdapterId;
  /** 适配器名称 */
  adapter_name: string;
  /** 当前状态 */
  status: AgentStatus;
  /** 工作目录 */
  working_dir: string;
  /** 是否为灵动岛主框架 */
  is_primary_framework: boolean;
  /** 创建时间（Unix 时间戳 ms） */
  created_at: number;
}

// ===== 会话记录 =====

/**
 * 会话摘要（列表展示用）
 * 对应 Rust SessionSummary
 */
export interface SessionSummary {
  /** 实例 ID */
  instance_id: InstanceId;
  /** 适配器名称 */
  adapter_name: string;
  /** 工作目录 */
  working_dir: string;
  /** 开始时间（Unix 时间戳 ms） */
  started_at: number;
  /** 结束时间（Unix 时间戳 ms），null 表示仍在运行 */
  ended_at: number | null;
  /** 事件总数 */
  event_count: number;
}

/**
 * 会话事件（回放用）
 * 对应 Rust SessionEvent
 */
export interface SessionEvent {
  /** 事件自增 ID */
  id: number;
  /** 实例 ID */
  instance_id: InstanceId;
  /** 事件类型 */
  event_type: string;
  /** JSON 序列化的事件数据 */
  data: string;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

// ===== 通知与权限 =====

/**
 * 权限请求（附录 B3 扩展版）
 * 对应 Rust PermissionRequest
 */
export interface PermissionRequest {
  /** 权限请求唯一 ID */
  id: string;
  /** 请求来源实例 ID */
  instance_id: InstanceId;
  /** 请求的操作名称 */
  action: string;
  /** 操作说明 */
  description: string;
  /** 权限请求前后 5 行原始 PTY 输出（附录 B3） */
  raw_context: string[];
  /** 权限状态（附录 B3） */
  status: PermissionStatus;
  /** 创建时间（Unix 时间戳 ms） */
  created_at: number;
  /** 超时秒数，默认 120（附录 B3） */
  timeout_seconds: number;
}

/**
 * 权限决定（附录 B3）
 * 对应 Rust PermissionDecision，serde rename_all = "snake_case"
 */
export type PermissionDecision = "approve" | "deny";

/**
 * 权限状态（附录 B3）
 * 对应 Rust PermissionStatus，serde rename_all = "snake_case"
 */
export type PermissionStatus = "pending" | "approved" | "denied" | "expired";

/**
 * 错误严重级别
 * 对应 Rust ErrorSeverity（无 serde rename，保持 PascalCase）
 */
export type ErrorSeverity = "Warning" | "Error" | "Fatal";

// ===== 附录 B1: stdin 注入安全策略 =====

/**
 * stdin 注入来源分类（附录 B1）
 * 对应 Rust InjectionSource，serde rename_all = "snake_case"
 */
export type InjectionSource =
  | "user_direct"
  | "permission_response"
  | "orchestration_auto"
  | "discussion_user_message";

/**
 * stdin 注入策略配置（附录 B1）
 * 对应 Rust StdinInjectionPolicy
 */
export interface StdinInjectionPolicy {
  /** 自动注入是否需要用户逐条确认 */
  require_confirmation_for_auto: boolean;
  /** 单次注入最大字符数限制 */
  max_injection_length: number;
  /** 注入速率限制（每分钟最大注入次数） */
  rate_limit_per_minute: number;
  /** 禁止注入的字符模式 */
  forbidden_patterns: string[];
}

// ===== 附录 B4: 事件优先级 =====

/**
 * 事件优先级（附录 B4）
 * 对应 Rust EventPriority
 */
export type EventPriority = "Critical" | "High" | "Normal" | "Low";

// ===== 统一错误类型 =====

/**
 * 前端收到的错误结构
 * 对应 Rust ConfluxError 序列化后的 JSON 形态
 */
export interface ConfluxError {
  /** 错误变体类型名 */
  type: string;
  /** 错误消息 */
  message: string;
}
