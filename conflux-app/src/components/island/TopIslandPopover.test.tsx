import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let TopIslandPopover: typeof import("./TopIslandPopover").TopIslandPopover;

const bridgeMocks = {
  respondToPermission: vi.fn(),
  setTopIslandPopoverHeight: vi.fn(() => Promise.resolve()),
};

let resizeCallback: (() => void) | null = null;

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(callback: () => void) {
    resizeCallback = callback;
  }
}

function setupWindow() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 420,
      innerHeight: 520,
    },
  });

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserver,
  });
}

function createPopoverNode() {
  return {
    getBoundingClientRect: () => ({ height: 118 }),
    scrollHeight: 118,
  };
}

describe("TopIslandPopover lifecycle", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          pendingPermissions: unknown[];
          notifications: unknown[];
          unreadCount: number;
          removePermissionRequest: ReturnType<typeof vi.fn>;
          clearNotification: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          pendingPermissions: [],
          notifications: [],
          unreadCount: 0,
          removePermissionRequest: vi.fn(),
          clearNotification: vi.fn(),
        }),
    }));
    vi.doMock("@/stores/agentStore", () => ({
      useAgentStore: (
        selector: (state: {
          instances: Map<string, unknown>;
          openDiscussionWizard: ReturnType<typeof vi.fn>;
          setDiscussionDirection: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          instances: new Map(),
          openDiscussionWizard: vi.fn(),
          setDiscussionDirection: vi.fn(),
        }),
    }));
    vi.doMock("@/lib/tauri-bridge", () => bridgeMocks);
    setupWindow();
    resizeCallback = null;
    bridgeMocks.setTopIslandPopoverHeight.mockClear();

    ({ TopIslandPopover } = await import("./TopIslandPopover"));
  });

  afterEach(() => {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.resetModules();
  });

  it("uses a branded attention heading", () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        createElement(TopIslandPopover, {
          anchor: { x: 200, y: 64 },
          view: "details",
          onClose: vi.fn(),
          onRestoreWorkspace: vi.fn(),
        }),
        {
          createNodeMock: (element) =>
            typeof element.props.className === "string" &&
            element.props.className.includes("top-island-popover")
              ? createPopoverNode()
              : null,
        }
      );
    });

    expect(
      renderer.root.findAll((node) => node.children.includes("Conflux attention")).length
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAll(
        (node) =>
          node.type === "svg" &&
          typeof node.props.className === "string" &&
          node.props.className.includes("conflux-brand-mark")
      ).length
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAll((node) => node.children.includes("Open workspace")).length
    ).toBeGreaterThan(0);
  });

  it("ignores stale resize callbacks after the popover unmounts", () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        createElement(TopIslandPopover, {
          anchor: { x: 200, y: 64 },
          view: "details",
          onClose: vi.fn(),
          onRestoreWorkspace: vi.fn(),
        }),
        {
          createNodeMock: (element) =>
            typeof element.props.className === "string" &&
            element.props.className.includes("top-island-popover")
              ? createPopoverNode()
              : null,
        }
      );
    });

    expect(bridgeMocks.setTopIslandPopoverHeight).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.unmount();
    });

    act(() => {
      resizeCallback?.();
    });

    expect(bridgeMocks.setTopIslandPopoverHeight).toHaveBeenCalledTimes(1);
  });
});
