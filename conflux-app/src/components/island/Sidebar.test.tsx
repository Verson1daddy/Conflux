import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const startCurrentWindowDrag = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/window-drag", () => ({
  startCurrentWindowDrag,
}));

function classNameIncludes(value: unknown, token: string): boolean {
  return typeof value === "string" && value.split(/\s+/).includes(token);
}

function nodeContainsText(node: TestRenderer.ReactTestInstance, text: string): boolean {
  return node.findAll((child) => child.children.includes(text)).length > 0;
}

describe("Sidebar notifications", () => {
  afterEach(() => {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/lib/tauri-bridge");
    startCurrentWindowDrag.mockClear();
    vi.resetModules();
  });

  it("shows the unread notification total even when the visible list is capped", async () => {
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          notifications: Array<{
            id: string;
            level: string;
            read: boolean;
            content: string;
            created_at: number;
            source_instance_id: string;
            source_adapter_name: string;
          }>;
          removePermissionRequest: ReturnType<typeof vi.fn>;
          clearNotification: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          notifications: Array.from({ length: 6 }, (_, index) => ({
            id: `notif-${index}`,
            level: "info",
            read: false,
            content: `Notification ${index}`,
            created_at: Date.now() - index * 1000,
            source_instance_id: "agent-1",
            source_adapter_name: "Codex",
          })),
          removePermissionRequest: vi.fn(),
          clearNotification: vi.fn(),
        }),
    }));
    vi.doMock("@/stores/agentStore", () => ({
      agentDisplayLabel: (agent: { instance_id: string }) => agent.instance_id,
      useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
        selector({ instances: new Map() }),
    }));
    vi.doMock("@/lib/tauri-bridge", () => ({
      focusAgentCard: vi.fn(),
      respondToPermission: vi.fn(),
    }));

    const { Sidebar } = await import("./Sidebar");
    let renderer!: TestRenderer.ReactTestRenderer;
    let onUndock = vi.fn();
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: () => undefined,
          onOpenWorkspace: () => undefined,
          onUndock,
        })
      );
    });

    const notificationHeader = renderer.root
      .findAll(
        (node) =>
          classNameIncludes(node.props.className, "sidebar-panel__section-header") &&
          nodeContainsText(node, "Notifications")
      )[0];
    const count = notificationHeader?.findByProps({
      className: "sidebar-panel__section-count",
    });

    expect(count?.children).toEqual(["6"]);
  });
  it("renders an undock action in the sidebar header", async () => {
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          notifications: [];
          removePermissionRequest: ReturnType<typeof vi.fn>;
          clearNotification: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          notifications: [],
          removePermissionRequest: vi.fn(),
          clearNotification: vi.fn(),
        }),
    }));
    vi.doMock("@/stores/agentStore", () => ({
      agentDisplayLabel: (agent: { instance_id: string }) => agent.instance_id,
      useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
        selector({ instances: new Map() }),
    }));
    vi.doMock("@/lib/tauri-bridge", () => ({
      focusAgentCard: vi.fn(),
      respondToPermission: vi.fn(),
    }));

    const { Sidebar } = await import("./Sidebar");
    const onUndock = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: () => undefined,
          onOpenWorkspace: () => undefined,
          onUndock,
        })
      );
    });

    const undockButton = renderer.root.findByProps({
      "aria-label": "Undock compact sidebar",
    });

    await act(async () => {
      undockButton.props.onClick();
    });

    expect(onUndock).toHaveBeenCalledTimes(1);
  });
  it("only enables dragging when the floating drag handle is active", async () => {
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          notifications: [];
          removePermissionRequest: ReturnType<typeof vi.fn>;
          clearNotification: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          notifications: [],
          removePermissionRequest: vi.fn(),
          clearNotification: vi.fn(),
        }),
    }));
    vi.doMock("@/stores/agentStore", () => ({
      agentDisplayLabel: (agent: { instance_id: string }) => agent.instance_id,
      useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
        selector({ instances: new Map() }),
    }));
    vi.doMock("@/lib/tauri-bridge", () => ({
      focusAgentCard: vi.fn(),
      respondToPermission: vi.fn(),
    }));

    const { Sidebar } = await import("./Sidebar");
    let renderer!: TestRenderer.ReactTestRenderer;
    const onDragStart = vi.fn();
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: () => undefined,
          onOpenWorkspace: () => undefined,
          onUndock: vi.fn(),
          onDragStart,
        })
      );
    });

    const dragSurface = renderer.root.find(
      (node) =>
        typeof node.props.className === "string" &&
        node.props.className.includes("sidebar-panel__drag-handle")
    );

    await act(async () => {
      dragSurface.props.onPointerDown({
        button: 0,
        stopPropagation: vi.fn(),
      });
      await Promise.resolve();
    });

    expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it("starts dragging from the sidebar handle even without an undock callback", async () => {
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          notifications: [];
          removePermissionRequest: ReturnType<typeof vi.fn>;
          clearNotification: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          notifications: [],
          removePermissionRequest: vi.fn(),
          clearNotification: vi.fn(),
        }),
    }));
    vi.doMock("@/stores/agentStore", () => ({
      agentDisplayLabel: (agent: { instance_id: string }) => agent.instance_id,
      useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
        selector({ instances: new Map() }),
    }));
    vi.doMock("@/lib/tauri-bridge", () => ({
      focusAgentCard: vi.fn(),
      respondToPermission: vi.fn(),
    }));

    const { Sidebar } = await import("./Sidebar");
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

    const dragSurface = renderer.root.find(
      (node) =>
        typeof node.props.className === "string" &&
        node.props.className.includes("sidebar-panel__drag-handle")
    );

    await act(async () => {
      dragSurface.props.onPointerDown({
        button: 0,
        stopPropagation: vi.fn(),
      });
      await Promise.resolve();
    });

    expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
  });
});

