import {
  createElement,
  forwardRef,
  type ForwardedRef,
  type ReactNode,
  useImperativeHandle,
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

function TopIslandPopoverMock(props: {
  anchor: { x: number; y: number };
  onClose: () => void;
  onRestoreWorkspace: () => void;
}) {
  return createElement("top-island-popover", props);
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
      createElement(FloatBall, { onToggleDetail: () => undefined })
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

  const setMode = vi.fn();

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (selector: (state: { mode: string; setMode: typeof setMode }) => unknown) =>
      selector({ mode: "sidebar", setMode }),
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

    return { renderer, setMode };
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

async function renderSidebarAssistantPanel(input: {
  notifications: Array<{
    id: string;
    level: string;
    read: boolean;
    content?: string;
    created_at: number;
    source_instance_id: string;
  }>;
  instances?: Map<string, unknown>;
}) {
  vi.resetModules();

  const focusAgentCard = vi.fn();
  const respondToPermissionMock = vi.fn().mockResolvedValue(undefined);
  const removePermissionRequest = vi.fn();
  const clearNotification = vi.fn();
  const onDismiss = vi.fn();
  const onOpenWorkspace = vi.fn();

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        notifications: typeof input.notifications;
        removePermissionRequest: typeof removePermissionRequest;
        clearNotification: typeof clearNotification;
      }) => unknown
    ) =>
      selector({
        notifications: input.notifications,
        removePermissionRequest,
        clearNotification,
      }),
  }));
  vi.doMock("@/stores/agentStore", () => ({
    agentDisplayLabel: (agent: { name?: string; instance_id: string }) =>
      agent.name ?? agent.instance_id,
    useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
      selector({
        instances:
          input.instances ??
          new Map([
            [
              "agent-1",
              {
                instance_id: "agent-1",
                name: "Research Alpha",
                created_at: Date.now() - 25_000,
                status: "coding",
              },
            ],
          ]),
      }),
  }));
  vi.doMock("@/lib/tauri-bridge", () => ({
    focusAgentCard,
    respondToPermission: respondToPermissionMock,
  }));

  try {
    const { Sidebar } = await import("@/components/island/Sidebar");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: onDismiss,
          onOpenWorkspace,
        })
      );
    });

    return {
      clearNotification,
      focusAgentCard,
      onDismiss,
      onOpenWorkspace,
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

function cleanupSidebarAssistantPanelMocks() {
  vi.doUnmock("@/stores/islandStore");
  vi.doUnmock("@/stores/agentStore");
  vi.doUnmock("@/lib/tauri-bridge");
  vi.resetModules();
}

async function renderCompactModeControllerForTopIslandFlow() {
  vi.resetModules();

  const setMode = vi.fn();

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        mode: string;
        setMode: typeof setMode;
        pendingPermissions: [];
        notifications: [];
        unreadCount: number;
        removePermissionRequest: ReturnType<typeof vi.fn>;
        clearNotification: ReturnType<typeof vi.fn>;
      }) => unknown
    ) =>
      selector({
        mode: "top_island",
        setMode,
        pendingPermissions: [],
        notifications: [],
        unreadCount: 0,
        removePermissionRequest: vi.fn(),
        clearNotification: vi.fn(),
      }),
  }));
  vi.doMock("@/stores/agentStore", () => ({
    useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
      selector({ instances: new Map() }),
  }));
  vi.doMock("@/lib/tauri-bridge", () => ({
    respondToPermission: vi.fn(),
    showWorkspaceOnly: vi.fn(),
  }));
  vi.doMock("@/components/island/IslandSurface", () => ({
    IslandSurface: forwardRef(function IslandSurfaceMock(
      props: { children: ReactNode; mode: string },
      ref: ForwardedRef<unknown>,
    ) {
      useImperativeHandle(ref, () => ({
        getBoundingClientRect: () => ({
          left: 100,
          top: 20,
          width: 400,
          height: 40,
        }),
      }));

      return createElement("island-surface", { mode: props.mode }, props.children);
    }),
  }));
  vi.doMock("@/components/island/FloatBall", () => ({
    FloatBall: () => createElement("float-ball"),
  }));
  vi.doMock("@/components/island/FloatBallPanel", () => ({
    FloatBallPanel: () => createElement("float-ball-panel"),
  }));
  vi.doMock("@/components/island/SidebarHotzone", () => ({
    SidebarHotzone: SidebarHotzoneMock,
  }));
  vi.doMock("@/components/island/Sidebar", () => ({
    Sidebar: SidebarPanelMock,
  }));
  vi.doMock("@/components/island/TopIslandPopover", () => ({
    TopIslandPopover: TopIslandPopoverMock,
  }));

  try {
    const { CompactModeController } = await import("@/components/island/CompactModeController");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(createElement(CompactModeController));
    });

    return { renderer, setMode };
  } catch (error) {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.doUnmock("@/components/island/IslandSurface");
    vi.doUnmock("@/components/island/FloatBall");
    vi.doUnmock("@/components/island/FloatBallPanel");
    vi.doUnmock("@/components/island/SidebarHotzone");
    vi.doUnmock("@/components/island/Sidebar");
    vi.doUnmock("@/components/island/TopIslandPopover");
    vi.resetModules();
    throw error;
  }
}

