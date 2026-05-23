import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentInstanceInfo, CardLayout } from "@/types";

let mergeWorkspaceCards: typeof import("./useWorkspaceLayout").mergeWorkspaceCards;
let shouldAddCardForStatusEvent: typeof import("./useWorkspaceLayout").shouldAddCardForStatusEvent;
let shouldAutoFitOnCardsRestored: typeof import("./useWorkspaceLayout").shouldAutoFitOnCardsRestored;
let selectWorkspaceLiveInstances: typeof import("./useWorkspaceLayout").selectWorkspaceLiveInstances;

beforeAll(async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });

  ({
    mergeWorkspaceCards,
    selectWorkspaceLiveInstances,
    shouldAddCardForStatusEvent,
    shouldAutoFitOnCardsRestored,
  } = await import("./useWorkspaceLayout"));
});

describe("shouldAutoFitOnCardsRestored", () => {
  it("fits the workspace when live cards appear from an empty canvas", () => {
    expect(shouldAutoFitOnCardsRestored(0, 2)).toBe(true);
  });

  it("does not steal the viewport after the user already has visible cards", () => {
    expect(shouldAutoFitOnCardsRestored(1, 2)).toBe(false);
    expect(shouldAutoFitOnCardsRestored(2, 2)).toBe(false);
    expect(shouldAutoFitOnCardsRestored(2, 0)).toBe(false);
  });
});

function makeInstance(
  instanceId: string,
  overrides: Partial<AgentInstanceInfo> = {}
): AgentInstanceInfo {
  return {
    instance_id: instanceId,
    adapter_id: "claude-code",
    adapter_name: "Claude Code",
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

function makeCard(
  instanceId: string,
  overrides: Partial<CardLayout> = {}
): CardLayout {
  return {
    instance_id: instanceId,
    position: { x: 24, y: 24 },
    size: { width: 620, height: 420 },
    z_index: 1,
    ...overrides,
  };
}

describe("mergeWorkspaceCards", () => {
  it("reuses saved layout for live instances restored after startup", () => {
    const savedCard = makeCard("agent-1", {
      position: { x: 640, y: 180 },
      z_index: 7,
    });

    const merged = mergeWorkspaceCards({
      liveInstances: [makeInstance("agent-1")],
      currentCards: [],
      savedCards: new Map([[savedCard.instance_id, savedCard]]),
    });

    expect(merged).toEqual([savedCard]);
  });

  it("preserves current in-memory card placement over saved layout", () => {
    const currentCard = makeCard("agent-1", {
      position: { x: 120, y: 96 },
      z_index: 4,
    });
    const savedCard = makeCard("agent-1", {
      position: { x: 640, y: 180 },
      z_index: 7,
    });

    const merged = mergeWorkspaceCards({
      liveInstances: [makeInstance("agent-1")],
      currentCards: [currentCard],
      savedCards: new Map([[savedCard.instance_id, savedCard]]),
    });

    expect(merged).toEqual([currentCard]);
  });

  it("drops stale cards and synthesizes defaults for unsaved live instances", () => {
    const staleCard = makeCard("agent-old");

    const merged = mergeWorkspaceCards({
      liveInstances: [makeInstance("agent-new")],
      currentCards: [staleCard],
      savedCards: new Map(),
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].instance_id).toBe("agent-new");
    expect(merged[0].position).toEqual({ x: 80, y: 80 });
    expect(merged[0].size).toEqual({ width: 620, height: 420 });
  });

  it("keeps current cards when live instances are temporarily unavailable", () => {
    const currentCards = [
      makeCard("agent-1", { position: { x: 120, y: 96 } }),
      makeCard("agent-2", { position: { x: 760, y: 180 } }),
    ];

    const merged = mergeWorkspaceCards({
      liveInstances: [],
      currentCards,
      savedCards: new Map(),
      preserveCurrentCardsOnEmpty: true,
    });

    expect(merged).toEqual(currentCards);
  });

  it("clears orphan cards after the backend confirms an empty workspace", () => {
    const currentCards = [
      makeCard("agent-1", { position: { x: 120, y: 96 } }),
      makeCard("agent-2", { position: { x: 760, y: 180 } }),
    ];

    const merged = mergeWorkspaceCards({
      liveInstances: [],
      currentCards,
      savedCards: new Map(),
      preserveCurrentCardsOnEmpty: false,
    });

    expect(merged).toEqual([]);
  });
});

describe("selectWorkspaceLiveInstances", () => {
  it("excludes ended agent instances before reconciling canvas cards", () => {
    const instances = new Map([
      ["live", makeInstance("live")],
      ["ended", makeInstance("ended", { ended_at: 2000 })],
    ]);

    expect(selectWorkspaceLiveInstances(instances).map((item) => item.instance_id)).toEqual([
      "live",
    ]);
  });
});

describe("shouldAddCardForStatusEvent", () => {
  it("adds a missing card only for a known visible live instance", () => {
    const instances = new Map([["agent-live", makeInstance("agent-live")]]);

    expect(
      shouldAddCardForStatusEvent({
        instanceId: "agent-live",
        instances,
        currentCards: [],
      })
    ).toBe(true);
  });

  it("does not add cards for hidden, ended, unknown, or already-rendered instances", () => {
    const instances = new Map([
      ["agent-live", makeInstance("agent-live")],
      ["agent-hidden", makeInstance("agent-hidden", { hidden: true })],
      ["agent-ended", makeInstance("agent-ended", { ended_at: 2000 })],
    ]);

    expect(
      shouldAddCardForStatusEvent({
        instanceId: "agent-hidden",
        instances,
        currentCards: [],
      })
    ).toBe(false);
    expect(
      shouldAddCardForStatusEvent({
        instanceId: "agent-ended",
        instances,
        currentCards: [],
      })
    ).toBe(false);
    expect(
      shouldAddCardForStatusEvent({
        instanceId: "agent-unknown",
        instances,
        currentCards: [],
      })
    ).toBe(false);
    expect(
      shouldAddCardForStatusEvent({
        instanceId: "agent-live",
        instances,
        currentCards: [makeCard("agent-live")],
      })
    ).toBe(false);
  });
});
