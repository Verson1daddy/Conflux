import { describe, expect, it } from "vitest";
import type { AgentInstanceInfo } from "@/types";
import { buildStatusSummary, getLiveAgentInstances } from "./workspace-status";

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
    working_dir: "D:\\Projects\\conflux",
    is_pinned: false,
    created_at: 1_000,
    last_activity_at: 1_000,
    ended_at: null,
    mode: "full",
    hidden: false,
    ...overrides,
  };
}

describe("workspace-status", () => {
  it("returns only non-ended agent instances", () => {
    const instances = new Map([
      ["live", agent("live")],
      ["ended", agent("ended", { ended_at: 2_000 })],
    ]);

    expect(getLiveAgentInstances(instances).map((item) => item.instance_id)).toEqual([
      "live",
    ]);
  });

  it("excludes hidden sandbox instances from live workspace surfaces", () => {
    const instances = new Map([
      ["visible", agent("visible")],
      ["hidden", agent("hidden", { hidden: true })],
    ]);

    expect(getLiveAgentInstances(instances).map((item) => item.instance_id)).toEqual([
      "visible",
    ]);
  });

  it("builds a status summary from live agents only", () => {
    const instances = new Map([
      [
        "live",
        agent("live", {
          adapter_name: "Claude Code",
          display_name: "Frontend",
          status: "thinking",
        }),
      ],
      [
        "ended",
        agent("ended", {
          adapter_name: "Codex",
          status: "error",
          ended_at: 2_000,
        }),
      ],
    ]);

    expect(buildStatusSummary(instances)).toBe("Claude Code - Frontend: thinking");
  });

  it("reports no active agents when every instance has ended", () => {
    const instances = new Map([
      ["ended", agent("ended", { ended_at: 2_000 })],
    ]);

    expect(buildStatusSummary(instances)).toBe("No active agents");
  });
});
