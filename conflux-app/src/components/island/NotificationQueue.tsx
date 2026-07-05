// ===== NotificationQueue 组件 =====
// 通知列表，每项包含：级别图标 + 来源名称 + 内容摘要 + 时间 + 操作按钮
// 用于 Sidebar 内部的 NOTIFICATIONS 区域

import { type FC, useState, useCallback } from "react";
import { useIslandStore } from "@/stores/islandStore";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { NotificationItem, NotificationLevel } from "@/types";

// ===== 级别图标与颜色映射 =====

interface LevelStyle {
  icon: IconName;
  color: string;
  bgColor: string;
  pulse: boolean;
}

const LEVEL_STYLES: Record<NotificationLevel, LevelStyle> = {
  info: {
    icon: "info",
    color: "text-accent",
    bgColor: "bg-accent/10",
    pulse: false,
  },
  warning: {
    icon: "alert",
    color: "text-yellow-400",
    bgColor: "bg-yellow-400/10",
    pulse: false,
  },
  error: {
    icon: "close",
    color: "text-red-400",
    bgColor: "bg-red-400/10",
    pulse: true,
  },
  permission_required: {
    icon: "shield",
    color: "text-yellow-400",
    bgColor: "bg-yellow-400/10",
    pulse: true,
  },
};

/** 时间格式化：显示相对时间 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${Math.floor(diffHour / 24)}d ago`;
}

// ===== 单条通知项组件 =====

interface NotificationItemRowProps {
  notification: NotificationItem;
  onMarkRead: (id: string) => void;
  onClear: (id: string) => void;
}

const NotificationItemRow: FC<NotificationItemRowProps> = ({
  notification,
  onMarkRead,
  onClear,
}) => {
  const [expanded, setExpanded] = useState(false);
  const style = LEVEL_STYLES[notification.level];

  const handleClick = useCallback(() => {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
    setExpanded((prev) => !prev);
  }, [notification.id, notification.read, onMarkRead]);

  const handleDismiss = useCallback(() => {
    onClear(notification.id);
  }, [notification.id, onClear]);

  return (
    <div
      className={`
        relative px-3 py-2.5 rounded-lg cursor-pointer transition-colors duration-200
        ${notification.read ? "bg-surface-dark/30" : "bg-surface-dark/60 border-l-2 border-accent-glow"}
        hover:bg-surface-dark/80
      `}
      onClick={handleClick}
      role="listitem"
      aria-label={`${notification.level} notification: ${notification.content}`}
    >
      {/* 头部：图标 + 来源 + 时间 */}
      <div className="flex items-center gap-2 mb-1">
        {/* 级别图标 */}
        <span
          className={`
            flex items-center justify-center w-5 h-5 rounded text-xs
            ${style.bgColor} ${style.color}
            ${style.pulse ? "animate-pulse" : ""}
          `}
          aria-hidden="true"
        >
          <Icon name={style.icon} size={12} />
        </span>

        {/* 来源名称 */}
        <span className="text-xs font-body text-white/80 truncate flex-1">
          {notification.source_adapter_name || notification.source_instance_id}
        </span>

        {/* 时间 */}
        <span className="text-[10px] font-mono text-white/40 whitespace-nowrap">
          {formatRelativeTime(notification.created_at)}
        </span>

        {/* 未读标记圆点 */}
        {!notification.read && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent-glow" />
        )}
      </div>

      {/* 内容摘要 */}
      <p
        className={`text-xs font-body text-white/60 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}
      >
        {notification.content}
      </p>

      {/* 展开时显示操作按钮 */}
      {expanded && notification.actions.length > 0 && (
        <div className="flex gap-2 mt-2 pt-2 border-t border-white/5">
          {notification.actions.map((action) => (
            <button
              key={action.action_type}
              className={`
                text-[10px] font-body px-2 py-1 rounded transition-colors
                ${action.action_type === "dismiss"
                  ? "text-white/40 hover:text-white/70 hover:bg-white/5"
                  : "text-accent hover:text-accent-hover hover:bg-accent/10"
                }
              `}
              onClick={(e) => {
                e.stopPropagation();
                if (action.action_type === "dismiss") {
                  handleDismiss();
                }
              }}
              aria-label={action.label}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ===== NotificationQueue 主组件 =====

interface NotificationQueueProps {
  /** 可选：最大显示条数（默认 50） */
  maxDisplay?: number;
}

/**
 * NotificationQueue — 通知队列
 *
 * 渲染通知列表，每项可展开/折叠。
 * 级别: info(蓝), warning(黄), error(红), permission_required(黄+脉冲)
 * 未读通知有高亮左边框标记。
 */
const NotificationQueue: FC<NotificationQueueProps> = ({
  maxDisplay = 50,
}) => {
  const notifications = useIslandStore((s) => s.notifications);
  const markRead = useIslandStore((s) => s.markRead);
  const clearNotification = useIslandStore((s) => s.clearNotification);
  const unreadCount = useIslandStore((s) => s.unreadCount);

  const visibleNotifications = notifications.slice(0, maxDisplay);

  if (visibleNotifications.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-xs font-body text-white/30">No notifications</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" role="list" aria-label="Notification queue">
      {/* 未读计数头部 */}
      {unreadCount > 0 && (
        <div className="px-3 py-1">
          <span className="text-[10px] font-mono text-accent-glow">
            {unreadCount} unread
          </span>
        </div>
      )}

      {/* 通知列表 */}
      {visibleNotifications.map((notification) => (
        <NotificationItemRow
          key={notification.id}
          notification={notification}
          onMarkRead={markRead}
          onClear={clearNotification}
        />
      ))}
    </div>
  );
};

export { NotificationQueue };