function cleanupCompactModeControllerTopIslandMocks() {
  vi.doUnmock("@/stores/islandStore");
  vi.doUnmock("@/stores/agentStore");
  vi.doUnmock("@/lib/tauri-bridge");
  vi.doUnmock("@/components/island/IslandSurface");
  vi.doUnmock("@/components/island/FloatBall");
  vi.doUnmock("@/components/island/FloatBallPanel");
  vi.doUnmock("@/components/island/SidebarHotzone");
  vi.doUnmock("@/components/island/Sidebar");
  vi.doUnmock("@/components/island/TopIslandPopover");
  vi.resetModules();
}

async function renderCompactModeControllerForFloatBallFlow(input: {
  notifications: Array<{
    id: string;
    level: string;
    read: boolean;
    source_adapter_name?: string;
    content?: string;
  }>;
  pendingPermissions: Array<{
    id: string;
    instance_id: string;
    action: string;
    description: string;
  }>;
  unreadCount: number;
}) {
  vi.resetModules();

  const setMode = vi.fn();
  const showWorkspaceOnly = vi.fn();

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        mode: string;
        setMode: typeof setMode;
        notifications: typeof input.notifications;
        pendingPermissions: typeof input.pendingPermissions;
        unreadCount: number;
      }) => unknown
    ) =>
      selector({
        mode: "float_ball",
        setMode,
        notifications: input.notifications,
        pendingPermissions: input.pendingPermissions,
        unreadCount: input.unreadCount,
      }),
  }));
  vi.doMock("@/lib/tauri-bridge", () => ({
    showWorkspaceOnly,
  }));
  vi.doMock("@/components/island/TopIsland", () => ({
    TopIsland: () => createElement("top-island"),
  }));
  vi.doMock("@/components/island/TopIslandPopover", () => ({
    TopIslandPopover: () => createElement("top-island-popover"),
  }));
  vi.doMock("@/components/island/SidebarHotzone", () => ({
    SidebarHotzone: SidebarHotzoneMock,
  }));
  vi.doMock("@/components/island/Sidebar", () => ({
    Sidebar: SidebarPanelMock,
  }));

  try {
    const { CompactModeController } = await import("@/components/island/CompactModeController");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(createElement(CompactModeController));
    });

    return { renderer, setMode, showWorkspaceOnly };
  } catch (error) {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.doUnmock("@/components/island/TopIsland");
    vi.doUnmock("@/components/island/TopIslandPopover");
    vi.doUnmock("@/components/island/SidebarHotzone");
    vi.doUnmock("@/components/island/Sidebar");
    vi.resetModules();
    throw error;
  }
}

function cleanupCompactModeControllerFloatBallMocks() {
  vi.doUnmock("@/stores/islandStore");
  vi.doUnmock("@/lib/tauri-bridge");
  vi.doUnmock("@/components/island/TopIsland");
  vi.doUnmock("@/components/island/TopIslandPopover");
  vi.doUnmock("@/components/island/SidebarHotzone");
  vi.doUnmock("@/components/island/Sidebar");
  vi.resetModules();
}

