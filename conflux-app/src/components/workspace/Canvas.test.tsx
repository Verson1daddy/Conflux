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

// 批3 §1：Canvas 数据源内化后从 agentStore selector 取 instances/statuses，
// mock state 形状跟随补齐（断言行为不变）。
vi.mock("@/stores/agentStore", () => ({
  useAgentStore: (selector: (state: any) => unknown) =>
    selector({
      expandedCardId: null,
      instances: new Map(),
      statuses: new Map(),
    }),
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

  // 旧 resolveGridVisuals（动态主格）用例已随 v5 删除——其语义由
  // src/lib/grid-model.test.ts 的连续权重 + 无跳变采样断言取代（spec §1.5）。

  it("does not trigger a deferred settle redraw while zoom interaction is still active", async () => {
    const { Canvas } = await import("./Canvas");
    TestRenderer.create(
      createElement(Canvas, {
        isFullscreen: false,
      }),
    );

    expect(windowMock.requestAnimationFrame.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("keeps the transform layer out of zoom transition mode after mount", async () => {
    const { Canvas } = await import("./Canvas");
    const renderer = TestRenderer.create(
      createElement(Canvas, {
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
        isFullscreen: false,
      }),
    );

    expect(windowMock.requestAnimationFrame.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
