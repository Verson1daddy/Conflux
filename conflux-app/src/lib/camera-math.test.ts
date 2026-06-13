// ===== 相机数学测试（log 空间平滑缩放，spec §1.4）=====

import { describe, it, expect } from "vitest";
import {
  approachLog,
  approachPan,
  cameraSettled,
  clampLogZoom,
  wheelLogDelta,
  anchorWorldPoint,
  panForAnchor,
  LOG_SNAP_EPSILON,
  PAN_SNAP_EPSILON,
} from "./camera-math";

describe("camera-math（log 空间平滑缩放）", () => {
  it("approachLog 单调趋近且帧率无关（两个 8ms ≈ 一个 16ms）", () => {
    const one = approachLog(0, 1, 16);
    const half = approachLog(approachLog(0, 1, 8), 1, 8);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
    expect(Math.abs(one - half)).toBeLessThan(1e-9);
  });

  it("接近目标时 snap（避免无限趋近的尾巴）", () => {
    expect(approachLog(1 - LOG_SNAP_EPSILON / 2, 1, 16)).toBe(1);
  });

  it("clampLogZoom 限制在 [log2 0.25, log2 7]", () => {
    expect(clampLogZoom(-10)).toBeCloseTo(Math.log2(0.25), 9);
    expect(clampLogZoom(10)).toBeCloseTo(Math.log2(7), 9);
  });

  it("wheelLogDelta：上滚为正、line 模式 ×16", () => {
    expect(wheelLogDelta(-120, 0)).toBeCloseTo(120 * 0.0032, 9);
    expect(wheelLogDelta(-3, 1)).toBeCloseTo(3 * 16 * 0.0032, 9);
  });

  it("锚点不变量：缩放后光标下的世界点不变（pan = p − w·zoom 闭式）", () => {
    const cursor = { x: 700, y: 400 };
    const pan0 = { x: 60, y: 90 };
    const w = anchorWorldPoint(cursor, pan0, 1.0);
    const pan1 = panForAnchor(cursor, w, 2.5);
    // 用新 pan/zoom 反算光标下世界点，应与 w 一致
    expect((cursor.x - pan1.x) / 2.5).toBeCloseTo(w.wx, 9);
    expect((cursor.y - pan1.y) / 2.5).toBeCloseTo(w.wy, 9);
  });

  it("approachPan 单调趋近且帧率无关（两个 8ms ≈ 一个 16ms）", () => {
    const one = approachPan(0, 400, 16);
    const half = approachPan(approachPan(0, 400, 8), 400, 8);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(400);
    expect(Math.abs(one - half)).toBeLessThan(1e-6);
  });

  it("approachPan 接近目标时 snap（亚像素以内直接落 target）", () => {
    expect(approachPan(400 - PAN_SNAP_EPSILON / 2, 400, 16)).toBe(400);
  });

  it("cameraSettled：zoom 与 pan 双双落 target 才算停", () => {
    const target = { x: 100, y: 200 };
    expect(cameraSettled(2, 2, { x: 100, y: 200 }, target)).toBe(true);
    expect(cameraSettled(2, 2.0001, { x: 100, y: 200 }, target)).toBe(false);
    expect(cameraSettled(2, 2, { x: 100, y: 201 }, target)).toBe(false);
    expect(cameraSettled(2, 2, { x: 99, y: 200 }, target)).toBe(false);
  });
});
