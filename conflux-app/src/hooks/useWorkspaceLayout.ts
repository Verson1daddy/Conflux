// ===== useWorkspaceLayout Hook =====
// Manages workspace layout lifecycle: load, save, event listening, and auto-pack
// Connects the zustand store to Tauri IPC and event system

import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAgentStore } from "@/stores/agentStore";
import { getLiveAgentInstances } from "@/lib/workspace-status";
import {
  loadWorkspaceLayout,
  saveWorkspaceLayout,
} from "@/lib/tauri-bridge";
import { onAgentStatusChanged } from "@/lib/event-listener";
import type {
  CardLayout,
  WorkspaceLayout,
  AgentInstanceInfo,
} from "@/types";

// ===== Default card dimensions for new agents =====
// Must stay >= MIN_CARD_W/H (320x220) enforced by AgentCard. Using 620x420
// gives comfortable room for header + footer chrome + several rows of terminal.
const DEFAULT_CARD_WIDTH = 620;
const DEFAULT_CARD_HEIGHT = 420;
const CARD_SPAWN_OFFSET = 40;

/**
 * Creates a default CardLayout for an agent instance that has no saved layout.
 * Positions cards in a cascading pattern to avoid full overlap.
 */
function createDefaultCardLayout(
  instance: AgentInstanceInfo,
  index: number
): CardLayout {
  return {
    instance_id: instance.instance_id,
    position: {
      x: 80 + index * CARD_SPAWN_OFFSET,
      y: 80 + index * CARD_SPAWN_OFFSET,
    },
    size: {
      width: DEFAULT_CARD_WIDTH,
      height: DEFAULT_CARD_HEIGHT,
    },
    z_index: index,
  };
}

export function mergeWorkspaceCards(input: {
  liveInstances: AgentInstanceInfo[];
  currentCards: CardLayout[];
  savedCards: Map<string, CardLayout>;
  preserveCurrentCardsOnEmpty?: boolean;
}): CardLayout[] {
  if (
    input.preserveCurrentCardsOnEmpty &&
    input.liveInstances.length === 0 &&
    input.currentCards.length > 0
  ) {
    return input.currentCards;
  }

  const currentCardMap = new Map(
    input.currentCards.map((card) => [card.instance_id, card] as const)
  );

  return input.liveInstances.map((instance, index) => {
    return (
      currentCardMap.get(instance.instance_id) ??
      input.savedCards.get(instance.instance_id) ??
      createDefaultCardLayout(instance, index)
    );
  });
}

export function shouldAutoFitOnCardsRestored(
  previousCardCount: number,
  nextCardCount: number
): boolean {
  return previousCardCount === 0 && nextCardCount > 0;
}

export function selectWorkspaceLiveInstances(
  instances: Map<string, AgentInstanceInfo>
): AgentInstanceInfo[] {
  return getLiveAgentInstances(instances);
}

export function shouldAddCardForStatusEvent(input: {
  instanceId: string;
  instances: Map<string, AgentInstanceInfo>;
  currentCards: CardLayout[];
}): boolean {
  if (input.currentCards.some((card) => card.instance_id === input.instanceId)) {
    return false;
  }

  const instance = input.instances.get(input.instanceId);
  return Boolean(instance && instance.ended_at === null && !instance.hidden);
}

/**
 * Workspace layout management hook.
 *
 * - On mount: loads persisted layout from backend, merges with live agent instances
 * - Listens for AgentStatusChanged events (no-op for layout, but keeps store in sync)
 * - Provides triggerAutoPack() to invoke backend auto-pack algorithm
 * - Provides saveLayout() to persist current layout to disk
 */
