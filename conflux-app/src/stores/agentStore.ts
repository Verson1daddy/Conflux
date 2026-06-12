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
import {
  collectArtifacts,
  replaceArtifactsForMessage,
  toggleArtifactPin as toggleDiscussionArtifactPinInList,
  upsertArtifactsForMessage,
} from "@/lib/discussion-artifacts";
import { adapterIdentityColor } from "@/lib/agent-visuals";
import { parseCodeBlocks, toFrontendMessage } from "@/lib/discussion-utils";
import { getLiveAgentInstances } from "@/lib/workspace-status";

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
  deliveryState?: "pending" | "confirmed" | "failed";
  deliveryError?: string | null;
}

export type ArtifactStatus = "draft" | "pinned";

export interface DiscussionArtifact {
  id: string;
  msgId: string;
  authorName: string;
  round: number;
  blockIdx: number;
  lang: string;
  content: string;
  status: ArtifactStatus;
  createdAt: number;
  updatedAt: number;
}

export type DiscussionLifecycleState =
  | "draft"
  | "active"
  | "ended_pending_review"
  | "ended_saved"
  | "ended_discarded";

export interface DiscussionWizardState {
  open: boolean;
  step: DiscussionStep;
  /** Step 1 - free-text goal of the discussion (required to advance) */
  direction: string;
  /** Step 1 - optional constraints / non-goals */
  requirements: string;
  /** Step 2 - editable rules, seeded with DEFAULT_RULES on open */
  rules: DiscussionRules;
  /** Step 3 - set of instance_id participating (primary always present) */
  participantIds: Set<string>;
  /** Step 4 - runtime message stream (seeded with demo openers on start) */
  messages: DiscussionMessage[];
  /** Step 4 - extracted code artifacts owned by discussion lifecycle */
  artifacts: DiscussionArtifact[];
  currentRound: number;
  paused: boolean;
  lifecycleState: DiscussionLifecycleState;
  endedAt: number | null;
  /** Optional source instance when launched from ExpandedAgentCard */
  sourceInstanceId: string | null;
  /** B3: Backend discussion session ID (null before startDiscussion succeeds) */
  discussionId: string | null;
  /** B3.1: Sandbox instance IDs for message injection (from backend start_discussion response) */
  sandboxInstanceIds: string[];
  /** Backend discussion lifecycle state for optimistic-vs-confirmed UI */
  backendState: "idle" | "starting" | "active" | "failed" | "ending";
  /** Latest backend lifecycle error, if any */
  backendError: string | null;
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
  artifacts: [],
  currentRound: 0,
  paused: false,
  lifecycleState: "draft",
  endedAt: null,
  sourceInstanceId: null,
  discussionId: null,
  sandboxInstanceIds: [],
  backendState: "idle",
  backendError: null,
};

// ===== State Interface =====

interface AgentStoreState {
  /** All known agent instances, keyed by instance_id */
  instances: Map<string, AgentInstanceInfo>;
  /** Current status for each instance, keyed by instance_id */
  statuses: Map<string, AgentStatus>;
  /** Agent tree for each instance, keyed by instance_id */
  trees: Map<string, AgentTree>;
  /** C2-T1 Exit Overlay - record of PTY exit payloads keyed by instance_id. */
  exitStates: Map<string, ProcessExitedPayload>;
  /** C2-A4 Shield - per-instance permission tier (local state -> backend in C2-C1) */
  permissionTiers: Map<string, string>;
  /** C2-A4b - per-instance custom card color (user picks at create or later) */
  cardColors: Map<string, string>;
  /** C2-A3 Frameworks - user's favorite adapter IDs (persisted to localStorage) */
  favoriteAdapters: Set<string>;
  /** C2-A3 Frameworks - user's primary adapter ID (persisted to localStorage) */
  primaryAdapter: string | null;
  /** Currently expanded card instance_id, or null when no card is expanded */
  expandedCardId: string | null;
  /** jump-back 近似滚动标注（ExpandedAgentCard 渲染 chip，数秒后自动清除） */
  terminalJumpHint: {
    instanceId: string;
    startLine: number;
    endLine: number;
    approximate: boolean;
  } | null;
  /** Guards one-shot backend list glitches without making real empty state sticky. */
  ignoredEmptyInstanceSnapshot: boolean;
  /** Discussion wizard state (multi-step + runtime chatroom) */
  discussion: DiscussionWizardState;

