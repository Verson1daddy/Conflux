import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterAuthStatus, AdapterInfo, AgentInstanceInfo } from "@/types";

let AddAgentModal: typeof import("./AddAgentModal").AddAgentModal;
let useAgentStore: typeof import("@/stores/agentStore").useAgentStore;
let useWorkspaceStore: typeof import("@/stores/workspaceStore").useWorkspaceStore;

const bridgeMocks = {
  createAgentInstance: vi.fn(),
  detectAdapterAuth: vi.fn(),
  getDefaultWorkingDir: vi.fn(),
  listAdapters: vi.fn(),
};

const dialogMocks = {
  open: vi.fn(),
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

const readyStatus: AdapterAuthStatus = {
  adapter_id: "codex",
  ready: true,
  message: "Ready",
  login_command: null,
  docs_url: null,
  installed: true,
  authenticated: true,
  runnable: true,
  session_supported: false,
  install_message: "CLI found",
  auth_message: "Authenticated",
  runtime_message: "Runnable",
  session_message: "Session restore is pending",
};

const codexAdapter: AdapterInfo = {
  id: "codex",
  name: "Codex",
  command: "codex",
  capabilities: {
    can_coordinate: false,
    coordination_template: null,
    can_parse_tree: false,
    can_detect_permission: true,
  },
  is_builtin: true,
};

function makeInstance(instanceId: string): AgentInstanceInfo {
  return {
    instance_id: instanceId,
    adapter_id: "codex",
    adapter_name: "Codex",
    display_name: null,
    status: "idle",
    working_dir: "D:\\Projects\\conflux",
    is_pinned: false,
    created_at: 1_000,
    last_activity_at: 1_000,
    ended_at: null,
    mode: "full",
    hidden: false,
  };
}

function collectText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const maybeChildren = (value as { children?: unknown[] }).children;
  if (!Array.isArray(maybeChildren)) {
    return "";
  }
  return maybeChildren.map(collectText).join("");
}

async function flushAsyncEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function findCreateButton(renderer: ReactTestRenderer) {
  return renderer.root
    .findAllByType("button")
    .find((button) => collectText(button).includes("Create Agent"));
}

beforeAll(async () => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      },
    },
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });

  vi.doMock("@/lib/tauri-bridge", () => bridgeMocks);
  vi.doMock("@tauri-apps/plugin-dialog", () => dialogMocks);

  ({ useAgentStore } = await import("@/stores/agentStore"));
  ({ useWorkspaceStore } = await import("@/stores/workspaceStore"));
  ({ AddAgentModal } = await import("./AddAgentModal"));
});

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  bridgeMocks.createAgentInstance.mockReset();
  bridgeMocks.detectAdapterAuth.mockReset();
  bridgeMocks.getDefaultWorkingDir.mockReset();
  bridgeMocks.listAdapters.mockReset();
  dialogMocks.open.mockReset();

  bridgeMocks.listAdapters.mockResolvedValue([codexAdapter]);
  bridgeMocks.detectAdapterAuth.mockResolvedValue(readyStatus);
  bridgeMocks.getDefaultWorkingDir.mockResolvedValue("D:\\Projects\\conflux");

  useAgentStore.setState({
    instances: new Map(),
    statuses: new Map(),
    trees: new Map(),
    exitStates: new Map(),
    cardColors: new Map(),
    expandedCardId: null,
  });
  useWorkspaceStore.setState({
    cards: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    selectedCardId: null,
  });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("AddAgentModal create flow", () => {
  it("does not commit a frontend instance or card when backend creation fails", async () => {
    bridgeMocks.createAgentInstance.mockRejectedValue(
      new Error("Failed to persist agent instance: FOREIGN KEY constraint failed")
    );

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AddAgentModal visible={true} onClose={() => undefined} />);
    });
    await flushAsyncEffects();

    const createButton = findCreateButton(renderer);
    expect(createButton?.props.disabled).toBe(false);

    await act(async () => {
      await createButton?.props.onClick();
    });

    expect(bridgeMocks.createAgentInstance).toHaveBeenCalledTimes(1);
    expect(useAgentStore.getState().instances.size).toBe(0);
    expect(useWorkspaceStore.getState().cards).toHaveLength(0);
  });

  it("commits both the instance and card only after backend creation succeeds", async () => {
    bridgeMocks.createAgentInstance.mockResolvedValue(makeInstance("agent-codex-1"));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AddAgentModal visible={true} onClose={() => undefined} />);
    });
    await flushAsyncEffects();

    const createButton = findCreateButton(renderer);
    expect(createButton?.props.disabled).toBe(false);

    await act(async () => {
      await createButton?.props.onClick();
    });

    expect(useAgentStore.getState().instances.has("agent-codex-1")).toBe(true);
    expect(useWorkspaceStore.getState().cards).toEqual([
      expect.objectContaining({ instance_id: "agent-codex-1" }),
    ]);
  });
});
