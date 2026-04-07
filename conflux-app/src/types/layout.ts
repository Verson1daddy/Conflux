// ===== 布局相关类型 =====
// 对应 Rust 端 src-tauri/src/core/types.rs 中的布局相关结构体
// 用于工作台画布的卡片布局管理

import type { InstanceId } from "./agent";

// ===== 基础几何类型 =====

/**
 * 二维位置
 * 对应 Rust Position
 */
export interface Position {
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
}

/**
 * 二维尺寸
 * 对应 Rust Size
 */
export interface Size {
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

// ===== 布局模式 =====

/**
 * 布局模式
 * 对应 Rust LayoutMode，serde rename_all = "snake_case"
 */
export type LayoutMode = "free" | "grid";

// ===== 卡片布局 =====

/**
 * 单个卡片布局信息
 * 对应 Rust CardLayout
 */
export interface CardLayout {
  /** 对应的实例 ID */
  instance_id: InstanceId;
  /** 卡片位置 */
  position: Position;
  /** 卡片尺寸 */
  size: Size;
  /** 层叠顺序 */
  z_index: number;
}

// ===== 工作台布局 =====

/**
 * 工作台布局
 * 对应 Rust WorkspaceLayout
 */
export interface WorkspaceLayout {
  /** 所有卡片的布局信息 */
  cards: CardLayout[];
  /** 布局模式 */
  layout_mode: LayoutMode;
  /** 更新时间（Unix 时间戳 ms） */
  updated_at: number;
}
