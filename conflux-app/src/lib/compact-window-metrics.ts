export const COMPACT_WINDOW_METRICS = {
  topIsland: {
    collapsedWidth: 180,
    expandedWidth: 420,
    collapsedHeight: 36,
    expandedHeight: 44,
    shellPaddingY: 8,
    windowHeight: 64,
    popoverWidth: 232,
    popoverMaxHeight: 168,
    popoverHeight: 244,
    popoverMargin: 12,
    popoverBodyMaxHeight: 320,
  },
  sidebar: {
    dockTabWidth: 48,
    dockTabHeight: 260,
    dockThreshold: 20,
    expandedWidth: 300,
    bandWidth: 220,
    floatingHeight: 720,
  },
  floatBall: {
    windowSize: 64,
    windowPadding: 6,
    buttonSize: 52,
    panelWidth: 340,
    panelHeight: 336,
  },
} as const;

export function px(value: number): string {
  return `${value}px`;
}

export function resolveTopIslandPopoverWindowHeight(input: {
  top: number;
  contentHeight: number;
}): number {
  const minHeight = COMPACT_WINDOW_METRICS.topIsland.windowHeight;
  const measuredHeight =
    input.top + input.contentHeight + COMPACT_WINDOW_METRICS.topIsland.popoverMargin;

  return Math.max(minHeight, Math.ceil(measuredHeight));
}
