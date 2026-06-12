// ===== useExitActions =====
// 退出态（agent CLI 进程死亡）的状态读取 + 三动作（restart/shell/close）。
// 质感批 Q3'：退出 UI 从 XtermTerminal 内的 ExitOverlay 迁出为卡片 footer
// 动作条（用户裁决方案二），动作逻辑抽到本 hook 供 AgentCard / ExpandedAgentCard
// 两个 footer 共用。
//
// 注意：退出解释/Restart 是 conflux 的 agent 语义（conmux 单用 = 普通终端，
// 不需要此概念）——见 spec 2026-06-12-cool-craft-direction-design.md §3。

import { useCallback } from "react";
import type { ProcessExitedPayload } from "@/types";
import { useAgentStore } from "@/stores/agentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  destroyAgentInstance,
  respawnAgentInstance,
  resizePty,
} from "@/lib/tauri-bridge";
import { getRegisteredTerminal } from "@/lib/xterm-registry";

export type ExitAction = "restart" | "shell" | "close";

export function useExitActions(instanceId: string): {
  exitState: ProcessExitedPayload | null;
  adapterName: string;
  handleExitAction: (action: ExitAction) => Promise<void>;
} {
  const exitState = useAgentStore((s) => s.exitStates.get(instanceId) ?? null);
  const inst = useAgentStore((s) => s.instances.get(instanceId));
  const addInstanceAction = useAgentStore((s) => s.addInstance);
  const removeInstanceAction = useAgentStore((s) => s.removeInstance);
  const setExitStateStore = useAgentStore((s) => s.setExitState);
  const removeCardAction = useWorkspaceStore((s) => s.removeCard);

  const adapterName = inst
    ? inst.display_name
      ? `${inst.adapter_name} · ${inst.display_name}`
      : inst.adapter_name
    : (exitState?.adapter_id ?? "Agent");

  const handleExitAction = useCallback(
    async (action: ExitAction) => {
      if (action === "close") {
        try {
          await destroyAgentInstance(instanceId);
        } catch (err) {
          // 后端可能已 gc——继续清前端态，别把用户卡死。
          console.error("[useExitActions] destroy on close failed:", err);
        }
        removeCardAction(instanceId);
        removeInstanceAction(instanceId);
        return;
      }

      // Restart / Shell：respawn 后替换实例元数据并清退出态；清掉当前注册
      // 终端（交互优先）的旧内容，并把新 PTY 对齐现网格——否则新进程默认
      // 120×30 与 xterm 网格不一致导致 TUI 错排。
      try {
        const next = await respawnAgentInstance(instanceId, action);
        addInstanceAction(next);
        setExitStateStore(instanceId, null);
        const term = getRegisteredTerminal(instanceId);
        if (term) {
          term.clear();
          term.reset();
          if (term.cols && term.rows) {
            resizePty(instanceId, term.cols, term.rows).catch(() => {});
          }
        }
      } catch (err) {
        console.error("[useExitActions] respawn failed:", err);
        // 保留退出态，用户仍可 close。
      }
    },
    [
      instanceId,
      addInstanceAction,
      removeCardAction,
      removeInstanceAction,
      setExitStateStore,
    ]
  );

  return { exitState, adapterName, handleExitAction };
}
