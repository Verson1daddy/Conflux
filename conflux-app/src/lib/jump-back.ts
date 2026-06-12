// ===== jump-back 三态分发（spec §2.2）=====
// 纯逻辑 + 注入式副作用，便于单测；实际 effects 由窗口侧组装（App.tsx 主窗消费）。
// 跨窗口链路：岛窗 executeJumpBack（fetch 落点）→ Tauri 事件广播 → 主窗双监听
// （App 展开/滚动/通知 + Canvas 视口聚焦）。

import { emit } from "@tauri-apps/api/event";
import type { JumpBackTarget, TerminalRange } from "@/types/jumpback";
import { getJumpBackTarget } from "./tauri-bridge";

export interface JumpEffects {
  /** 落点失效/不可达：显示兜底上下文（通知/提示）。 */
  showFallback: (summary: string) => void;
  /** 画布聚焦卡片 + 选中 + 高亮脉冲。 */
  focusCard: (instanceId: string) => void;
  /** 展开卡片详情（终端视图）。 */
  expandCard: (instanceId: string) => void;
  /** 滚动终端到行区间；approximate=true 表示 backend_abs 近似（需标注）。 */
  scrollTerminal: (instanceId: string, range: TerminalRange, approximate: boolean) => void;
}

export type JumpOutcome = "fallback" | "card" | "terminal";

export function dispatchJumpTarget(target: JumpBackTarget, fx: JumpEffects): JumpOutcome {
  const instanceId = target.instance_id;
  if (target.target_kind === "fallback_context" || !instanceId) {
    fx.showFallback(target.fallback_summary ?? "回场落点已失效");
    return "fallback";
  }
  fx.focusCard(instanceId);
  if (target.target_kind === "terminal_range" && target.terminal_range) {
    fx.expandCard(instanceId);
    fx.scrollTerminal(
      instanceId,
      target.terminal_range,
      target.terminal_range.coord_space === "backend_abs"
    );
    return "terminal";
  }
  return "card";
}

/** 跨窗口 jump 请求通道：任意窗口 fetch 落点后广播，主窗消费执行。 */
export const JUMP_BACK_EVENT = "conflux://jump-back-target";

/**
 * 任意窗口调用：取落点（后端已应用降级链）→ 广播给所有窗口。
 * 主窗监听 JUMP_BACK_EVENT 执行聚焦/展开/滚动；fallback 态入通知。
 */
export async function executeJumpBack(jumpBackTargetId: string): Promise<void> {
  const target = await getJumpBackTarget(jumpBackTargetId);
  await emit(JUMP_BACK_EVENT, target);
}
