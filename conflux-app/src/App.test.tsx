import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("App event bridge", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/i18n");
    vi.doUnmock("@tauri-apps/api/window");
    vi.doUnmock("./hooks/useAgentInstances");
    vi.doUnmock("./hooks/useIslandMode");
    vi.doUnmock("./hooks/useIsFullscreen");
    vi.doUnmock("./stores/agentStore");
    vi.doUnmock("./stores/islandStore");
    vi.doUnmock("./components/workspace/Canvas");
    vi.doUnmock("./components/workspace/TopBar");
    vi.doUnmock("./components/workspace/StatusBar");
    vi.doUnmock("./components/workspace/CloseConfirmModal");
    vi.doUnmock("./components/workspace/OnboardingWizard");
    vi.doUnmock("./components/workspace/QuickTour");
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("mounts the island mode hook so backend events reach notifications and permissions", async () => {
    const useIslandMode = vi.fn(() => ({
      mode: "top_island",
      switchMode: vi.fn(),
      listAgentInstances: vi.fn(),
      isHydrated: true,
    }));
    const setIslandMode = vi.fn();
    const openDiscussionWizard = vi.fn();
    const onCloseRequested = vi.fn(() => Promise.resolve(() => undefined));
    const setFullscreen = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) =>
        key === "conflux.onboarded.v1" ? "true" : null,
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    vi.doMock("@/lib/i18n", () => ({}));
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        label: "main",
        onCloseRequested,
        isFullscreen: vi.fn().mockResolvedValue(false),
        setFullscreen,
      }),
    }));
    // 批3 §1：App 改用副作用层 useAgentInstancesSync（不再订阅数据 Map），
    // mock 形状跟随重构（断言行为不变）。
    vi.doMock("./hooks/useAgentInstances", () => ({
      useAgentInstancesSync: () => ({ refresh: vi.fn() }),
    }));
    vi.doMock("./hooks/useIslandMode", () => ({ useIslandMode }));
    vi.doMock("./hooks/useIsFullscreen", () => ({
      useIsFullscreen: () => false,
    }));
    vi.doMock("./stores/agentStore", () => ({
      useAgentStore: (selector: (state: unknown) => unknown) =>
        selector({
          expandedCardId: null,
          discussion: { open: false },
          openDiscussionWizard,
        }),
    }));
    vi.doMock("./stores/islandStore", () => ({
      useIslandStore: (selector: (state: unknown) => unknown) =>
        selector({ setMode: setIslandMode }),
    }));
    vi.doMock("./components/workspace/Canvas", () => ({
      Canvas: () => createElement("main", { "data-testid": "canvas" }),
    }));
    vi.doMock("./components/workspace/TopBar", () => ({
      TopBar: () => createElement("header", { "data-testid": "topbar" }),
    }));
    vi.doMock("./components/workspace/StatusBar", () => ({
      StatusBar: () => createElement("footer", { "data-testid": "statusbar" }),
    }));
    vi.doMock("./components/workspace/CloseConfirmModal", () => ({
      CloseConfirmModal: () => null,
    }));

    const { default: App } = await import("./App");

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(App));
      await Promise.resolve();
    });

    expect(useIslandMode).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });

  it("toggles fullscreen when the TopBar fullscreen button is used", async () => {
    const useIslandMode = vi.fn(() => ({
      mode: "top_island",
      switchMode: vi.fn(),
      listAgentInstances: vi.fn(),
      isHydrated: true,
    }));
    const onCloseRequested = vi.fn(() => Promise.resolve(() => undefined));
    const setFullscreen = vi.fn().mockResolvedValue(undefined);
    const topBarPropsRef: { current: Record<string, unknown> | null } = { current: null };

    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    vi.doMock("@/lib/i18n", () => ({}));
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        label: "main",
        onCloseRequested,
        isFullscreen: vi.fn().mockResolvedValue(false),
        setFullscreen,
      }),
    }));
    // 批3 §1：App 改用副作用层 useAgentInstancesSync（不再订阅数据 Map），
    // mock 形状跟随重构（断言行为不变）。
    vi.doMock("./hooks/useAgentInstances", () => ({
      useAgentInstancesSync: () => ({ refresh: vi.fn() }),
    }));
    vi.doMock("./hooks/useIslandMode", () => ({ useIslandMode }));
    vi.doMock("./hooks/useIsFullscreen", () => ({
      useIsFullscreen: () => false,
    }));
    vi.doMock("./stores/agentStore", () => ({
      useAgentStore: (selector: (state: unknown) => unknown) =>
        selector({
          expandedCardId: null,
          discussion: { open: false },
          openDiscussionWizard: vi.fn(),
        }),
    }));
    vi.doMock("./stores/islandStore", () => ({
      useIslandStore: (selector: (state: unknown) => unknown) =>
        selector({ setMode: vi.fn() }),
    }));
    vi.doMock("./components/workspace/Canvas", () => ({
      Canvas: () => createElement("main", { "data-testid": "canvas" }),
    }));
    vi.doMock("./components/workspace/TopBar", () => ({
      TopBar: (props: Record<string, unknown>) => {
        topBarPropsRef.current = props;
        return createElement("header", { "data-testid": "topbar" });
      },
    }));
    vi.doMock("./components/workspace/StatusBar", () => ({
      StatusBar: () => createElement("footer", { "data-testid": "statusbar" }),
    }));
    vi.doMock("./components/workspace/CloseConfirmModal", () => ({
      CloseConfirmModal: () => null,
    }));

    const { default: App } = await import("./App");

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(App));
      await Promise.resolve();
    });

    await act(async () => {
      await (topBarPropsRef.current?.onToggleFullscreen as (() => Promise<void>) | undefined)?.();
    });

    expect(setFullscreen).toHaveBeenCalledWith(true);

    await act(async () => {
      renderer.unmount();
    });
  });

  it("does not block a fresh workspace with automatic onboarding", async () => {
    const useIslandMode = vi.fn(() => ({
      mode: "top_island",
      switchMode: vi.fn(),
      listAgentInstances: vi.fn(),
      isHydrated: true,
    }));
    const onCloseRequested = vi.fn(() => Promise.resolve(() => undefined));
    const setFullscreen = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    vi.doMock("@/lib/i18n", () => ({}));
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        label: "main",
        onCloseRequested,
        isFullscreen: vi.fn().mockResolvedValue(false),
        setFullscreen,
      }),
    }));
    // 批3 §1：App 改用副作用层 useAgentInstancesSync（不再订阅数据 Map），
    // mock 形状跟随重构（断言行为不变）。
    vi.doMock("./hooks/useAgentInstances", () => ({
      useAgentInstancesSync: () => ({ refresh: vi.fn() }),
    }));
    vi.doMock("./hooks/useIslandMode", () => ({ useIslandMode }));
    vi.doMock("./hooks/useIsFullscreen", () => ({
      useIsFullscreen: () => false,
    }));
    vi.doMock("./stores/agentStore", () => ({
      useAgentStore: (selector: (state: unknown) => unknown) =>
        selector({
          expandedCardId: null,
          discussion: { open: false },
          openDiscussionWizard: vi.fn(),
        }),
    }));
    vi.doMock("./stores/islandStore", () => ({
      useIslandStore: (selector: (state: unknown) => unknown) =>
        selector({ setMode: vi.fn() }),
    }));
    vi.doMock("./components/workspace/Canvas", () => ({
      Canvas: () => createElement("main", { "data-testid": "canvas" }),
    }));
    vi.doMock("./components/workspace/TopBar", () => ({
      TopBar: () => createElement("header", { "data-testid": "topbar" }),
    }));
    vi.doMock("./components/workspace/StatusBar", () => ({
      StatusBar: () => createElement("footer", { "data-testid": "statusbar" }),
    }));
    vi.doMock("./components/workspace/CloseConfirmModal", () => ({
      CloseConfirmModal: () => null,
    }));
    vi.doMock("./components/workspace/OnboardingWizard", () => ({
      OnboardingWizard: () => createElement("section", { "data-testid": "onboarding" }),
    }));
    vi.doMock("./components/workspace/QuickTour", () => ({
      QuickTour: () => createElement("aside", { "data-testid": "quick-tour" }),
    }));

    const { default: App } = await import("./App");

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(App));
      await Promise.resolve();
      await Promise.resolve();
    });

    const tree = renderer.root;
    expect(tree.findAllByProps({ "data-testid": "canvas" })).toHaveLength(1);
    expect(tree.findAllByProps({ "data-testid": "onboarding" })).toHaveLength(0);
    expect(tree.findAllByProps({ "data-testid": "quick-tour" })).toHaveLength(0);

    await act(async () => {
      renderer.unmount();
    });
  });
});
