// ===== 灵动岛相关类型 =====
// 对应 Rust 端 src-tauri/src/core/types.rs 中的灵动岛相关结构体
// 用于灵动岛三形态切换及通知管理

import type { InstanceId } from "./agent";

// ===== 灵动岛模式 =====

/**
 * 灵动岛模式
 * 对应 Rust IslandMode，serde rename_all = "snake_case"
 * top_island: 顶部岛模式（macOS 刘海风格）
 * sidebar: 侧边栏模式
 * float_ball: 悬浮球模式
 */
export type IslandMode = "top_island" | "sidebar" | "float_ball";

export type CloseAction = "quit" | "top_island" | "sidebar";

// ===== 通知级别 =====

/**
 * 通知级别
 * 对应 Rust NotificationLevel，serde rename_all = "snake_case"
 */
export type NotificationLevel =
  | "info"
  | "warning"
  | "error"
  | "permission_required";

// ===== 通知操作 =====

/**
 * 通知操作类型
 * 对应 Rust NotificationActionType，serde rename_all = "snake_case"
 */
export type NotificationActionType =
  | "approve"
  | "deny"
  | "view_details"
  | "dismiss";

/**
 * 通知操作按钮
 * 对应 Rust NotificationAction
 */
export interface NotificationAction {
  /** 按钮显示文本 */
  label: string;
  /** 操作类型 */
  action_type: NotificationActionType;
}

// ===== 通知项 =====

/**
 * 通知项
 * 对应 Rust NotificationItem
 */
export interface NotificationItem {
  /** 通知 ID */
  id: string;
  /** 通知级别 */
  level: NotificationLevel;
  /** 来源实例 ID */
  source_instance_id: InstanceId;
  /** 来源适配器名称 */
  source_adapter_name: string;
  /** 通知内容 */
  content: string;
  /** 可执行操作列表 */
  actions: NotificationAction[];
  /** 创建时间（Unix 时间戳 ms） */
  created_at: number;
  /** 是否已读 */
  read: boolean;
}
