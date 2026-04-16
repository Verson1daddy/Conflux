// ===== Agent Store =====
// zustand store for agent instance state management
// Manages agent instances, statuses, trees, expanded card, and discussion wizard

import { create } from "zustand";
import type {
  AgentInstanceInfo,
  AgentStatus,
  AgentTree,
  ProcessExitedPayload,
  CodeBlock,
} from "@/types";
import {
  startBackendDiscussion,
  sendMessageWithInjection,
  endBackendDiscussion,
} from "@/lib/discussion-ipc";
import { toFrontendMessage } from "@/lib/discussion-utils";

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
  /** Extracted code blocks from body (from backend or parsed locally) */
  codeBlocks: CodeBlock[] | null;
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
  /** B3: Backend discussion session ID (null before startDiscussion succeeds) */
  discussionId: string | null;
  /** B3.1: Sandbox instance IDs for message injection (from backend start_discussion response) */
  sandboxInstanceIds: string[];
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
  discussionId: null,
  sandboxInstanceIds: [],
};

// ===== State Interface =====

interface AgentStoreState {
  /** All known agent instances, keyed by instance_id */
  instances: Map<string, AgentInstanceInfo>;
  /** Current status for each instance, keyed by instance_id */
  statuses: Map<string, AgentStatus>;
  /** Agent tree for each instance, keyed by instance_id */
  trees: Map<string, AgentTree>;
  /** C2-T1 Exit Overlay · record of PTY exit payloads keyed by instance_id. */
  exitStates: Map<string, ProcessExitedPayload>;
  /** C2-A4 Shield · per-instance permission tier (local state → backend in C2-C1) */
  permissionTiers: Map<string, string>;
  /** C2-A4b · per-instance custom card color (user picks at create or later) */
  cardColors: Map<string, string>;
  /** C2-A3 Frameworks · user's favorite adapter IDs (persisted to localStorage) */
  favoriteAdapters: Set<string>;
  /** C2-A3 Frameworks · user's primary adapter ID (persisted to localStorage) */
  primaryAdapter: string | null;
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
  setExitState: (instanceId: string, payload: ProcessExitedPayload | null) => void;
  /** C2-A4 Shield · set per-instance permission tier */
  setPermissionTier: (instanceId: string, tier: string) => void;
  /** C2-A4b · set per-instance card color */
  setCardColor: (instanceId: string, color: string) => void;
  /** C2-A3 Frameworks · set favorite adapters + persist to localStorage */
  setFavoriteAdapters: (ids: Set<string>) => void;
  /** C2-A3 Frameworks · set primary adapter + persist to localStorage */
  setPrimaryAdapter: (id: string | null) => void;
  updateStatus: (instanceId: string, status: AgentStatus) => void;
  updateTree: (instanceId: string, tree: AgentTree) => void;
  setExpandedCard: (id: string | null) => void;
  /** Toggle pin for an instance (multi-select). Updates local state + backend. */
  togglePin: (instanceId: string) => void;
  /** Hydrate pin state from backend on startup */
  hydratePins: (pinnedIds: string[]) => void;
  /** Update display_name for an instance locally (after backend rename succeeds) */
  setDisplayName: (instanceId: string, displayName: string | null) => void;

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
  /** B3: Append a backend-sourced message (e.g. from event subscription).
   *  Deduplicates by message id — safe to call multiple times for the same msg. */
  appendDiscussionMessage: (msg: DiscussionMessage) => void;
}

// ===== Helpers =====

/** Look up the instance that should be primary for a freshly-opened wizard.
 *  Preference order: first pinned instance → first instance in store → null. */
function resolvePrimaryInstance(
  instances: Map<string, AgentInstanceInfo>
): AgentInstanceInfo | null {
  for (const info of instances.values()) {
    if (info.is_pinned) return info;
  }
  const first = instances.values().next();
  return first.done ? null : first.value;
}

/** Helper: get display label for an agent instance.
 *  Format: "adapter_name · display_name" if alias set, else just adapter_name. */
