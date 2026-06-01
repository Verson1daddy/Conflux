import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInstanceInfo } from "@/types";

const discussionMocks = vi.hoisted(() => ({
  startBackendDiscussion: vi.fn(() =>
    Promise.resolve({
      id: "discussion-1",
      topic: "test",
      participant_ids: [] as string[],
      sandbox_instance_ids: [] as string[],
      status: "active",
      created_at: 1000,
      ended_at: null,
      max_rounds: 8,
      current_round: 1,
      summary: null,
    }),
  ),
  sendMessageWithInjection: vi.fn(),
  endBackendDiscussion: vi.fn(),
}));

vi.mock("@/lib/discussion-ipc", () => discussionMocks);

function agent(
  instanceId: string,
  overrides: Partial<AgentInstanceInfo> = {},
): AgentInstanceInfo {
  return {
    instance_id: instanceId,
    adapter_id: "codex",
    adapter_name: "Codex",
    display_name: null,
    status: "idle",
    working_dir: "D:\\repo",
    is_pinned: false,
    created_at: 1000,
    last_activity_at: 1000,
    ended_at: null,
    mode: "full",
    hidden: false,
    ...overrides,
  };
}

describe("agentStore discussion participants", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    discussionMocks.startBackendDiscussion.mockClear();
  });

  it("opens the discussion wizard with the first visible live primary", async () => {
    const { useAgentStore } = await import("./agentStore");

    useAgentStore.getState().setInstances([
      agent("hidden-pinned", { hidden: true, is_pinned: true }),
      agent("ended", { ended_at: 2000 }),
      agent("visible"),
    ]);

    useAgentStore.getState().openDiscussionWizard({
      sourceInstanceId: "hidden-pinned",
    });

    expect([...useAgentStore.getState().discussion.participantIds]).toEqual([
      "visible",
    ]);
  });

  it("starts backend discussions with only visible live participants", async () => {
    const { useAgentStore } = await import("./agentStore");

    useAgentStore.getState().setInstances([
      agent("primary", { is_pinned: true }),
      agent("visible-peer"),
      agent("hidden-peer", { hidden: true }),
      agent("ended-peer", { ended_at: 2000 }),
    ]);

    useAgentStore.getState().openDiscussionWizard();
    useAgentStore.getState().toggleDiscussionParticipant("visible-peer");
    useAgentStore.getState().toggleDiscussionParticipant("hidden-peer");
    useAgentStore.getState().toggleDiscussionParticipant("ended-peer");
    useAgentStore.getState().startDiscussion();

    expect(discussionMocks.startBackendDiscussion).toHaveBeenCalledWith(
      "",
      ["primary", "visible-peer"],
      8,
    );
  });
});

