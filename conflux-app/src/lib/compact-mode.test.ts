import {
  createElement,
  forwardRef,
  type ForwardedRef,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import {
  nextDetailState,
  resolveFloatBallSemanticState,
  resolveSidebarVisibility,
  resolveTopIslandState,
  type CompactDetailState,
} from "./compact-mode";

function SidebarHotzoneMock(props: {
  expanded: boolean;
  onHoverChange: (hovered: boolean) => void;
}) {
  return createElement("sidebar-hotzone", props);
}

function SidebarPanelMock(props: { onCollapse: () => void }) {
  return createElement("sidebar-panel", props);
}

async function renderFloatBallWithIslandState(input: {
  notifications: Array<{ id: string; level: string; read: boolean }>;
  pendingPermissions: Array<{ id: string }>;
  unreadCount: number;
}) {
  vi.resetModules();
  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        notifications: Array<{ id: string; level: string; read: boolean }>;
        pendingPermissions: Array<{ id: string }>;
        unreadCount: number;
      }) => unknown
    ) =>
      selector({
        notifications: input.notifications,
        pendingPermissions: input.pendingPermissions,
        unreadCount: input.unreadCount,
      }),
  }));

  try {
    const { FloatBall } = await import("@/components/island/FloatBall");
    return renderToStaticMarkup(
      createElement(FloatBall, { onExpand: () => undefined })
    );
  } finally {
    vi.doUnmock("@/stores/islandStore");
    vi.resetModules();
  }
}

async function renderCompactModeControllerForSidebarFlow() {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    clearTimeout,
    setTimeout,
  });

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (selector: (state: { mode: string }) => unknown) =>
      selector({ mode: "sidebar" }),
  }));
  vi.doMock("@/lib/tauri-bridge", () => ({
    showWorkspaceOnly: vi.fn(),
  }));
  vi.doMock("@/components/island/SidebarHotzone", () => ({
    SidebarHotzone: SidebarHotzoneMock,
  }));
  vi.doMock("@/components/island/Sidebar", () => ({
    Sidebar: SidebarPanelMock,
  }));
  vi.doMock("@/components/island/IslandSurface", () => ({
    IslandSurface: forwardRef(function IslandSurfaceMock(
      props: { children: ReactNode; mode: string },
      ref: ForwardedRef<unknown>,
    ) {
      return createElement("island-surface", { ref, mode: props.mode }, props.children);
    }),
  }));
  vi.doMock("@/components/island/FloatBall", () => ({
    FloatBall: () => createElement("float-ball"),
  }));
  vi.doMock("@/components/island/FloatBallPanel", () => ({
    FloatBallPanel: () => createElement("float-ball-panel"),
  }));
  vi.doMock("@/components/island/TopIsland", () => ({
    TopIsland: () => createElement("top-island"),
  }));
  vi.doMock("@/components/island/TopIslandPopover", () => ({
    TopIslandPopover: () => createElement("top-island-popover"),
  }));

  try {
    const { CompactModeController } = await import("@/components/island/CompactModeController");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(createElement(CompactModeController));
    });

    return renderer;
  } catch (error) {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.doUnmock("@/components/island/SidebarHotzone");
    vi.doUnmock("@/components/island/Sidebar");
    vi.doUnmock("@/components/island/IslandSurface");
    vi.doUnmock("@/components/island/FloatBall");
    vi.doUnmock("@/components/island/FloatBallPanel");
    vi.doUnmock("@/components/island/TopIsland");
    vi.doUnmock("@/components/island/TopIslandPopover");
    vi.resetModules();
    throw error;
  }
}

function cleanupCompactModeControllerSidebarMocks() {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("@/stores/islandStore");
  vi.doUnmock("@/lib/tauri-bridge");
  vi.doUnmock("@/components/island/SidebarHotzone");
  vi.doUnmock("@/components/island/Sidebar");
  vi.doUnmock("@/components/island/IslandSurface");
  vi.doUnmock("@/components/island/FloatBall");
  vi.doUnmock("@/components/island/FloatBallPanel");
  vi.doUnmock("@/components/island/TopIsland");
  vi.doUnmock("@/components/island/TopIslandPopover");
  vi.resetModules();
}

async function renderTopIslandWithRejectingPermission() {
  vi.resetModules();

  const removePermissionRequest = vi.fn();
  const clearNotification = vi.fn();
  const respondToPermissionMock = vi.fn().mockRejectedValue(new Error("permission failed"));

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        pendingPermissions: Array<{
          id: string;
          instance_id: string;
          action: string;
          description: string;
        }>;
        notifications: Array<{
          id: string;
          level: string;
          read: boolean;
          source_adapter_name: string;
        }>;
        unreadCount: number;
        removePermissionRequest: typeof removePermissionRequest;
        clearNotification: typeof clearNotification;
      }) => unknown
    ) =>
      selector({
        pendingPermissions: [
          {
            id: "perm-1",
            instance_id: "agent-1",
            action: "shell",
            description: "Need approval",
          },
        ],
        notifications: [
          {
            id: "perm-1",
            level: "permission_required",
            read: false,
            source_adapter_name: "Conflux",
          },
        ],
        unreadCount: 1,
        removePermissionRequest,
        clearNotification,
      }),
  }));
  vi.doMock("@/stores/agentStore", () => ({
    useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
      selector({ instances: new Map() }),
  }));
  vi.doMock("@/lib/tauri-bridge", () => ({
    respondToPermission: respondToPermissionMock,
  }));

  try {
    const { TopIsland } = await import("@/components/island/TopIsland");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(TopIsland, { onExpand: () => undefined })
      );
    });

    return {
      clearNotification,
      removePermissionRequest,
      renderer,
      respondToPermissionMock,
    };
  } catch (error) {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.resetModules();
    throw error;
  }
}

