import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "@/types/interaction";

// ===== 控制面 P5 · §17.1 同源投影契约 =====
// TopIsland 与 Sidebar 必须从同一 attentionStore selector（useActivePermissions）读取
// 待处理权限态。这里用同一组后端投影项喂两个组件，断言两者渲染一致——不存在第二份
// 各自维护的权限队列（旧 islandStore.pendingPermissions 已删除）。

function permissionItem(id: string, summary: string): AttentionItem {
  return {
    attention_item_id: `attn-${id}`,
    instance_id: `agent-${id}`,
    kind: "permission",
    priority: "Critical",
    source_event_id: null,
    interaction_id: id,
    payload_summary: summary,
    available_actions: ["approve", "deny"],
    jump_back_target_id: null,
    created_at: 1000,
    resolved_at: null,
    resolution: null,
    audit_event_id: null,
    permission_context: null,
    timeout_seconds: 120,
    remind_at: null,
    signal_source: null,
  };
}

/** 用同一组活跃项装上 attentionStore 投影 mock（两个组件共用这唯一真相源）。 */
function mockSharedAttention(items: AttentionItem[]) {
  vi.doMock("@/stores/attentionStore", () => ({
    useActivePermissions: () => items,
    useActiveAttentionItems: () => items,
    useActiveAttentionCount: () => items.length,
    useDeferredAttentionItems: () => [],
  }));
}

function mockIslandStore() {
  vi.doMock("@/stores/islandStore", () => ({
    useIslandStore: (
      selector: (state: {
        notifications: [];
        unreadCount: number;
        clearNotification: ReturnType<typeof vi.fn>;
      }) => unknown
    ) => selector({ notifications: [], unreadCount: 0, clearNotification: vi.fn() }),
  }));
}

/** 一个活着的实例（ended_at=null / 未隐藏）——权限项的来源 agent 需活着才渲染 Allow/Deny。 */
function liveInstance(instanceId: string) {
  return {
    instance_id: instanceId,
    adapter_id: "claude-code",
    adapter_name: "Claude Code",
    display_name: null,
    status: "coding",
    working_dir: null,
    created_at: 1000,
    last_activity_at: 2000,
    ended_at: null,
    hidden: false,
  };
}

function mockAgentStore(liveIds: string[] = []) {
  const instances = new Map(liveIds.map((id) => [id, liveInstance(id)]));
  vi.doMock("@/stores/agentStore", () => ({
    agentDisplayLabel: (agent: { instance_id: string }) => agent.instance_id,
    useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
      selector({ instances }),
  }));
}

describe("control-plane attention same-source projection (§17.1)", () => {
  afterEach(() => {
    vi.doUnmock("@/stores/attentionStore");
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.doUnmock("@/lib/window-drag");
    vi.resetModules();
  });

  it("TopIsland and Sidebar render the same active permissions from one selector", async () => {
    const items = [
      permissionItem("perm-1", "Approve shell command"),
      permissionItem("perm-2", "Review migration plan"),
    ];

    vi.resetModules();
    mockSharedAttention(items);
    mockIslandStore();
    // 权限项的来源 agent 都活着 → Sidebar 渲染 Allow/Deny（非孤儿清除态）。
    mockAgentStore(items.map((item) => item.instance_id));
    vi.doMock("@/lib/tauri-bridge", () => ({
      focusAgentCard: vi.fn(),
      respondToPermission: vi.fn(),
      ignoreAttentionItem: vi.fn(),
    }));
    vi.doMock("@/lib/window-drag", () => ({
      startCurrentWindowDrag: vi.fn().mockResolvedValue(undefined),
    }));

    const { TopIsland } = await import("./TopIsland");
    const { Sidebar } = await import("./Sidebar");

    let topRenderer!: TestRenderer.ReactTestRenderer;
    let sidebarRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      topRenderer = TestRenderer.create(
        createElement(TopIsland, { presentation: "collapsed", onExpand: vi.fn() })
      );
      sidebarRenderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: () => undefined,
          onOpenWorkspace: () => undefined,
        })
      );
    });

    // TopIsland：因 permissionCount > 0 进入 permission 视觉态。
    const permissionStateNodes = topRenderer.root.findAll(
      (node) => node.props["data-visual-state"] === "permission"
    );
    expect(permissionStateNodes.length).toBeGreaterThan(0);
    // 首条权限摘要出现在岛胶囊里。
    expect(
      topRenderer.root.findAll((node) =>
        node.children.includes("Approve shell command")
      ).length
    ).toBeGreaterThan(0);

    // Sidebar："Needs attention" 计数与同一来源一致（2 条权限 + 0 通知）。
    const needsAttentionHeader = sidebarRenderer.root
      .findAll(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.split(/\s+/).includes("sidebar-panel__section-header") &&
          node.findAll((child) => child.children.includes("Needs attention")).length > 0
      )[0];
    const count = needsAttentionHeader?.findByProps({
      className: "sidebar-panel__section-count",
    });
    expect(count?.children).toEqual([String(items.length)]);

    // Sidebar 渲染每条权限卡的 Allow/Deny（来自同一 selector）。
    const allowButtons = sidebarRenderer.root
      .findAllByType("button")
      .filter((node) => node.props.children === "Allow");
    expect(allowButtons).toHaveLength(items.length);
    expect(
      sidebarRenderer.root.findAll((node) =>
        node.children.includes("Approve shell command")
      ).length
    ).toBeGreaterThan(0);

    await act(async () => {
      topRenderer.unmount();
      sidebarRenderer.unmount();
    });
  });

  it("both surfaces fall back to the idle/empty shape when the shared selector is empty", async () => {
    vi.resetModules();
    mockSharedAttention([]);
    mockIslandStore();
    mockAgentStore();
    vi.doMock("@/lib/tauri-bridge", () => ({
      focusAgentCard: vi.fn(),
      respondToPermission: vi.fn(),
    }));
    vi.doMock("@/lib/window-drag", () => ({
      startCurrentWindowDrag: vi.fn().mockResolvedValue(undefined),
    }));

    const { TopIsland } = await import("./TopIsland");
    const { Sidebar } = await import("./Sidebar");

    let topRenderer!: TestRenderer.ReactTestRenderer;
    let sidebarRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      topRenderer = TestRenderer.create(
        createElement(TopIsland, { presentation: "collapsed", onExpand: vi.fn() })
      );
      sidebarRenderer = TestRenderer.create(
        createElement(Sidebar, {
          expanded: true,
          onCollapse: () => undefined,
          onOpenWorkspace: () => undefined,
        })
      );
    });

    // TopIsland 不进入 permission 态。
    expect(
      topRenderer.root.findAll(
        (node) => node.props["data-visual-state"] === "permission"
      )
    ).toHaveLength(0);

    // Sidebar "Needs attention" 计数为 0，无 Allow 按钮。
    const count = sidebarRenderer.root
      .findAll(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.split(/\s+/).includes("sidebar-panel__section-header") &&
          node.findAll((child) => child.children.includes("Needs attention")).length > 0
      )[0]
      ?.findByProps({ className: "sidebar-panel__section-count" });
    expect(count?.children).toEqual(["0"]);
    expect(
      sidebarRenderer.root
        .findAllByType("button")
        .filter((node) => node.props.children === "Allow")
    ).toHaveLength(0);

    await act(async () => {
      topRenderer.unmount();
      sidebarRenderer.unmount();
    });
  });
});
