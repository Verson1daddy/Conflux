import { beforeAll, describe, expect, it } from "vitest";

let formatCardElapsed: typeof import("./AgentCard").formatCardElapsed;
let resolveCardFooterInfo: typeof import("./AgentCard").resolveCardFooterInfo;

beforeAll(async () => {
  const memory = new Map<string, string>();
  const storage = {
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
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });

  ({ formatCardElapsed, resolveCardFooterInfo } = await import("./AgentCard"));
});

describe("AgentCard footer helpers", () => {
  it("formats live card elapsed time from runtime timestamps", () => {
    expect(formatCardElapsed(1_000, 64_000)).toBe("1m 03s");
  });

  it("uses runtime-derived footer info for real instances instead of demo presets", () => {
    expect(
      resolveCardFooterInfo({
        isDemo: false,
        adapterBadge: "codex",
        status: "coding",
        fileCount: 0,
        lastActivity: 1_000,
        now: 64_000,
      })
    ).toEqual({
      time: "1m 03s",
      detail: "coding",
      detailKind: "status",
    });
  });

  it("does not require fake file counts for real runtime cards", () => {
    expect(
      resolveCardFooterInfo({
        isDemo: false,
        adapterBadge: "codex",
        status: "thinking",
        fileCount: null,
        lastActivity: 2_000,
        now: 65_000,
      })
    ).toEqual({
      time: "1m 03s",
      detail: "thinking",
      detailKind: "status",
    });
  });

  it("keeps demo footer presets for seeded demo cards only", () => {
    expect(
      resolveCardFooterInfo({
        isDemo: true,
        adapterBadge: "codex",
        status: "idle",
        fileCount: 0,
        lastActivity: 0,
        now: 64_000,
      })
    ).toEqual({
      time: "1m 47s",
      detail: "1 sub-agent",
      detailKind: "demo",
    });
  });

  it("marks real file-count details separately from runtime status tags", () => {
    expect(
      resolveCardFooterInfo({
        isDemo: false,
        adapterBadge: "claude-code",
        status: "coding",
        fileCount: 2,
        lastActivity: 1_000,
        now: 64_000,
      })
    ).toEqual({
      time: "1m 03s",
      detail: "2 files changed",
      detailKind: "activity",
    });
  });
});
