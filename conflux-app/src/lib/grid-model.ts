// ===== 网格 v5 连续权重模型 =====
// 设计真源: docs/superpowers/specs/2026-06-12-frontend-interaction-batch1-design.md §1.3
// 机制: 固定间距族 + 权重随屏幕格距连续淡变（tldraw 式），杜绝旧实现"动态挑主格"的跳变。

export const GRID_MIN_ZOOM = 0.25;
export const GRID_MAX_ZOOM = 7;

/** 固定间距族（世界单位）：4.625 × 2^k。k=4 → 74，即 zoom=1 的主十字格律。 */
export const GRID_BASE_SPACING = 4.625;
export const GRID_LEVELS: readonly number[] = Array.from(
  { length: 16 },
  (_, k) => GRID_BASE_SPACING * 2 ** k,
);

export const CROSS_ALPHA_MAX = 0.42;
export const CROSS_ARM_PX = 2.5;
export const CROSS_GRAY = 214;
export const DOT_ALPHA_MAX = 0.24;
export const DOT_GRAY = 190;
/** 绘制裁剪窗（屏幕像素）。窗外权重必为 0，跳过纯属省功。 */
export const DOT_PX_RANGE: readonly [number, number] = [8, 320];
export const CROSS_PX_RANGE: readonly [number, number] = [40, 320];
/** 单层交点预算（视口过密时跳过该层，对应旧 lineBudget）。 */
export const LEVEL_INTERSECTION_BUDGET = 40000;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 主十字权重窗：48–70px 淡入，118–178px 淡出（次八度留半强回声）。 */
export function crossWeight(px: number): number {
  return smoothstep(48, 70, px) * (1 - smoothstep(118, 178, px));
}

/** 圆点权重窗：9–14px 淡入，64–96px 淡出（与十字淡入带重叠 → 形态 morph 连续）。 */
export function dotWeight(px: number): number {
  return smoothstep(9, 14, px) * (1 - smoothstep(64, 96, px));
}

/** 点半径随格距连续生长 0.6→1.1（Golus 纪律：细到亚像素前先走 alpha 淡出）。 */
export function dotRadius(px: number): number {
  return 0.6 + 0.5 * smoothstep(14, 64, px);
}

export interface GridLevelVisual {
  worldSpacing: number;
  pixelSize: number;
  dotAlpha: number;
  dotR: number;
  crossAlpha: number;
}

/** 当前 zoom 下所有可见层（dot/cross 任一 alpha > 0.004），按间距升序。 */
export function resolveGridLevels(zoom: number): GridLevelVisual[] {
  const out: GridLevelVisual[] = [];
  for (const worldSpacing of GRID_LEVELS) {
    const pixelSize = worldSpacing * zoom;
    const dotAlpha =
      pixelSize >= DOT_PX_RANGE[0] && pixelSize <= DOT_PX_RANGE[1]
        ? dotWeight(pixelSize) * DOT_ALPHA_MAX
        : 0;
    const crossAlpha =
      pixelSize >= CROSS_PX_RANGE[0] && pixelSize <= CROSS_PX_RANGE[1]
        ? crossWeight(pixelSize) * CROSS_ALPHA_MAX
        : 0;
    if (dotAlpha > 0.004 || crossAlpha > 0.004) {
      out.push({ worldSpacing, pixelSize, dotAlpha, dotR: dotRadius(pixelSize), crossAlpha });
    }
  }
  return out;
}
