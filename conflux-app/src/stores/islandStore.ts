// ===== 灵动岛状态管理 =====
// zustand store，管理灵动岛模式 + 通知队列（已读/未读 UI 态）。
//
// P5 同源改造：权限/注意力态已迁出本 store。唯一真相源是后端 AttentionQueue，
// 前端经 stores/attentionStore.ts 投影（list_attention_items 重放 + attention_updated 订阅）。
// 本 store 不再维护 pendingPermissions / 镜像 permission_required 通知，
// 仅保留 error / task-completed 等活动通知的本地已读/未读 UI 态。

import { create } from "zustand";
import { readPersistedIslandMode } from "@/lib/island-mode-preference";
import type { IslandMode, NotificationItem } from "@/types";

const MAX_NOTIFICATIONS = 200;

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

/** 灵动岛 zustand store 状态 + 操作 */
interface IslandState {
  /** 当前灵动岛显示模式 */
  mode: IslandMode;
  /** 通知队列（活动通知：error / task-completed；权限请求不再走此队列） */
  notifications: NotificationItem[];
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
}

export const useIslandStore = create<IslandState>((set) => ({
  // 初始状态
  // C2-A5: hydrate island mode from localStorage
  mode: readPersistedIslandMode() || "top_island",
  notifications: [],
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
}));
