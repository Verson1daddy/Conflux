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
/** pan 趋近时间常数（ms）。Fit All / autoArrange / jump-back 的相机平移飞入。
 *  比 zoom 略大——大跨度平移用稍慢曲线更稳，杜绝撕裂感。 */
export const PAN_SMOOTH_TAU_MS = 130;
/** pan 收敛 snap 阈（屏幕像素，亚像素以内即落 target）。 */
export const PAN_SNAP_EPSILON = 0.25;

const LOG_MIN = Math.log2(GRID_MIN_ZOOM);
const LOG_MAX = Math.log2(GRID_MAX_ZOOM);

export function clampLogZoom(logZoom: number): number {
  return Math.max(LOG_MIN, Math.min(LOG_MAX, logZoom));
}

/** wheel 事件 → log2 zoom 增量（deltaMode 1 = 行模式，×16）。 */
export function wheelLogDelta(deltaY: number, deltaMode: number): number {
  return -deltaY * (deltaMode === 1 ? 16 : 1) * WHEEL_LOG_STEP;
}

/** 裸 wheel（无 Ctrl/Meta）→ 画布平移增量（屏幕像素）。画布类应用惯例
 *  （Figma/Miro）：两指滑动/滚轮 = 平移，内容随手势方向走（负号同浏览器滚动）。
 *  触控板双指横滑自带 deltaX；鼠标滚轮无横轴，shift+纵滚 = 横移。 */
export function wheelPanDelta(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  shiftKey: boolean,
): { dx: number; dy: number } {
  const k = deltaMode === 1 ? 16 : 1;
  if (shiftKey && deltaX === 0) return { dx: -deltaY * k, dy: 0 };
  return { dx: -deltaX * k, dy: -deltaY * k };
}

/** 帧率无关指数趋近内核（无 snap，纯曲线）。 */
function expApproach(current: number, target: number, dtMs: number, tauMs: number): number {
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}

/** 帧率无关指数趋近（log 域）；进入 snap 阈直接落到 target。 */
export function approachLog(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number = ZOOM_SMOOTH_TAU_MS,
): number {
  const next = expApproach(current, target, dtMs, tauMs);
  return Math.abs(target - next) < LOG_SNAP_EPSILON ? target : next;
}

/** 帧率无关指数趋近（屏幕像素 pan 域）；进入 snap 阈直接落到 target。
 *  Fit All / autoArrange / jump-back 的相机飞入复用同一曲线纪律（与滚轮缩放
 *  同源），杜绝线性 lerp / CSS transition 跳变。 */
export function approachPan(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number = PAN_SMOOTH_TAU_MS,
): number {
  const next = expApproach(current, target, dtMs, tauMs);
  return Math.abs(target - next) < PAN_SNAP_EPSILON ? target : next;
}

/** 相机是否已同时收敛到目标（zoom 与 pan 双双落 target）——动画停机判据。 */
export function cameraSettled(
  logZoom: number,
  targetLogZoom: number,
  pan: { x: number; y: number },
  targetPan: { x: number; y: number },
): boolean {
  return (
    logZoom === targetLogZoom &&
    pan.x === targetPan.x &&
    pan.y === targetPan.y
  );
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
