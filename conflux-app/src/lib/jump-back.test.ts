// ===== jump-back 三态分发测试（spec §2.2）=====

import { describe, it, expect, vi } from "vitest";
import { dispatchJumpTarget, type JumpEffects } from "./jump-back";
import type { JumpBackTarget } from "@/types/jumpback";

function effects(): JumpEffects {
  return {
    showFallback: vi.fn(),
    focusCard: vi.fn(),
    expandCard: vi.fn(),
    scrollTerminal: vi.fn(),
  };
}

const base: JumpBackTarget = {
  jump_back_target_id: "jb-1",
  target_kind: "card",
  instance_id: "inst-a",
  card_id: "inst-a",
  terminal_range: null,
  cwd: null,
  fallback_summary: null,
  confidence: "medium",
};

describe("dispatchJumpTarget 三态分发（spec §2.2）", () => {
  it("fallback_context → 只提示，不动画布", () => {
    const fx = effects();
    const outcome = dispatchJumpTarget(
      {
        ...base,
        target_kind: "fallback_context",
        instance_id: null,
        card_id: null,
        fallback_summary: "已失效",
        confidence: "low",
      },
      fx
    );
    expect(outcome).toBe("fallback");
    expect(fx.showFallback).toHaveBeenCalledWith("已失效");
    expect(fx.focusCard).not.toHaveBeenCalled();
  });

  it("card → 聚焦不展开", () => {
    const fx = effects();
    const outcome = dispatchJumpTarget(base, fx);
    expect(outcome).toBe("card");
    expect(fx.focusCard).toHaveBeenCalledWith("inst-a");
    expect(fx.expandCard).not.toHaveBeenCalled();
    expect(fx.scrollTerminal).not.toHaveBeenCalled();
  });

  it("terminal_range(xterm) → 聚焦+展开+精确滚动", () => {
    const fx = effects();
    const outcome = dispatchJumpTarget(
      {
        ...base,
        target_kind: "terminal_range",
        terminal_range: { start_line: 73, end_line: 78, coord_space: "xterm" },
        confidence: "high",
      },
      fx
    );
    expect(outcome).toBe("terminal");
    expect(fx.focusCard).toHaveBeenCalledWith("inst-a");
    expect(fx.expandCard).toHaveBeenCalledWith("inst-a");
    expect(fx.scrollTerminal).toHaveBeenCalledWith(
      "inst-a",
      { start_line: 73, end_line: 78, coord_space: "xterm" },
      false
    );
  });

  it("terminal_range(backend_abs) → 近似滚动标记 approximate=true", () => {
    const fx = effects();
    dispatchJumpTarget(
      {
        ...base,
        target_kind: "terminal_range",
        terminal_range: { start_line: 73, end_line: 78, coord_space: "backend_abs" },
      },
      fx
    );
    expect(fx.scrollTerminal).toHaveBeenCalledWith(
      "inst-a",
      { start_line: 73, end_line: 78, coord_space: "backend_abs" },
      true
    );
  });

  it("card 但 instance 缺失 → 按 fallback 兜底", () => {
    const fx = effects();
    const outcome = dispatchJumpTarget({ ...base, instance_id: null, card_id: null }, fx);
    expect(outcome).toBe("fallback");
    expect(fx.showFallback).toHaveBeenCalled();
    expect(fx.focusCard).not.toHaveBeenCalled();
  });
});