export function useWorkspaceLayout() {
  const instanceMap = useAgentStore((s) => s.instances);
  const preserveCurrentCardsOnEmpty = useAgentStore(
    (s) => s.ignoredEmptyInstanceSnapshot
  );
  const liveInstances = useMemo(
    () => selectWorkspaceLiveInstances(instanceMap),
    [instanceMap]
  );
  const {
    cards,
    layoutMode,
    autoPackConfig,
    setCards,
    setLayoutMode,
    setAutoPackConfig,
  } = useWorkspaceStore();

  const initializedRef = useRef(false);
  const savedCardsRef = useRef(new Map<string, CardLayout>());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layoutHydrated, setLayoutHydrated] = useState(false);

  // ===== Initialization: load persisted layout metadata =====
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let cancelled = false;

    async function initialize() {
      try {
        const savedLayout = await loadWorkspaceLayout();

        if (cancelled) return;

        const savedCardMap = new Map<string, CardLayout>();
        if (savedLayout) {
          for (const card of savedLayout.cards) {
            savedCardMap.set(card.instance_id, card);
          }
        }
        savedCardsRef.current = savedCardMap;

        if (savedLayout) {
          setLayoutMode(savedLayout.layout_mode);
          if (savedLayout.auto_pack_config) {
            setAutoPackConfig(savedLayout.auto_pack_config);
          }
        }

        setLayoutHydrated(true);
      } catch (err) {
        // On error (e.g., backend not ready), initialize with empty state
        console.error("[useWorkspaceLayout] initialization failed:", err);
        setLayoutHydrated(true);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [setCards, setLayoutMode, setAutoPackConfig]);

  // ===== Reconcile cards with live instances =====
  useEffect(() => {
    if (!initializedRef.current || !layoutHydrated) {
      return;
    }

    const mergedCards = mergeWorkspaceCards({
      liveInstances,
      currentCards: useWorkspaceStore.getState().cards,
      savedCards: savedCardsRef.current,
      preserveCurrentCardsOnEmpty,
    });

    const currentCards = useWorkspaceStore.getState().cards;
    const cardsChanged =
      currentCards.length !== mergedCards.length ||
      currentCards.some((card, index) => {
        const next = mergedCards[index];
        return (
          !next ||
          card.instance_id !== next.instance_id ||
          card.position.x !== next.position.x ||
          card.position.y !== next.position.y ||
          card.size.width !== next.size.width ||
          card.size.height !== next.size.height ||
          card.z_index !== next.z_index
        );
      });

    if (cardsChanged) {
      setCards(mergedCards);
    }
  }, [layoutHydrated, liveInstances, preserveCurrentCardsOnEmpty, setCards]);

  // ===== Event listener: AgentStatusChanged =====
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    onAgentStatusChanged((payload) => {
      // When a new agent appears that we don't have a card for, add one
      const currentCards = useWorkspaceStore.getState().cards;
      const currentInstances = useAgentStore.getState().instances;
      if (
        shouldAddCardForStatusEvent({
          instanceId: payload.instance_id,
          instances: currentInstances,
          currentCards,
        })
      ) {
        const newCard: CardLayout = {
          instance_id: payload.instance_id,
          position: {
            x: 80 + currentCards.length * CARD_SPAWN_OFFSET,
            y: 80 + currentCards.length * CARD_SPAWN_OFFSET,
          },
          size: {
            width: DEFAULT_CARD_WIDTH,
            height: DEFAULT_CARD_HEIGHT,
          },
          z_index: currentCards.length,
        };
        useWorkspaceStore.getState().setCards([...currentCards, newCard]);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ===== Actions =====

  /**
   * Trigger auto-arrange using the frontend store's algorithm.
   * The backend autoPackLayout IPC returns empty for frontend-only cards,
   * so we use the client-side autoArrange instead.
   */
  const triggerAutoPack = useCallback(() => {
    useWorkspaceStore.getState().autoArrange();
  }, []);

  /**
   * Persist current workspace layout to backend storage.
   */
  const saveLayout = useCallback(async () => {
    try {
      const state = useWorkspaceStore.getState();
      const layout: WorkspaceLayout = {
        cards: state.cards,
        layout_mode: state.layoutMode,
        auto_pack_config:
          state.layoutMode === "auto_pack" ? state.autoPackConfig : null,
        updated_at: Date.now(),
      };
      await saveWorkspaceLayout(layout);
    } catch (err) {
      console.error("[useWorkspaceLayout] saveLayout failed:", err);
    }
  }, []);

  useEffect(() => {
    if (!layoutHydrated) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      void saveLayout();
    }, 250);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [autoPackConfig, cards, layoutHydrated, layoutMode, saveLayout]);

  return {
    cards,
    layoutMode,
    autoPackConfig,
    triggerAutoPack,
    saveLayout,
  };
}
