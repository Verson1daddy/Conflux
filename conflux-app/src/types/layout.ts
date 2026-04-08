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
export type LayoutMode = "free" | "grid" | "auto_pack";

// ===== AutoPack 吸附排列 =====

/**
 * 吸附排列排序策略
 * 对应 Rust PackSortStrategy
 */
export type PackSortStrategy = "by_activity" | "by_created_time" | "by_framework_group";

/**
 * 卡片尺寸策略
 * 对应 Rust CardSizePreset
 */
export type CardSizePreset = "smart" | "uniform" | "shuffle";

/**
 * 离散卡片尺寸档位（格子单位，1 格基准 = 280×180px）
 * 对应 Rust CardSizeSlot
 */
export type CardSizeSlot = "mini" | "small" | "medium" | "large" | "wide";

/**
 * AutoPack 布局配置
 * 对应 Rust AutoPackConfig
 */
export interface AutoPackConfig {
  /** 排序策略 */
  sort_strategy: PackSortStrategy;
  /** 尺寸策略 */
  size_preset: CardSizePreset;
  /** 新增卡片时是否自动重排 */
  auto_repack_on_add: boolean;
}

/**
 * 画布吸附网格（px）— 拖拽时位置对齐到 8px 整数倍，肉眼无感知
 * 与 CardSizeSlot 解耦：尺寸档位定义卡片大小，SNAP_GRID 定义放置精度
 */
export const SNAP_GRID_PX = 8;

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
  /** AutoPack 配置（仅 layout_mode === "auto_pack" 时生效） */
  auto_pack_config: AutoPackConfig | null;
  /** 更新时间（Unix 时间戳 ms） */
  updated_at: number;
}