function cleanupTopIslandMocks() {
  vi.doUnmock("@/stores/islandStore");
  vi.doUnmock("@/stores/agentStore");
  vi.doUnmock("@/lib/tauri-bridge");
  vi.resetModules();
}

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

  it("renders the real unread notification count in the float ball badge", async () => {
    const html = await renderFloatBallWithIslandState({
      notifications: [
        { id: "notif-1", level: "info", read: false },
        { id: "notif-2", level: "warning", read: false },
      ],
      pendingPermissions: [],
      unreadCount: 0,
    });

    expect(html).toContain('aria-label="Float ball activity count 2"');
    expect(html).toMatch(/<span[^>]*aria-label="Float ball activity count 2"[^>]*>2<\/span>/);
  });

  it("falls back to pending permission count when unread notifications are zero", async () => {
    const html = await renderFloatBallWithIslandState({
      notifications: [],
      pendingPermissions: [{ id: "perm-1" }, { id: "perm-2" }],
      unreadCount: 0,
    });

    expect(html).toContain('aria-label="Float ball activity count 2"');
    expect(html).toMatch(/<span[^>]*aria-label="Float ball activity count 2"[^>]*>2<\/span>/);
  });

  it("adds unmatched pending permissions on top of unread notifications in mixed state", async () => {
    const html = await renderFloatBallWithIslandState({
      notifications: [{ id: "notif-1", level: "info", read: false }],
      pendingPermissions: [{ id: "perm-1" }, { id: "perm-2" }],
      unreadCount: 0,
    });

    expect(html).toContain('aria-label="Float ball activity count 3"');
    expect(html).toMatch(/<span[^>]*aria-label="Float ball activity count 3"[^>]*>3<\/span>/);
  });

  it("does not double count pending permissions already represented by unread permission notifications", async () => {
    const html = await renderFloatBallWithIslandState({
      notifications: [
        { id: "perm-1", level: "permission_required", read: false },
        { id: "perm-2", level: "permission_required", read: false },
      ],
      pendingPermissions: [{ id: "perm-1" }, { id: "perm-2" }],
      unreadCount: 0,
    });

    expect(html).toContain('aria-label="Float ball activity count 2"');
    expect(html).toMatch(/<span[^>]*aria-label="Float ball activity count 2"[^>]*>2<\/span>/);
  });

  it("keeps stale permission notification ids separate from unmatched pending permissions", async () => {
    const html = await renderFloatBallWithIslandState({
      notifications: [
        { id: "notif-stale", level: "permission_required", read: false },
      ],
      pendingPermissions: [{ id: "perm-1" }],
      unreadCount: 0,
    });

    expect(html).toContain('aria-label="Float ball activity count 2"');
    expect(html).toMatch(/<span[^>]*aria-label="Float ball activity count 2"[^>]*>2<\/span>/);
  });

  it("renders a float ball badge for unread error activity", async () => {
    const html = await renderFloatBallWithIslandState({
      notifications: [{ id: "notif-1", level: "error", read: false }],
      pendingPermissions: [],
      unreadCount: 0,
    });

    expect(html).toContain('aria-label="Float ball activity count 1"');
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

  it("collapses the sidebar only after hover leaves and the timeout elapses", async () => {
    const renderer = await renderCompactModeControllerForSidebarFlow();

    try {
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      const panelSensor = renderer.root.find(
        (node) =>
          typeof node.props.onMouseEnter === "function" &&
          typeof node.props.onMouseLeave === "function"
      );

      await act(async () => {
        panelSensor.props.onMouseEnter();
      });
      await act(async () => {
        hotzone.props.onHoverChange(false);
        vi.advanceTimersByTime(160);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      await act(async () => {
        panelSensor.props.onMouseLeave();
      });
      await act(async () => {
        vi.advanceTimersByTime(159);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("auto-collapses after hotzone-only hover without entering the panel", async () => {
    const renderer = await renderCompactModeControllerForSidebarFlow();

    try {
      const sidebarPanel = renderer.root.findByType(SidebarPanelMock);
      await act(async () => {
        sidebarPanel.props.onCollapse();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(159);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("keeps the permission request queued when responding fails", async () => {
    const {
      clearNotification,
      removePermissionRequest,
      renderer,
      respondToPermissionMock,
    } = await renderTopIslandWithRejectingPermission();

    try {
      const allowButton = renderer.root
        .findAllByType("button")
        .find((node) => node.props.children === "Allow");

      expect(allowButton).toBeDefined();

      await act(async () => {
        allowButton?.props.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(respondToPermissionMock).toHaveBeenCalledWith(
        "agent-1",
        "perm-1",
        "approve"
      );
      expect(removePermissionRequest).not.toHaveBeenCalled();
      expect(clearNotification).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupTopIslandMocks();
    }
  });
});
