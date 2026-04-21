import {
  type FC,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { showWorkspaceOnly } from "@/lib/tauri-bridge";
import {
  nextDetailState,
  resolveSidebarVisibility,
  type CompactDetailState,
} from "@/lib/compact-mode";
import { useIslandStore } from "@/stores/islandStore";
import type { IslandMode } from "@/types";
import { FloatBall } from "./FloatBall";
import { FloatBallPanel } from "./FloatBallPanel";
import { IslandSurface } from "./IslandSurface";
import { Sidebar } from "./Sidebar";
import { SidebarHotzone } from "./SidebarHotzone";
import { TopIsland } from "./TopIsland";
import { TopIslandPopover } from "./TopIslandPopover";

const SIDEBAR_COLLAPSE_DELAY_MS = 160;

interface SidebarState {
  expanded: boolean;
  hotzoneHovered: boolean;
  panelHovered: boolean;
  collapseArmed: boolean;
}

type SidebarAction =
  | { type: "sync_mode"; mode: IslandMode }
  | { type: "set_hotzone_hovered"; hovered: boolean }
  | { type: "set_panel_hovered"; hovered: boolean }
  | { type: "collapse" }
  | { type: "collapse_from_timeout" };

function nextSidebarState(base: Omit<SidebarState, "collapseArmed">): SidebarState {
  const visibility = resolveSidebarVisibility({
    hotzoneHovered: base.hotzoneHovered,
    panelHovered: base.panelHovered,
    expanded: base.expanded,
    collapseDelayMs: SIDEBAR_COLLAPSE_DELAY_MS,
  });

  return {
    ...base,
    expanded: visibility.expanded,
    collapseArmed: visibility.shouldScheduleCollapse,
  };
}

function createSidebarState(mode: IslandMode): SidebarState {
  return {
    expanded: mode === "sidebar",
    hotzoneHovered: false,
    panelHovered: false,
    collapseArmed: false,
  };
}

function reduceSidebarState(state: SidebarState, action: SidebarAction): SidebarState {
  switch (action.type) {
    case "sync_mode":
      return createSidebarState(action.mode);
    case "set_hotzone_hovered":
      return nextSidebarState({
        expanded: state.expanded,
        hotzoneHovered: action.hovered,
        panelHovered: state.panelHovered,
      });
    case "set_panel_hovered":
      return nextSidebarState({
        expanded: state.expanded,
        hotzoneHovered: state.hotzoneHovered,
        panelHovered: action.hovered,
      });
    case "collapse":
      return {
        expanded: false,
        hotzoneHovered: false,
        panelHovered: false,
        collapseArmed: false,
      };
    case "collapse_from_timeout":
      if (!state.collapseArmed || state.panelHovered) {
        return state;
      }
      return {
        expanded: false,
        hotzoneHovered: false,
        panelHovered: false,
        collapseArmed: false,
      };
    default:
      return state;
  }
}

export const CompactModeController: FC = () => {
  const mode = useIslandStore((state) => state.mode) as IslandMode;
  const [detail, setDetail] = useState<CompactDetailState>({ kind: "none" });
  const [sidebar, dispatchSidebar] = useReducer(reduceSidebarState, mode, createSidebarState);
  const collapseTimeoutRef = useRef<number | null>(null);

  const clearSidebarCollapseTimeout = useCallback(() => {
    if (collapseTimeoutRef.current !== null) {
      window.clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetail((currentDetail) =>
      nextDetailState({
        currentMode: mode,
        currentDetail,
        action: { type: "close_detail" },
      })
    );
  }, [mode]);

  const handleRestoreWorkspace = useCallback(() => {
    closeDetail();
    clearSidebarCollapseTimeout();
    dispatchSidebar({ type: "collapse" });
    void showWorkspaceOnly();
  }, [clearSidebarCollapseTimeout, closeDetail]);

  const toggleTopIslandPopover = useCallback((anchor: { x: number; y: number }) => {
    setDetail((currentDetail) =>
      nextDetailState({
        currentMode: mode,
        currentDetail,
        action: { type: "toggle_top_island_popover", anchor },
      })
    );
  }, [mode]);

  const toggleFloatBallPanel = useCallback(() => {
    setDetail((currentDetail) =>
      nextDetailState({
        currentMode: mode,
        currentDetail,
        action: { type: "toggle_float_ball_panel" },
      })
    );
  }, [mode]);

  const sidebarInteractionState =
    sidebar.panelHovered ? "panel" : sidebar.hotzoneHovered ? "hotzone" : "idle";

  useEffect(() => {
    setDetail((currentDetail) =>
      currentDetail.kind === "none"
        ? currentDetail
        : nextDetailState({
            currentMode: mode,
            currentDetail,
            action: { type: "close_detail" },
          })
    );

    clearSidebarCollapseTimeout();
    dispatchSidebar({ type: "sync_mode", mode });
  }, [clearSidebarCollapseTimeout, mode]);

  useEffect(() => {
    if (mode !== "sidebar" || !sidebar.collapseArmed) {
      clearSidebarCollapseTimeout();
      return;
    }

    clearSidebarCollapseTimeout();
    collapseTimeoutRef.current = window.setTimeout(() => {
      dispatchSidebar({ type: "collapse_from_timeout" });
    }, SIDEBAR_COLLAPSE_DELAY_MS);

    return clearSidebarCollapseTimeout;
  }, [clearSidebarCollapseTimeout, mode, sidebar.collapseArmed]);

  useEffect(() => clearSidebarCollapseTimeout, [clearSidebarCollapseTimeout]);

  if (mode === "sidebar") {
    return (
      <div data-sidebar-interaction={sidebarInteractionState}>
        <SidebarHotzone
          expanded={sidebar.expanded}
          onHoverChange={(hovered) =>
            dispatchSidebar({ type: "set_hotzone_hovered", hovered })
          }
        />
        {sidebar.expanded && (
          <div
            onMouseEnter={() =>
              dispatchSidebar({ type: "set_panel_hovered", hovered: true })
            }
            onMouseLeave={() =>
              dispatchSidebar({ type: "set_panel_hovered", hovered: false })
            }
          >
            <IslandSurface mode={mode}>
              <Sidebar onCollapse={() => dispatchSidebar({ type: "collapse" })} />
            </IslandSurface>
          </div>
        )}
      </div>
    );
  }

  if (mode === "float_ball") {
    return (
      <>
        <IslandSurface mode={mode}>
          <FloatBall onToggleDetail={toggleFloatBallPanel} />
        </IslandSurface>
        {detail.kind === "float_ball_panel" && (
          <FloatBallPanel
            onClose={closeDetail}
            onOpenWorkspace={handleRestoreWorkspace}
          />
        )}
      </>
    );
  }

  return (
    <>
      <IslandSurface mode={mode}>
        <TopIsland onExpand={toggleTopIslandPopover} />
      </IslandSurface>
      {detail.kind === "top_island_popover" && (
        <TopIslandPopover
          anchor={detail.anchor}
          onClose={closeDetail}
          onRestoreWorkspace={handleRestoreWorkspace}
        />
      )}
    </>
  );
};
