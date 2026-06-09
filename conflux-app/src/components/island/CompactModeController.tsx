import {
  type FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { onCompactDetailReset } from "@/lib/event-listener";
import {
  setIslandDetailPresentation,
  showWorkspaceOnly,
} from "@/lib/tauri-bridge";
import {
  nextDetailState,
  type CompactDetailState,
  type TopIslandPopoverView,
} from "@/lib/compact-mode";
import { useIslandStore } from "@/stores/islandStore";
import { useActivePermissions } from "@/stores/attentionStore";
import type { IslandMode } from "@/types";
import { IslandSurface } from "./IslandSurface";
import { Sidebar } from "./Sidebar";
import { SidebarHotzone } from "./SidebarHotzone";
import { TopIsland } from "./TopIsland";
import type { TopIslandPresentation } from "./TopIsland";
import { TopIslandPopover } from "./TopIslandPopover";

const SIDEBAR_COLLAPSE_DELAY_MS = 160;

type SidebarIntent =
  | "docked_idle"
  | "docked_hover_open"
  | "docked_pinned_open"
  | "floating_open";

interface SidebarState {
  intent: SidebarIntent;
  panelHovered: boolean;
  collapseArmed: boolean;
  awaitingPointerSync: boolean;
}

type SidebarAction =
  | { type: "sync_mode" }
  | { type: "expand_hover" }
  | { type: "expand_pinned" }
  | { type: "undock" }
  | { type: "set_panel_hovered"; hovered: boolean }
  | { type: "collapse" }
  | { type: "collapse_from_timeout" };

function createSidebarState(): SidebarState {
  return {
    intent: "docked_idle",
    panelHovered: false,
    collapseArmed: false,
    awaitingPointerSync: false,
  };
}

function reduceSidebarState(state: SidebarState, action: SidebarAction): SidebarState {
  switch (action.type) {
    case "sync_mode":
      return createSidebarState();
    case "expand_hover":
      return {
        intent: "docked_hover_open",
        panelHovered: true,
        collapseArmed: false,
        awaitingPointerSync: false,
      };
    case "expand_pinned":
      return {
        intent: "docked_pinned_open",
        panelHovered: true,
        collapseArmed: false,
        awaitingPointerSync: false,
      };
    case "undock":
      return {
        intent: "floating_open",
        panelHovered: true,
        collapseArmed: false,
        awaitingPointerSync: false,
      };
    case "set_panel_hovered":
      if (action.hovered) {
        return {
          ...state,
          panelHovered: true,
          collapseArmed: false,
          awaitingPointerSync: false,
        };
      }
      if (state.intent === "docked_hover_open") {
        return {
          ...state,
          panelHovered: false,
          collapseArmed: true,
          awaitingPointerSync: false,
        };
      }
      return {
        ...state,
        panelHovered: false,
        collapseArmed: false,
        awaitingPointerSync: false,
      };
    case "collapse":
      return createSidebarState();
    case "collapse_from_timeout":
      if (state.intent !== "docked_hover_open" || !state.collapseArmed || state.panelHovered) {
        return state;
      }
      return createSidebarState();
    default:
      return state;
  }
}

export const CompactModeController: FC = () => {
  const mode = useIslandStore((state) => state.mode) as IslandMode;
  // 同源（控制面 P5）：shell 展开闸的"待处理"计数来自 AttentionQueue 投影。
  const pendingPermissionCount = useActivePermissions().length;
  const topIslandUnreadCount = useIslandStore((state) => state.unreadCount);
  const [detail, setDetail] = useState<CompactDetailState>({ kind: "none" });
  const [topIslandPresentation, setTopIslandPresentation] =
    useState<TopIslandPresentation>("collapsed");
  const [sidebar, dispatchSidebar] = useReducer(reduceSidebarState, undefined, createSidebarState);
  const [sidebarWindowExpanded, setSidebarWindowExpanded] = useState(false);
  const [sidebarCloseEpoch, setSidebarCloseEpoch] = useState(0);
  const [topIslandPopoverWindowExpanded, setTopIslandPopoverWindowExpanded] = useState(false);
  const collapseTimeoutRef = useRef<number | null>(null);
  const sidebarPresentationRequestRef = useRef(0);

  const clearSidebarCollapseTimeout = useCallback(() => {
    if (collapseTimeoutRef.current !== null) {
      window.clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  }, []);

  const closeDetail = useCallback(() => {
    setTopIslandPopoverWindowExpanded(false);
    setDetail((currentDetail) =>
      nextDetailState({
        currentMode: mode,
        currentDetail,
        action: { type: "close_detail" },
      })
    );

    if (
      mode === "top_island" &&
      pendingPermissionCount === 0 &&
      topIslandUnreadCount === 0
    ) {
      setTopIslandPresentation("collapsed");
      void setIslandDetailPresentation("none", mode);
    }
  }, [mode, pendingPermissionCount, topIslandUnreadCount]);

  const handleRestoreWorkspace = useCallback(() => {
    closeDetail();
    clearSidebarCollapseTimeout();
    dispatchSidebar({ type: "collapse" });
    setSidebarWindowExpanded(false);
    void showWorkspaceOnly();
  }, [clearSidebarCollapseTimeout, closeDetail]);

  const expandTopIslandShell = useCallback(() => {
    setTopIslandPresentation("expanded");
  }, []);

  const collapseTopIslandShell = useCallback(() => {
    if (
      mode !== "top_island" ||
      detail.kind !== "none" ||
      pendingPermissionCount > 0 ||
      topIslandUnreadCount > 0
    ) {
      return;
    }

    setTopIslandPresentation("collapsed");
    void setIslandDetailPresentation("none", mode);
  }, [detail.kind, mode, pendingPermissionCount, topIslandUnreadCount]);

  const toggleTopIslandPopover = useCallback((anchor: { x: number; y: number }, view: TopIslandPopoverView) => {
    if (detail.kind === "top_island_popover" && detail.view === view) {
      setDetail((currentDetail) =>
        nextDetailState({
          currentMode: mode,
          currentDetail,
          action: { type: "close_detail" },
        })
      );

      if (pendingPermissionCount === 0 && topIslandUnreadCount === 0) {
        setTopIslandPresentation("collapsed");
        void setIslandDetailPresentation("none", mode);
      }
      return;
    }

    setTopIslandPresentation("expanded");
    setDetail((currentDetail) =>
        nextDetailState({
          currentMode: mode,
          currentDetail,
        action: { type: "toggle_top_island_popover", anchor, view },
      })
    );
  }, [detail, mode, pendingPermissionCount, topIslandUnreadCount]);

  const handleTopIslandSnapToMonitor = useCallback(
    (_presentation: TopIslandPresentation) => {
      if (mode !== "top_island") return;

      const detailPresentation =
        detail.kind === "top_island_popover"
          ? "top_island_popover"
          : "none";

      void setIslandDetailPresentation(detailPresentation, mode);
    },
    [detail.kind, mode],
  );

  const sidebarExpanded = sidebar.intent !== "docked_idle";
  const sidebarDocked = sidebar.intent !== "floating_open";
  const showSidebarHotzone = sidebar.intent === "docked_idle";
  const sidebarInteractionState =
    sidebar.intent === "floating_open"
      ? "floating"
      : sidebar.intent === "docked_idle"
        ? "idle"
        : sidebar.panelHovered
          ? "panel"
          : "expanded";
  const effectiveTopIslandPresentation: TopIslandPresentation =
    pendingPermissionCount > 0 || topIslandUnreadCount > 0
      ? "expanded"
      : topIslandPresentation;

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
    dispatchSidebar({ type: "sync_mode" });
    setSidebarWindowExpanded(false);
    setTopIslandPopoverWindowExpanded(false);
    setTopIslandPresentation("collapsed");
  }, [clearSidebarCollapseTimeout, mode]);

  useEffect(() => {
    if (mode !== "sidebar" || !sidebar.collapseArmed || !sidebarWindowExpanded) {
      clearSidebarCollapseTimeout();
      return;
    }

    clearSidebarCollapseTimeout();
    collapseTimeoutRef.current = window.setTimeout(() => {
      dispatchSidebar({ type: "collapse_from_timeout" });
    }, SIDEBAR_COLLAPSE_DELAY_MS);

    return clearSidebarCollapseTimeout;
  }, [clearSidebarCollapseTimeout, mode, sidebar.collapseArmed, sidebarWindowExpanded]);

  useEffect(() => clearSidebarCollapseTimeout, [clearSidebarCollapseTimeout]);

  useEffect(() => {
    if (mode !== "sidebar") {
      return;
    }
    if (!sidebarExpanded) {
      setSidebarWindowExpanded(false);
      setSidebarCloseEpoch((value) => value + 1);
      return;
    }

    const presentation = sidebarDocked ? "sidebar_expanded" : "sidebar_floating";
    const requestId = sidebarPresentationRequestRef.current + 1;
    sidebarPresentationRequestRef.current = requestId;
    setSidebarWindowExpanded(false);

    void setIslandDetailPresentation(presentation, mode)
      .then(() => {
        if (sidebarPresentationRequestRef.current !== requestId) {
          return;
        }
        setSidebarWindowExpanded(true);
      })
      .catch(() => {
        if (sidebarPresentationRequestRef.current !== requestId) {
          return;
        }
        setSidebarWindowExpanded(false);
        dispatchSidebar({ type: "collapse" });
      });
  }, [mode, sidebarDocked, sidebarExpanded]);

  useLayoutEffect(() => {
    if (mode !== "sidebar" || sidebarExpanded) {
      return;
    }
    sidebarPresentationRequestRef.current += 1;
    void setIslandDetailPresentation("none", mode);
  }, [mode, sidebarExpanded]);

  useLayoutEffect(() => {
    if (mode !== "top_island") {
      return;
    }

    const detailPresentation =
      detail.kind === "top_island_popover"
        ? "top_island_popover"
        : "none";

    setTopIslandPopoverWindowExpanded(false);

    let disposed = false;
    void setIslandDetailPresentation(detailPresentation, mode)
      .then(() => {
        if (disposed) {
          return;
        }

        setTopIslandPopoverWindowExpanded(detailPresentation === "top_island_popover");
      })
      .catch(() => {
        if (!disposed) {
          setTopIslandPopoverWindowExpanded(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [detail.kind, mode]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    onCompactDetailReset(() => {
      setDetail({ kind: "none" });
      clearSidebarCollapseTimeout();
      dispatchSidebar({ type: "collapse" });
      setSidebarWindowExpanded(false);
      setTopIslandPopoverWindowExpanded(false);
      setTopIslandPresentation("collapsed");
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [clearSidebarCollapseTimeout]);

  if (mode === "sidebar") {
    return (
      <div data-sidebar-interaction={sidebarInteractionState}>
        {showSidebarHotzone && (
          <SidebarHotzone
            expanded={false}
            onActivate={() => dispatchSidebar({ type: "expand_pinned" })}
            onHoverChange={(hovered) => {
              if (hovered) {
                dispatchSidebar({ type: "expand_hover" });
              }
            }}
          />
        )}
        {sidebarExpanded && sidebarWindowExpanded && (
          sidebarDocked ? (
            <div
              className="sidebar-panel-sensor"
              onPointerEnter={() =>
                dispatchSidebar({ type: "set_panel_hovered", hovered: true })
              }
              onPointerLeave={() =>
                dispatchSidebar({ type: "set_panel_hovered", hovered: false })
              }
              onMouseEnter={() =>
                dispatchSidebar({ type: "set_panel_hovered", hovered: true })
              }
              onMouseLeave={() =>
                dispatchSidebar({ type: "set_panel_hovered", hovered: false })
              }
            >
              <IslandSurface mode={mode}>
                <Sidebar
                  key={`docked-${sidebarCloseEpoch}`}
                  expanded={true}
                  onCollapse={() => dispatchSidebar({ type: "collapse" })}
                  onOpenWorkspace={handleRestoreWorkspace}
                  onUndock={() => dispatchSidebar({ type: "undock" })}
                  onDragStart={() => dispatchSidebar({ type: "undock" })}
                />
              </IslandSurface>
            </div>
          ) : (
            <IslandSurface mode={mode}>
              <Sidebar
                key={`floating-${sidebarCloseEpoch}`}
                expanded={true}
                onCollapse={() => dispatchSidebar({ type: "collapse" })}
                onOpenWorkspace={handleRestoreWorkspace}
              />
            </IslandSurface>
          )
        )}
      </div>
    );
  }

  return (
    <>
      <IslandSurface mode={mode}>
        <TopIsland
          presentation={effectiveTopIslandPresentation}
          onExpandShell={expandTopIslandShell}
          onCollapseShell={collapseTopIslandShell}
          onExpand={toggleTopIslandPopover}
          onSnapToMonitor={handleTopIslandSnapToMonitor}
        />
      </IslandSurface>
      {detail.kind === "top_island_popover" && topIslandPopoverWindowExpanded && (
        <TopIslandPopover
          anchor={detail.anchor}
          view={detail.view}
          onClose={closeDetail}
          onRestoreWorkspace={handleRestoreWorkspace}
        />
      )}
    </>
  );
};
