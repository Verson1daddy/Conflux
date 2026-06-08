import type { IslandMode } from "@/types";

export type TopIslandVisualState = "active" | "permission" | "idle";
export type TopIslandPopoverView = "details" | "notifications" | "quick_reply";

export type CompactDetailState =
  | { kind: "none" }
  | {
      kind: "top_island_popover";
      anchor: { x: number; y: number };
      view: TopIslandPopoverView;
    };

export function resolveTopIslandState(input: {
  activeCount: number;
  permissionCount: number;
  unreadCount: number;
}): TopIslandVisualState {
  if (input.permissionCount > 0) return "permission";
  if (input.activeCount > 0 || input.unreadCount > 0) return "active";
  return "idle";
}

type CompactDetailAction =
  | {
      type: "toggle_top_island_popover";
      anchor: { x: number; y: number };
      view: TopIslandPopoverView;
    }
  | { type: "close_detail" };

function normalizeDetailForMode(
  mode: IslandMode,
  detail: CompactDetailState,
): CompactDetailState {
  if (detail.kind === "none") return detail;
  if (mode === "top_island" && detail.kind === "top_island_popover") return detail;
  return { kind: "none" };
}

export function nextDetailState(input: {
  currentMode: IslandMode;
  currentDetail: CompactDetailState;
  action: CompactDetailAction;
}): CompactDetailState {
  const normalizedDetail = normalizeDetailForMode(input.currentMode, input.currentDetail);

  if (input.action.type === "close_detail") return { kind: "none" };
  if (input.action.type === "toggle_top_island_popover") {
    if (input.currentMode !== "top_island") return { kind: "none" };
    return normalizedDetail.kind === "top_island_popover" &&
      normalizedDetail.view === input.action.view
      ? { kind: "none" }
      : {
          kind: "top_island_popover",
          anchor: input.action.anchor,
          view: input.action.view,
        };
  }
  return { kind: "none" };
}

export function resolveSidebarVisibility(input: {
  hotzoneHovered: boolean;
  panelHovered: boolean;
  expanded: boolean;
  collapseDelayMs: number;
}) {
  if (input.panelHovered || input.hotzoneHovered) {
    return {
      expanded: input.expanded,
      shouldScheduleCollapse: false,
    };
  }
  return {
    expanded: input.expanded,
    shouldScheduleCollapse: input.expanded && input.collapseDelayMs > 0,
  };
}
