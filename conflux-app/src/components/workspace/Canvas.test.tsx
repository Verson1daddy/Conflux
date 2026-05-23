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
    windowMock.addEventListener.mockClear();
    windowMock.removeEventListener.mockClear();
    windowMock.requestAnimationFrame.mockClear();
    windowMock.cancelAnimationFrame.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the free-mode grid visibly present while still tagging the active layout mode", async () => {
    vi.doMock("@/stores/workspaceStore", () => ({
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
});
