import { useCallback, useEffect } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { getAgentTree, listAgentInstances } from "@/lib/tauri-bridge";
import {
  onAgentStatusChanged,
  onSubAgentCompleted,
  onSubAgentSpawned,
} from "@/lib/event-listener";

interface UseAgentInstancesOptions {
  hydrateTrees?: boolean;
}

export function useAgentInstances(options: UseAgentInstancesOptions = {}) {
  const { hydrateTrees = true } = options;
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

      if (!hydrateTrees) {
        return;
      }

      const trees = await Promise.all(
        list.map(async (inst) => {
          try {
            const tree = await getAgentTree(inst.instance_id);
            return { instanceId: inst.instance_id, tree };
          } catch {
            return null;
          }
        })
      );

      for (const entry of trees) {
        if (entry) {
          updateTree(entry.instanceId, entry.tree);
        }
      }
    } catch {
      // Backend not available yet (e.g. during startup); leave store empty.
    }
  }, [hydrateTrees, setInstances, updateTree]);

  useEffect(() => {
    refresh();

    const unlistenStatus = onAgentStatusChanged((payload) => {
      updateStatus(payload.instance_id, payload.new_status, payload.timestamp);
    });

    const unlistenSpawned = hydrateTrees
      ? onSubAgentSpawned((payload) => {
          getAgentTree(payload.instance_id)
            .then((tree) => updateTree(payload.instance_id, tree))
            .catch(() => {
              // Tree fetch failed; ignore.
            });
        })
      : Promise.resolve(() => {});

    const unlistenCompleted = hydrateTrees
      ? onSubAgentCompleted((payload) => {
          getAgentTree(payload.instance_id)
            .then((tree) => updateTree(payload.instance_id, tree))
            .catch(() => {
              // Tree fetch failed; ignore.
            });
        })
      : Promise.resolve(() => {});

    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenSpawned.then((fn) => fn());
      unlistenCompleted.then((fn) => fn());
    };
  }, [hydrateTrees, refresh, updateStatus, updateTree]);

  return { instances, statuses, trees, refresh };
}
