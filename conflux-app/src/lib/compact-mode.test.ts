import { describe, expect, it } from "vitest";
import {
  nextDetailState,
  resolveFloatBallSemanticState,
  resolveSidebarVisibility,
  resolveTopIslandState,
  type CompactDetailState,
} from "./compact-mode";

describe("compact-mode", () => {
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

  it("keeps sidebar closed when the pointer only brushes the hotzone", () => {
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
});
