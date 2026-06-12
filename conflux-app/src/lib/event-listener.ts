// ===== Tauri 事件监听封装 =====
// 使用 @tauri-apps/api/event 的 listen() 监听后端发射的事件
// 每种 ConfluxEvent 都有对应的订阅函数
// 所有订阅函数返回 UnlistenFn，调用后取消订阅（用于 React useEffect 清理）

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ConfluxEvent,
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
  IslandMode,
  AttentionItem,
  JumpBackTarget,
} from "../types";

// ===== Tauri 事件名常量 =====
// 后端通过 app.emit() 发射事件，前端通过 listen() 监听
// 事件名约定：使用 "conflux://" 前缀 + 事件类型名（snake_case）

/** 统一事件通道名——所有 ConfluxEvent 通过此通道发射 */
const CONFLUX_EVENT_CHANNEL = "conflux://event";
const COMPACT_DETAIL_RESET_EVENT = "compact-detail-reset";

/** 各事件类型独立通道名（按事件类型分发，便于精确订阅） */
const EVENT_CHANNELS = {
  AgentStatusChanged: "conflux://agent-status-changed",
  PermissionRequested: "conflux://permission-requested",
  SubAgentSpawned: "conflux://sub-agent-spawned",
  SubAgentCompleted: "conflux://sub-agent-completed",
  TaskCompleted: "conflux://task-completed",
  ErrorOccurred: "conflux://error-occurred",
  DiscussionMessage: "conflux://discussion-message",
  CoordinationCommand: "conflux://coordination-command",
  PtyOutput: "conflux://pty-output",
  StdinInjected: "conflux://stdin-injected",
  ProcessExited: "conflux://process-exited",
} as const;

const ISLAND_MODE_CHANGED_EVENT = "island-mode-changed";

// ===== 统一事件监听 =====

/**
 * 监听所有 ConfluxEvent（统一通道）
 * 后端通过统一通道发射所有事件，前端自行按 type 字段分发
 * @param callback 事件回调，接收完整的 ConfluxEvent 对象
 * @returns UnlistenFn 取消订阅函数
 */
export async function onConfluxEvent(
  callback: (event: ConfluxEvent) => void
): Promise<UnlistenFn> {
  return listen<ConfluxEvent>(CONFLUX_EVENT_CHANNEL, (tauriEvent) => {
    callback(tauriEvent.payload);
  });
}

// ===== 注意力队列投影（控制面 P5） =====
/** 后端 AttentionQueue 活跃项快照通道（对应 event_emit.rs channels::ATTENTION_UPDATED）。 */
const ATTENTION_UPDATED_EVENT = "conflux://attention-updated";

/**
 * 监听注意力队列更新事件。后端在 ingest / resolve / defer / ignore / restore 后
 * emit 全量活跃项快照（AttentionItem[]）；前端收到后直接替换 store（同源）。
 * @param callback 接收完整活跃项数组
 * @returns UnlistenFn 取消订阅函数
 */
export async function onAttentionUpdated(
  callback: (items: AttentionItem[]) => void
): Promise<UnlistenFn> {
  return listen<AttentionItem[]>(ATTENTION_UPDATED_EVENT, (tauriEvent) => {
    callback(tauriEvent.payload);
  });
}

// ===== jump-back 跨窗口请求 =====
/** lib/jump-back.ts JUMP_BACK_EVENT 广播（岛窗 fetch 落点后发出），主窗消费执行。 */
const JUMP_BACK_REQUEST_EVENT = "conflux://jump-back-target";

export async function onJumpBackRequested(
  callback: (target: JumpBackTarget) => void
): Promise<UnlistenFn> {
  return listen<JumpBackTarget>(JUMP_BACK_REQUEST_EVENT, (tauriEvent) => {
    callback(tauriEvent.payload);
  });
}

// ===== 分事件类型监听 =====

