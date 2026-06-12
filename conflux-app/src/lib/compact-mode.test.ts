import {
  createElement,
  forwardRef,
  type ForwardedRef,
  type ReactNode,
  useImperativeHandle,
} from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import {
  nextDetailState,
  resolveSidebarVisibility,
  resolveTopIslandState,
  type CompactDetailState,
} from "./compact-mode";
import { COMPACT_WINDOW_METRICS } from "./compact-window-metrics";
import type { AttentionItem } from "@/types/interaction";

// 控制面 P5：权限态从后端 AttentionQueue 投影（attentionStore），不再走 islandStore。
// 把测试里的轻量权限规格映射成后端 AttentionItem 形状。
interface PermissionSpec {
  id: string;
  instance_id?: string;
  action?: string;
  description?: string;
  content?: string;
  created_at?: number;
  raw_context?: string[];
  timeout_seconds?: number;
}

function permissionAttentionItem(spec: PermissionSpec): AttentionItem {
  return {
    attention_item_id: `attn-${spec.id}`,
    instance_id: spec.instance_id ?? "agent-1",
    kind: "permission",
    priority: "Critical",
    source_event_id: null,
    interaction_id: spec.id,
    payload_summary: spec.description ?? spec.action ?? spec.content ?? "",
    available_actions: ["approve", "deny"],
    jump_back_target_id: null,
    created_at: spec.created_at ?? 1000,
    resolved_at: null,
    resolution: null,
    audit_event_id: null,
    permission_context: spec.raw_context ?? null,
    timeout_seconds: spec.timeout_seconds ?? null,
    remind_at: null,
    signal_source: null,
  };
}

/** 装上 attentionStore 投影 mock（useActivePermissions 等 selector 直接返回映射后的活跃项）。 */
function mockAttentionStore(specs?: PermissionSpec[]) {
  const items = (specs ?? []).map(permissionAttentionItem);
  vi.doMock("@/stores/attentionStore", () => ({
    useActivePermissions: () => items,
    useActiveAttentionItems: () => items,
    useActiveAttentionCount: () => items.length,
    useDeferredAttentionItems: () => [],
  }));
}

function SidebarHotzoneMock(props: {
  expanded: boolean;
  onHoverChange: (hovered: boolean) => void;
  onActivate: () => void;
}) {
  return createElement("sidebar-hotzone", props);
}

function SidebarPanelMock(props: {
  onCollapse: () => void;
  onOpenWorkspace?: () => void;
  onUndock?: () => void;
  onDragStart?: () => void;
}) {
  return createElement("sidebar-panel", props);
}

function TopIslandPopoverMock(props: {
  anchor: { x: number; y: number };
  view: "details" | "notifications" | "quick_reply";
  onClose: () => void;
  onRestoreWorkspace: () => void;
}) {
  return createElement("top-island-popover", props);
}

function classNameIncludes(value: unknown, token: string): boolean {
  return typeof value === "string" && value.split(/\s+/).includes(token);
}

async function renderTopIslandWithIslandState(input: {
  notifications: Array<{
    id: string;
    level: string;
    read: boolean;
    source_adapter_name?: string;
    content?: string;
  }>;
  pendingPermissions: Array<{ id: string }>;
  unreadCount: number;
  instances?: Map<
    string,
    { status: "thinking" | "coding" | "waiting_permission" | "idle" }
  >;
  presentation?: "collapsed" | "expanded";
  onExpand?: (
    anchor: { x: number; y: number },
    view: "details" | "notifications" | "quick_reply"
  ) => void;
  onSnapToMonitor?: (presentation: "collapsed" | "expanded") => void;
}) {
  vi.resetModules();
  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        notifications: typeof input.notifications;
        pendingPermissions: typeof input.pendingPermissions;
        unreadCount: number;
      }) => unknown
    ) =>
      selector({
        notifications: input.notifications,
        pendingPermissions: input.pendingPermissions,
        unreadCount: input.unreadCount,
      }),
  }));
  vi.doMock("@/stores/agentStore", () => ({
    useAgentStore: (
      selector: (state: { instances: typeof input.instances }) => unknown
    ) =>
      selector({
        instances: input.instances ?? new Map(),
      }),
  }));
  mockAttentionStore(input.pendingPermissions);

  try {
    const { TopIsland } = await import("@/components/island/TopIsland");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(TopIsland, {
          presentation: input.presentation,
          onExpand: input.onExpand ?? (() => undefined),
          onSnapToMonitor: input.onSnapToMonitor,
        })
      );
    });

    return renderer;
  } finally {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/stores/attentionStore");
    vi.resetModules();
  }
}

async function renderCompactModeControllerForSidebarFlow(input?: {
  setIslandDetailPresentation?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    clearTimeout,
    setTimeout,
  });

  const setMode = vi.fn();
  const showWorkspaceOnly = vi.fn();
  const setIslandDetailPresentation =
    input?.setIslandDetailPresentation ?? vi.fn().mockResolvedValue(undefined);

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        mode: string;
        setMode: typeof setMode;
        pendingPermissions: [];
        unreadCount: number;
      }) => unknown
    ) =>
      selector({
        mode: "sidebar",
        setMode,
        pendingPermissions: [],
        unreadCount: 0,
      }),
  }));
  vi.doMock("@/lib/tauri-bridge", () => ({
    setIslandDetailPresentation,
    showWorkspaceOnly,
  }));
  vi.doMock("@/lib/event-listener", () => ({
    onCompactDetailReset: vi.fn().mockResolvedValue(() => undefined),
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

    return { renderer, setIslandDetailPresentation, setMode, showWorkspaceOnly };
  } catch (error) {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.doUnmock("@/lib/event-listener");
    vi.doUnmock("@/components/island/SidebarHotzone");
    vi.doUnmock("@/components/island/Sidebar");
    vi.doUnmock("@/components/island/IslandSurface");
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
  vi.doUnmock("@/lib/event-listener");
  vi.doUnmock("@/components/island/SidebarHotzone");
  vi.doUnmock("@/components/island/Sidebar");
  vi.doUnmock("@/components/island/IslandSurface");
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
  permissions?: PermissionSpec[];
  instances?: Map<string, unknown>;
  respondToPermissionMock?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const focusAgentCard = vi.fn();
  const respondToPermissionMock =
    input.respondToPermissionMock ?? vi.fn().mockResolvedValue(undefined);
  const clearNotification = vi.fn();
  const onDismiss = vi.fn();
  const onOpenWorkspace = vi.fn();

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        notifications: typeof input.notifications;
        clearNotification: typeof clearNotification;
      }) => unknown
    ) =>
      selector({
        notifications: input.notifications,
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
  mockAttentionStore(input.permissions);
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
      renderer,
      respondToPermissionMock,
    };
  } catch (error) {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/stores/attentionStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.resetModules();
    throw error;
  }
}

