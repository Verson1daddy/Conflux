import { type FC, useCallback, useEffect, useRef, useState } from "react";
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

function anchorFromSurface(
  surface: HTMLDivElement | null,
  fallback: { x: number; y: number },
) {
  if (!surface) {
    return fallback;
  }

  const rect = surface.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + Math.min(rect.height, 52),
  };
}

export const CompactModeController: FC = () => {
  const mode = useIslandStore((state) => state.mode) as IslandMode;
  const [detail, setDetail] = useState<CompactDetailState>({ kind: "none" });
  const [sidebarExpanded, setSidebarExpanded] = useState(mode === "sidebar");
  const [hotzoneHovered, setHotzoneHovered] = useState(false);
  const [panelHovered, setPanelHovered] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const collapseTimeoutRef = useRef<number | null>(null);
  const sidebarExpandedRef = useRef(mode === "sidebar");
  const hotzoneHoveredRef = useRef(false);
  const panelHoveredRef = useRef(false);

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
    hotzoneHoveredRef.current = false;
    panelHoveredRef.current = false;
    sidebarExpandedRef.current = false;
    setHotzoneHovered(false);
    setPanelHovered(false);
    setSidebarExpanded(false);
    void showWorkspaceOnly();
  }, [clearSidebarCollapseTimeout, closeDetail]);

  const toggleTopIslandPopover = useCallback(() => {
    const anchor = anchorFromSurface(surfaceRef.current, { x: 420, y: 48 });
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

  const applySidebarVisibility = useCallback(
    (nextHotzoneHovered: boolean, nextPanelHovered: boolean) => {
      hotzoneHoveredRef.current = nextHotzoneHovered;
      panelHoveredRef.current = nextPanelHovered;
      setHotzoneHovered(nextHotzoneHovered);
      setPanelHovered(nextPanelHovered);

      if (mode !== "sidebar") {
        return;
      }

      const next = resolveSidebarVisibility({
        hotzoneHovered: nextHotzoneHovered,
        panelHovered: nextPanelHovered,
        expanded: sidebarExpandedRef.current,
        collapseDelayMs: SIDEBAR_COLLAPSE_DELAY_MS,
      });

      if (next.expanded !== sidebarExpandedRef.current) {
        sidebarExpandedRef.current = next.expanded;
        setSidebarExpanded(next.expanded);
      }

      clearSidebarCollapseTimeout();
      if (!next.shouldScheduleCollapse) {
        return;
      }

      collapseTimeoutRef.current = window.setTimeout(() => {
        if (!hotzoneHoveredRef.current && !panelHoveredRef.current) {
          sidebarExpandedRef.current = false;
          setSidebarExpanded(false);
        }
      }, SIDEBAR_COLLAPSE_DELAY_MS);
    },
    [clearSidebarCollapseTimeout, mode]
  );

  const handleSidebarHoverChange = useCallback(
    (hovered: boolean) => {
      applySidebarVisibility(hovered, panelHoveredRef.current);
    },
    [applySidebarVisibility]
  );

  const handleSidebarPanelHoverChange = useCallback(
    (hovered: boolean) => {
      applySidebarVisibility(hotzoneHoveredRef.current, hovered);
    },
    [applySidebarVisibility]
  );

  const handleSidebarCollapse = useCallback(() => {
    clearSidebarCollapseTimeout();
    hotzoneHoveredRef.current = false;
    panelHoveredRef.current = false;
    sidebarExpandedRef.current = false;
    setHotzoneHovered(false);
    setPanelHovered(false);
    setSidebarExpanded(false);
  }, [clearSidebarCollapseTimeout]);

  const sidebarInteractionState =
    panelHovered ? "panel" : hotzoneHovered ? "hotzone" : "idle";

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
    hotzoneHoveredRef.current = false;
    panelHoveredRef.current = false;
    sidebarExpandedRef.current = mode === "sidebar";
    setHotzoneHovered(false);
    setPanelHovered(false);
    setSidebarExpanded(mode === "sidebar");
  }, [clearSidebarCollapseTimeout, mode]);

  useEffect(() => clearSidebarCollapseTimeout, [clearSidebarCollapseTimeout]);

  if (mode === "sidebar") {
    return (
      <div data-sidebar-interaction={sidebarInteractionState}>
        <SidebarHotzone
          expanded={sidebarExpanded}
          onHoverChange={handleSidebarHoverChange}
        />
        {sidebarExpanded && (
          <div
            onMouseEnter={() => handleSidebarPanelHoverChange(true)}
            onMouseLeave={() => handleSidebarPanelHoverChange(false)}
          >
            <IslandSurface ref={surfaceRef} mode={mode}>
              <Sidebar onCollapse={handleSidebarCollapse} />
            </IslandSurface>
          </div>
        )}
      </div>
    );
  }

  if (mode === "float_ball") {
    return (
      <>
        <IslandSurface ref={surfaceRef} mode={mode}>
          <FloatBall onExpand={toggleFloatBallPanel} />
        </IslandSurface>
        {detail.kind === "float_ball_panel" && (
          <FloatBallPanel
            onClose={closeDetail}
            onRestoreWorkspace={handleRestoreWorkspace}
          />
        )}
      </>
    );
  }

  return (
    <>
      <IslandSurface ref={surfaceRef} mode={mode}>
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