/**
 * 监听 Agent 状态变化事件
 * 对应 Rust ConfluxEvent::AgentStatusChanged
 * @param callback 接收 AgentStatusChangedPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onAgentStatusChanged(
  callback: (payload: AgentStatusChangedPayload) => void
): Promise<UnlistenFn> {
  return listen<AgentStatusChangedPayload>(
    EVENT_CHANNELS.AgentStatusChanged,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

/**
 * 监听权限确认请求事件
 * 对应 Rust ConfluxEvent::PermissionRequested
 * @param callback 接收 PermissionRequestedPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onPermissionRequested(
  callback: (payload: PermissionRequestedPayload) => void
): Promise<UnlistenFn> {
  return listen<PermissionRequestedPayload>(
    EVENT_CHANNELS.PermissionRequested,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

/**
 * 监听子代理创建事件
 * 对应 Rust ConfluxEvent::SubAgentSpawned
 * @param callback 接收 SubAgentSpawnedPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onSubAgentSpawned(
  callback: (payload: SubAgentSpawnedPayload) => void
): Promise<UnlistenFn> {
  return listen<SubAgentSpawnedPayload>(
    EVENT_CHANNELS.SubAgentSpawned,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

/**
 * 监听子代理完成事件
 * 对应 Rust ConfluxEvent::SubAgentCompleted
 * @param callback 接收 SubAgentCompletedPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onSubAgentCompleted(
  callback: (payload: SubAgentCompletedPayload) => void
): Promise<UnlistenFn> {
  return listen<SubAgentCompletedPayload>(
    EVENT_CHANNELS.SubAgentCompleted,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

/**
 * 监听任务完成事件
 * 对应 Rust ConfluxEvent::TaskCompleted
 * @param callback 接收 TaskCompletedPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onTaskCompleted(
  callback: (payload: TaskCompletedPayload) => void
): Promise<UnlistenFn> {
  return listen<TaskCompletedPayload>(
    EVENT_CHANNELS.TaskCompleted,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

/**
 * 监听错误发生事件
 * 对应 Rust ConfluxEvent::ErrorOccurred
 * @param callback 接收 ErrorOccurredPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onErrorOccurred(
  callback: (payload: ErrorOccurredPayload) => void
): Promise<UnlistenFn> {
  return listen<ErrorOccurredPayload>(
    EVENT_CHANNELS.ErrorOccurred,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

/**
 * 监听讨论消息事件
 * 对应 Rust ConfluxEvent::DiscussionMessage
 * @param callback 接收 DiscussionMessagePayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onDiscussionMessage(
  callback: (payload: DiscussionMessagePayload) => void
): Promise<UnlistenFn> {
  return listen<DiscussionMessagePayload>(
    EVENT_CHANNELS.DiscussionMessage,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

/**
 * 监听调度指令事件
 * 对应 Rust ConfluxEvent::CoordinationCommand
 * @param callback 接收 CoordinationCommandPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onCoordinationCommand(
  callback: (payload: CoordinationCommandPayload) => void
): Promise<UnlistenFn> {
  return listen<CoordinationCommandPayload>(
    EVENT_CHANNELS.CoordinationCommand,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

/**
 * 监听 PTY 原始输出事件
 * 对应 Rust ConfluxEvent::PtyOutput
 * 注意：data 为 base64 编码字符串（MED-05 修复）
 * @param callback 接收 PtyOutputPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onPtyOutput(
  callback: (payload: PtyOutputPayload) => void
): Promise<UnlistenFn> {
  return listen<PtyOutputPayload>(
    EVENT_CHANNELS.PtyOutput,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

export async function onIslandModeChanged(
  callback: (mode: IslandMode) => void
): Promise<UnlistenFn> {
  return listen<IslandMode>(ISLAND_MODE_CHANGED_EVENT, (tauriEvent) => {
    callback(tauriEvent.payload);
  });
}

export type CompactDetailResetSource = "island_window";

export async function onCompactDetailReset(
  callback: (source: CompactDetailResetSource) => void
): Promise<UnlistenFn> {
  return listen<CompactDetailResetSource>(COMPACT_DETAIL_RESET_EVENT, (tauriEvent) => {
    callback(tauriEvent.payload);
  });
}

/**
 * 监听 stdin 注入审计事件（附录 B1）
 * 对应 Rust ConfluxEvent::StdinInjected
 * @param callback 接收 StdinInjectedPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onStdinInjected(
  callback: (payload: StdinInjectedPayload) => void
): Promise<UnlistenFn> {
  return listen<StdinInjectedPayload>(
    EVENT_CHANNELS.StdinInjected,
    (tauriEvent) => {
      callback(tauriEvent.payload);
    }
  );
}

// ===== 按实例过滤的监听辅助函数 =====

/**
 * 监听指定实例的 PTY 输出事件
 * 在 onPtyOutput 基础上按 instance_id 过滤，减少不必要的回调
 * @param instanceId 目标实例 ID
 * @param callback 接收该实例的 PtyOutputPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onPtyOutputForInstance(
  instanceId: string,
  callback: (payload: PtyOutputPayload) => void
): Promise<UnlistenFn> {
  return listen<PtyOutputPayload>(
    EVENT_CHANNELS.PtyOutput,
    (tauriEvent) => {
      if (tauriEvent.payload.instance_id === instanceId) {
        callback(tauriEvent.payload);
      }
    }
  );
}

/**
 * 监听指定实例的状态变化事件
 * 在 onAgentStatusChanged 基础上按 instance_id 过滤
 * @param instanceId 目标实例 ID
 * @param callback 接收该实例的 AgentStatusChangedPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onAgentStatusChangedForInstance(
  instanceId: string,
  callback: (payload: AgentStatusChangedPayload) => void
): Promise<UnlistenFn> {
  return listen<AgentStatusChangedPayload>(
    EVENT_CHANNELS.AgentStatusChanged,
    (tauriEvent) => {
      if (tauriEvent.payload.instance_id === instanceId) {
        callback(tauriEvent.payload);
      }
    }
  );
}

/**
 * C2-T1 Exit Overlay · 监听指定实例的 PTY 进程退出事件
 *
 * XtermTerminal 订阅此事件以弹出 ExitOverlay。按 instance_id 过滤使得
 * 每个卡片只处理自己 PTY 的 exit，不干扰其他卡片。
 * @param instanceId 目标实例 ID
 * @param callback 接收该实例的 ProcessExitedPayload
 * @returns UnlistenFn 取消订阅函数
 */
export async function onProcessExitedForInstance(
  instanceId: string,
  callback: (payload: ProcessExitedPayload) => void
): Promise<UnlistenFn> {
  return listen<ProcessExitedPayload>(
    EVENT_CHANNELS.ProcessExited,
    (tauriEvent) => {
      if (tauriEvent.payload.instance_id === instanceId) {
        callback(tauriEvent.payload);
      }
    }
  );
}
