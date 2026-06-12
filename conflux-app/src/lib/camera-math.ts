// ===== 相机数学：log 空间滚轮平滑（spec §1.4）=====
// 依据: pixi-viewport Wheel / d3-zoom / lisyarus exponential smoothing
// （调研: .workbench/coordination/research/grid-direction-2026-06-12/findings-smooth-grid-2026-06-12.md）。
// 必须 log 空间插值：线性 lerp zoom 会忽快忽慢（Logarithmic Interpolation 伪影）。

import { GRID_MIN_ZOOM, GRID_MAX_ZOOM } from "./grid-model";

/** 指数趋近时间常数（ms）。 */
export const ZOOM_SMOOTH_TAU_MS = 90;
/** 滚轮单位 deltaY → log2 zoom 增量系数。 */
export const WHEEL_LOG_STEP = 0.0032;
/** 收敛 snap 阈（log2 域）。 */
export const LOG_SNAP_EPSILON = 0.0005;

const LOG_MIN = Math.log2(GRID_MIN_ZOOM);
const LOG_MAX = Math.log2(GRID_MAX_ZOOM);

export function clampLogZoom(logZoom: number): number {
  return Math.max(LOG_MIN, Math.min(LOG_MAX, logZoom));
}

/** wheel 事件 → log2 zoom 增量（deltaMode 1 = 行模式，×16）。 */
export function wheelLogDelta(deltaY: number, deltaMode: number): number {
  return -deltaY * (deltaMode === 1 ? 16 : 1) * WHEEL_LOG_STEP;
}

/** 帧率无关指数趋近（log 域）；进入 snap 阈直接落到 target。 */
export function approachLog(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number = ZOOM_SMOOTH_TAU_MS,
): number {
  const next = current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
  return Math.abs(target - next) < LOG_SNAP_EPSILON ? target : next;
}

export interface AnchorWorld {
  wx: number;
  wy: number;
}

/** wheel 时捕获：光标下世界点 w = (p − pan) / zoom。 */
export function anchorWorldPoint(
  cursor: { x: number; y: number },
  pan: { x: number; y: number },
  zoom: number,
): AnchorWorld {
  return { wx: (cursor.x - pan.x) / zoom, wy: (cursor.y - pan.y) / zoom };
}

/** 每帧闭式重算（零累积漂移）：pan = p − w·zoom。 */
export function panForAnchor(
  cursor: { x: number; y: number },
  world: AnchorWorld,
  zoom: number,
): { x: number; y: number } {
  return { x: cursor.x - world.wx * zoom, y: cursor.y - world.wy * zoom };
}
