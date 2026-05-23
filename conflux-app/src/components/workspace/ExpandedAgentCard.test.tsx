import React, { Suspense } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInstanceInfo } from "@/types";

let ExpandedAgentCard: typeof import("./ExpandedAgentCard").ExpandedAgentCard;
let useAgentStore: typeof import("@/stores/agentStore").useAgentStore;

const terminalLifecycle = {
  mounts: [] as string[],
  unmounts: [] as string[],
};

function makeInstance(instanceId: string, workingDir: string): AgentInstanceInfo {
  return {
    instance_id: instanceId,
    adapter_id: "codex",
    adapter_name: "Codex",
    display_name: null,
    status: "idle",
    working_dir: workingDir,
    is_pinned: false,
    created_at: 1_000,
    last_activity_at: 1_000,
    ended_at: null,
    mode: "full",
    hidden: false,
  };
}

beforeAll(async () => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      innerWidth: 1280,
    },
  });

  vi.doMock("@/lib/event-listener", () => ({
    onSubAgentCompleted: vi.fn(() => Promise.resolve(() => undefined)),
    onSubAgentSpawned: vi.fn(() => Promise.resolve(() => undefined)),
  }));

  vi.doMock("@/lib/tauri-bridge", () => ({
    getAgentTree: vi.fn(() => Promise.reject(new Error("backend unavailable in test"))),
  }));

  vi.doMock("./XtermTerminal", () => ({
    XtermTerminal: ({ instanceId }: { instanceId: string }) => {
      React.useEffect(() => {
        terminalLifecycle.mounts.push(instanceId);
        return () => {
          terminalLifecycle.unmounts.push(instanceId);
        };
      }, []);
      return React.createElement("mock-xterm", { instanceId });
    },
  }));

  ({ useAgentStore } = await import("@/stores/agentStore"));
  ({ ExpandedAgentCard } = await import("./ExpandedAgentCard"));
});

beforeEach(() => {
  terminalLifecycle.mounts = [];
  terminalLifecycle.unmounts = [];
  useAgentStore.setState({
    instances: new Map([
      ["agent-c-users", makeInstance("agent-c-users", "C:\\Users\\zwm")],
      [
        "agent-src-tauri",
        makeInstance(
          "agent-src-tauri",
          "D:\\Trae_rela_pro\\Conflux\\conflux-app\\src-tauri"
        ),
      ],
    ]),
    statuses: new Map([
      ["agent-c-users", "idle"],
      ["agent-src-tauri", "idle"],
    ]),
    trees: new Map(),
    exitStates: new Map(),
    expandedCardId: null,
  });
});

describe("ExpandedAgentCard terminal binding", () => {
  it("bounds the interactive terminal in a non-scrolling flex region", async () => {
    let renderer!: ReactTestRenderer;
    const flushLazyImports = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 0));

    await act(async () => {
      renderer = create(
        <Suspense fallback={null}>
          <ExpandedAgentCard instanceId="agent-c-users" />
        </Suspense>
      );
      await flushLazyImports();
    });

    const terminalRegion = renderer.root.findByProps({
      "data-testid": "expanded-terminal-region",
    });

    expect(terminalRegion.props.className).toContain("flex-1");
    expect(terminalRegion.props.className).toContain("min-h-0");
    expect(terminalRegion.props.className).toContain("overflow-hidden");
  });

  it("remounts xterm when the expanded instance changes", async () => {
    let renderer!: ReactTestRenderer;
    const flushLazyImports = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 0));

    await act(async () => {
      renderer = create(
        <Suspense fallback={null}>
          <ExpandedAgentCard instanceId="agent-c-users" />
        </Suspense>
      );
      await flushLazyImports();
    });

    expect(terminalLifecycle.mounts).toEqual(["agent-c-users"]);

    await act(async () => {
      renderer.update(
        <Suspense fallback={null}>
          <ExpandedAgentCard instanceId="agent-src-tauri" />
        </Suspense>
      );
      await flushLazyImports();
    });

    expect(terminalLifecycle.mounts).toEqual([
      "agent-c-users",
      "agent-src-tauri",
    ]);
    expect(terminalLifecycle.unmounts).toEqual(["agent-c-users"]);
  });
});
