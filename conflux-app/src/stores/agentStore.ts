// ===== Agent Store =====
// zustand store for agent instance state management
// Manages agent instances, statuses, trees, expanded card, and discussion wizard

import { create } from "zustand";
import type {
  AgentInstanceInfo,
  AgentStatus,
  AgentTree,
  ProcessExitedPayload,
} from "@/types";

// ===== Discussion wizard types =====

export type DiscussionStep = 1 | 2 | 3 | 4;

export type TurnOrder = "primary_moderates" | "round_robin" | "free_form";
export type MessageStyle = "concise" | "deep_dive";

export interface DiscussionRules {
  turnOrder: TurnOrder;
  maxRounds: number;
  turnTimeoutSec: number;
  autoEndOnConsensus: boolean;
  messageStyle: MessageStyle;
}

export interface DiscussionMessage {
  id: string;
  authorInstanceId: string | "user";
  authorName: string;
  initials: string;
  avatarBg: string;
  round: number;
  /** True when this is a user Ctrl+Enter interject rather than an agent turn */
  interject: boolean;
  /** Epoch ms */
  time: number;
  body: string;
}

export interface DiscussionWizardState {
  open: boolean;
  step: DiscussionStep;
  /** Step 1 — free-text goal of the discussion (required to advance) */
  direction: string;
  /** Step 1 — optional constraints / non-goals */
  requirements: string;
  /** Step 2 — editable rules, seeded with DEFAULT_RULES on open */
  rules: DiscussionRules;
  /** Step 3 — set of instance_id participating (primary always present) */
  participantIds: Set<string>;
  /** Step 4 — runtime message stream (seeded with demo openers on start) */
  messages: DiscussionMessage[];
  currentRound: number;
  paused: boolean;
  /** Optional source instance when launched from ExpandedAgentCard */
  sourceInstanceId: string | null;
}

// maxRounds: 0 means unlimited
// turnTimeoutSec: 0 means no timeout (agents get as long as they need)
// Default 5 minutes accommodates deep-reasoning models that take minutes per turn.
export const DEFAULT_DISCUSSION_RULES: DiscussionRules = {
  turnOrder: "primary_moderates",
  maxRounds: 8,
  turnTimeoutSec: 300,
  autoEndOnConsensus: true,
  messageStyle: "concise",
};

const EMPTY_WIZARD: DiscussionWizardState = {
  open: false,
  step: 1,
  direction: "",
  requirements: "",
  rules: { ...DEFAULT_DISCUSSION_RULES },
  participantIds: new Set<string>(),
  messages: [],
  currentRound: 0,
  paused: false,
  sourceInstanceId: null,
};

// ===== State Interface =====

interface AgentStoreState {
  /** All known agent instances, keyed by instance_id */
  instances: Map<string, AgentInstanceInfo>;
  /** Current status for each instance, keyed by instance_id */
  statuses: Map<string, AgentStatus>;
  /** Agent tree for each instance, keyed by instance_id */
  trees: Map<string, AgentTree>;
  /** C2-T1 Exit Overlay · record of PTY exit payloads keyed by instance_id.
   *  Lives in the store (not in XtermTerminal local state) so that card
   *  unmount/remount cycles — resize below terminal-minimum, 3D flip,
   *  collapse from expanded — don't hide the overlay. */
  exitStates: Map<string, ProcessExitedPayload>;
  /** Currently expanded card instance_id, or null when no card is expanded */
  expandedCardId: string | null;
  /** Discussion wizard state (multi-step + runtime chatroom) */
  discussion: DiscussionWizardState;

  // ===== Actions =====

  setInstances: (instances: AgentInstanceInfo[]) => void;
  addInstance: (instance: AgentInstanceInfo) => void;
  /** Drop an instance from the store along with its status/tree entries.
   *  The caller is responsible for any backend destroy_agent_instance call
   *  — this action only touches frontend state. */
  removeInstance: (instanceId: string) => void;
  /** C2-T1 Exit Overlay · record that a PTY process has exited. Kept in the
   *  global store (not XtermTerminal local state) so that toggling a card
   *  through resize / flip / expand-collapse doesn't accidentally hide the
   *  overlay — the fact that a process is dead must survive remounts. */
  setExitState: (instanceId: string, payload: ProcessExitedPayload | null) => void;
  updateStatus: (instanceId: string, status: AgentStatus) => void;
  updateTree: (instanceId: string, tree: AgentTree) => void;
  setExpandedCard: (id: string | null) => void;
  setPrimary: (instanceId: string | null) => void;

