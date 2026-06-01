import { createElement } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowMock = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  clearTimeout,
  setTimeout,
  requestAnimationFrame: vi.fn(() => 1),
  cancelAnimationFrame: vi.fn(),
};

globalThis.requestAnimationFrame = windowMock.requestAnimationFrame as typeof globalThis.requestAnimationFrame;
globalThis.cancelAnimationFrame = windowMock.cancelAnimationFrame as typeof globalThis.cancelAnimationFrame;

vi.stubGlobal("window", windowMock);

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: (selector: (state: any) => unknown) =>
    selector({
      cards: [],
      layoutMode: "free",
      selectedCardId: null,
      zoom: 1,
      pan: { x: 0, y: 0 },
      selectCard: vi.fn(),
      setZoom: vi.fn(),
      setPan: vi.fn(),
      fitAll: vi.fn(),
      autoArrange: vi.fn(),
    }),
}));

vi.mock("@/stores/agentStore", () => ({
  useAgentStore: (selector: (state: any) => unknown) =>
    selector({ expandedCardId: null }),
}));

vi.mock("@/hooks/useWorkspaceLayout", () => ({
  useWorkspaceLayout: () => ({ triggerAutoPack: vi.fn() }),
  shouldAutoFitOnCardsRestored: () => false,
}));

vi.mock("@/lib/canvas-viewport", () => ({
  fitCardsIntoViewport: vi.fn(),
  shouldDisablePinnedFilter: () => false,
  shouldFitCardsIntoViewport: () => false,
}));

vi.mock("@/lib/tauri-bridge", () => ({
  togglePinInstance: vi.fn(),
}));

vi.mock("./AgentCard", () => ({
  AgentCard: () => createElement("article", { "data-testid": "agent-card" }),
}));

vi.mock("./LayoutManager", () => ({
  LayoutManager: () => createElement("div", { "data-testid": "layout-manager" }),
}));

describe("Canvas grid layer", () => {
  beforeEach(() => {
    vi.resetModules();
    windowMock.addEventListener.mockClear();
    windowMock.removeEventListener.mockClear();
    windowMock.requestAnimationFrame.mockClear();
    windowMock.cancelAnimationFrame.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the free-mode grid visibly present while still tagging the active layout mode", async () => {
    const { Canvas } = await import("./Canvas");
    const renderer = TestRenderer.create(
      createElement(Canvas, {
        agents: new Map(),
        agentStatuses: new Map(),
        isFullscreen: false,
      }),
    );

    const grid = renderer.root.findByProps({ className: "canvas-grid-layer" });
    expect(grid.props["data-layout-mode"]).toBe("free");
    expect(grid.type).toBe("canvas");
    expect(grid.props.style.width).toBe("100%");
    expect(grid.props.style.height).toBe("100%");

    renderer.unmount();
  });

  it("keeps a four-level perceptible grid structure in the normal state", async () => {
    const { resolveGridVisuals } = await import("./Canvas");

    const visible = resolveGridVisuals(1).filter((level) => level.visible);

    expect(visible.map((level) => level.kind)).toEqual([
      "major",
      "subMajor",
      "minor",
      "micro",
    ]);
  });

  it("enters major emphasis gradually instead of snapping at the target size", async () => {
    const { resolveGridVisuals } = await import("./Canvas");

    const before = resolveGridVisuals(2.7).find((level) => level.kind === "major");
    const at = resolveGridVisuals(3.0).find((level) => level.kind === "major");
    const after = resolveGridVisuals(3.3).find((level) => level.kind === "major");

    expect(before?.alpha).toBeLessThan(at?.alpha ?? 0);
    expect(at?.alpha).toBeLessThan(after?.alpha ?? 1);
  });

  it("keeps the finest level gray for longer before clamp and hide", async () => {
    const { resolveGridVisuals } = await import("./Canvas");

    const stillGray = resolveGridVisuals(0.35).find((level) => level.kind === "micro");
    const clamped = resolveGridVisuals(0.2).find((level) => level.state === "blackClamped");
    const hidden = resolveGridVisuals(0.1).find((level) => level.state === "hidden");

    expect(stillGray?.state).toBe("weighted");
    expect(clamped?.state).toBe("blackClamped");
    expect(hidden?.state).toBe("hidden");
  });

  it("keeps the same major-family anchor through the 299% to 319% zoom band", async () => {
    const { resolveGridVisuals } = await import("./Canvas");

    for (const zoom of [2.99, 3.0, 3.1, 3.19]) {
      const majorFamily = resolveGridVisuals(zoom).filter(
        (level) => level.visible && (level.kind === "major" || level.kind === "majorCandidate"),
      );

      expect(majorFamily[0]?.worldSpacing).toBe(40);
    }
  });

  it("does not trigger a deferred settle redraw while zoom interaction is still active", async () => {
    const { Canvas } = await import("./Canvas");
    TestRenderer.create(
      createElement(Canvas, {
        agents: new Map(),
        agentStatuses: new Map(),
        isFullscreen: false,
      }),
    );

    expect(windowMock.requestAnimationFrame.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("keeps the transform layer out of zoom transition mode after mount", async () => {
    const { Canvas } = await import("./Canvas");
    const renderer = TestRenderer.create(
      createElement(Canvas, {
        agents: new Map(),
        agentStatuses: new Map(),
        isFullscreen: false,
      }),
    );

    const transformLayer = renderer.root.findByProps({
      className: "absolute top-0 left-0 origin-top-left canvas-transform-layer",
    });
    expect(transformLayer.props["data-zooming"]).toBeUndefined();

    renderer.unmount();
  });

  it("does not require a settle redraw to make the grid current after mount", async () => {
    const { Canvas } = await import("./Canvas");
    TestRenderer.create(
      createElement(Canvas, {
        agents: new Map(),
        agentStatuses: new Map(),
        isFullscreen: false,
      }),
    );

    expect(windowMock.requestAnimationFrame.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