export function agentDisplayLabel(info: AgentInstanceInfo): string {
  return info.display_name
    ? `${info.adapter_name} · ${info.display_name}`
    : info.adapter_name;
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
      codeBlocks: null,
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
      codeBlocks: null,
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

// C2-A3: Hydrate framework preferences from localStorage on store init
function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem("conflux.favorites");
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* corrupt — ignore */ }
  return new Set();
}
function loadPrimaryAdapter(): string | null {
  return localStorage.getItem("conflux.primaryAdapter") || null;
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  instances: new Map(),
  statuses: new Map(),
  trees: new Map(),
  exitStates: new Map(),
  permissionTiers: new Map<string, string>(
    JSON.parse(localStorage.getItem("conflux.permissionTiers") || "[]") as [string, string][]
  ),
  cardColors: new Map<string, string>(
    JSON.parse(localStorage.getItem("conflux.cardColors") || "[]") as [string, string][]
  ),
  favoriteAdapters: loadFavorites(),
  primaryAdapter: loadPrimaryAdapter(),
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

  setPermissionTier: (instanceId, tier) =>
    set((state) => {
      const next = new Map(state.permissionTiers);
      next.set(instanceId, tier);
      localStorage.setItem("conflux.permissionTiers", JSON.stringify([...next]));
      return { permissionTiers: next };
    }),

  setCardColor: (instanceId, color) =>
    set((state) => {
      const next = new Map(state.cardColors);
      next.set(instanceId, color);
      localStorage.setItem("conflux.cardColors", JSON.stringify([...next]));
      return { cardColors: next };
    }),

  setFavoriteAdapters: (ids) => {
    localStorage.setItem("conflux.favorites", JSON.stringify([...ids]));
    set({ favoriteAdapters: ids });
  },

  setPrimaryAdapter: (id) => {
    if (id) {
      localStorage.setItem("conflux.primaryAdapter", id);
    } else {
      localStorage.removeItem("conflux.primaryAdapter");
    }
    set({ primaryAdapter: id });
  },

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

  togglePin: (instanceId) =>
    set((state) => {
      const nextInstances = new Map(state.instances);
      const info = nextInstances.get(instanceId);
      if (info) {
        nextInstances.set(instanceId, { ...info, is_pinned: !info.is_pinned });
      }
      return { instances: nextInstances };
    }),

  hydratePins: (pinnedIds) =>
    set((state) => {
      const pinnedSet = new Set(pinnedIds);
      const nextInstances = new Map<string, AgentInstanceInfo>();
      state.instances.forEach((info, id) => {
        nextInstances.set(id, { ...info, is_pinned: pinnedSet.has(id) });
      });
      return { instances: nextInstances };
    }),

  setDisplayName: (instanceId, displayName) =>
    set((state) => {
      const nextInstances = new Map(state.instances);
      const info = nextInstances.get(instanceId);
      if (info) {
        nextInstances.set(instanceId, { ...info, display_name: displayName });
      }
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

  startDiscussion: () => {
    const state = get();
    const participants: AgentInstanceInfo[] = [];
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
    const participantIds = [...state.discussion.participantIds];
    const topic = state.discussion.direction;
    const maxRounds = state.discussion.rules.maxRounds;

    // Optimistic UI: switch to chatroom immediately
    set((s) => ({
      discussion: {
        ...s.discussion,
        step: 4,
        messages: openers,
        currentRound: 1,
        paused: false,
      },
    }));

    // B3: Fire-and-forget backend call; store discussionId + sandboxInstanceIds on success
    startBackendDiscussion(topic, participantIds, maxRounds)
      .then((session) => {
        // B3.1: Extract sandbox instance IDs from backend response
        // Backend InstanceId is newtype { "0": "uuid" }, but Tauri may serialize as string
        const sandboxIds = (session.sandbox_instance_ids ?? []).map((id: string | { "0": string }) =>
          typeof id === "string" ? id : id["0"]
        );
        set((s) => ({
          discussion: {
            ...s.discussion,
            discussionId: typeof session.id === "string" ? session.id : (session.id as unknown as { "0": string })["0"],
            sandboxInstanceIds: sandboxIds,
          },
        }));
      })
      .catch((err) => {
        console.error("[agentStore] startBackendDiscussion failed:", err);
        // Discussion continues in UI-only mode; backend will be unavailable
        // but user can still interject locally.
      });
  },

  pauseDiscussion: () =>
    set((state) => ({ discussion: { ...state.discussion, paused: true } })),

  resumeDiscussion: () =>
    set((state) => ({ discussion: { ...state.discussion, paused: false } })),

  endDiscussion: () => {
    const { discussion } = get();
    const discussionId = discussion.discussionId;

    // Reset UI immediately
    set(() => ({
      discussion: { ...EMPTY_WIZARD, participantIds: new Set() },
    }));

    // B3: Notify backend (fire-and-forget)
    if (discussionId) {
      endBackendDiscussion(discussionId).catch((err) => {
        console.warn("[agentStore] endBackendDiscussion failed:", err);
      });
    }
  },

  interjectDiscussion: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const state = get();
    const optimisticMsg: DiscussionMessage = {
      id: `m-${Date.now()}-u`,
      authorInstanceId: "user",
      authorName: "You",
      initials: "U",
      avatarBg: "#1A1A1A",
      round: state.discussion.currentRound || 1,
      interject: true,
      time: Date.now(),
      body: trimmed,
      codeBlocks: null,
    };

    // Optimistic UI: show message immediately
    set((s) => ({
      discussion: {
        ...s.discussion,
        messages: [...s.discussion.messages, optimisticMsg],
      },
    }));

    // B3/B3.1: Send to backend + inject into sandbox PTYs (not workspace instances)
    const discussionId = state.discussion.discussionId;
    if (discussionId) {
      const targetIds = state.discussion.sandboxInstanceIds.length > 0
        ? state.discussion.sandboxInstanceIds
        : [...state.discussion.participantIds];
      sendMessageWithInjection(discussionId, trimmed, targetIds)
        .then((backendMsg) => {
          // Replace the optimistic message with the backend-confirmed one
          const confirmed = toFrontendMessage(backendMsg, get().instances);
          set((s) => ({
            discussion: {
              ...s.discussion,
              messages: s.discussion.messages.map((m) =>
                m.id === optimisticMsg.id ? { ...confirmed, interject: true } : m,
              ),
            },
          }));
        })
        .catch((err) => {
          console.warn("[agentStore] sendMessageWithInjection failed:", err);
          // Optimistic message stays in UI; user sees it even if backend failed
        });
    }
  },

  appendDiscussionMessage: (msg) =>
    set((state) => {
      // Deduplicate by message id
      if (state.discussion.messages.some((m) => m.id === msg.id)) {
        return state;
      }
      return {
        discussion: {
          ...state.discussion,
          messages: [...state.discussion.messages, msg],
        },
      };
    }),
}));