function cleanupSidebarAssistantPanelMocks() {
  vi.doUnmock("@/stores/islandStore");
  vi.doUnmock("@/stores/agentStore");
  vi.doUnmock("@/stores/attentionStore");
  vi.doUnmock("@/lib/tauri-bridge");
  vi.resetModules();
}

async function renderSidebarWithIslandState(input: {
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
  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        notifications: typeof input.notifications;
        removePermissionRequest: ReturnType<typeof vi.fn>;
        clearNotification: ReturnType<typeof vi.fn>;
      }) => unknown
    ) =>
      selector({
        notifications: input.notifications,
        removePermissionRequest: vi.fn(),
        clearNotification: vi.fn(),
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
  mockAttentionStore();
  vi.doMock("@/lib/tauri-bridge", () => ({
    focusAgentCard: vi.fn(),
    respondToPermission: vi.fn(),
  }));

  try {
    const { Sidebar } = await import("@/components/island/Sidebar");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: () => undefined,
          onOpenWorkspace: () => undefined,
        })
      );
    });

    return renderer;
  } finally {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/stores/attentionStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.resetModules();
  }
}

async function renderCompactModeControllerForTopIslandFlow(input?: {
  notifications?: Array<{ id: string; level: string; read: boolean }>;
  pendingPermissions?: Array<{ id: string }>;
  unreadCount?: number;
  setIslandDetailPresentation?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  vi.stubGlobal("window", {
    clearTimeout,
    setTimeout,
  });

  const setMode = vi.fn();
  const setIslandDetailPresentation =
    input?.setIslandDetailPresentation ?? vi.fn().mockResolvedValue(undefined);
  const notifications = input?.notifications ?? [];
  const pendingPermissions = input?.pendingPermissions ?? [];
  const unreadCount = input?.unreadCount ?? 0;

  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        mode: string;
        setMode: typeof setMode;
        pendingPermissions: typeof pendingPermissions;
        notifications: typeof notifications;
        unreadCount: number;
        removePermissionRequest: ReturnType<typeof vi.fn>;
        clearNotification: ReturnType<typeof vi.fn>;
      }) => unknown
    ) =>
      selector({
        mode: "top_island",
        setMode,
        pendingPermissions,
        notifications,
        unreadCount,
        removePermissionRequest: vi.fn(),
        clearNotification: vi.fn(),
      }),
  }));
  vi.doMock("@/stores/agentStore", () => ({
    useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
      selector({ instances: new Map() }),
  }));
  mockAttentionStore(pendingPermissions);
  vi.doMock("@/lib/tauri-bridge", () => ({
    respondToPermission: vi.fn(),
    setIslandDetailPresentation,
    showWorkspaceOnly: vi.fn(),
  }));
  vi.doMock("@/lib/event-listener", () => ({
    onCompactDetailReset: vi.fn().mockResolvedValue(() => undefined),
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

    return { renderer, setIslandDetailPresentation, setMode };
  } catch (error) {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/stores/attentionStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.doUnmock("@/lib/event-listener");
    vi.doUnmock("@/components/island/IslandSurface");
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
  vi.doUnmock("@/stores/attentionStore");
  vi.doUnmock("@/lib/tauri-bridge");
  vi.doUnmock("@/lib/event-listener");
  vi.doUnmock("@/components/island/IslandSurface");
  vi.doUnmock("@/components/island/SidebarHotzone");
  vi.doUnmock("@/components/island/Sidebar");
  vi.doUnmock("@/components/island/TopIslandPopover");
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
  view?: "details" | "notifications" | "quick_reply";
  anchor?: { x: number; y: number };
  viewport?: { innerWidth: number; innerHeight: number };
  respondToPermissionMock?: ReturnType<typeof vi.fn>;
  onClose?: () => void;
}) {
  vi.resetModules();

  if (input.viewport) {
    vi.stubGlobal("window", {
      innerWidth: input.viewport.innerWidth,
      innerHeight: input.viewport.innerHeight,
    });
  }

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
  const openDiscussionWizard = vi.fn();
  vi.doMock("@/stores/agentStore", () => ({
    useAgentStore: (
      selector: (state: {
        instances: Map<string, unknown>;
        openDiscussionWizard: typeof openDiscussionWizard;
      }) => unknown
    ) =>
      selector({
        instances: new Map(
          (input.activeStatuses ?? []).map((status, index) => [
            `agent-${index}`,
            {
              instance_id: `agent-${index}`,
              adapter_name: index === 0 ? "Codex" : "Claude Code",
              display_name: null,
              status,
              ended_at: null,
            },
          ])
        ),
        openDiscussionWizard,
      }),
  }));
  mockAttentionStore(input.pendingPermissions);
  vi.doMock("@/lib/tauri-bridge", () => ({
    respondToPermission: respondToPermissionMock,
  }));

  try {
    const { TopIslandPopover } = await import("@/components/island/TopIslandPopover");
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(TopIslandPopover, {
          anchor: input.anchor ?? { x: 320, y: 180 },
          view: input.view ?? "details",
          onClose: input.onClose ?? (() => undefined),
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
    vi.doUnmock("@/stores/attentionStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.unstubAllGlobals();
    vi.resetModules();
    throw error;
  }
}

function cleanupTopIslandMocks() {
  vi.doUnmock("@/stores/islandStore");
  vi.doUnmock("@/stores/agentStore");
  vi.doUnmock("@/stores/attentionStore");
  vi.doUnmock("@/lib/tauri-bridge");
  vi.unstubAllGlobals();
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
      action: {
        type: "toggle_top_island_popover";
        anchor: { x: number; y: number };
        view: "details" | "notifications" | "quick_reply";
      },
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
      view: "details",
    });

    expect(next.mode).toBe(prev.mode);
    expect(next.detail.kind).toBe("top_island_popover");
  });

  it("opens a detail layer without switching mode", () => {
    const detail = nextDetailState({
      currentMode: "top_island",
      currentDetail: { kind: "none" },
      action: {
        type: "toggle_top_island_popover",
        anchor: { x: 600, y: 44 },
        view: "details",
      },
    });

    expect(detail).toEqual({
      kind: "top_island_popover",
      anchor: { x: 600, y: 44 },
      view: "details",
    } satisfies CompactDetailState);
  });

  it("toggles the top island popover at the provided cursor anchor", () => {
    const opened = nextDetailState({
      currentMode: "top_island",
      currentDetail: { kind: "none" },
      action: {
        type: "toggle_top_island_popover",
        anchor: { x: 700, y: 52 },
        view: "details",
      },
    });
    const closed = nextDetailState({
      currentMode: "top_island",
      currentDetail: opened,
      action: {
        type: "toggle_top_island_popover",
        anchor: { x: 700, y: 52 },
        view: "details",
      },
    });

    expect(opened).toEqual({
      kind: "top_island_popover",
      anchor: { x: 700, y: 52 },
      view: "details",
    });
    expect(closed).toEqual({ kind: "none" });
  });

  it("switches top island popover views without collapsing the bubble", () => {
    const notifications = nextDetailState({
      currentMode: "top_island",
      currentDetail: { kind: "none" },
      action: {
        type: "toggle_top_island_popover",
        anchor: { x: 700, y: 52 },
        view: "notifications",
      },
    });
    const quickReply = nextDetailState({
      currentMode: "top_island",
      currentDetail: notifications,
      action: {
        type: "toggle_top_island_popover",
        anchor: { x: 700, y: 52 },
        view: "quick_reply",
      },
    });

    expect(quickReply).toEqual({
      kind: "top_island_popover",
      anchor: { x: 700, y: 52 },
      view: "quick_reply",
    });
  });

  it("opens a collapsed sidebar from hotzone hover alone", () => {
    const next = resolveSidebarVisibility({
      hotzoneHovered: true,
      panelHovered: false,
      expanded: true,
      collapseDelayMs: 160,
    });

    expect(next).toEqual({
      expanded: true,
      shouldScheduleCollapse: false,
    });
  });

  it("keeps an expanded sidebar open while the pointer stays on the hotzone", () => {
    const next = resolveSidebarVisibility({
      hotzoneHovered: true,
      panelHovered: false,
      expanded: true,
      collapseDelayMs: 160,
    });

    expect(next).toEqual({
      expanded: true,
      shouldScheduleCollapse: false,
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

  it("locks the idle top island shell geometry to the pen baseline", async () => {
    const renderer = await renderTopIslandWithIslandState({
      notifications: [],
      pendingPermissions: [],
      unreadCount: 0,
    });
    const capsule = renderer.root.find(
      (node) =>
        classNameIncludes(node.props.className, "top-island-capsule")
    );
    const detailTriggers = renderer.root.findAllByProps({
      "aria-label": "Open dynamic island details",
    });

    expect(classNameIncludes(capsule.props.className, "top-island-capsule")).toBe(true);
    expect(capsule.props["data-visual-state"]).toBe("idle");
    expect(capsule.props["data-presentation"]).toBe("collapsed");
    expect(capsule.props["data-tauri-drag-region"]).toBe(true);
    expect(capsule.props.style?.["--top-island-width"]).toBe("180px");
    expect(capsule.props.style?.["--top-island-height"]).toBe("36px");
    expect(JSON.stringify(renderer.toJSON())).toContain("Conflux · idle");
    expect(detailTriggers).toHaveLength(0);
  });

  it("asks the native island window to resnap when a draggable capsule is released", async () => {
    const onSnapToMonitor = vi.fn();
    const renderer = await renderTopIslandWithIslandState({
      notifications: [],
      pendingPermissions: [],
      unreadCount: 0,
      onSnapToMonitor,
    });
    const capsule = renderer.root.find(
      (node) =>
        classNameIncludes(node.props.className, "top-island-capsule")
    );

    await act(async () => {
      capsule.props.onPointerUp();
    });

    expect(onSnapToMonitor).toHaveBeenCalledWith("collapsed");
  });

  it("locks the unread top island shell geometry to the pen baseline", async () => {
    const renderer = await renderTopIslandWithIslandState({
      notifications: [
        {
          id: "notif-1",
          level: "info",
          read: false,
          source_adapter_name: "Conflux",
          content: "Workspace ready",
        },
      ],
      pendingPermissions: [],
      unreadCount: 1,
    });
    const capsule = renderer.root.find(
      (node) =>
        node.type === "div" && classNameIncludes(node.props.className, "top-island-capsule")
    );

    expect(classNameIncludes(capsule.props.className, "top-island-capsule")).toBe(true);
    expect(capsule.props["data-visual-state"]).toBe("active");
    expect(capsule.props["data-presentation"]).toBe("expanded");
    expect(capsule.props.style?.["--top-island-width"]).toBe("420px");
    expect(capsule.props.style?.["--top-island-height"]).toBe("44px");
  });

  it("renders top island notification and quick reply actions instead of a blank expanded spacer", async () => {
    const onExpand = vi.fn();
    const renderer = await renderTopIslandWithIslandState({
      notifications: [],
      pendingPermissions: [],
      unreadCount: 0,
      presentation: "expanded",
      onExpand,
    });

    try {
      const capsule = renderer.root.find(
        (node) =>
          classNameIncludes(node.props.className, "top-island-capsule")
      );

      expect(capsule.props["data-presentation"]).toBe("expanded");
      const notificationButton = renderer.root.findByProps({
        "aria-label": "Open notifications",
      });
      const quickReplyButton = renderer.root.findByProps({
        "aria-label": "Open quick reply",
      });
      const detailsButton = renderer.root.findByProps({
        "aria-label": "Open dynamic island details",
      });

      await act(async () => {
        notificationButton.props.onClick();
      });
      await act(async () => {
        quickReplyButton.props.onClick();
      });
      await act(async () => {
        detailsButton.props.onClick();
      });

      expect(onExpand).toHaveBeenNthCalledWith(1, expect.any(Object), "notifications");
      expect(onExpand).toHaveBeenNthCalledWith(2, expect.any(Object), "quick_reply");
      expect(onExpand).toHaveBeenNthCalledWith(3, expect.any(Object), "details");
      expect(
        renderer.root.findAll((node) =>
          classNameIncludes(node.props.className, "top-island-capsule__spacer")
        )
      ).toHaveLength(0);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });

  it("closes repeated top island toggles", () => {
    const detail = nextDetailState({
      currentMode: "top_island",
      currentDetail: {
        kind: "top_island_popover",
        anchor: { x: 600, y: 44 },
        view: "details",
      },
      action: {
        type: "toggle_top_island_popover",
        anchor: { x: 620, y: 52 },
        view: "details",
      },
    });

    expect(detail).toEqual({ kind: "none" });
  });

  it("clicking the collapsed dynamic island expands before opening details and keeps mode stable", async () => {
    const { renderer, setIslandDetailPresentation, setMode } =
      await renderCompactModeControllerForTopIslandFlow();

    try {
      const collapsedCapsule = renderer.root.findByProps({
        "aria-label": "Expand dynamic island capsule",
      });

      expect(renderer.root.findAllByProps({
        "aria-label": "Open dynamic island details",
      })).toHaveLength(0);

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        collapsedCapsule.props.onClick();
      });

      const expandedCapsule = renderer.root.find(
        (node) =>
          classNameIncludes(node.props.className, "top-island-capsule")
      );
      expect(expandedCapsule.props["data-presentation"]).toBe("expanded");
      expect(expandedCapsule.props.style?.["--top-island-width"]).toBe("420px");
      expect(setIslandDetailPresentation).not.toHaveBeenCalledWith("top_island_expanded");
      expect(setIslandDetailPresentation).not.toHaveBeenCalled();
      expect(setMode).not.toHaveBeenCalled();

      const topIslandButton = renderer.root.findByProps({
        "aria-label": "Open dynamic island details",
      });

      await act(async () => {
        topIslandButton.props.onClick({
          currentTarget: {
            getBoundingClientRect: () => ({
              right: 368,
              bottom: 56,
            }),
          },
        });
      });

      const popover = renderer.root.findByType(TopIslandPopoverMock);
      expect(popover.props.anchor).toEqual({
        x:
          COMPACT_WINDOW_METRICS.topIsland.expandedWidth -
          COMPACT_WINDOW_METRICS.topIsland.popoverWidth -
          12,
        y:
          COMPACT_WINDOW_METRICS.topIsland.shellPaddingY +
          COMPACT_WINDOW_METRICS.topIsland.expandedHeight +
          12,
      });
      expect(popover.props.view).toBe("details");
      expect(setIslandDetailPresentation).toHaveBeenCalledWith(
        "top_island_popover",
        "top_island"
      );
      expect(setMode).not.toHaveBeenCalled();

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        topIslandButton.props.onClick({
          currentTarget: {
            getBoundingClientRect: () => ({
              right: 368,
              bottom: 56,
            }),
          },
        });
      });

      expect(renderer.root.findAllByType(TopIslandPopoverMock)).toHaveLength(0);
      expect(setIslandDetailPresentation).toHaveBeenCalledWith("none", "top_island");
      const recollapsedCapsule = renderer.root.findByProps({
        "aria-label": "Expand dynamic island capsule",
      });
      expect(recollapsedCapsule.props["data-presentation"]).toBe("collapsed");
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerTopIslandMocks();
    }
  });

  it("waits for native top island popover resize before mounting the popover", async () => {
    let resolvePopoverResize!: () => void;
    const setIslandDetailPresentation = vi.fn((presentation: string) => {
      if (presentation === "top_island_popover") {
        return new Promise<void>((resolve) => {
          resolvePopoverResize = resolve;
        });
      }

      return Promise.resolve();
    });
    const { renderer } = await renderCompactModeControllerForTopIslandFlow({
      setIslandDetailPresentation,
    });

    try {
      const collapsedCapsule = renderer.root.findByProps({
        "aria-label": "Expand dynamic island capsule",
      });

      await act(async () => {
        collapsedCapsule.props.onClick();
      });

      const topIslandButton = renderer.root.findByProps({
        "aria-label": "Open dynamic island details",
      });

      await act(async () => {
        topIslandButton.props.onClick({
          currentTarget: {
            getBoundingClientRect: () => ({
              right: 368,
              bottom: 56,
            }),
          },
        });
      });

      expect(setIslandDetailPresentation).toHaveBeenCalledWith(
        "top_island_popover",
        "top_island"
      );
      expect(renderer.root.findAllByType(TopIslandPopoverMock)).toHaveLength(0);

      await act(async () => {
        resolvePopoverResize();
      });

      expect(renderer.root.findAllByType(TopIslandPopoverMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerTopIslandMocks();
    }
  });

  it("previews the full dynamic island on hover and collapses after pointer leaves", async () => {
    const { renderer, setIslandDetailPresentation, setMode } =
      await renderCompactModeControllerForTopIslandFlow();

    try {
      const collapsedCapsule = renderer.root.findByProps({
        "aria-label": "Expand dynamic island capsule",
      });

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        collapsedCapsule.props.onMouseEnter();
      });

      const expandedCapsule = renderer.root.find(
        (node) =>
          classNameIncludes(node.props.className, "top-island-capsule")
      );

      expect(expandedCapsule.props["data-presentation"]).toBe("expanded");
      expect(expandedCapsule.props.style?.["--top-island-width"]).toBe("420px");
      expect(setIslandDetailPresentation).not.toHaveBeenCalledWith("top_island_expanded");
      expect(setIslandDetailPresentation).not.toHaveBeenCalled();

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        expandedCapsule.props.onMouseLeave({ buttons: 0 });
      });

      const recollapsedCapsule = renderer.root.findByProps({
        "aria-label": "Expand dynamic island capsule",
      });

      expect(recollapsedCapsule.props["data-presentation"]).toBe("collapsed");
      expect(recollapsedCapsule.props.style?.["--top-island-width"]).toBe("180px");
      expect(setIslandDetailPresentation).toHaveBeenCalledWith("none", "top_island");
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerTopIslandMocks();
    }
  });

  it("does not collapse the full dynamic island preview while a drag is active", async () => {
    const { renderer, setIslandDetailPresentation, setMode } =
      await renderCompactModeControllerForTopIslandFlow();

    try {
      const collapsedCapsule = renderer.root.findByProps({
        "aria-label": "Expand dynamic island capsule",
      });

      await act(async () => {
        collapsedCapsule.props.onMouseEnter();
      });

      const expandedCapsule = renderer.root.find(
        (node) =>
          classNameIncludes(node.props.className, "top-island-capsule")
      );

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        expandedCapsule.props.onMouseLeave({ buttons: 1 });
      });

      expect(expandedCapsule.props["data-presentation"]).toBe("expanded");
      expect(setIslandDetailPresentation).not.toHaveBeenCalledWith("none");
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerTopIslandMocks();
    }
  });

  it("keeps the native top island viewport stable when unread activity forces the full capsule", async () => {
    const { renderer, setIslandDetailPresentation, setMode } =
      await renderCompactModeControllerForTopIslandFlow({
        notifications: [{ id: "notif-1", level: "info", read: false }],
        unreadCount: 1,
      });

    try {
      const capsule = renderer.root.find(
        (node) =>
          classNameIncludes(node.props.className, "top-island-capsule")
      );

      expect(capsule.props["data-presentation"]).toBe("expanded");
      expect(capsule.props.style?.["--top-island-width"]).toBe("420px");
      expect(setIslandDetailPresentation).not.toHaveBeenCalledWith("top_island_expanded");
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerTopIslandMocks();
    }
  });

  it("resnaps the top island viewport using the current capsule presentation after drag release", async () => {
    const { renderer, setIslandDetailPresentation, setMode } =
      await renderCompactModeControllerForTopIslandFlow();

    try {
      const collapsedCapsule = renderer.root.findByProps({
        "aria-label": "Expand dynamic island capsule",
      });

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        collapsedCapsule.props.onPointerUp();
      });

      expect(setIslandDetailPresentation).toHaveBeenCalledWith("none", "top_island");

      await act(async () => {
        collapsedCapsule.props.onClick();
      });

      const expandedCapsule = renderer.root.find(
        (node) =>
          classNameIncludes(node.props.className, "top-island-capsule")
      );

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        expandedCapsule.props.onPointerUp();
      });

      expect(setIslandDetailPresentation).toHaveBeenCalledWith("none", "top_island");
      expect(setIslandDetailPresentation).not.toHaveBeenCalledWith("top_island_expanded");
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerTopIslandMocks();
    }
  });

  it("rejects illegal mode and action combinations", () => {
    const detail = nextDetailState({
      currentMode: "sidebar",
      currentDetail: {
        kind: "top_island_popover",
        anchor: { x: 600, y: 44 },
        view: "details",
      },
      action: {
        type: "toggle_top_island_popover",
        anchor: { x: 640, y: 44 },
        view: "details",
      },
    });

    expect(detail).toEqual({ kind: "none" });
  });

  it("waits for native floating sidebar placement before mounting the floating panel", async () => {
    let resolveFloatingPlacement!: () => void;
    const setIslandDetailPresentation = vi.fn((presentation: string) => {
      if (presentation === "sidebar_expanded") {
        return Promise.resolve();
      }
      if (presentation === "sidebar_floating") {
        return new Promise<void>((resolve) => {
          resolveFloatingPlacement = resolve;
        });
      }

      return Promise.resolve();
    });
    const { renderer } = await renderCompactModeControllerForSidebarFlow({
      setIslandDetailPresentation,
    });

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      await act(async () => {
        hotzone.props.onActivate();
      });

      const panel = renderer.root.findByType(SidebarPanelMock);
      await act(async () => {
        panel.props.onUndock();
      });

      expect(setIslandDetailPresentation).toHaveBeenCalledWith(
        "sidebar_floating",
        "sidebar"
      );
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      await act(async () => {
        resolveFloatingPlacement();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
      expect(renderer.root.findAllByProps({ className: "sidebar-panel-sensor" })).toHaveLength(0);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("collapses the sidebar when native floating placement fails", async () => {
    const setIslandDetailPresentation = vi.fn((presentation: string) => {
      if (presentation === "sidebar_expanded") {
        return Promise.resolve();
      }
      if (presentation === "sidebar_floating") {
        return Promise.reject(new Error("native floating placement failed"));
      }

      return Promise.resolve();
    });
    const { renderer } = await renderCompactModeControllerForSidebarFlow({
      setIslandDetailPresentation,
    });

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      await act(async () => {
        hotzone.props.onActivate();
      });

      const panel = renderer.root.findByType(SidebarPanelMock);
      await act(async () => {
        panel.props.onUndock();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
      expect(renderer.root.findAllByType(SidebarHotzoneMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("ignores stale docked expansion acks after undocking into floating placement", async () => {
    let resolveExpanded!: () => void;
    let resolveFloating!: () => void;
    const setIslandDetailPresentation = vi.fn((presentation: string) => {
      if (presentation === "sidebar_expanded") {
        return new Promise<void>((resolve) => {
          resolveExpanded = resolve;
        });
      }
      if (presentation === "sidebar_floating") {
        return new Promise<void>((resolve) => {
          resolveFloating = resolve;
        });
      }

      return Promise.resolve();
    });
    const { renderer } = await renderCompactModeControllerForSidebarFlow({
      setIslandDetailPresentation,
    });

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onActivate();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      await act(async () => {
        resolveExpanded();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      const dockedPanel = renderer.root.findByType(SidebarPanelMock);
      await act(async () => {
        dockedPanel.props.onUndock();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      await act(async () => {
        resolveExpanded();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      await act(async () => {
        resolveFloating();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
      expect(renderer.root.findAllByProps({ className: "sidebar-panel-sensor" })).toHaveLength(0);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("restores the workspace and resets sidebar shell state", async () => {
    const { renderer, showWorkspaceOnly } = await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onActivate();
        await Promise.resolve();
      });

      await act(async () => {
        await Promise.resolve();
      });

      const panel = renderer.root.findByType(SidebarPanelMock);
      await act(async () => {
        panel.props.onOpenWorkspace();
        await Promise.resolve();
      });

      expect(showWorkspaceOnly).toHaveBeenCalledTimes(1);
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
      expect(renderer.root.findAllByType(SidebarHotzoneMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("reveals the docked sidebar from hotzone hover without requiring a click", async () => {
    const { renderer, setIslandDetailPresentation } =
      await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      expect(setIslandDetailPresentation).toHaveBeenCalledWith(
        "sidebar_expanded",
        "sidebar"
      );
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("stops responding to hotzone hover once the sidebar is undocked", async () => {
    const { renderer, setIslandDetailPresentation } =
      await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      const panel = renderer.root.findByType(SidebarPanelMock);
      await act(async () => {
        panel.props.onUndock();
      });

      setIslandDetailPresentation.mockClear();
      expect(renderer.root.findAllByType(SidebarHotzoneMock)).toHaveLength(0);
      expect(setIslandDetailPresentation).not.toHaveBeenCalledWith(
        "sidebar_expanded",
        "sidebar"
      );
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("clicking the dock tab keeps the docked sidebar pinned open", async () => {
    const { renderer } = await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onActivate();
      });

      expect(renderer.root.findAllByType(SidebarHotzoneMock)).toHaveLength(0);

      const panelSensor = renderer.root.findByProps({
        className: "sidebar-panel-sensor",
      });

      await act(async () => {
        panelSensor.props.onMouseLeave();
      });
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(160);
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("switches the sidebar into floating native placement after undock", async () => {
    const { renderer, setIslandDetailPresentation } =
      await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      await act(async () => {
        hotzone.props.onActivate();
      });

      const panel = renderer.root.findByType(SidebarPanelMock);
      setIslandDetailPresentation.mockClear();
      await act(async () => {
        panel.props.onUndock();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(setIslandDetailPresentation).toHaveBeenCalledWith(
        "sidebar_floating",
        "sidebar"
      );
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("passes the sidebar mode with native sidebar detail requests", async () => {
    const { renderer, setIslandDetailPresentation } =
      await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      setIslandDetailPresentation.mockClear();
      await act(async () => {
        hotzone.props.onActivate();
      });

      expect(setIslandDetailPresentation).toHaveBeenCalledWith(
        "sidebar_expanded",
        "sidebar"
      );

      const panel = renderer.root.findByType(SidebarPanelMock);
      await act(async () => {
        panel.props.onCollapse();
      });

      expect(setIslandDetailPresentation).toHaveBeenCalledWith("none", "sidebar");
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("mounts the expanded docked sidebar inside a full-window hover sensor", async () => {
    const { renderer } = await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      await act(async () => {
        hotzone.props.onActivate();
      });

      const root = renderer.root.findByProps({
        "data-sidebar-interaction": "panel",
      });
      expect(root.props["data-sidebar-interaction"]).toBe("panel");

      const panelSensor = renderer.root.findByProps({
        className: "sidebar-panel-sensor",
      });

      expect(panelSensor.props.onPointerEnter).toEqual(expect.any(Function));
      expect(panelSensor.props.onPointerLeave).toEqual(expect.any(Function));
      expect(panelSensor.props.onMouseEnter).toEqual(expect.any(Function));
      expect(panelSensor.props.onMouseLeave).toEqual(expect.any(Function));
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("does not keep the floating sidebar inside the docked hover sensor", async () => {
    const { renderer } = await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      await act(async () => {
        hotzone.props.onActivate();
      });

      const panel = renderer.root.findByType(SidebarPanelMock);
      await act(async () => {
        panel.props.onUndock();
      });

      expect(renderer.root.findAllByProps({ className: "sidebar-panel-sensor" })).toHaveLength(0);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("retries docked hover reveal after a native expanded ack failure", async () => {
    let expandedRequests = 0;
    const setIslandDetailPresentation = vi.fn((presentation: string) => {
      if (presentation !== "sidebar_expanded" && presentation !== "sidebar_floating") {
        return Promise.resolve();
      }

      expandedRequests += 1;
      return expandedRequests === 1
        ? Promise.reject(new Error("native sidebar resize failed"))
        : Promise.resolve();
    });
    const { renderer } = await renderCompactModeControllerForSidebarFlow({
      setIslandDetailPresentation,
    });

    try {
      let hotzone = renderer.root.findByType(SidebarHotzoneMock);

      await act(async () => {
        hotzone.props.onHoverChange(true);
        await Promise.resolve();
      });

      expect(expandedRequests).toBe(1);
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
        await Promise.resolve();
      });

      expect(expandedRequests).toBe(2);
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("hover reveal collapses back after the cursor leaves the docked sidebar", async () => {
    const { renderer } = await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      const panelSensor = renderer.root.findByProps({
        className: "sidebar-panel-sensor",
      });

      await act(async () => {
        panelSensor.props.onMouseLeave();
      });
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(160);
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
      expect(renderer.root.findAllByType(SidebarHotzoneMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("collapses the hover-revealed docked sidebar only after panel hover leaves and the timeout elapses", async () => {
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
        vi.advanceTimersByTime(160);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
      expect(setMode).not.toHaveBeenCalled();

      await act(async () => {
        panelSensor.props.onMouseLeave();
      });
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(159);
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
      expect(renderer.root.findAllByType(SidebarHotzoneMock)).toHaveLength(1);
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("keeps the docked sidebar hidden until the native expanded ack resolves after hover reveal", async () => {
    const expansionResolvers: Array<() => void> = [];
    const setIslandDetailPresentation = vi.fn((presentation: string) => {
      if (presentation === "sidebar_expanded" || presentation === "sidebar_floating") {
        return new Promise<void>((resolve) => {
          expansionResolvers.push(resolve);
        });
      }

      return Promise.resolve();
    });

    const { renderer } = await renderCompactModeControllerForSidebarFlow({
      setIslandDetailPresentation,
    });

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);

      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
      expect(expansionResolvers).toHaveLength(1);

      await act(async () => {
        expansionResolvers.forEach((resolve) => resolve());
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
      expect(renderer.root.findAllByType(SidebarHotzoneMock)).toHaveLength(0);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("keeps the hover-revealed docked sidebar mounted while moving from hotzone into panel before timeout", async () => {
    const { renderer } = await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      const panelSensor = renderer.root.findByProps({
        className: "sidebar-panel-sensor",
      });

      await act(async () => {
        panelSensor.props.onPointerEnter();
        vi.advanceTimersByTime(160);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("drops collapseArmed after the hover-revealed panel re-enters before timeout fires", async () => {
    const { renderer } = await renderCompactModeControllerForSidebarFlow();

    try {
      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      const panelSensor = renderer.root.findByProps({
        className: "sidebar-panel-sensor",
      });

      await act(async () => {
        panelSensor.props.onPointerLeave();
        vi.advanceTimersByTime(80);
        panelSensor.props.onPointerEnter();
        vi.advanceTimersByTime(80);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("collapses the hover-revealed docked sidebar after leaving the panel without re-entering", async () => {
    const { renderer, setMode } = await renderCompactModeControllerForSidebarFlow();

    try {
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onHoverChange(true);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
      expect(setMode).not.toHaveBeenCalled();

      const panelSensor = renderer.root.findByProps({
        className: "sidebar-panel-sensor",
      });

      await act(async () => {
        vi.advanceTimersByTime(159);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      await act(async () => {
        panelSensor.props.onMouseLeave();
      });
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(159);
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);
      expect(renderer.root.findAllByType(SidebarHotzoneMock)).toHaveLength(1);
      expect(setMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("clicking the docked sidebar keeps it open until explicit dismiss", async () => {
    const { renderer, setMode } = await renderCompactModeControllerForSidebarFlow();

    try {
      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(0);

      const hotzone = renderer.root.findByType(SidebarHotzoneMock);
      await act(async () => {
        hotzone.props.onActivate();
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
      expect(setMode).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

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
        panelSensor.props.onMouseLeave();
      });
      await act(async () => {
        vi.advanceTimersByTime(160);
      });

      expect(renderer.root.findAllByType(SidebarPanelMock)).toHaveLength(1);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupCompactModeControllerSidebarMocks();
    }
  });

  it("locks the sidebar shell geometry to the pen baseline", async () => {
    const renderer = await renderSidebarWithIslandState({
      notifications: [
        {
          id: "perm-1",
          level: "permission_required",
          read: false,
          content: "Approve shell command",
          created_at: Date.now() - 10_000,
          source_instance_id: "agent-7",
        },
      ],
    });
    const rail = renderer.root.find(
      (node) =>
        node.type === "aside" && classNameIncludes(node.props.className, "sidebar-panel")
    );
    const band = renderer.root.find(
      (node) => classNameIncludes(node.props.className, "sidebar-panel__band")
    );

    expect(classNameIncludes(rail.props.className, "sidebar-panel")).toBe(true);
    expect(classNameIncludes(band.props.className, "sidebar-panel__band")).toBe(true);
    expect(rail.props.style?.["--sidebar-rail-width"]).toBe("300px");
    expect(band.props.style?.["--sidebar-band-width"]).toBe("220px");
  });

  it("renders the collapsed sidebar as a right-edge dock tab with a transparent icon", async () => {
    const onActivate = vi.fn();
    const onHoverChange = vi.fn();
    const { SidebarHotzone } = await import("@/components/island/SidebarHotzone");

    const renderer = TestRenderer.create(
      createElement(SidebarHotzone, {
        expanded: false,
        onActivate,
        onHoverChange,
      })
    );

    const tab = renderer.root.findByType("button");
    const icon = renderer.root.find(
      (node) =>
        typeof node.props.className === "string" &&
        node.props.className.includes("sidebar-hotzone__icon")
    );

    expect(classNameIncludes(tab.props.className, "sidebar-hotzone")).toBe(true);
    expect(tab.props.style?.["--sidebar-dock-tab-width"]).toBe("48px");
    expect(tab.props.style?.["--sidebar-dock-tab-height"]).toBe("260px");
    expect(icon.props["aria-hidden"]).toBe("true");
  });

  it("starts a native window drag from the collapsed sidebar dock tab without expanding", async () => {
    vi.resetModules();
    const onActivate = vi.fn();
    const onHoverChange = vi.fn();
    const startCurrentWindowDrag = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/window-drag", () => ({
      startCurrentWindowDrag,
    }));

    try {
      const { SidebarHotzone } = await import("@/components/island/SidebarHotzone");
      const renderer = TestRenderer.create(
        createElement(SidebarHotzone, {
          expanded: false,
          onActivate,
          onHoverChange,
        })
      );
      const tab = renderer.root.findByType("button");

      await act(async () => {
        tab.props.onPointerDown({
          button: 0,
          buttons: 1,
          clientX: 12,
          clientY: 40,
        });
        await Promise.resolve();
      });

      expect(onActivate).not.toHaveBeenCalled();
      expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);

      await act(async () => {
        tab.props.onPointerMove({
          buttons: 1,
          clientX: 18,
          clientY: 41,
        });
        await Promise.resolve();
      });

      expect(onActivate).not.toHaveBeenCalled();
      expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("@/lib/window-drag");
      vi.resetModules();
    }
  });

  it("suppresses the synthetic click that follows a sidebar dock tab drag", async () => {
    vi.resetModules();
    const onActivate = vi.fn();
    const onHoverChange = vi.fn();
    const startCurrentWindowDrag = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/window-drag", () => ({
      startCurrentWindowDrag,
    }));

    try {
      const { SidebarHotzone } = await import("@/components/island/SidebarHotzone");
      const renderer = TestRenderer.create(
        createElement(SidebarHotzone, {
          expanded: false,
          onActivate,
          onHoverChange,
        })
      );
      const tab = renderer.root.findByType("button");
      const clickEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      };

      await act(async () => {
        tab.props.onPointerDown({
          button: 0,
          buttons: 1,
          clientX: 12,
          clientY: 40,
        });
        tab.props.onPointerMove({
          buttons: 1,
          clientX: 19,
          clientY: 42,
        });
        await Promise.resolve();
      });

      await act(async () => {
        tab.props.onClick(clickEvent);
      });

      expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
      expect(onActivate).not.toHaveBeenCalled();
      expect(clickEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(clickEvent.stopPropagation).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("@/lib/window-drag");
      vi.resetModules();
    }
  });

  it("opens the collapsed sidebar dock tab from an explicit click", async () => {
    const onActivate = vi.fn();
    const onHoverChange = vi.fn();
    const { SidebarHotzone } = await import("@/components/island/SidebarHotzone");

    const renderer = TestRenderer.create(
      createElement(SidebarHotzone, {
        expanded: false,
        onActivate,
        onHoverChange,
      })
    );
    const tab = renderer.root.findByType("button");

    await act(async () => {
      tab.props.onClick();
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
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
      expect(json).toContain("Attention");
      expect(json).toContain("Assistant rail");
      expect(json).toContain("Open workspace");
      expect(json).toContain("Dismiss");
      expect(json).toContain("Live agents");
      expect(json).toContain("Needs attention");

      const buttons = renderer.root.findAllByType("button");
      const openWorkspaceButton = buttons.find(
        (node) => node.props.children === "Open workspace"
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

  it("wires sidebar allow actions through the permission bridge using the interaction id", async () => {
    const respondToPermissionMock = vi.fn().mockResolvedValue(undefined);
    const {
      clearNotification,
      renderer,
    } = await renderSidebarAssistantPanel({
      notifications: [],
      permissions: [
        {
          id: "perm-1",
          instance_id: "agent-7",
          description: "Approve shell command",
          created_at: Date.now() - 10_000,
        },
      ],
      respondToPermissionMock,
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

      // 唯一注入路径：(instance_id, interaction_id, decision)。后端 resolve + emit 移除项，
      // 前端不再手动 removePermissionRequest。
      expect(respondToPermissionMock).toHaveBeenCalledTimes(1);
      expect(respondToPermissionMock).toHaveBeenCalledWith(
        "agent-7",
        "perm-1",
        "approve",
      );
      expect(clearNotification).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupSidebarAssistantPanelMocks();
    }
  });

  it("wires sidebar deny actions through the permission bridge using the interaction id", async () => {
    const respondToPermissionMock = vi.fn().mockResolvedValue(undefined);
    const {
      clearNotification,
      renderer,
    } = await renderSidebarAssistantPanel({
      notifications: [],
      permissions: [
        {
          id: "perm-2",
          instance_id: "agent-9",
          description: "Deny file deletion",
          created_at: Date.now() - 12_000,
        },
      ],
      respondToPermissionMock,
    });

    try {
      const denyButton = renderer.root
        .findAllByType("button")
        .find((node) => node.props.children === "Deny");

      expect(denyButton).toBeDefined();

      await act(async () => {
        denyButton?.props.onClick();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(respondToPermissionMock).toHaveBeenCalledTimes(1);
      expect(respondToPermissionMock).toHaveBeenCalledWith(
        "agent-9",
        "perm-2",
        "deny",
      );
      expect(clearNotification).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupSidebarAssistantPanelMocks();
    }
  });

  it("suppresses repeated sidebar permission submissions while one is pending", async () => {
    let resolvePermission!: () => void;
    const respondToPermissionMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePermission = resolve;
        }),
    );
    const {
      clearNotification,
      renderer,
    } = await renderSidebarAssistantPanel({
      notifications: [],
      permissions: [
        {
          id: "perm-3",
          instance_id: "agent-11",
          description: "Approve terminal access",
          created_at: Date.now() - 15_000,
        },
      ],
      respondToPermissionMock,
    });

    try {
      const getActionButtons = () =>
        renderer.root.findAllByType("button").filter((node) => {
          return node.props.children === "Allow" || node.props.children === "Deny";
        });

      const [allowButton, denyButton] = getActionButtons();
      expect(allowButton).toBeDefined();
      expect(denyButton).toBeDefined();

      await act(async () => {
        allowButton?.props.onClick();
        await Promise.resolve();
      });

      expect(respondToPermissionMock).toHaveBeenCalledTimes(1);
      expect(respondToPermissionMock).toHaveBeenLastCalledWith(
        "agent-11",
        "perm-3",
        "approve",
      );

      // 处置 in-flight 时按钮禁用，重复点击不再触发第二次注入。
      const [pendingAllowButton, pendingDenyButton] = getActionButtons();
      expect(pendingAllowButton?.props.disabled).toBe(true);
      expect(pendingDenyButton?.props.disabled).toBe(true);

      await act(async () => {
        pendingDenyButton?.props.onClick();
        await Promise.resolve();
      });

      expect(respondToPermissionMock).toHaveBeenCalledTimes(1);
      expect(clearNotification).not.toHaveBeenCalled();

      // 完成后清掉 pending 态，按钮重新可用（队列项由后端 emit 快照决定去留）。
      await act(async () => {
        resolvePermission();
        await Promise.resolve();
        await Promise.resolve();
      });

      const [resolvedAllowButton, resolvedDenyButton] = getActionButtons();
      expect(resolvedAllowButton?.props.disabled).toBe(false);
      expect(resolvedDenyButton?.props.disabled).toBe(false);
      expect(respondToPermissionMock).toHaveBeenCalledTimes(1);
      expect(clearNotification).not.toHaveBeenCalled();
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
      expect(popoverRoot.props.style["--top-island-popover-width"]).toBe("232px");
      expect(popoverRoot.props.style["--top-island-popover-measure-height"]).toBe("168px");
      expect(buttonLabels).toContain("Open workspace");
      expect(buttonLabels).toContain("Dismiss");
      expect(JSON.stringify(renderer.toJSON())).toContain("Mode");
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupTopIslandMocks();
    }
  });

  it("keeps the top island popover below the capsule while the native window is still resizing", async () => {
    const expectedTop =
      COMPACT_WINDOW_METRICS.topIsland.shellPaddingY +
      COMPACT_WINDOW_METRICS.topIsland.expandedHeight +
      12;
    const { renderer } = await renderTopIslandPopoverWithIslandState({
      pendingPermissions: [],
      notifications: [],
      unreadCount: 0,
      anchor: { x: 176, y: expectedTop },
      viewport: {
        innerWidth: COMPACT_WINDOW_METRICS.topIsland.expandedWidth,
        innerHeight: COMPACT_WINDOW_METRICS.topIsland.windowHeight,
      },
    });

    try {
      const popoverRoot = renderer.root.find(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("top-island-popover")
      );

      expect(popoverRoot.props.style.top).toBe(expectedTop);
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupTopIslandMocks();
    }
  });

  it("closes the top island popover when the pointer leaves its bubble", async () => {
    const onClose = vi.fn();
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
      onClose,
    });

    try {
      const popoverRoot = renderer.root.find(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("top-island-popover")
      );

      await act(async () => {
        popoverRoot.props.onMouseLeave();
      });

      expect(onClose).toHaveBeenCalledTimes(1);
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

  it("suppresses repeated top island permission submissions while one is pending", async () => {
    let resolvePermission!: () => void;
    const respondToPermissionMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePermission = resolve;
        })
    );
    const {
      clearNotification,
      renderer,
    } = await renderTopIslandPopoverWithIslandState({
      pendingPermissions: [
        {
          id: "perm-1",
          instance_id: "agent-1",
          action: "shell",
          description: "Need approval",
        },
      ],
      notifications: [],
      unreadCount: 0,
      respondToPermissionMock,
    });

    try {
      const allowButton = renderer.root
        .findAllByType("button")
        .find((node) => node.props.children === "Allow");

      expect(allowButton).toBeDefined();

      await act(async () => {
        allowButton?.props.onClick();
        allowButton?.props.onClick();
        await Promise.resolve();
      });

      // pending 期间二次点击被 pendingDecisionRef 抑制：只注入一次。
      expect(respondToPermissionMock).toHaveBeenCalledTimes(1);
      expect(clearNotification).not.toHaveBeenCalled();

      await act(async () => {
        resolvePermission();
        await Promise.resolve();
        await Promise.resolve();
      });

      // 完成后不再补发；队列项去留由后端 emit 快照决定，不在前端手动移除。
      expect(respondToPermissionMock).toHaveBeenCalledTimes(1);
      expect(clearNotification).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupTopIslandMocks();
    }
  });

  it("renders top island notifications as a compact unread list instead of the details view", async () => {
    const { renderer } = await renderTopIslandPopoverWithIslandState({
      pendingPermissions: [],
      notifications: [
        {
          id: "notif-1",
          level: "info",
          read: false,
          source_adapter_name: "Codex",
          content: "Review finished",
        },
        {
          id: "notif-2",
          level: "warning",
          read: false,
          source_adapter_name: "Claude Code",
          content: "Permission still pending",
        },
      ],
      unreadCount: 2,
      activeStatuses: ["idle"],
      view: "notifications",
    });

    try {
      const json = JSON.stringify(renderer.toJSON());
      const list = renderer.root.findByProps({
        className: "top-island-bubble__notification-list",
      });

      expect(list.children).toHaveLength(2);
      expect(json).toContain("Notifications");
      expect(json).toContain("Review finished");
      expect(json).toContain("Permission still pending");
      expect(json).not.toContain("Top-centered capsule");
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupTopIslandMocks();
    }
  });

  it("renders top island quick reply as a composer entry point", async () => {
    const { renderer } = await renderTopIslandPopoverWithIslandState({
      pendingPermissions: [],
      notifications: [],
      unreadCount: 0,
      activeStatuses: ["idle"],
      view: "quick_reply",
    });

    try {
      const json = JSON.stringify(renderer.toJSON());
      const textarea = renderer.root.findByType("textarea");
      const openDiscussionButton = renderer.root
        .findAllByType("button")
        .find((node) => node.props.children === "Open Discussion");

      expect(json).toContain("Quick Reply");
      expect(json).toContain("Reply to Codex");
      expect(textarea.props.placeholder).toContain("Message Codex");
      expect(openDiscussionButton).toBeDefined();
      expect(json).not.toContain("Top-centered capsule");
    } finally {
      await act(async () => {
        renderer.unmount();
      });
      cleanupTopIslandMocks();
    }
  });
});
