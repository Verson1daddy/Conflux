import type { IslandMode } from "@/types";

export type TopIslandVisualState = "active" | "permission" | "idle";
export type FloatBallVisualState = "normal" | "notification" | "error";

export type CompactDetailState =
  | { kind: "none" }
  | { kind: "top_island_popover"; anchor: { x: number; y: number } }
  | { kind: "float_ball_panel" };

export function resolveTopIslandState(input: {
  activeCount: number;
  permissionCount: number;
  unreadCount: number;
}): TopIslandVisualState {
  if (input.permissionCount > 0) return "permission";
  if (input.activeCount > 0 || input.unreadCount > 0) return "active";
  return "idle";
}

export function resolveFloatBallSemanticState(input: {
  unreadCount: number;
  hasError: boolean;
}): FloatBallVisualState {
  if (input.hasError) return "error";
  if (input.unreadCount > 0) return "notification";
  return "normal";
}

export function nextDetailState(input: {
  currentMode: IslandMode;
  currentDetail: CompactDetailState;
  action:
    | { type: "toggle_top_island_popover"; anchor: { x: number; y: number } }
    | { type: "toggle_float_ball_panel" }
    | { type: "close_detail" };
}): CompactDetailState {
  if (input.action.type === "close_detail") return { kind: "none" };
  if (input.action.type === "toggle_top_island_popover") {
    return input.currentDetail.kind === "top_island_popover"
      ? { kind: "none" }
      : { kind: "top_island_popover", anchor: input.action.anchor };
  }
  return input.currentDetail.kind === "float_ball_panel"
    ? { kind: "none" }
    : { kind: "float_ball_panel" };
}

export function resolveSidebarVisibility(input: {
  hotzoneHovered: boolean;
  panelHovered: boolean;
  expanded: boolean;
  collapseDelayMs: number;
}) {
  if (input.panelHovered) {
    return { expanded: true, shouldScheduleCollapse: false };
  }
  if (input.hotzoneHovered) {
    return { expanded: true, shouldScheduleCollapse: true };
  }
  return {
    expanded: input.expanded,
    shouldScheduleCollapse: input.expanded && input.collapseDelayMs > 0,
  };
}
