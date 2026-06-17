import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

function nodeContainsText(node: TestRenderer.ReactTestInstance, text: RegExp): boolean {
  return node.findAll((child) =>
    child.children.some((value) => typeof value === "string" && text.test(value))
  ).length > 0;
}

describe("TopIsland brand capsule", () => {
  afterEach(() => {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.resetModules();
  });

  it("renders Conflux as the capsule identity in collapsed mode", async () => {
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          pendingPermissions: [];
          notifications: [];
          unreadCount: number;
        }) => unknown
      ) =>
        selector({
          pendingPermissions: [],
          notifications: [],
          unreadCount: 0,
        }),
    }));
    vi.doMock("@/stores/agentStore", () => ({
      useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
        selector({
          instances: new Map([
            ["agent-1", { instance_id: "agent-1", status: "coding", last_activity_at: 3, ended_at: null, hidden: false }],
            ["agent-2", { instance_id: "agent-2", status: "idle", last_activity_at: 2, ended_at: null, hidden: false }],
            ["agent-3", { instance_id: "agent-3", status: "done", last_activity_at: 1, ended_at: null, hidden: false }],
          ]),
        }),
    }));

    const { TopIsland } = await import("./TopIsland");
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(TopIsland, {
          presentation: "collapsed",
          onExpand: vi.fn(),
        })
      );
    });

    expect(nodeContainsText(renderer.root, /Conflux/i)).toBe(true);
    expect(nodeContainsText(renderer.root, /3 agents/i)).toBe(true);
    expect(
      renderer.root.findAll(
        (node) =>
          node.type === "svg" &&
          typeof node.props.className === "string" &&
          node.props.className.includes("conflux-brand-mark")
      ).length
    ).toBeGreaterThan(0);
  });
});
