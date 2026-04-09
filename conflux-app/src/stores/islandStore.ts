// ===== 灵动岛状态管理 =====
// zustand store，管理灵动岛模式、通知队列、权限请求队列
// 所有灵动岛组件从此 store 读取状态并派发操作

import { create } from "zustand";
import type {
  IslandMode,
  NotificationItem,
  PermissionRequest,
} from "@/types";

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
  addPermissionRequest: (request: PermissionRequest) => void;
  /** 从队列中移除指定权限请求（已处理或已过期） */
  removePermissionRequest: (id: string) => void;
}

export const useIslandStore = create<IslandState>((set) => ({
  // 初始状态
  mode: "top_island",
  notifications: [],
  pendingPermissions: [],
  unreadCount: 0,

  setMode: (mode) => set({ mode }),

  addNotification: (notification) =>
    set((state) => {
      // H-02 修复：上限 200 条，超出丢弃最旧通知
      const MAX_NOTIFICATIONS = 200;
      const updated = [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      const newUnreadCount = notification.read
        ? state.unreadCount
        : state.unreadCount + 1;
      return {
        notifications: updated,
        unreadCount: newUnreadCount,
      };
    }),

  markRead: (id) =>
    set((state) => {
      let unreadDelta = 0;
      const updated = state.notifications.map((n) => {
        if (n.id === id && !n.read) {
          unreadDelta = -1;
          return { ...n, read: true };
        }
        return n;
      });
      return {
        notifications: updated,
        unreadCount: Math.max(0, state.unreadCount + unreadDelta),
      };
    }),

  clearNotification: (id) =>
    set((state) => {
      const target = state.notifications.find((n) => n.id === id);
      const unreadDelta = target && !target.read ? -1 : 0;
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount: Math.max(0, state.unreadCount + unreadDelta),
      };
    }),

  addPermissionRequest: (request) =>
    set((state) => ({
      pendingPermissions: [...state.pendingPermissions, request],
    })),

  removePermissionRequest: (id) =>
    set((state) => ({
      pendingPermissions: state.pendingPermissions.filter((p) => p.id !== id),
    })),
}));