  // ===== Actions =====

  setInstances: (instances: AgentInstanceInfo[]) => void;
  addInstance: (instance: AgentInstanceInfo) => void;
  /** Drop an instance from the store along with its status/tree entries.
   *  The caller is responsible for any backend destroy_agent_instance call
   *  - this action only touches frontend state. */
  removeInstance: (instanceId: string) => void;
  setExitState: (instanceId: string, payload: ProcessExitedPayload | null) => void;
  /** C2-A4 Shield - set per-instance permission tier */
  setPermissionTier: (instanceId: string, tier: string) => void;
  /** C2-A4b - set per-instance card color */
  setCardColor: (instanceId: string, color: string) => void;
  /** C2-A3 Frameworks - set favorite adapters + persist to localStorage */
  setFavoriteAdapters: (ids: Set<string>) => void;
  /** C2-A3 Frameworks - set primary adapter + persist to localStorage */
  setPrimaryAdapter: (id: string | null) => void;
  updateStatus: (instanceId: string, status: AgentStatus, lastActivityAt?: number) => void;
  updateTree: (instanceId: string, tree: AgentTree) => void;
  setExpandedCard: (id: string | null) => void;
  setTerminalJumpHint: (hint: AgentStoreState["terminalJumpHint"]) => void;
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
  endDiscussion: () => Promise<import("@/types").DiscussionSummary | null>;
  markDiscussionReviewSaved: () => void;
  markDiscussionReviewDiscarded: () => void;
  interjectDiscussion: (text: string) => void;
  toggleDiscussionArtifactPin: (artifactId: string) => void;
  /** B3: Append a backend-sourced message (e.g. from event subscription).
   *  Deduplicates by message id - safe to call multiple times for the same msg. */
  appendDiscussionMessage: (msg: DiscussionMessage) => void;
}

// ===== Helpers =====

/** Look up the instance that should be primary for a freshly-opened wizard.
 *  Preference order: first pinned instance -> first instance in store -> null. */
function resolvePrimaryInstance(
  instances: Map<string, AgentInstanceInfo>
): AgentInstanceInfo | null {
  const liveInstances = getLiveAgentInstances(instances);
  for (const info of liveInstances) {
    if (info.is_pinned) return info;
  }
  return liveInstances[0] ?? null;
}

/** Helper: get display label for an agent instance.
 *  Format: "adapter_name - display_name" if alias set, else just adapter_name. */
export function agentDisplayLabel(info: AgentInstanceInfo): string {
  return info.display_name
    ? `${info.adapter_name} - ${info.display_name}`
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
      body: `Sure. From my analysis, the main tradeoff here is between correctness and speed; I'd lean toward the safer path first and optimize once we have a baseline.`,
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
  return adapterIdentityColor(adapterId);
}

// ===== Store =====