describe("agentStore discussion backend lifecycle", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    discussionMocks.startBackendDiscussion.mockReset();
    discussionMocks.endBackendDiscussion.mockReset();
    discussionMocks.sendMessageWithInjection.mockReset();
  });

  it("marks the discussion backend state active after sandbox startup succeeds", async () => {
    discussionMocks.startBackendDiscussion.mockResolvedValue({
      id: "discussion-1",
      topic: "test",
      participant_ids: [] as string[],
      sandbox_instance_ids: ["sandbox-1"] as string[],
      status: "active",
      created_at: 1000,
      ended_at: null,
      max_rounds: 8,
      current_round: 1,
      summary: null,
    });

    const { useAgentStore } = await import("./agentStore");
    useAgentStore.getState().setInstances([agent("primary", { is_pinned: true })]);
    useAgentStore.getState().openDiscussionWizard();
    useAgentStore.getState().startDiscussion();

    expect(useAgentStore.getState().discussion.backendState).toBe("starting");

    await Promise.resolve();
    await Promise.resolve();

    expect(useAgentStore.getState().discussion.backendState).toBe("active");
    expect(useAgentStore.getState().discussion.sandboxInstanceIds).toEqual(["sandbox-1"]);
  });

  it("marks the discussion backend state failed when sandbox startup fails", async () => {
    discussionMocks.startBackendDiscussion.mockRejectedValue(new Error("sandbox boot failed"));

    const { useAgentStore } = await import("./agentStore");
    useAgentStore.getState().setInstances([agent("primary", { is_pinned: true })]);
    useAgentStore.getState().openDiscussionWizard();
    useAgentStore.getState().startDiscussion();

    await Promise.resolve();
    await Promise.resolve();

    expect(useAgentStore.getState().discussion.backendState).toBe("failed");
    expect(useAgentStore.getState().discussion.backendError).toContain("sandbox boot failed");
    expect(useAgentStore.getState().discussion.paused).toBe(true);
  });

  it("ends failed discussions locally without calling backend end", async () => {
    discussionMocks.startBackendDiscussion.mockRejectedValue(new Error("sandbox boot failed"));

    const { useAgentStore } = await import("./agentStore");
    useAgentStore.getState().setInstances([agent("primary", { is_pinned: true })]);
    useAgentStore.getState().openDiscussionWizard();
    useAgentStore.getState().startDiscussion();

    await Promise.resolve();
    await Promise.resolve();

    const summary = await useAgentStore.getState().endDiscussion();

    expect(discussionMocks.endBackendDiscussion).not.toHaveBeenCalled();
    expect(summary?.summary_text).toContain("Backend discussion failed to start");
    expect(useAgentStore.getState().discussion.backendState).toBe("failed");
    expect(useAgentStore.getState().discussion.lifecycleState).toBe("ended_pending_review");
  });

  it("marks the discussion backend state failed when ending the backend session throws", async () => {
    discussionMocks.startBackendDiscussion.mockResolvedValue({
      id: "discussion-1",
      topic: "test",
      participant_ids: [] as string[],
      sandbox_instance_ids: ["sandbox-1"] as string[],
      status: "active",
      created_at: 1000,
      ended_at: null,
      max_rounds: 8,
      current_round: 1,
      summary: null,
    });
    discussionMocks.endBackendDiscussion.mockRejectedValue(new Error("end failed"));

    const { useAgentStore } = await import("./agentStore");
    useAgentStore.getState().setInstances([agent("primary", { is_pinned: true })]);
    useAgentStore.getState().openDiscussionWizard();
    useAgentStore.getState().startDiscussion();

    await Promise.resolve();
    await Promise.resolve();

    await expect(useAgentStore.getState().endDiscussion()).rejects.toThrow("end failed");
    expect(useAgentStore.getState().discussion.backendState).toBe("failed");
    expect(useAgentStore.getState().discussion.backendError).toContain("end failed");
  });
  it("marks discussions pending review after backend end succeeds", async () => {
    discussionMocks.startBackendDiscussion.mockResolvedValue({
      id: "discussion-1",
      topic: "test",
      participant_ids: [] as string[],
      sandbox_instance_ids: ["sandbox-1"] as string[],
      status: "active",
      created_at: 1000,
      ended_at: null,
      max_rounds: 8,
      current_round: 1,
      summary: null,
    });
    discussionMocks.endBackendDiscussion.mockResolvedValue({
      discussion_id: "discussion-1",
      topic: "test",
      total_rounds: 1,
      summary_text: "done",
      ended_at: 2000,
    });

    const { useAgentStore } = await import("./agentStore");
    useAgentStore.getState().setInstances([agent("primary", { is_pinned: true })]);
    useAgentStore.getState().openDiscussionWizard();
    useAgentStore.getState().startDiscussion();

    await Promise.resolve();
    await Promise.resolve();
    await useAgentStore.getState().endDiscussion();

    expect(useAgentStore.getState().discussion.lifecycleState).toBe("ended_pending_review");
    expect(useAgentStore.getState().discussion.endedAt).toBe(2000);
  });

  it("tracks saved and discarded ended discussion reviews", async () => {
    const { useAgentStore } = await import("./agentStore");
    useAgentStore.setState((state) => ({
      discussion: {
        ...state.discussion,
        lifecycleState: "ended_pending_review",
        endedAt: 2000,
      },
    }));

    useAgentStore.getState().markDiscussionReviewSaved();
    expect(useAgentStore.getState().discussion.lifecycleState).toBe("ended_saved");

    useAgentStore.setState((state) => ({
      discussion: {
        ...state.discussion,
        lifecycleState: "ended_pending_review",
      },
    }));
    useAgentStore.getState().markDiscussionReviewDiscarded();
    expect(useAgentStore.getState().discussion.lifecycleState).toBe("ended_discarded");
  });

  it("marks optimistic interjects pending before backend confirmation", async () => {
    let resolveInjection!: (value: {
      id: string;
      discussion_id: string;
      sender: { type: "User" };
      content: string;
      round: number;
      created_at: number;
      code_blocks: null;
    }) => void;

    discussionMocks.sendMessageWithInjection.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInjection = resolve;
        }),
    );

    const { useAgentStore } = await import("./agentStore");
    useAgentStore.getState().setInstances([agent("primary", { is_pinned: true })]);
    useAgentStore.setState((state) => ({
      discussion: {
        ...state.discussion,
        open: true,
        step: 4,
        discussionId: "discussion-1",
        backendState: "active",
        participantIds: new Set(["primary"]),
      },
    }));

    useAgentStore.getState().interjectDiscussion("Need a quick check");

    const pendingMessages = useAgentStore.getState().discussion.messages;
    expect(pendingMessages[pendingMessages.length - 1]?.deliveryState).toBe("pending");

    resolveInjection({
      id: "backend-msg-1",
      discussion_id: "discussion-1",
      sender: { type: "User" },
      content: "Need a quick check",
      round: 1,
      created_at: 2000,
      code_blocks: null,
    });
    await Promise.resolve();
    await Promise.resolve();

    const confirmedMessages = useAgentStore.getState().discussion.messages;
    const lastMessage = confirmedMessages[confirmedMessages.length - 1];
    expect(lastMessage?.deliveryState).toBe("confirmed");
    expect(lastMessage?.deliveryError).toBeNull();
  });

  it("marks interjects failed when backend injection rejects", async () => {
    discussionMocks.sendMessageWithInjection.mockRejectedValue(new Error("sandbox rejected input"));

    const { useAgentStore } = await import("./agentStore");
    useAgentStore.getState().setInstances([agent("primary", { is_pinned: true })]);
    useAgentStore.setState((state) => ({
      discussion: {
        ...state.discussion,
        open: true,
        step: 4,
        discussionId: "discussion-1",
        backendState: "active",
        participantIds: new Set(["primary"]),
      },
    }));

    useAgentStore.getState().interjectDiscussion("Need a quick check");
    await Promise.resolve();
    await Promise.resolve();

    const messages = useAgentStore.getState().discussion.messages;
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage?.deliveryState).toBe("failed");
    expect(lastMessage?.deliveryError).toContain("sandbox rejected input");
  });
});

