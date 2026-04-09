// ===== FloatBall 组件 =====
// 悬浮球态灵动岛
// 圆形 52x52px，三种语义色（冰蓝/黄/红），点击展开为侧边栏

import { type FC, useMemo } from "react";
import { useIslandStore } from "@/stores/islandStore";

interface FloatBallProps {
  /** 点击悬浮球回调（展开为侧边栏） */
  onExpand: () => void;
}

/**
 * FloatBall — 悬浮球态灵动岛
 *
 * 三种语义色：
 * - 正常：#B8D4E3（冰蓝）+ 发光
 * - 通知：#FFB800（黄色）+ 脉冲动画
 * - 错误：#FF3B30（红色）+ 脉冲动画
 *
 * 显示未读通知数量 badge
 * 点击 → 展开为侧边栏
 */
const FloatBall: FC<FloatBallProps> = ({ onExpand }) => {
  const notifications = useIslandStore((s) => s.notifications);
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const unreadCount = useIslandStore((s) => s.unreadCount);

  // 决定语义色
  const semanticState = useMemo(() => {
    // 检查是否有错误通知
    const hasError = notifications.some(
      (n) => !n.read && n.level === "error"
    );
    if (hasError) return "error" as const;

    // 检查是否有待处理权限或未读通知
    const hasNotification =
      pendingPermissions.length > 0 ||
      notifications.some(
        (n) => !n.read && (n.level === "warning" || n.level === "permission_required")
      );
    if (hasNotification) return "notification" as const;

    return "normal" as const;
  }, [notifications, pendingPermissions]);

  // 颜色和效果映射
  const colorConfig = {
    normal: {
      bg: "bg-[#B8D4E3]",
      shadow: "shadow-float-ball",
      pulse: false,
      innerColor: "bg-island-bg",
    },
    notification: {
      bg: "bg-[#FFB800]",
      shadow: "shadow-[0_0_20px_rgba(255,184,0,0.5)]",
      pulse: true,
      innerColor: "bg-island-bg",
    },
    error: {
      bg: "bg-[#FF3B30]",
      shadow: "shadow-[0_0_20px_rgba(255,59,48,0.5)]",
      pulse: true,
      innerColor: "bg-island-bg",
    },
  };

  const config = colorConfig[semanticState];

  return (
    <div className="fixed bottom-6 right-6 z-40" style={{ pointerEvents: "auto" }}>
      <button
        className={`
          relative w-[52px] h-[52px] rounded-full
          ${config.bg}
          ${config.shadow}
          ${config.pulse ? "animate-[pulse_1.5s_ease-in-out_infinite]" : ""}
          cursor-pointer
          transition-shadow duration-300
          hover:scale-105 active:scale-95
          flex items-center justify-center
        `}
        onClick={onExpand}
        aria-label={`Dynamic island float ball. ${unreadCount} unread notifications. Click to expand sidebar.`}
      >
        {/* 内圈：黑色圆形 */}
        <div
          className={`w-10 h-10 rounded-full ${config.innerColor} flex items-center justify-center`}
        >
          <span className="text-xs font-display font-bold text-accent-glow">
            C
          </span>
        </div>

        {/* 未读 badge */}
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center
              min-w-[18px] h-[18px] px-1 rounded-full
              bg-accent text-[10px] font-mono text-white font-bold"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
};

export { FloatBall };
