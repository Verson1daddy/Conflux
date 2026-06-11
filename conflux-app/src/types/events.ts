// ===== ConfluxEvent 联合类型及所有 Payload 接口 =====
// 对应 Rust 端 src-tauri/src/core/event.rs 中的 ConfluxEvent enum
// serde(tag = "type", content = "payload") 序列化方式
// 前端通过 Tauri 事件监听接收这些事件

import type {
  InstanceId,
  DiscussionId,
  AgentStatus,
  ErrorSeverity,
  PermissionRequest,
  SubAgentInfo,
  InjectionSource,
} from "./agent";
import type { DiscussionMessageData } from "./discussion";

// ===== 事件 Payload 接口 =====

/** Agent 状态变化事件 payload — 对应 Rust ConfluxEvent::AgentStatusChanged */
export interface AgentStatusChangedPayload {
  /** 变化的实例 ID */
  instance_id: InstanceId;
  /** 旧状态 */
  old_status: AgentStatus;
  /** 新状态 */
  new_status: AgentStatus;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** 权限确认请求事件 payload — 对应 Rust ConfluxEvent::PermissionRequested */
export interface PermissionRequestedPayload {
  /** 请求来源实例 ID */
  instance_id: InstanceId;
  /** 权限请求详情 */
  request: PermissionRequest;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** 子代理创建事件 payload — 对应 Rust ConfluxEvent::SubAgentSpawned */
export interface SubAgentSpawnedPayload {
  /** 父实例 ID */
  instance_id: InstanceId;
  /** 新创建的子代理信息 */
  sub_agent: SubAgentInfo;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** 子代理完成事件 payload — 对应 Rust ConfluxEvent::SubAgentCompleted */
export interface SubAgentCompletedPayload {
  /** 父实例 ID */
  instance_id: InstanceId;
  /** 完成的子代理 ID */
  sub_agent_id: string;
  /** 结果摘要（可能为 null） */
  result_summary: string | null;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** 任务完成事件 payload — 对应 Rust ConfluxEvent::TaskCompleted */
export interface TaskCompletedPayload {
  /** 完成任务的实例 ID */
  instance_id: InstanceId;
  /** 任务摘要 */
  summary: string;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** 错误发生事件 payload — 对应 Rust ConfluxEvent::ErrorOccurred */
export interface ErrorOccurredPayload {
  /** 出错的实例 ID */
  instance_id: InstanceId;
  /** 错误消息 */
  error_message: string;
  /** 错误严重级别 */
  severity: ErrorSeverity;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** 讨论消息事件 payload — 对应 Rust ConfluxEvent::DiscussionMessage */
export interface DiscussionMessagePayload {
  /** 讨论 ID */
  discussion_id: DiscussionId;
  /** 消息数据 */
  message: DiscussionMessageData;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** 调度指令事件 payload — 对应 Rust ConfluxEvent::CoordinationCommand */
export interface CoordinationCommandPayload {
  /** 目标实例 ID */
  target_instance_id: InstanceId;
  /** 指令文本 */
  command_text: string;
  /** 来源讨论 ID（可能为 null） */
  source_discussion_id: DiscussionId | null;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/**
 * PTY 原始输出事件 payload — 对应 Rust ConfluxEvent::PtyOutput
 * 注意：data 为 base64 编码字符串（MED-05 修复）
 */
export interface PtyOutputPayload {
  /** 输出来源实例 ID */
  instance_id: InstanceId;
  /** base64 编码的原始输出数据（MED-05 修复） */
  data: string;
  /** per-pane 单调序号（V1-core mux +seq：连续性对账 / V2 重放；旧事件可空） */
  seq?: number | null;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/** stdin 注入审计事件 payload — 对应 Rust ConfluxEvent::StdinInjected（附录 B1） */
export interface StdinInjectedPayload {
  /** 被注入的实例 ID */
  instance_id: InstanceId;
  /** 注入来源分类 */
  source: InjectionSource;
  /** 注入内容预览（前 200 字符） */
  content_preview: string;
  /** 注入内容完整长度 */
  content_length: number;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

/**
 * PTY 子进程退出事件 payload — 对应 Rust ConfluxEvent::ProcessExited
 *
 * 由 PtyManager 的读取线程在检测到 EOF 时发送。
 * XtermTerminal 订阅此事件以弹出 ExitOverlay，让用户选择 Restart /
 * Open Shell / Close Card。
 *
 * 字段详情见 Rust 侧 `src-tauri/src/core/event.rs::ConfluxEvent::ProcessExited`。
 */
export interface ProcessExitedPayload {
  /** 退出的实例 ID */
  instance_id: InstanceId;
  /** 所属 adapter ID（Restart 时复用；shell 模式下后端会在 respawn 后写入 "__shell__"） */
  adapter_id: string;
  /** 退出码；null = 无法获取（读取线程粗粒度版先置 null，后续精细化） */
  exit_code: number | null;
  /** 信号描述："pipe_broken" | null — null = 正常退出 */
  signal: string | null;
  /** 时间戳（Unix 时间戳 ms） */
  timestamp: number;
}

// ===== ConfluxEvent 联合类型 =====

/**
 * 统一事件联合类型
 * 对应 Rust ConfluxEvent enum
 * serde(tag = "type", content = "payload") 序列化方式
 * 9 种原始变体 + StdinInjected 审计事件（附录 B1）
 */
export type ConfluxEvent =
  | { type: "AgentStatusChanged"; payload: AgentStatusChangedPayload }
  | { type: "PermissionRequested"; payload: PermissionRequestedPayload }
  | { type: "SubAgentSpawned"; payload: SubAgentSpawnedPayload }
  | { type: "SubAgentCompleted"; payload: SubAgentCompletedPayload }
  | { type: "TaskCompleted"; payload: TaskCompletedPayload }
  | { type: "ErrorOccurred"; payload: ErrorOccurredPayload }
  | { type: "DiscussionMessage"; payload: DiscussionMessagePayload }
  | { type: "CoordinationCommand"; payload: CoordinationCommandPayload }
  | { type: "PtyOutput"; payload: PtyOutputPayload }
  | { type: "StdinInjected"; payload: StdinInjectedPayload }
  | { type: "ProcessExited"; payload: ProcessExitedPayload };

/**
 * ConfluxEvent 的 type 字段可能的值
 * 用于事件过滤和类型守卫
 */
export type ConfluxEventType = ConfluxEvent["type"];
