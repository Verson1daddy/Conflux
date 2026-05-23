import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("TopBar compact shortcut", () => {
  afterEach(() => {
    vi.doUnmock("@/stores/agentStore");
    vi.resetModules();
  });

  it("enters compact mode when the top bar background is double-clicked", async () => {
    vi.doMock("@/stores/agentStore", () => ({
      useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
        selector({ instances: new Map() }),
    }));

    const { TopBar } = await import("./TopBar");
    const onMinimize = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(TopBar, {
          onIslandOpen: vi.fn(),
          onMinimize,
          onQuickReplyOpen: vi.fn(),
          onDiscussionOpen: vi.fn(),
          onAddAgent: vi.fn(),
          onSearch: vi.fn(),
          onSettings: vi.fn(),
          onToggleFullscreen: vi.fn(),
          onClose: vi.fn(),
        })
      );
    });

    const topBar = renderer.root.findByType("header");

    await act(async () => {
      topBar.props.onDoubleClick({
        target: {
          closest: vi.fn(() => null),
        },
      });
    });

    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it("enters compact mode on the second titlebar mousedown before native drag handling can swallow dblclick", async () => {
    vi.doMock("@/stores/agentStore", () => ({
      useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
        selector({ instances: new Map() }),
    }));

    const { TopBar } = await import("./TopBar");
    const onMinimize = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(TopBar, {
          onIslandOpen: vi.fn(),
          onMinimize,
          onQuickReplyOpen: vi.fn(),
          onDiscussionOpen: vi.fn(),
          onAddAgent: vi.fn(),
          onSearch: vi.fn(),
          onSettings: vi.fn(),
          onToggleFullscreen: vi.fn(),
          onClose: vi.fn(),
        })
      );
    });

    const topBar = renderer.root.findByType("header");
    const event = {
      detail: 2,
      target: {
        closest: vi.fn(() => null),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    await act(async () => {
      topBar.props.onMouseDownCapture(event);
    });

    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("does not enter compact mode twice when the fallback mousedown is followed by dblclick", async () => {
    vi.doMock("@/stores/agentStore", () => ({
      useAgentStore: (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
        selector({ instances: new Map() }),
    }));

    const { TopBar } = await import("./TopBar");
    const onMinimize = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        createElement(TopBar, {
          onIslandOpen: vi.fn(),
          onMinimize,
          onQuickReplyOpen: vi.fn(),
          onDiscussionOpen: vi.fn(),
          onAddAgent: vi.fn(),
          onSearch: vi.fn(),
          onSettings: vi.fn(),
          onToggleFullscreen: vi.fn(),
          onClose: vi.fn(),
        })
      );
    });

    const topBar = renderer.root.findByType("header");
    const target = {
      closest: vi.fn(() => null),
    };

    await act(async () => {
      topBar.props.onMouseDownCapture({
        detail: 2,
        target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });
      topBar.props.onDoubleClick({
        target,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      });
    });

    expect(onMinimize).toHaveBeenCalledTimes(1);
  });
});
