// ===== 会话状态启发式（缩点条 dot 4 态来源）=====
//
// attention 真路由（MF-3，2026-06-19 落地）：attention 脉冲由**真 PTY 信号**触发——
// 终端响铃（BEL）或进程退出（见 session-observer 的 AwareState.attention），用户切到该会话
// 即清除。在**观测层 + App**（非启发式臆测「是否在等输入」）；route 在前端而非 daemon——
// 当前 GUI mount-all 观测全部 pane，故前端就能拿到全部会话的真信号。daemon `MuxNotify::Attention`
// 的纯架构路由留作未来（仅当 GUI 不再观测全部 pane 时才需要）。
// dot 运行/空闲态来源 = daemon pane lifecycle（M② 退出探测）+ M3-ext 观测者的输出活跃度。
// 注：本文件 deriveStatusFromAware 只产 running/idle（不产 attention）；attention 由 App 据
// aware.attention + 非活跃 叠加（见 App sessionStates）。

import type { ProcessExitedPayload } from "@conmux/terminal-core";
import type { AwareState } from "../observe/types";

/** 会话生命周期态（dot 颜色语义）。 */
export type SessionStatus = "running" | "idle" | "warn" | "attention";

export interface SessionState {
  instanceId: string;
  name: string;
  status: SessionStatus;
  /** 是否为当前活跃会话（活跃 = 带名 pill；非活跃 = 裸点）。 */
  active: boolean;
  /**
   * 进程是否已退出（observer 的 aware.status==="exited"）。dot 颜色仍映射成 idle，
   * 但右键菜单据此决定是否提供「重启」。默认/未知 = false。
   */
  exited?: boolean;
}

/**
 * 由退出信息派生会话状态（M② 单 pane 兼容路径；保留供退出态条复用）。
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

/**
 * 由 M3-ext 观测者的 AwareState 派生缩点条 dot 状态（M④ 多会话主路径）。
 * - exited → idle（干净退出，缩点显空闲灯）。
 * - running → running。
 * - idle → idle。
 *
 * 本函数只产 running/idle（输出活跃度 + 退出，诚实反映）。**attention 不在此**——
 * attention 真路由（BEL/退出真信号）由 App 据 `aware.attention` + 非活跃 叠加（MF-3 已落地，
 * 见本文件头注释 + App sessionStates）。
 */
export function deriveStatusFromAware(s: AwareState): SessionStatus {
  switch (s.status) {
    case "running":
      return "running";
    case "idle":
      return "idle";
    case "exited":
      return "idle";
  }
}

/**
 * App 级重渲门控签名（F1，2026-07-03 P2 根部债）：App 对每个 observer 的订阅原本
 * 任一 commit 即 bump 全 App 重渲——而 observer 的 elapsed tick **每秒必 commit**，
 * N 会话 ≈ N Hz 全 App 重渲（"几十会话"目标的根部性能债）。App 实际只消费三个
 * 语义字段（缩点 dot 的 status、attention 脉冲、Home RUNNING 行的 activity；
 * exited 由 status 编码；elapsed 由 AwareHeader 自订阅局部渲染）——签名不变则
 * 不 bump。加字段进 App 消费面时**必须**同步扩此签名（否则该字段变化不触发重渲）。
 */
export function awareDotSignature(s: AwareState): string {
  return `${s.status}|${s.attention ? 1 : 0}|${s.activity ?? ""}`;
}
