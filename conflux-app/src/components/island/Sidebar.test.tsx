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
          nodeContainsText(node, "Needs attention")
      )[0];
    const count = notificationHeader?.findByProps({
      className: "sidebar-panel__section-count",
    });

    expect(count?.children).toEqual(["6"]);
  });
  it("uses brand rail semantics instead of open or hide labels", async () => {
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
          onUndock: vi.fn(),
        })
      );
    });

    const spineBrand = renderer.root.findAllByProps({ className: "sidebar-panel__spine-brand" });
    const logoBrand = renderer.root.findAllByProps({ className: "sidebar-panel__logo-mark" });

    expect(spineBrand).toHaveLength(0);
    expect(logoBrand).toHaveLength(1);
    expect(nodeContainsText(renderer.root, "Conflux")).toBe(true);
    expect(nodeContainsText(renderer.root, "Assistant rail")).toBe(true);
    expect(nodeContainsText(renderer.root, "Open workspace")).toBe(true);
    expect(nodeContainsText(renderer.root, "open")).toBe(false);
    expect(nodeContainsText(renderer.root, "hide")).toBe(false);
  });

  it("structures the expanded rail as a spine plus the 220px attention band", async () => {
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
          onUndock: vi.fn(),
        })
      );
    });

    const spine = renderer.root.findByProps({ className: "sidebar-panel__spine" });
    const band = renderer.root.findByProps({ className: "sidebar-panel__band" });
    const header = renderer.root.findByProps({ className: "sidebar-panel__header" });

    expect(spine.parent?.props["data-testid"]).toBe("sidebar-panel");
    expect(band.parent?.props["data-testid"]).toBe("sidebar-panel");
    expect(header.parent?.props.className).toBe("sidebar-panel__band");
    expect(
      header.findAll((node) => classNameIncludes(node.props.className, "sidebar-panel__drag-handle"))
    ).toHaveLength(0);
  });

  it("keeps the empty sidebar dense without fabricating live data", async () => {
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
          onUndock: vi.fn(),
        })
      );
    });

    expect(renderer.root.findAllByProps({ className: "sidebar-panel__empty-mascot" })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ className: "sidebar-panel__empty-agent-slot" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: "sidebar-panel__empty-notification-slot" })).toHaveLength(0);
    expect(nodeContainsText(renderer.root, "暂时还没创建 agent 框架哦")).toBe(true);
    expect(nodeContainsText(renderer.root, "创建后会在这里显示运行状态和需要处理的事项")).toBe(true);
    expect(nodeContainsText(renderer.root, "Standing by")).toBe(false);
    expect(nodeContainsText(renderer.root, "Quiet queue")).toBe(false);
    expect(nodeContainsText(renderer.root, "Boundary: monitor, approve, jump back.")).toBe(false);
    expect(renderer.root.findAllByProps({ className: "sidebar-panel__agent" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: "sidebar-panel__notification" })).toHaveLength(0);
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

  it("shows the scrape badge only for scrape-sourced permissions", async () => {
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

    const { useAttentionStore } = await import("@/stores/attentionStore");
    const { Sidebar } = await import("./Sidebar");

    const baseItem = {
      kind: "permission" as const,
      priority: "Critical" as const,
      source_event_id: null,
      payload_summary: "Wants to write pane.rs",
      available_actions: ["approve" as const, "deny" as const],
      jump_back_target_id: null,
      created_at: 1000,
      resolved_at: null,
      resolution: null,
      audit_event_id: null,
      permission_context: null,
      timeout_seconds: 120,
      remind_at: null,
    };
    act(() => {
      useAttentionStore.setState({
        hydrated: true,
        items: [
          {
            ...baseItem,
            attention_item_id: "attn-scrape",
            instance_id: "agent-s",
            interaction_id: "intr-s",
            signal_source: "scrape",
          },
          {
            ...baseItem,
            attention_item_id: "attn-hook",
            instance_id: "agent-h",
            interaction_id: "intr-h",
            signal_source: "hook",
          },
        ],
      });
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: () => undefined,
          onOpenWorkspace: () => undefined,
          onUndock: vi.fn(),
        })
      );
    });

    const badges = renderer.root.findAll((node) =>
      classNameIncludes(node.props.className, "signal-scrape-badge")
    );
    expect(badges.length).toBe(1);
    expect(nodeContainsText(renderer.root, "刮屏推断 · 可能误报")).toBe(true);

    act(() => {
      useAttentionStore.setState({ items: [], hydrated: false });
    });
  });

  it("clicking a permission row triggers jump-back with its target id", async () => {
    const executeJumpBack = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/jump-back", () => ({ executeJumpBack }));
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

    const { useAttentionStore } = await import("@/stores/attentionStore");
    const { Sidebar } = await import("./Sidebar");

    act(() => {
      useAttentionStore.setState({
        hydrated: true,
        items: [
          {
            attention_item_id: "attn-jb",
            instance_id: "agent-jb",
            kind: "permission",
            priority: "Critical",
            source_event_id: null,
            interaction_id: "intr-jb",
            payload_summary: "Wants to write pane.rs",
            available_actions: ["approve", "deny"],
            jump_back_target_id: "jb-1",
            created_at: 1000,
            resolved_at: null,
            resolution: null,
            audit_event_id: null,
            permission_context: null,
            timeout_seconds: 120,
            remind_at: null,
            signal_source: "hook",
          },
        ],
      });
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: () => undefined,
          onOpenWorkspace: () => undefined,
          onUndock: vi.fn(),
        })
      );
    });

    const row = renderer.root.findAll((node) =>
      classNameIncludes(node.props.className, "sidebar-panel__notification--jumpable")
    )[0];
    expect(row).toBeTruthy();

    await act(async () => {
      row.props.onClick();
    });

    expect(executeJumpBack).toHaveBeenCalledWith("jb-1");

    act(() => {
      useAttentionStore.setState({ items: [], hydrated: false });
    });
    vi.doUnmock("@/lib/jump-back");
  });
});
