import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { showWorkspaceOnly } from "@/lib/tauri-bridge";
import {
  nextDetailState,
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
  const surfaceRef = useRef<HTMLDivElement | null>(null);

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
    setSidebarExpanded(false);
    void showWorkspaceOnly();
  }, [closeDetail]);

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

  const handleSidebarExpandedChange = useCallback((expanded: boolean) => {
    setSidebarExpanded(expanded);
  }, []);

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

    setSidebarExpanded(mode === "sidebar");
  }, [mode]);

  if (mode === "sidebar") {
    return (
      <>
        <SidebarHotzone
          expanded={sidebarExpanded}
          onExpandedChange={handleSidebarExpandedChange}
        />
        {sidebarExpanded && (
          <IslandSurface ref={surfaceRef} mode={mode}>
            <Sidebar onCollapse={() => setSidebarExpanded(false)} />
          </IslandSurface>
        )}
      </>
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
