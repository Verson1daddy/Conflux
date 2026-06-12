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

// 批3 §1：副作用层与数据订阅层拆分（审计：App 顶层订阅扇出 P1）。
// useAgentInstancesSync 只做"首拉 + 事件桥接 → 写 store"，不订阅任何数据
// 字段（action 经 selector 取——zustand action 引用稳定，不触发重渲染）。
// App / IslandWindowApp 用它挂副作用即可；需要数据的组件自己按粒度订阅。

export function useAgentInstancesSync(options: UseAgentInstancesOptions = {}) {
  const { hydrateTrees = true } = options;
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

  return { refresh };
}

/** 副作用 + 三张 Map 的数据订阅（保留原签名作公共 hook；订阅整 Map 意味着
 *  调用方会随任意实例变更重渲染——顶层组件请改用 useAgentInstancesSync）。 */
export function useAgentInstances(options: UseAgentInstancesOptions = {}) {
  const { refresh } = useAgentInstancesSync(options);
  const instances = useAgentStore((s) => s.instances);
  const statuses = useAgentStore((s) => s.statuses);
  const trees = useAgentStore((s) => s.trees);

  return { instances, statuses, trees, refresh };
}