  // Discussion wizard
  openDiscussionWizard: (opts?: { sourceInstanceId?: string }) => void;
  closeDiscussionWizard: () => void;
  setDiscussionStep: (step: DiscussionStep) => void;
  setDiscussionDirection: (text: string) => void;
  setDiscussionRequirements: (text: string) => void;
  setDiscussionRules: (partial: Partial<DiscussionRules>) => void;
  toggleDiscussionParticipant: (instanceId: string) => void;
  startDiscussion: () => void;
  pauseDiscussion: () => void;
  resumeDiscussion: () => void;
  endDiscussion: () => void;
  interjectDiscussion: (text: string) => void;
}

// ===== Helpers =====

/** Look up the instance that should be primary for a freshly-opened wizard.
 *  Preference order: pinned instance → first instance in store → null. */
function resolvePrimaryInstance(
  instances: Map<string, AgentInstanceInfo>
): AgentInstanceInfo | null {
  for (const info of instances.values()) {
    if (info.is_primary_framework) return info;
  }
  const first = instances.values().next();
  return first.done ? null : first.value;
}

/** Build opening demo messages so the chatroom isn't empty on entry. */
function buildOpeningMessages(
  direction: string,
  participants: AgentInstanceInfo[]
): DiscussionMessage[] {
  if (participants.length === 0) return [];
  const primary = participants[0];
  const second = participants[1];
  const now = Date.now();
  const topic = direction.trim() || "the current task";

  const msgs: DiscussionMessage[] = [
    {
      id: `m-${now}-1`,
      authorInstanceId: primary.instance_id,
      authorName: primary.adapter_name,
      initials: initialsOf(primary.adapter_name),
      avatarBg: colorOfAdapter(primary.adapter_id),
      round: 1,
      interject: false,
      time: now,
      body: `Kicking off the discussion. Goal: ${topic}. ${
        second ? `${second.adapter_name}, want to share your angle first?` : "Who's first?"
      }`,
    },
  ];

  if (second) {
    msgs.push({
      id: `m-${now}-2`,
      authorInstanceId: second.instance_id,
      authorName: second.adapter_name,
      initials: initialsOf(second.adapter_name),
      avatarBg: colorOfAdapter(second.adapter_id),
      round: 1,
      interject: false,
      time: now + 1,
      body: `Sure. From my analysis, the main tradeoff here is between correctness and speed — I'd lean toward the safer path first and optimize once we have a baseline.`,
    });
  }

  return msgs;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function colorOfAdapter(adapterId: string): string {
  switch (adapterId) {
    case "claude-code": return "#B8D4E3";
    case "codex":       return "#FFB800";
    case "aider":       return "#8EA4B8";
    case "opencode":    return "#C9B894";
    default:            return "#8A8A8A";
  }
}

// ===== Store =====

export const useAgentStore = create<AgentStoreState>((set) => ({
  instances: new Map(),
  statuses: new Map(),
  trees: new Map(),
  exitStates: new Map(),
  expandedCardId: null,
  discussion: { ...EMPTY_WIZARD, participantIds: new Set() },

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

  removeInstance: (instanceId) =>
    set((state) => {
      const nextInstances = new Map(state.instances);
      nextInstances.delete(instanceId);
      const nextStatuses = new Map(state.statuses);
      nextStatuses.delete(instanceId);
      const nextTrees = new Map(state.trees);
      nextTrees.delete(instanceId);
      const nextExitStates = new Map(state.exitStates);
      nextExitStates.delete(instanceId);
      // If the user was looking at this instance in expanded mode, collapse
      // the view before it disappears so the panel doesn't render a ghost.
      const nextExpanded =
        state.expandedCardId === instanceId ? null : state.expandedCardId;
      return {
        instances: nextInstances,
        statuses: nextStatuses,
        trees: nextTrees,
        exitStates: nextExitStates,
        expandedCardId: nextExpanded,
      };
    }),

  setExitState: (instanceId, payload) =>
    set((state) => {
      const next = new Map(state.exitStates);
      if (payload === null) {
        next.delete(instanceId);
      } else {
        next.set(instanceId, payload);
      }
      return { exitStates: next };
    }),

  updateStatus: (instanceId, status) =>
    set((state) => {
      const nextStatuses = new Map(state.statuses);
      nextStatuses.set(instanceId, status);
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

  // ===== Discussion wizard actions =====

  openDiscussionWizard: (opts) =>
    set((state) => {
      const primary = resolvePrimaryInstance(state.instances);
      const participantIds = new Set<string>();
      // Primary is always in the set; discussion makes no sense without one.
      if (primary) participantIds.add(primary.instance_id);
      // Source instance (launched from ExpandedAgentCard) is auto-added too.
      if (opts?.sourceInstanceId && opts.sourceInstanceId !== primary?.instance_id) {
        participantIds.add(opts.sourceInstanceId);
      }
      return {
        discussion: {
          ...EMPTY_WIZARD,
          participantIds,
          rules: { ...DEFAULT_DISCUSSION_RULES },
          open: true,
          step: 1,
          sourceInstanceId: opts?.sourceInstanceId ?? null,
        },
      };
    }),

  closeDiscussionWizard: () =>
    set(() => ({
      discussion: { ...EMPTY_WIZARD, participantIds: new Set() },
    })),

  setDiscussionStep: (step) =>
    set((state) => ({ discussion: { ...state.discussion, step } })),

  setDiscussionDirection: (text) =>
    set((state) => ({ discussion: { ...state.discussion, direction: text } })),

  setDiscussionRequirements: (text) =>
    set((state) => ({ discussion: { ...state.discussion, requirements: text } })),

  setDiscussionRules: (partial) =>
    set((state) => ({
      discussion: {
        ...state.discussion,
        rules: { ...state.discussion.rules, ...partial },
      },
    })),

  toggleDiscussionParticipant: (instanceId) =>
    set((state) => {
      const primary = resolvePrimaryInstance(state.instances);
      // Guard: primary can't be toggled off
      if (primary?.instance_id === instanceId) return state;
      const next = new Set(state.discussion.participantIds);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return { discussion: { ...state.discussion, participantIds: next } };
    }),

  startDiscussion: () =>
    set((state) => {
      const participants: AgentInstanceInfo[] = [];
      // Primary always comes first
      const primary = resolvePrimaryInstance(state.instances);
      if (primary && state.discussion.participantIds.has(primary.instance_id)) {
        participants.push(primary);
      }
      state.discussion.participantIds.forEach((id) => {
        if (id === primary?.instance_id) return;
        const info = state.instances.get(id);
        if (info) participants.push(info);
      });
      const openers = buildOpeningMessages(state.discussion.direction, participants);
      return {
        discussion: {
          ...state.discussion,
          step: 4,
          messages: openers,
          currentRound: 1,
          paused: false,
        },
      };
    }),

  pauseDiscussion: () =>
    set((state) => ({ discussion: { ...state.discussion, paused: true } })),

  resumeDiscussion: () =>
    set((state) => ({ discussion: { ...state.discussion, paused: false } })),

  endDiscussion: () =>
    set(() => ({
      discussion: { ...EMPTY_WIZARD, participantIds: new Set() },
    })),

  interjectDiscussion: (text) =>
    set((state) => {
      const trimmed = text.trim();
      if (!trimmed) return state;
      const msg: DiscussionMessage = {
        id: `m-${Date.now()}-u`,
        authorInstanceId: "user",
        authorName: "You",
        initials: "U",
        avatarBg: "#1A1A1A",
        round: state.discussion.currentRound || 1,
        interject: true,
        time: Date.now(),
        body: trimmed,
      };
      return {
        discussion: {
          ...state.discussion,
          messages: [...state.discussion.messages, msg],
        },
      };
    }),
}));