describe("SidebarHotzone", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/window-drag");
    vi.resetModules();
  });

  it("starts dragging from pointer edge interactions without activating the sidebar", async () => {
    const startCurrentWindowDrag = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/window-drag", () => ({
      startCurrentWindowDrag,
    }));
    const { SidebarHotzone } = await import("./SidebarHotzone");
    const onActivate = vi.fn();
    const onHoverChange = vi.fn();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(SidebarHotzone, {
          expanded: false,
          onActivate,
          onHoverChange,
        })
      );
    });

    const hotzone = renderer.root.findByType("button");

    await act(async () => {
      hotzone.props.onPointerEnter();
      hotzone.props.onPointerDown({
        button: 0,
        buttons: 1,
        clientX: 12,
        clientY: 40,
      });
      hotzone.props.onPointerMove({
        buttons: 1,
        clientX: 18,
        clientY: 41,
      });
      hotzone.props.onPointerLeave();
      await Promise.resolve();
    });

    expect(onHoverChange).toHaveBeenNthCalledWith(1, true);
    expect(onHoverChange).toHaveBeenNthCalledWith(2, false);
    expect(onActivate).not.toHaveBeenCalled();
    expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
  });

  it("falls back to mouse dragging when pointer events are unreliable", async () => {
    const startCurrentWindowDrag = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/window-drag", () => ({
      startCurrentWindowDrag,
    }));
    const { SidebarHotzone } = await import("./SidebarHotzone");
    const onActivate = vi.fn();
    const onHoverChange = vi.fn();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(SidebarHotzone, {
          expanded: false,
          onActivate,
          onHoverChange,
        })
      );
    });

    const hotzone = renderer.root.findByType("button");

    await act(async () => {
      hotzone.props.onMouseEnter();
      hotzone.props.onMouseDown({
        button: 0,
        buttons: 1,
        clientX: 12,
        clientY: 40,
      });
      hotzone.props.onMouseMove({
        buttons: 1,
        clientX: 18,
        clientY: 42,
      });
      hotzone.props.onMouseLeave();
      await Promise.resolve();
    });

    expect(onHoverChange).toHaveBeenNthCalledWith(1, true);
    expect(onHoverChange).toHaveBeenNthCalledWith(2, false);
    expect(onActivate).not.toHaveBeenCalled();
    expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
  });

  it("activates the sidebar from an explicit click", async () => {
    const { SidebarHotzone } = await import("./SidebarHotzone");
    const onActivate = vi.fn();
    const onHoverChange = vi.fn();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(SidebarHotzone, {
          expanded: false,
          onActivate,
          onHoverChange,
        })
      );
    });

    const hotzone = renderer.root.findByType("button");

    await act(async () => {
      hotzone.props.onClick();
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