async function renderTopIslandPopoverWithIslandState(input: {
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
    content?: string;
  }>;
  unreadCount: number;
  activeStatuses?: Array<"thinking" | "coding" | "waiting_permission" | "idle">;
  respondToPermissionMock?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const removePermissionRequest = vi.fn();
  const clearNotification = vi.fn();
  const respondToPermissionMock =
    input.respondToPermissionMock ?? vi.fn().mockResolvedValue(undefined);

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
          content?: string;
        }>;
        unreadCount: number;
        removePermissionRequest: typeof removePermissionRequest;
        clearNotification: typeof clearNotification;
      }) => unknown
    ) =>
      selector({
        pendingPermissions: input.pendingPermissions,
        notifications: input.notifications,
        unreadCount: input.unreadCount,
        removePermissionRequest,
        clearNotification,
      }),
  }));
  vi.doMock("@/stores/agentStore", () => ({
    useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
      selector({
        instances: new Map(
          (input.activeStatuses ?? []).map((status, index) => [
            `agent-${index}`,
            { status },
          ])
        ),
      }),
  }));
  vi.doMock("@/lib/tauri-bridge", () => ({
    respondToPermission: respondToPermissionMock,
  }));

  try {
    const { TopIslandPopover } = await import("@/components/island/TopIslandPopover");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(TopIslandPopover, {
          anchor: { x: 320, y: 180 },
          onClose: () => undefined,
          onRestoreWorkspace: () => undefined,
        })
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

  it("toggles the top island popover at the provided cursor anchor", () => {
    const opened = nextDetailState({
      currentMode: "top_island",
      currentDetail: { kind: "none" },
      action: { type: "toggle_top_island_popover", anchor: { x: 700, y: 52 } },
    });
    const closed = nextDetailState({
      currentMode: "top_island",
      currentDetail: opened,
      action: { type: "toggle_top_island_popover", anchor: { x: 700, y: 52 } },
    });

    expect(opened).toEqual({
      kind: "top_island_popover",
      anchor: { x: 700, y: 52 },
    });
    expect(closed).toEqual({ kind: "none" });
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

  it("prefers error state over notification state for the float ball", () => {
    expect(resolveFloatBallSemanticState({ unreadCount: 3, hasError: true })).toBe("error");
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

  it("clicking dynamic island only toggles its popover and keeps mode stable", async () => {
    const { renderer, setMode } = await renderCompactModeControllerForTopIslandFlow();

    try {
      const topIslandButton = renderer.root.findByType("button");

      await act(async () => {
        topIslandButton.props.onClick({ clientX: 250, clientY: 120 });
      });

      const popover = renderer.root.findByType(TopIslandPopoverMock);
      expect(popover.props.anchor).toEqual({ x: 262, y: 108 });
      expect(setMode).not.toHaveBeenCalled();

      await act(async () => {
        topIslandButton.props.onClick({ clientX: 250, clientY: 120 });
      });

      expect(renderer.root.findAllByType(TopIslandPopoverMock)).toHaveLength(0);
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerTopIslandMocks();
    }
  });

  it("clicking float ball only toggles its own panel and keeps mode stable", async () => {
    const { renderer, setMode, showWorkspaceOnly } = await renderCompactModeControllerForFloatBallFlow({
      notifications: [
        {
          id: "notif-error",
          level: "error",
          read: false,
          source_adapter_name: "Codex",
          content: "Agent failed to continue",
        },
      ],
      pendingPermissions: [
        {
          id: "perm-shell",
          instance_id: "agent-7",
          action: "shell",
          description: "Approve shell command",
        },
      ],
      unreadCount: 1,
    });

    try {
      const floatBallButton = renderer.root.findByProps({
        "aria-label": "Open float ball details",
      });

      expect(renderer.root.findAllByProps({ "data-testid": "float-ball-panel" })).toHaveLength(0);

      await act(async () => {
        floatBallButton.props.onClick();
      });

      const panel = renderer.root.findByProps({ "data-testid": "float-ball-panel" });
      expect(panel).toBeDefined();
      expect(setMode).not.toHaveBeenCalled();
      expect(JSON.stringify(renderer.toJSON())).toContain("Status summary");
      expect(JSON.stringify(renderer.toJSON())).toContain("Recent activity");
      expect(JSON.stringify(renderer.toJSON())).toContain("Approve shell command");
      expect(JSON.stringify(renderer.toJSON())).toContain("Agent failed to continue");
      expect(JSON.stringify(renderer.toJSON())).toContain("Open Workspace");
      expect(JSON.stringify(renderer.toJSON())).toContain("Dismiss");

      await act(async () => {
        floatBallButton.props.onClick();
      });

      expect(renderer.root.findAllByProps({ "data-testid": "float-ball-panel" })).toHaveLength(0);
      expect(setMode).not.toHaveBeenCalled();

      await act(async () => {
        floatBallButton.props.onClick();
      });

      const openWorkspaceButton = renderer.root
        .findAllByType("button")
        .find((node) => node.props.children === "Open Workspace");
      expect(openWorkspaceButton).toBeDefined();

      await act(async () => {
        openWorkspaceButton?.props.onClick();
      });

      expect(showWorkspaceOnly).toHaveBeenCalledTimes(1);
      expect(renderer.root.findAllByProps({ "data-testid": "float-ball-panel" })).toHaveLength(0);
      expect(setMode).not.toHaveBeenCalled();

      await act(async () => {
        floatBallButton.props.onClick();
      });

      const dismissButton = renderer.root
        .findAllByType("button")
        .find((node) => node.props.children === "Dismiss");
      expect(dismissButton).toBeDefined();

      await act(async () => {
        dismissButton?.props.onClick();
      });

      expect(renderer.root.findAllByProps({ "data-testid": "float-ball-panel" })).toHaveLength(0);
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerFloatBallMocks();
    }
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
    const { renderer, setMode } = await renderCompactModeControllerForSidebarFlow();

    try {
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      expect(setMode).not.toHaveBeenCalled();
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

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
      expect(setMode).not.toHaveBeenCalled();

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
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("auto-collapses after hotzone-only hover without entering the panel", async () => {
    const { renderer, setMode } = await renderCompactModeControllerForSidebarFlow();

    try {
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
      expect(setMode).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(159);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("renders sidebar as a compact assistant panel with explicit workspace and dismiss actions", async () => {
    const {
      onDismiss,
      onOpenWorkspace,
      renderer,
    } = await renderSidebarAssistantPanel({
      notifications: [
        {
          id: "notif-1",
          level: "info",
          read: false,
          content: "Workspace sync is ready",
          created_at: Date.now() - 60_000,
          source_instance_id: "agent-1",
        },
      ],
    });

    try {
      const json = JSON.stringify(renderer.toJSON());
      expect(json).toContain("Assistant");
      expect(json).toContain("Open Workspace");
      expect(json).toContain("Dismiss");
      expect(json).toContain("Agents");
      expect(json).toContain("Notifications");

      const buttons = renderer.root.findAllByType("button");
      const openWorkspaceButton = buttons.find(
        (node) => node.props.children === "Open Workspace"
      );
      const dismissButton = buttons.find((node) => node.props.children === "Dismiss");

      expect(openWorkspaceButton).toBeDefined();
      expect(dismissButton).toBeDefined();

      await act(async () => {
        openWorkspaceButton?.props.onClick();
      });
      await act(async () => {
        dismissButton?.props.onClick();
      });

      expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupSidebarAssistantPanelMocks();
    }
  });

  it("renders a contextual top island popover using the provided anchor", async () => {
    const { renderer } = await renderTopIslandPopoverWithIslandState({
      pendingPermissions: [],
      notifications: [
        {
          id: "notif-1",
          level: "info",
          read: false,
          source_adapter_name: "Conflux",
          content: "Workspace ready",
        },
      ],
      unreadCount: 1,
      activeStatuses: ["thinking"],
    });

    try {
      const popoverRoot = renderer.root.find(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("top-island-popover")
      );
      const buttonLabels = renderer.root
        .findAllByType("button")
        .map((node) => node.props.children)
        .filter((child) => typeof child === "string");

      expect(popoverRoot.props.style.left).toBe(320);
      expect(popoverRoot.props.style.top).toBe(180);
      expect(buttonLabels).toContain("Open Workspace");
      expect(buttonLabels).toContain("Dismiss");
      expect(JSON.stringify(renderer.toJSON())).toContain("Mode");
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupTopIslandMocks();
    }
  });

  it("keeps the permission request queued when responding fails", async () => {
    const {
      clearNotification,
      removePermissionRequest,
      renderer,
      respondToPermissionMock,
    } = await renderTopIslandPopoverWithIslandState({
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
      respondToPermissionMock: vi.fn().mockRejectedValue(new Error("permission failed")),
    });

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
