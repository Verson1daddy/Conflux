import { createElement, type FC } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentInstanceInfo,
  IslandMode,
  PermissionRequestedPayload,
} from "@/types";

describe("useIslandMode hydration", () => {
  afterEach(() => {
    vi.doUnmock("@/stores/islandStore");
    vi.doUnmock("@/stores/agentStore");
    vi.doUnmock("@/lib/tauri-bridge");
    vi.doUnmock("@/lib/event-listener");
    vi.doUnmock("@/lib/system-notifications");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps a persisted sidebar preference when the backend still reports the default top island", async () => {
    const setMode = vi.fn();
    const getIslandMode = vi.fn().mockResolvedValue("top_island");
    const listener = vi.fn().mockResolvedValue(() => undefined);
    const localStorageMock = {
      getItem: vi.fn((key: string) =>
        key === "conflux.islandMode" ? "sidebar" : null
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const snapshots: Array<{ mode: IslandMode; isHydrated: boolean }> = [];

    vi.stubGlobal("localStorage", localStorageMock);
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          mode: IslandMode;
          setMode: typeof setMode;
          addNotification: ReturnType<typeof vi.fn>;
          addPermissionRequest: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          mode: "sidebar",
          setMode,
          addNotification: vi.fn(),
          addPermissionRequest: vi.fn(),
        }),
    }));
    vi.doMock("@/stores/agentStore", () => {
      const useAgentStore = Object.assign(
        (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
          selector({ instances: new Map() }),
        {
          getState: () => ({ instances: new Map() }),
        }
      );
      return { useAgentStore };
    });
    vi.doMock("@/lib/tauri-bridge", () => ({
      getIslandMode,
      listAgentInstances: vi.fn(),
      switchIslandMode: vi.fn(),
    }));
    vi.doMock("@/lib/event-listener", () => ({
      onErrorOccurred: listener,
      onIslandModeChanged: listener,
      onPermissionRequested: listener,
      onTaskCompleted: listener,
    }));
    vi.doMock("@/lib/system-notifications", () => ({
      showSystemNotification: vi.fn(),
    }));

    const { useIslandMode } = await import("./useIslandMode");
    const Probe: FC = () => {
      const snapshot = useIslandMode();
      snapshots.push({
        mode: snapshot.mode,
        isHydrated: snapshot.isHydrated,
      });
      return null;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getIslandMode).toHaveBeenCalledTimes(1);
    expect(setMode).not.toHaveBeenCalledWith("top_island");
    expect(snapshots[snapshots.length - 1]).toEqual({
      mode: "sidebar",
      isHydrated: true,
    });

    await act(async () => {
      renderer.unmount();
    });
  });

  it("lets compact island windows use the backend mode as the native geometry authority", async () => {
    const setMode = vi.fn();
    const getIslandMode = vi.fn().mockResolvedValue("sidebar");
    const listener = vi.fn().mockResolvedValue(() => undefined);
    const localStorageMock = {
      getItem: vi.fn((key: string) =>
        key === "conflux.islandMode" ? "top_island" : null
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const snapshots: Array<{ mode: IslandMode; isHydrated: boolean }> = [];

    vi.stubGlobal("localStorage", localStorageMock);
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          mode: IslandMode;
          setMode: typeof setMode;
          addNotification: ReturnType<typeof vi.fn>;
          addPermissionRequest: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          mode: "top_island",
          setMode,
          addNotification: vi.fn(),
          addPermissionRequest: vi.fn(),
        }),
    }));
    vi.doMock("@/stores/agentStore", () => {
      const useAgentStore = Object.assign(
        (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
          selector({ instances: new Map() }),
        {
          getState: () => ({ instances: new Map() }),
        }
      );
      return { useAgentStore };
    });
    vi.doMock("@/lib/tauri-bridge", () => ({
      getIslandMode,
      listAgentInstances: vi.fn(),
      switchIslandMode: vi.fn(),
    }));
    vi.doMock("@/lib/event-listener", () => ({
      onErrorOccurred: listener,
      onIslandModeChanged: listener,
      onPermissionRequested: listener,
      onTaskCompleted: listener,
    }));
    vi.doMock("@/lib/system-notifications", () => ({
      showSystemNotification: vi.fn(),
    }));

    const { useIslandMode } = await import("./useIslandMode");
    const Probe: FC = () => {
      const snapshot = useIslandMode({ preferBackendMode: true });
      snapshots.push({
        mode: snapshot.mode,
        isHydrated: snapshot.isHydrated,
      });
      return null;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getIslandMode).toHaveBeenCalledTimes(1);
    expect(setMode).toHaveBeenCalledWith("sidebar");
    expect(snapshots[snapshots.length - 1].isHydrated).toBe(true);

    await act(async () => {
      renderer.unmount();
    });
  });

  it("lets compact island windows accept backend mode-change events over stale local preference", async () => {
    const setMode = vi.fn();
    const getIslandMode = vi.fn().mockResolvedValue("sidebar");
    const genericListener = vi.fn().mockResolvedValue(() => undefined);
    let islandModeHandler: ((mode: IslandMode) => void) | null = null;

    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) =>
        key === "conflux.islandMode" ? "top_island" : null
      ),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          mode: IslandMode;
          setMode: typeof setMode;
          addNotification: ReturnType<typeof vi.fn>;
          addPermissionRequest: ReturnType<typeof vi.fn>;
        }) => unknown
      ) =>
        selector({
          mode: "top_island",
          setMode,
          addNotification: vi.fn(),
          addPermissionRequest: vi.fn(),
        }),
    }));
    vi.doMock("@/stores/agentStore", () => {
      const useAgentStore = Object.assign(
        (selector: (state: { instances: Map<string, unknown> }) => unknown) =>
          selector({ instances: new Map() }),
        {
          getState: () => ({ instances: new Map() }),
        }
      );
      return { useAgentStore };
    });
    vi.doMock("@/lib/tauri-bridge", () => ({
      getIslandMode,
      listAgentInstances: vi.fn(),
      switchIslandMode: vi.fn(),
    }));
    vi.doMock("@/lib/event-listener", () => ({
      onErrorOccurred: genericListener,
      onIslandModeChanged: vi.fn((callback: (mode: IslandMode) => void) => {
        islandModeHandler = callback;
        return Promise.resolve(() => undefined);
      }),
      onPermissionRequested: genericListener,
      onTaskCompleted: genericListener,
    }));
    vi.doMock("@/lib/system-notifications", () => ({
      showSystemNotification: vi.fn(),
    }));

    const { useIslandMode } = await import("./useIslandMode");
    const Probe: FC = () => {
      useIslandMode({ preferBackendMode: true });
      return null;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    setMode.mockClear();
    await act(async () => {
      islandModeHandler?.("sidebar");
    });

    expect(setMode).toHaveBeenCalledWith("sidebar");

    await act(async () => {
      renderer.unmount();
    });
  });

  it("passes the resolved adapter name into permission requests", async () => {
    const addPermissionRequest = vi.fn();
    const showSystemNotification = vi.fn().mockResolvedValue(undefined);
    let permissionHandler: ((payload: PermissionRequestedPayload) => void) | null =
      null;
    const listener = vi.fn().mockResolvedValue(() => undefined);
    const codexInstance: AgentInstanceInfo = {
      instance_id: "agent-1",
      adapter_id: "codex",
      adapter_name: "Codex",
      display_name: null,
      status: "waiting_permission",
      working_dir: "D:\\repo",
      is_pinned: false,
      created_at: 1000,
      last_activity_at: 1000,
      ended_at: null,
      mode: "full",
      hidden: false,
    };

    vi.stubGlobal("localStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.doMock("@/stores/islandStore", () => ({
      useIslandStore: (
        selector: (state: {
          mode: IslandMode;
          setMode: ReturnType<typeof vi.fn>;
          addNotification: ReturnType<typeof vi.fn>;
          addPermissionRequest: typeof addPermissionRequest;
        }) => unknown
      ) =>
        selector({
          mode: "top_island",
          setMode: vi.fn(),
          addNotification: vi.fn(),
          addPermissionRequest,
        }),
    }));
    vi.doMock("@/stores/agentStore", () => {
      const instances = new Map([[codexInstance.instance_id, codexInstance]]);
      const useAgentStore = Object.assign(
        (selector: (state: { instances: typeof instances }) => unknown) =>
          selector({ instances }),
        {
          getState: () => ({ instances }),
        }
      );
      return { useAgentStore };
    });
    vi.doMock("@/lib/tauri-bridge", () => ({
      getIslandMode: vi.fn().mockResolvedValue("top_island"),
      listAgentInstances: vi.fn(),
      switchIslandMode: vi.fn(),
    }));
    vi.doMock("@/lib/event-listener", () => ({
      onErrorOccurred: listener,
      onIslandModeChanged: listener,
      onPermissionRequested: vi.fn(
        (callback: (payload: PermissionRequestedPayload) => void) => {
          permissionHandler = callback;
          return Promise.resolve(() => undefined);
        }
      ),
      onTaskCompleted: listener,
    }));
    vi.doMock("@/lib/system-notifications", () => ({
      showSystemNotification,
    }));

    const { useIslandMode } = await import("./useIslandMode");
    const Probe: FC = () => {
      useIslandMode();
      return null;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      permissionHandler?.({
        instance_id: "agent-1",
        request: {
          id: "perm-1",
          instance_id: "agent-1",
          action: "shell",
          description: "Approve shell command",
          raw_context: [],
          status: "pending",
          created_at: 1000,
          timeout_seconds: 120,
        },
        timestamp: 1234,
      });
    });

    expect(addPermissionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "perm-1",
        created_at: 1234,
        source_adapter_name: "Codex",
      })
    );
    expect(showSystemNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Codex",
        tag: "perm-1",
      })
    );

    await act(async () => {
      renderer.unmount();
    });
  });
});
