import type { AgentInstanceInfo } from "@/types";

export function getLiveAgentInstances(
  instances: Map<string, AgentInstanceInfo>,
): AgentInstanceInfo[] {
  return Array.from(instances.values()).filter(
    (agent) => agent.ended_at === null && !agent.hidden,
  );
}

export function buildStatusSummary(
  instances: Map<string, AgentInstanceInfo>,
): string {
  const liveAgents = getLiveAgentInstances(instances);

  if (liveAgents.length === 0) {
    return "No active agents";
  }

  return liveAgents
    .map((agent) => {
      const label = agent.display_name
        ? `${agent.adapter_name} - ${agent.display_name}`
        : agent.adapter_name;
      return `${label}: ${agent.status}`;
    })
    .join(" - ");
}
