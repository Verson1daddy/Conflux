// ===== TopIsland 组件 =====
// 顶部胶囊态灵动岛
// 纯黑背景 + 冰蓝发光，约 200x36px pill 形状
// 居中显示在窗口顶部，显示主框架状态，点击展开为侧边栏

import { type FC, useEffect, useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StatusCapsule } from "./StatusCapsule";
import { useIslandStore } from "@/stores/islandStore";
import { listAgentInstances } from "@/lib/tauri-bridge";
import { onAgentStatusChanged } from "@/lib/event-listener";
import type { AgentStatus } from "@/types";

interface TopIslandProps {
  /** 点击胶囊时的回调（展开为侧边栏） */
  onExpand: () => void;
}

/**
 * TopIsland — 顶部胶囊态灵动岛
 *
 * 三种状态显示：
 * - 活跃（thinking/coding）：冰蓝发光 + 状态文字
 * - 权限请求：黄色脉冲 + "Approval needed"
 * - 空闲：灰色暗淡 + "idle"
 *
 * 左键按住可拖拽窗口（Tauri startDragging）
 * 点击 → 展开为侧边栏模式
 */
const TopIsland: FC<TopIslandProps> = ({ onExpand }) => {
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const unreadCount = useIslandStore((s) => s.unreadCount);

  // 主框架 Agent 状态
  const [primaryStatus, setPrimaryStatus] = useState<AgentStatus>("idle");
  const [primaryName, setPrimaryName] = useState<string>("");

  // 获取主框架 Agent 信息
  useEffect(() => {
    let cancelled = false;
    async function fetchPrimary() {
      try {
        const agents = await listAgentInstances();
        if (cancelled) return;
        const primary = agents.find((a) => a.is_pinned);
        if (primary) {
          setPrimaryStatus(primary.status);
          setPrimaryName(primary.adapter_name);
        }
      } catch {
        // 后端不可用时保持默认
      }
    }
    fetchPrimary();
    return () => {
      cancelled = true;
    };
  }, []);

  // 监听 Agent 状态变化更新主框架状态
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onAgentStatusChanged(async (_payload) => {
      // 重新获取列表以确认是否为主框架
      try {
        const agents = await listAgentInstances();
        const primary = agents.find((a) => a.is_pinned);
        if (primary) {
          setPrimaryStatus(primary.status);
          setPrimaryName(primary.adapter_name);
        }
      } catch {
        // 忽略刷新错误
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // 拖拽窗口
  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    // 仅左键按下时拖拽
    if (e.button === 0) {
      try {
        await getCurrentWindow().startDragging();
      } catch {
        // 非 Tauri 环境忽略
      }
    }
  }, []);

  // 点击展开（区分拖拽和点击：拖拽会阻止 click 事件触发）
  const handleClick = useCallback(() => {
    onExpand();
  }, [onExpand]);

  // 决定显示状态
  const hasPermissionPending = pendingPermissions.length > 0;
  const isActive = primaryStatus === "thinking" || primaryStatus === "coding";

  // 决定显示内容
  let displayStatus: AgentStatus;
  let displayLabel: string;

  if (hasPermissionPending) {
    displayStatus = "waiting_permission";
    displayLabel = "Approval needed";
  } else if (isActive) {
    displayStatus = primaryStatus;
    displayLabel = primaryName
      ? `${primaryName}: ${primaryStatus}`
      : primaryStatus;
  } else {
    displayStatus = primaryStatus;
    displayLabel = primaryName ? `${primaryName}: ${primaryStatus}` : "idle";
  }

  // 决定发光样式
  const glowClass = hasPermissionPending
    ? "shadow-[0_0_20px_rgba(255,184,0,0.4)]"
    : isActive
      ? "shadow-island-glow"
      : "shadow-none";

  const pulseClass = hasPermissionPending ? "animate-pulse" : "";

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 z-40"
      style={{ pointerEvents: "auto" }}
    >
      <button
        className={`
          flex items-center gap-2 px-4 h-9 rounded-full
          bg-island-bg border border-white/10
          ${glowClass}
          ${pulseClass}
          cursor-pointer select-none
          transition-shadow duration-300
          hover:border-white/20
        `}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        aria-label={`Dynamic island: ${displayLabel}. Click to expand sidebar.`}
        style={{ minWidth: "200px", maxWidth: "320px" }}
      >
        {/* 状态胶囊 */}
        <StatusCapsule
          status={displayStatus}
          label={displayLabel}
          className="bg-transparent px-0 py-0"
        />

        {/* 未读通知数量 badge */}
        {unreadCount > 0 && (
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent text-[10px] font-mono text-white font-bold">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
};

export { TopIsland };
