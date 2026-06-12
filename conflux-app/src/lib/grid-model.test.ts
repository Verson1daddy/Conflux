// ===== 网格 v5 连续权重模型测试 =====
// 真源: docs/superpowers/specs/2026-06-12-frontend-interaction-batch1-design.md §1.3
// 关键资产: "无跳变"从主观验收变成采样回归断言（旧动态主格模型做不到）。

import { describe, it, expect } from "vitest";
import {
  GRID_LEVELS,
  crossWeight,
  dotWeight,
  dotRadius,
  resolveGridLevels,
  GRID_MIN_ZOOM,
  GRID_MAX_ZOOM,
} from "./grid-model";

describe("grid-model v5（连续权重）", () => {
  it("zoom=1 时 74px 层十字满权重、37px 层圆点满权重（B3 格律）", () => {
    expect(GRID_LEVELS).toContain(74); // 4.625 × 2^4
    expect(crossWeight(74)).toBeCloseTo(1, 5);
    expect(dotWeight(37)).toBeCloseTo(1, 5);
    expect(crossWeight(148)).toBeCloseTo(0.5, 2); // 次八度回声十字半强
  });

  it("权重与半径对 zoom 连续：1% 步进下相邻采样差有界（结构性无跳变）", () => {
    let z = GRID_MIN_ZOOM;
    while (z < GRID_MAX_ZOOM) {
      const zNext = z * 1.01;
      for (const ws of GRID_LEVELS) {
        expect(Math.abs(crossWeight(ws * zNext) - crossWeight(ws * z))).toBeLessThan(0.06);
        expect(Math.abs(dotWeight(ws * zNext) - dotWeight(ws * z))).toBeLessThan(0.06);
        expect(Math.abs(dotRadius(ws * zNext) - dotRadius(ws * z))).toBeLessThan(0.02);
      }
      z = zNext;
    }
  });

  it("resolveGridLevels 只返回可见层、按间距升序、zoom=1 含满强度十字层", () => {
    const levels = resolveGridLevels(1);
    expect(levels.length).toBeGreaterThan(0);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].worldSpacing).toBeGreaterThan(levels[i - 1].worldSpacing);
    }
    const full = levels.find((l) => l.worldSpacing === 74);
    expect(full?.crossAlpha).toBeCloseTo(0.42, 3);
    for (const l of levels) {
      expect(l.dotAlpha > 0.004 || l.crossAlpha > 0.004).toBe(true);
    }
  });

  it("点半径随格距连续生长 0.6→1.1", () => {
    expect(dotRadius(10)).toBeCloseTo(0.6, 2);
    expect(dotRadius(100)).toBeCloseTo(1.1, 2);
  });
});
