// ===== 灵动岛状态管理 =====
// zustand store，管理灵动岛模式、通知队列、权限请求队列
// 所有灵动岛组件从此 store 读取状态并派发操作

import { create } from "zustand";
import { readPersistedIslandMode } from "@/lib/island-mode-preference";
import type {
  IslandMode,
  NotificationItem,
  PermissionRequest,
} from "@/types";

const MAX_NOTIFICATIONS = 200;

type PermissionRequestWithSource = PermissionRequest & {
  source_adapter_name?: string;
};

function countUnread(notifications: NotificationItem[]): number {
  return notifications.filter((notification) => !notification.read).length;
}

function upsertNotification(
  notifications: NotificationItem[],
  notification: NotificationItem,
): NotificationItem[] {
  return [
    notification,
    ...notifications.filter((item) => item.id !== notification.id),
  ].slice(0, MAX_NOTIFICATIONS);
}

function notificationForPermissionRequest(
  request: PermissionRequestWithSource
): NotificationItem {
  return {
    id: request.id,
    level: "permission_required",
    source_instance_id: request.instance_id,
    source_adapter_name: request.source_adapter_name ?? "",
    content: `Permission needed: ${request.action} - ${request.description}`,
    actions: [{ label: "View", action_type: "view_details" }],
    created_at: request.created_at,
    read: false,
  };
}

/** 灵动岛 zustand store 状态 + 操作 */
interface IslandState {
  /** 当前灵动岛显示模式 */
  mode: IslandMode;
  /** 通知队列 */
  notifications: NotificationItem[];
  /** 待处理的权限请求队列 */
  pendingPermissions: PermissionRequest[];
  /** 未读通知计数 */
  unreadCount: number;

  // ===== Actions =====

  /** 设置灵动岛模式 */
  setMode: (mode: IslandMode) => void;
  /** 添加一条通知 */
  addNotification: (notification: NotificationItem) => void;
  /** 将指定通知标记为已读 */
  markRead: (id: string) => void;
  /** 移除指定通知 */
  clearNotification: (id: string) => void;
  /** 添加一条权限请求到队列 */
  addPermissionRequest: (request: PermissionRequestWithSource) => void;
  /** 从队列中移除指定权限请求（已处理或已过期） */
  removePermissionRequest: (id: string) => void;
}

export const useIslandStore = create<IslandState>((set) => ({
  // 初始状态
  // C2-A5: hydrate island mode from localStorage
  mode: readPersistedIslandMode() || "top_island",
  notifications: [],
  pendingPermissions: [],
  unreadCount: 0,

  setMode: (mode) => {
    localStorage.setItem("conflux.islandMode", mode);
    set({ mode });
  },

  addNotification: (notification) =>
    set((state) => {
      const updated = upsertNotification(state.notifications, notification);
      return {
        notifications: updated,
        unreadCount: countUnread(updated),
      };
    }),

  markRead: (id) =>
    set((state) => {
      const updated = state.notifications.map((n) => {
        if (n.id === id && !n.read) {
          return { ...n, read: true };
        }
        return n;
      });
      return {
        notifications: updated,
        unreadCount: countUnread(updated),
      };
    }),

  clearNotification: (id) =>
    set((state) => {
      const updated = state.notifications.filter((n) => n.id !== id);
      return {
        notifications: updated,
        unreadCount: countUnread(updated),
      };
    }),

  addPermissionRequest: (request) =>
    set((state) => {
      const notification = notificationForPermissionRequest(request);
      const updatedNotifications = upsertNotification(
        state.notifications,
        notification,
      );
      return {
        pendingPermissions: [
        request,
        ...state.pendingPermissions.filter((p) => p.id !== request.id),
      ],
        notifications: updatedNotifications,
        unreadCount: countUnread(updatedNotifications),
      };
    }),

  removePermissionRequest: (id) =>
    set((state) => {
      const updatedNotifications = state.notifications.filter((n) => n.id !== id);
      return {
        pendingPermissions: state.pendingPermissions.filter((p) => p.id !== id),
        notifications: updatedNotifications,
        unreadCount: countUnread(updatedNotifications),
      };
    }),
}));
