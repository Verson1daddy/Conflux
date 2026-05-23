import type { AdapterCapabilities, AdapterInfo, AgentInstanceInfo } from "@/types";

const ADAPTER_METADATA: Record<string, { vendor: string; description: string }> = {
  "claude-code": {
    vendor: "Anthropic",
    description: "flagship agent framework",
  },
  codex: {
    vendor: "OpenAI",
    description: "code-focused reasoning and analysis",
  },
  aider: {
    vendor: "Paul Gauthier",
    description: "git-aware pair programmer",
  },
  opencode: {
    vendor: "OpenCode",
    description: "agentic CLI workspace",
  },
};

export interface SettingsAdapterRow {
  id: string;
  name: string;
  vendor: string;
  command: string;
  description: string;
  kindLabel: "built-in" | "custom";
  capabilitySummary: string;
  activeCount: number;
  isFavorite: boolean;
  isPrimary: boolean;
}

export function formatAdapterCapabilitySummary(capabilities: AdapterCapabilities): string {
  const labels: string[] = [];

  if (capabilities.can_coordinate) labels.push("coordination");
  if (capabilities.can_parse_tree) labels.push("sub-agent tree");
  if (capabilities.can_detect_permission) labels.push("permission detection");

  return labels.length > 0 ? labels.join(", ") : "basic terminal session";
}

export function buildSettingsAdapterRows(input: {
  adapters: AdapterInfo[];
  instances: Iterable<AgentInstanceInfo>;
  favoriteAdapters: Set<string>;
  primaryAdapter: string | null;
}): SettingsAdapterRow[] {
  const activeCounts = new Map<string, number>();

  for (const instance of input.instances) {
    activeCounts.set(instance.adapter_id, (activeCounts.get(instance.adapter_id) ?? 0) + 1);
  }

  return input.adapters.map((adapter) => {
    const metadata = ADAPTER_METADATA[adapter.id];
    return {
      id: adapter.id,
      name: adapter.name,
      vendor: metadata?.vendor ?? "Custom",
      command: adapter.command,
      description: metadata?.description ?? "registered adapter",
      kindLabel: adapter.is_builtin ? "built-in" : "custom",
      capabilitySummary: formatAdapterCapabilitySummary(adapter.capabilities),
      activeCount: activeCounts.get(adapter.id) ?? 0,
      isFavorite: input.favoriteAdapters.has(adapter.id),
      isPrimary: input.primaryAdapter === adapter.id,
    };
  });
}

export function resolvePrimaryAdapterName(
  rows: SettingsAdapterRow[],
  primaryAdapter: string | null,
): string | null {
  if (!primaryAdapter) return null;
  return rows.find((row) => row.id === primaryAdapter)?.name ?? primaryAdapter;
}