// C2-A3: Hydrate framework preferences from localStorage on store init
function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem("conflux.favorites");
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* corrupt - ignore */ }
  return new Set();
}
function loadPrimaryAdapter(): string | null {
  try {
    return localStorage.getItem("conflux.primaryAdapter") || null;
  } catch { /* corrupt / blocked - ignore */ return null; }
}
// P1-1: 损坏的 localStorage 不应在 store 初始化（模块导入）时抛异常导致白屏。
// 与 loadFavorites 同款保护：非法 JSON / getItem 抛错时回退空 Map。
function loadEntryMap(key: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Map(JSON.parse(raw) as [string, string][]);
  } catch { /* corrupt - ignore */ }
  return new Map();
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  instances: new Map(),
  statuses: new Map(),
  trees: new Map(),
  exitStates: new Map(),
  permissionTiers: loadEntryMap("conflux.permissionTiers"),
  cardColors: loadEntryMap("conflux.cardColors"),
  favoriteAdapters: loadFavorites(),
  primaryAdapter: loadPrimaryAdapter(),
  expandedCardId: null,
  terminalJumpHint: null,
  ignoredEmptyInstanceSnapshot: false,
  discussion: { ...EMPTY_WIZARD, participantIds: new Set() },

  setInstances: (instances) =>
    set((state) => {
      const currentLiveInstances = getLiveAgentInstances(state.instances);
      if (instances.length === 0 && currentLiveInstances.length > 0) {
        if (!state.ignoredEmptyInstanceSnapshot) {
          return { ignoredEmptyInstanceSnapshot: true };
        }
      }

      const instanceMap = new Map<string, AgentInstanceInfo>();
      const statusMap = new Map<string, AgentStatus>();
      for (const inst of instances) {
        instanceMap.set(inst.instance_id, inst);
        statusMap.set(inst.instance_id, inst.status);
      }
      return {
        instances: instanceMap,
        statuses: statusMap,
        ignoredEmptyInstanceSnapshot: false,
      };
    }),

  addInstance: (instance) =>
    set((state) => {
      const nextInstances = new Map(state.instances);
      nextInstances.set(instance.instance_id, instance);
      const nextStatuses = new Map(state.statuses);
      nextStatuses.set(instance.instance_id, instance.status);
      return {
        instances: nextInstances,
        statuses: nextStatuses,
        ignoredEmptyInstanceSnapshot: false,
      };
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
      const nextInstances = new Map(state.instances);
      const existing = nextInstances.get(instanceId);
      if (payload === null) {
        next.delete(instanceId);
        if (existing) {
          nextInstances.set(instanceId, { ...existing, ended_at: null });
        }
      } else {
        next.set(instanceId, payload);
        if (existing) {
          nextInstances.set(instanceId, {
            ...existing,
            ended_at: payload.timestamp,
            last_activity_at: payload.timestamp,
          });
        }
      }
      return { exitStates: next, instances: nextInstances };
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

  updateStatus: (instanceId, status, lastActivityAt) =>
    set((state) => {
      const nextStatuses = new Map(state.statuses);
      nextStatuses.set(instanceId, status);
      const nextInstances = new Map(state.instances);
      const existing = nextInstances.get(instanceId);
      if (existing) {
        nextInstances.set(instanceId, {
          ...existing,
          status,
          last_activity_at: lastActivityAt ?? existing.last_activity_at,
        });
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

  setTerminalJumpHint: (hint) => set({ terminalJumpHint: hint }),

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
      const sourceInstanceId = opts?.sourceInstanceId ?? null;
      const sourceInstance = sourceInstanceId
        ? state.instances.get(sourceInstanceId)
        : null;
      if (
        sourceInstance &&
        sourceInstance.ended_at === null &&
        !sourceInstance.hidden &&
        sourceInstance.instance_id !== primary?.instance_id
      ) {
        participantIds.add(sourceInstance.instance_id);
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
      const instance = state.instances.get(instanceId);
      if (!instance || instance.ended_at !== null || instance.hidden) {
        return state;
      }
      const next = new Set(state.discussion.participantIds);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return { discussion: { ...state.discussion, participantIds: next } };
    }),

  startDiscussion: () => {
    const state = get();
    const participants: AgentInstanceInfo[] = [];
    const liveInstances = new Map(
      getLiveAgentInstances(state.instances).map((info) => [info.instance_id, info] as const),
    );
    const primary = resolvePrimaryInstance(state.instances);
    if (primary && state.discussion.participantIds.has(primary.instance_id)) {
      participants.push(primary);
    }
    state.discussion.participantIds.forEach((id) => {
      if (id === primary?.instance_id) return;
      const info = liveInstances.get(id);
      if (info) participants.push(info);
    });
    const openers = buildOpeningMessages(state.discussion.direction, participants);
    const participantIds = participants.map((participant) => participant.instance_id);
    const topic = state.discussion.direction;
    const maxRounds = state.discussion.rules.maxRounds;

    // Optimistic UI: switch to chatroom immediately
    set((s) => ({
      discussion: {
        ...s.discussion,
        step: 4,
        messages: openers,
        artifacts: collectArtifacts(openers),
        currentRound: 1,
        paused: false,
        backendState: "starting",
        backendError: null,
        lifecycleState: "active",
        endedAt: null,
        discussionId: null,
        sandboxInstanceIds: [],
      },
    }));

    // B3: Fire-and-forget backend call; store discussionId + sandboxInstanceIds on success
    startBackendDiscussion(topic, participantIds, maxRounds)
      .then((session) => {
        const sandboxIds = (session.sandbox_instance_ids ?? []).map((id: string | { "0": string }) =>
          typeof id === "string" ? id : id["0"]
        );
        set((s) => ({
          discussion: {
            ...s.discussion,
            discussionId: typeof session.id === "string" ? session.id : (session.id as unknown as { "0": string })["0"],
            sandboxInstanceIds: sandboxIds,
            backendState: "active",
            backendError: null,
          },
        }));
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[agentStore] startBackendDiscussion failed:", err);
        set((s) => ({
          discussion: {
            ...s.discussion,
            paused: true,
            backendState: "failed",
            backendError: message,
            discussionId: null,
            sandboxInstanceIds: [],
          },
        }));
      });
  },

  pauseDiscussion: () =>
    set((state) => ({ discussion: { ...state.discussion, paused: true } })),

  resumeDiscussion: () =>
    set((state) => ({ discussion: { ...state.discussion, paused: false } })),

  endDiscussion: async () => {
    const { discussion } = get();
    const discussionId = discussion.discussionId;

    set((state) => ({
      discussion: {
        ...state.discussion,
        paused: true,
        backendState: discussionId ? "ending" : state.discussion.backendState,
        backendError: null,
      },
    }));

    if (!discussionId) {
      const now = Date.now();
      set((state) => ({
        discussion: {
          ...state.discussion,
          discussionId: null,
          sandboxInstanceIds: [],
          backendState:
            state.discussion.backendState === "failed" ? "failed" : "idle",
          lifecycleState: "ended_pending_review",
          endedAt: now,
        },
      }));
      return {
        discussion_id: "local-discussion",
        topic: discussion.direction || "Discussion",
        total_rounds: discussion.currentRound,
        summary_text:
          discussion.backendState === "failed"
            ? "Backend discussion failed to start. Review the local transcript and artifacts before closing."
            : "Local discussion ended. Review artifacts before saving or discarding.",
        ended_at: now,
      };
    }

    try {
      const summary = await endBackendDiscussion(discussionId);
      set((state) => ({
        discussion: {
          ...state.discussion,
          paused: true,
          discussionId: null,
          sandboxInstanceIds: [],
          backendState: "idle",
          backendError: null,
          lifecycleState: "ended_pending_review",
          endedAt: summary.ended_at,
        },
      }));
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        discussion: {
          ...state.discussion,
          paused: true,
          backendState: "failed",
          backendError: message,
        },
      }));
      throw error;
    }
  },

  markDiscussionReviewSaved: () =>
    set((state) => ({
      discussion: {
        ...state.discussion,
        lifecycleState: "ended_saved",
      },
    })),

  markDiscussionReviewDiscarded: () =>
    set((state) => ({
      discussion: {
        ...state.discussion,
        lifecycleState: "ended_discarded",
      },
    })),

  interjectDiscussion: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const state = get();
    const codeBlocks = parseCodeBlocks(trimmed);
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
      codeBlocks,
      deliveryState: "pending",
      deliveryError: null,
    };

    // Optimistic UI: show message immediately
    set((s) => ({
      discussion: {
        ...s.discussion,
        messages: [...s.discussion.messages, optimisticMsg],
        artifacts: upsertArtifactsForMessage(s.discussion.artifacts, optimisticMsg),
      },
    }));

    // B3/B3.1: Send to backend + inject into sandbox PTYs (not workspace instances)
    const discussionId = state.discussion.discussionId;
    if (discussionId && state.discussion.backendState !== "failed") {
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
                m.id === optimisticMsg.id
                  ? {
                      ...confirmed,
                      interject: true,
                      deliveryState: "confirmed",
                      deliveryError: null,
                    }
                  : m,
              ),
              artifacts: replaceArtifactsForMessage(
                s.discussion.artifacts,
                optimisticMsg.id,
                confirmed,
              ),
            },
          }));
        })
        .catch((err) => {
          console.warn("[agentStore] sendMessageWithInjection failed:", err);
          const message = err instanceof Error ? err.message : String(err);
          set((s) => ({
            discussion: {
              ...s.discussion,
              messages: s.discussion.messages.map((m) =>
                m.id === optimisticMsg.id
                  ? {
                      ...m,
                      deliveryState: "failed",
                      deliveryError: message,
                    }
                  : m,
              ),
            },
          }));
        });
    }
  },

  toggleDiscussionArtifactPin: (artifactId) =>
    set((state) => ({
      discussion: {
        ...state.discussion,
        artifacts: toggleDiscussionArtifactPinInList(state.discussion.artifacts, artifactId),
      },
    })),

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
          artifacts: upsertArtifactsForMessage(state.discussion.artifacts, msg),
        },
      };
    }),
}));
