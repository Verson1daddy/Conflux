// ===== useAgentInstances Hook =====
// Initializes agent instances from Tauri backend and subscribes to real-time events
// Populates agentStore with instances, statuses, and trees

import { useEffect, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { listAgentInstances, getAgentTree } from "@/lib/tauri-bridge";
import {
  onAgentStatusChanged,
  onSubAgentSpawned,
  onSubAgentCompleted,
} from "@/lib/event-listener";

/**
 * Hook that manages agent instance lifecycle:
 * - Loads all instances on mount via listAgentInstances()
 * - Subscribes to AgentStatusChanged events to update statuses
 * - Subscribes to SubAgentSpawned / SubAgentCompleted events to refresh trees
 * - Returns instances, statuses, trees, and a manual refresh function
 */
export function useAgentInstances() {
  const instances = useAgentStore((s) => s.instances);
  const statuses = useAgentStore((s) => s.statuses);
  const trees = useAgentStore((s) => s.trees);
  const setInstances = useAgentStore((s) => s.setInstances);
  const updateStatus = useAgentStore((s) => s.updateStatus);
  const updateTree = useAgentStore((s) => s.updateTree);

  const refresh = useCallback(async () => {
    try {
      const list = await listAgentInstances();
      setInstances(list);
      // Fetch trees for each instance
      for (const inst of list) {
        try {
          const tree = await getAgentTree(inst.instance_id);
          updateTree(inst.instance_id, tree);
        } catch {
          // Tree may not be available for all instances; skip silently
        }
      }
    } catch {
      // Backend not available yet (e.g. during startup); leave store empty
    }
  }, [setInstances, updateTree]);

  useEffect(() => {
    // Initial load
    refresh();

    // Subscribe to status changes
    const unlistenStatus = onAgentStatusChanged((payload) => {
      updateStatus(payload.instance_id, payload.new_status);
    });

    // Subscribe to sub-agent spawned events — refresh tree for the parent
    const unlistenSpawned = onSubAgentSpawned((payload) => {
      getAgentTree(payload.instance_id)
        .then((tree) => updateTree(payload.instance_id, tree))
        .catch(() => {
          // Tree fetch failed; ignore
        });
    });

    // Subscribe to sub-agent completed events — refresh tree for the parent
    const unlistenCompleted = onSubAgentCompleted((payload) => {
      getAgentTree(payload.instance_id)
        .then((tree) => updateTree(payload.instance_id, tree))
        .catch(() => {
          // Tree fetch failed; ignore
        });
    });

    // Cleanup subscriptions on unmount
    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenSpawned.then((fn) => fn());
      unlistenCompleted.then((fn) => fn());
    };
  }, [refresh, updateStatus, updateTree]);

  return { instances, statuses, trees, refresh };
}
