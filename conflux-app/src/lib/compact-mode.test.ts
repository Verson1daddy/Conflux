import { describe, expect, it } from "vitest";
import {
  nextDetailState,
  resolveFloatBallSemanticState,
  resolveSidebarVisibility,
  resolveTopIslandState,
  type CompactDetailState,
} from "./compact-mode";

describe("compact-mode", () => {
  it("does not mutate the selected mode when toggling detail layers", () => {
    const prev = {
      mode: "top_island" as const,
      detail: { kind: "none" } as CompactDetailState,
    };
    const reduceDetail = (
      state: typeof prev,
      action: { type: "toggle_top_island_popover"; anchor: { x: number; y: number } },
    ) => ({
      ...state,
      detail: nextDetailState({
        currentMode: state.mode,
        currentDetail: state.detail,
        action,
      }),
    });
    const next = reduceDetail(prev, {
      type: "toggle_top_island_popover",
      anchor: { x: 420, y: 48 },
    });

    expect(next.mode).toBe(prev.mode);
    expect(next.detail.kind).toBe("top_island_popover");
  });

  it("opens a detail layer without switching mode", () => {
    const detail = nextDetailState({
      currentMode: "top_island",
      currentDetail: { kind: "none" },
      action: { type: "toggle_top_island_popover", anchor: { x: 600, y: 44 } },
    });

    expect(detail).toEqual({
      kind: "top_island_popover",
      anchor: { x: 600, y: 44 },
    } satisfies CompactDetailState);
  });

  it("expands the sidebar while scheduling collapse when the pointer only brushes the hotzone", () => {
    const next = resolveSidebarVisibility({
      hotzoneHovered: true,
      panelHovered: false,
      expanded: false,
      collapseDelayMs: 160,
    });

    expect(next).toEqual({
      expanded: true,
      shouldScheduleCollapse: true,
    });
  });

  it("keeps sidebar open while pointer is inside the panel", () => {
    const next = resolveSidebarVisibility({
      hotzoneHovered: false,
      panelHovered: true,
      expanded: true,
      collapseDelayMs: 160,
    });

    expect(next).toEqual({
      expanded: true,
      shouldScheduleCollapse: false,
    });
  });

  it("schedules collapse after the pointer leaves an expanded sidebar", () => {
    const next = resolveSidebarVisibility({
      hotzoneHovered: false,
      panelHovered: false,
      expanded: true,
      collapseDelayMs: 160,
    });

    expect(next).toEqual({
      expanded: true,
      shouldScheduleCollapse: true,
    });
  });

  it("maps top island data to pen-aligned states", () => {
    expect(resolveTopIslandState({ activeCount: 3, permissionCount: 0, unreadCount: 0 })).toBe("active");
    expect(resolveTopIslandState({ activeCount: 0, permissionCount: 1, unreadCount: 0 })).toBe("permission");
    expect(resolveTopIslandState({ activeCount: 0, permissionCount: 0, unreadCount: 0 })).toBe("idle");
  });

  it("maps float ball data to semantic states", () => {
    expect(resolveFloatBallSemanticState({ unreadCount: 0, hasError: false })).toBe("normal");
    expect(resolveFloatBallSemanticState({ unreadCount: 2, hasError: false })).toBe("notification");
    expect(resolveFloatBallSemanticState({ unreadCount: 1, hasError: true })).toBe("error");
  });

  it("closes repeated top island toggles", () => {
    const detail = nextDetailState({
      currentMode: "top_island",
      currentDetail: { kind: "top_island_popover", anchor: { x: 600, y: 44 } },
      action: { type: "toggle_top_island_popover", anchor: { x: 620, y: 52 } },
    });

    expect(detail).toEqual({ kind: "none" });
  });

  it("closes detail explicitly when requested", () => {
    const detail = nextDetailState({
      currentMode: "float_ball",
      currentDetail: { kind: "float_ball_panel" },
      action: { type: "close_detail" },
    });

    expect(detail).toEqual({ kind: "none" });
  });

  it("rejects illegal mode and action combinations", () => {
    const detail = nextDetailState({
      currentMode: "sidebar",
      currentDetail: { kind: "top_island_popover", anchor: { x: 600, y: 44 } },
      action: { type: "toggle_top_island_popover", anchor: { x: 640, y: 44 } },
    });

    expect(detail).toEqual({ kind: "none" });
  });

  it("normalizes an illegal current detail before opening the allowed one", () => {
    const detail = nextDetailState({
      currentMode: "float_ball",
      currentDetail: { kind: "top_island_popover", anchor: { x: 600, y: 44 } },
      action: { type: "toggle_float_ball_panel" },
    });

    expect(detail).toEqual({ kind: "float_ball_panel" });
  });
});
