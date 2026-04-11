// ===== Agent Store =====
// zustand store for agent instance state management
// Manages agent instances, statuses, trees, and expanded card state

import { create } from "zustand";
import type {
  AgentInstanceInfo,
  AgentStatus,
  AgentTree,
} from "@/types";

// ===== State Interface =====

interface AgentStoreState {
  /** All known agent instances, keyed by instance_id */
  instances: Map<string, AgentInstanceInfo>;
  /** Current status for each instance, keyed by instance_id */
  statuses: Map<string, AgentStatus>;
  /** Agent tree for each instance, keyed by instance_id */
  trees: Map<string, AgentTree>;
  /** Currently expanded card instance_id, or null when no card is expanded */
  expandedCardId: string | null;
  /** Instance id whose DiscussionPanel is open, or null when closed */
  discussionOpenForInstanceId: string | null;

  // ===== Actions =====

  /** Replace all instances from a list (e.g. initial load) */
  setInstances: (instances: AgentInstanceInfo[]) => void;
  /** Add a single instance (e.g. after createAgentInstance) */
  addInstance: (instance: AgentInstanceInfo) => void;
  /** Update the status of a single instance */
  updateStatus: (instanceId: string, status: AgentStatus) => void;
  /** Update the agent tree of a single instance */
  updateTree: (instanceId: string, tree: AgentTree) => void;
  /** Set the expanded card (or collapse with null) */
  setExpandedCard: (id: string | null) => void;
  /** Open the DiscussionPanel anchored on a specific agent instance */
  openDiscussion: (instanceId: string) => void;
  /** Close the DiscussionPanel */
  closeDiscussion: () => void;
  /** Set a single instance as the primary framework (or clear with null).
   *  Unpins all other instances automatically. */
  setPrimary: (instanceId: string | null) => void;
}

// ===== Store =====

export const useAgentStore = create<AgentStoreState>((set) => ({
  instances: new Map(),
  statuses: new Map(),
  trees: new Map(),
  expandedCardId: null,
  discussionOpenForInstanceId: null,

  setInstances: (instances) =>
    set(() => {
      const instanceMap = new Map<string, AgentInstanceInfo>();
      const statusMap = new Map<string, AgentStatus>();
      for (const inst of instances) {
        instanceMap.set(inst.instance_id, inst);
        statusMap.set(inst.instance_id, inst.status);
      }
      return { instances: instanceMap, statuses: statusMap };
    }),

  addInstance: (instance) =>
    set((state) => {
      const nextInstances = new Map(state.instances);
      nextInstances.set(instance.instance_id, instance);
      const nextStatuses = new Map(state.statuses);
      nextStatuses.set(instance.instance_id, instance.status);
      return { instances: nextInstances, statuses: nextStatuses };
    }),

  updateStatus: (instanceId, status) =>
    set((state) => {
      const nextStatuses = new Map(state.statuses);
      nextStatuses.set(instanceId, status);
      // Also update the status field within the instance info if it exists
      const nextInstances = new Map(state.instances);
      const existing = nextInstances.get(instanceId);
      if (existing) {
        nextInstances.set(instanceId, { ...existing, status });
      }
      return { statuses: nextStatuses, instances: nextInstances };
    }),

  updateTree: (instanceId, tree) =>
    set((state) => {
      const nextTrees = new Map(state.trees);
      nextTrees.set(instanceId, tree);
      return { trees: nextTrees };
    }),

  setExpandedCard: (id) => set({ expandedCardId: id }),

  openDiscussion: (instanceId) => set({ discussionOpenForInstanceId: instanceId }),

  closeDiscussion: () => set({ discussionOpenForInstanceId: null }),

  setPrimary: (instanceId) =>
    set((state) => {
      const nextInstances = new Map<string, AgentInstanceInfo>();
      state.instances.forEach((info, id) => {
        nextInstances.set(id, {
          ...info,
          is_primary_framework: instanceId !== null && id === instanceId,
        });
      });
      return { instances: nextInstances };
    }),
}));
