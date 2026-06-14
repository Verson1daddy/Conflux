// ===== 会话状态启发式（M③ 缩点条 dot 4 态来源）=====
//
// ⚠️ MF-3：M③ 的 attention 脉冲是「前端本地启发式占位」，**非控制面真路由**。
// 真路由 = M4+ 新增 `MuxNotify::Attention`（须过红队）；本文件的 attention 仅依据
// 前端可观测的本地信号（退出码非零 / 无输出超时 / 用户标记）做视觉预留位。
// dot 运行/空闲态来源 = daemon pane lifecycle（M② 已通的退出探测）；M③ 单 pane
// 取 is_process_exited / 运行态。文案/契约不得宣称 M③ 已是受监管路由。

import type { ProcessExitedPayload } from "@conmux/terminal-core";

/** 会话生命周期态（dot 颜色语义）。 */
export type SessionStatus = "running" | "idle" | "warn" | "attention";

export interface SessionState {
  instanceId: string;
  name: string;
  status: SessionStatus;
  /** 是否为当前活跃会话（活跃 = 带名 pill；非活跃 = 裸点）。M③ 单 pane 恒 true。 */
  active: boolean;
}

/**
 * 由退出信息派生会话状态（M③ 单 pane 启发式占位）。
 * - 未退出 → running。
 * - 退出码非零 / 信号 → attention（脉冲，本地启发式，非控制面路由）。
 * - 退出码 0 → idle（已干净退出）。
 */
export function deriveSessionStatus(
  exitInfo: ProcessExitedPayload | null
): SessionStatus {
  if (!exitInfo) return "running";
  const code = exitInfo.exit_code;
  if (exitInfo.signal != null) return "attention";
  if (code != null && code !== 0) return "attention";
  return "idle";
}
