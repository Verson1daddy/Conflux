import { describe, expect, it } from "vitest";
import type { AdapterInfo, AgentInstanceInfo } from "@/types";
import {
  buildSettingsAdapterRows,
  formatAdapterCapabilitySummary,
  resolvePrimaryAdapterName,
} from "./settings-model";

const baseCapabilities = {
  can_coordinate: false,
  coordination_template: null,
  can_parse_tree: false,
  can_detect_permission: false,
};

function adapter(overrides: Partial<AdapterInfo> & Pick<AdapterInfo, "id" | "name" | "command">): AdapterInfo {
  return {
    capabilities: baseCapabilities,
    is_builtin: false,
    ...overrides,
  };
}

function instance(overrides: Partial<AgentInstanceInfo> & Pick<AgentInstanceInfo, "instance_id" | "adapter_id">): AgentInstanceInfo {
  return {
    adapter_name: overrides.adapter_id,
    display_name: null,
    status: "idle",
    working_dir: "",
    is_pinned: false,
    created_at: 1,
    last_activity_at: 1,
    ended_at: null,
    mode: "full",
    hidden: false,
    ...overrides,
  };
}

describe("settings model", () => {
  it("builds adapter rows only from the live registry list", () => {
    const rows = buildSettingsAdapterRows({
      adapters: [
        adapter({ id: "codex", name: "Codex", command: "codex", is_builtin: true }),
        adapter({ id: "my-agent", name: "My Agent", command: "my-agent" }),
      ],
      instances: [
        instance({ instance_id: "i-1", adapter_id: "codex" }),
        instance({ instance_id: "i-2", adapter_id: "codex" }),
      ],
      favoriteAdapters: new Set(["codex"]),
      primaryAdapter: "codex",
    });

    expect(rows.map((row) => row.id)).toEqual(["codex", "my-agent"]);
    expect(rows.find((row) => row.id === "claude-code")).toBeUndefined();
    expect(rows[0]).toMatchObject({
      id: "codex",
      vendor: "OpenAI",
      activeCount: 2,
      isFavorite: true,
      isPrimary: true,
      kindLabel: "built-in",
    });
    expect(rows[1]).toMatchObject({
      id: "my-agent",
      vendor: "Custom",
      activeCount: 0,
      kindLabel: "custom",
    });
  });

  it("summarizes adapter capabilities without implying unsupported runtime state", () => {
    expect(formatAdapterCapabilitySummary(baseCapabilities)).toBe("basic terminal session");
    expect(formatAdapterCapabilitySummary({
      ...baseCapabilities,
      can_coordinate: true,
      can_parse_tree: true,
      can_detect_permission: true,
    })).toBe("coordination, sub-agent tree, permission detection");
  });

  it("resolves primary adapter names from visible rows, then falls back to id", () => {
    const rows = buildSettingsAdapterRows({
      adapters: [adapter({ id: "custom-cli", name: "Custom CLI", command: "custom" })],
      instances: [],
      favoriteAdapters: new Set(),
      primaryAdapter: null,
    });

    expect(resolvePrimaryAdapterName(rows, "custom-cli")).toBe("Custom CLI");
    expect(resolvePrimaryAdapterName(rows, "missing-cli")).toBe("missing-cli");
    expect(resolvePrimaryAdapterName(rows, null)).toBe(null);
  });
});