describe("agentStore instance snapshots", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  });

  it("keeps live instances when a backend refresh returns one transient empty snapshot", async () => {
    const { useAgentStore } = await import("./agentStore");

    useAgentStore.getState().setInstances([agent("live")]);
    useAgentStore.getState().setInstances([]);

    expect([...useAgentStore.getState().instances.keys()]).toEqual(["live"]);
    expect([...useAgentStore.getState().statuses.keys()]).toEqual(["live"]);
  });

  it("allows empty snapshots to clear the store when no live instances remain", async () => {
    const { useAgentStore } = await import("./agentStore");

    useAgentStore.getState().setInstances([
      agent("ended", { ended_at: 2000 }),
    ]);
    useAgentStore.getState().setInstances([]);

    expect([...useAgentStore.getState().instances.keys()]).toEqual([]);
    expect([...useAgentStore.getState().statuses.keys()]).toEqual([]);
  });

  it("clears live instances after consecutive empty backend snapshots", async () => {
    const { useAgentStore } = await import("./agentStore");

    useAgentStore.getState().setInstances([agent("live")]);
    useAgentStore.getState().setInstances([]);
    useAgentStore.getState().setInstances([]);

    expect([...useAgentStore.getState().instances.keys()]).toEqual([]);
    expect([...useAgentStore.getState().statuses.keys()]).toEqual([]);
  });
});
