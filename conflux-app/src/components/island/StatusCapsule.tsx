// ===== StatusCapsule 组件 =====
// 小型胶囊，显示 Agent 状态文字 + 颜色圆点
// 用于 TopIsland 内部和侧边栏 Agent 列表

import { type FC } from "react";
import type { AgentStatus } from "@/types";

/** 状态到颜色映射（圆点 + 文字色） */
const STATUS_DOT_COLOR: Record<AgentStatus, string> = {
  idle: "bg-accent-muted",
  thinking: "bg-accent-glow",
  coding: "bg-accent",
  waiting_permission: "bg-yellow-500",
  done: "bg-green-500",
  error: "bg-red-500",
};

/** 状态到显示文字映射 */
const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "idle",
  thinking: "thinking",
  coding: "coding",
  waiting_permission: "approval needed",
  done: "done",
  error: "error",
};

/** 状态到文字色映射 */
const STATUS_TEXT_COLOR: Record<AgentStatus, string> = {
  idle: "text-accent-muted",
  thinking: "text-accent-glow",
  coding: "text-accent",
  waiting_permission: "text-yellow-400",
  done: "text-green-400",
  error: "text-red-400",
};

interface StatusCapsuleProps {
  /** Agent 当前状态 */
  status: AgentStatus;
  /** 可选：覆盖默认显示文字 */
  label?: string;
  /** 可选：额外的 CSS 类名 */
  className?: string;
}

/**
 * StatusCapsule — 状态胶囊
 *
 * 显示一个小型 pill 形状的状态指示器：
 * - 左侧：颜色圆点（根据状态语义变色）
 * - 右侧：状态文字
 *
 * 用于 TopIsland 内部显示主框架状态，以及 Sidebar Agent 列表中每个 Agent 的状态。
 */
const StatusCapsule: FC<StatusCapsuleProps> = ({
  status,
  label,
  className = "",
}) => {
  const dotColor = STATUS_DOT_COLOR[status];
  const textColor = STATUS_TEXT_COLOR[status];
  const displayLabel = label ?? STATUS_LABEL[status];

  // waiting_permission 和 error 状态圆点添加脉冲动画
  const shouldPulse =
    status === "waiting_permission" || status === "error";

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-dark/60 ${className}`}
      role="status"
      aria-label={`Status: ${displayLabel}`}
    >
      <span
        className={`w-2 h-2 rounded-full ${dotColor} ${shouldPulse ? "animate-pulse" : ""}`}
      />
      <span
        className={`text-xs font-body leading-none ${textColor}`}
      >
        {displayLabel}
      </span>
    </span>
  );
};

export { StatusCapsule };
