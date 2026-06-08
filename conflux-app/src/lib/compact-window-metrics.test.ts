import { describe, expect, it } from "vitest";

import {
  COMPACT_WINDOW_METRICS,
  resolveTopIslandPopoverWindowHeight,
  px,
} from "./compact-window-metrics";

describe("compact window metrics", () => {
  it("freezes the V1 compact shell dimensions shared by UI tokens", () => {
    expect(COMPACT_WINDOW_METRICS.topIsland.collapsedWidth).toBe(180);
    expect(COMPACT_WINDOW_METRICS.topIsland.expandedWidth).toBe(420);
    expect(COMPACT_WINDOW_METRICS.topIsland.collapsedHeight).toBe(36);
    expect(COMPACT_WINDOW_METRICS.topIsland.expandedHeight).toBe(44);
    expect(COMPACT_WINDOW_METRICS.topIsland.shellPaddingY).toBe(8);
    expect(COMPACT_WINDOW_METRICS.topIsland.windowHeight).toBe(64);
    expect(COMPACT_WINDOW_METRICS.topIsland.popoverWidth).toBe(232);
    expect(COMPACT_WINDOW_METRICS.topIsland.popoverMaxHeight).toBe(168);
    expect(COMPACT_WINDOW_METRICS.topIsland.popoverHeight).toBe(244);
    expect(COMPACT_WINDOW_METRICS.topIsland.popoverMargin).toBe(12);
    expect(COMPACT_WINDOW_METRICS.topIsland.popoverBodyMaxHeight).toBe(320);
    expect(COMPACT_WINDOW_METRICS.sidebar.dockTabWidth).toBe(48);
    expect(COMPACT_WINDOW_METRICS.sidebar.dockTabHeight).toBe(260);
    expect(COMPACT_WINDOW_METRICS.sidebar.dockThreshold).toBe(20);
    expect(COMPACT_WINDOW_METRICS.sidebar.expandedWidth).toBe(300);
    expect(COMPACT_WINDOW_METRICS.sidebar.bandWidth).toBe(220);
    expect(COMPACT_WINDOW_METRICS.sidebar.floatingHeight).toBe(720);
  });

  it("formats CSS pixel tokens from the frozen numeric values", () => {
    expect(px(COMPACT_WINDOW_METRICS.topIsland.collapsedWidth)).toBe("180px");
    expect(px(COMPACT_WINDOW_METRICS.topIsland.expandedWidth)).toBe("420px");
    expect(px(COMPACT_WINDOW_METRICS.sidebar.dockTabWidth)).toBe("48px");
    expect(px(COMPACT_WINDOW_METRICS.sidebar.dockTabHeight)).toBe("260px");
    expect(px(COMPACT_WINDOW_METRICS.sidebar.expandedWidth)).toBe("300px");
    expect(px(COMPACT_WINDOW_METRICS.sidebar.bandWidth)).toBe("220px");
  });

  it("keeps the native top island viewport tall enough for the expanded capsule", () => {
    const { expandedHeight, shellPaddingY, windowHeight } =
      COMPACT_WINDOW_METRICS.topIsland;

    expect(windowHeight).toBeGreaterThanOrEqual(
      expandedHeight + shellPaddingY * 2
    );
  });

  it("keeps the native top island popover viewport tall enough for permission actions", () => {
    const {
      expandedHeight,
      popoverHeight,
      popoverMaxHeight,
      shellPaddingY,
    } = COMPACT_WINDOW_METRICS.topIsland;

    expect(popoverHeight).toBeGreaterThanOrEqual(
      expandedHeight + shellPaddingY * 2 + popoverMaxHeight
    );
  });

  it("sizes the top island popover window from actual bubble content", () => {
    expect(
      resolveTopIslandPopoverWindowHeight({
        top: 64,
        contentHeight: 118,
      })
    ).toBe(194);
    expect(
      resolveTopIslandPopoverWindowHeight({
        top: 64,
        contentHeight: 218,
      })
    ).toBe(294);
  });
});
