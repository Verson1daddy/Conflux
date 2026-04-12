// ===== useWorkspaceLayout Hook =====
// Manages workspace layout lifecycle: load, save, event listening, and auto-pack
// Connects the zustand store to Tauri IPC and event system

import { useEffect, useCallback, useRef } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  loadWorkspaceLayout,
  saveWorkspaceLayout,
  autoPackLayout,
  listAgentInstances,
} from "@/lib/tauri-bridge";
import { onAgentStatusChanged } from "@/lib/event-listener";
import type {
  CardLayout,
  WorkspaceLayout,
  AgentInstanceInfo,
} from "@/types";

// ===== Default card dimensions for new agents =====
// Must stay >= MIN_CARD_W/H (580x380) enforced by AgentCard. Using 620x420
// gives a little breathing room for the header + footer chrome + a few rows
// of terminal content.
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

/**
 * Workspace layout management hook.
 *
 * - On mount: loads persisted layout from backend, merges with live agent instances
 * - Listens for AgentStatusChanged events (no-op for layout, but keeps store in sync)
 * - Provides triggerAutoPack() to invoke backend auto-pack algorithm
 * - Provides saveLayout() to persist current layout to disk
 */
export function useWorkspaceLayout() {
  const {
    cards,
    layoutMode,
    autoPackConfig,
    setCards,
    setLayoutMode,
    setAutoPackConfig,
  } = useWorkspaceStore();

  const initializedRef = useRef(false);

  // ===== Initialization: load layout + merge with live agents =====
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let cancelled = false;

    async function initialize() {
      try {
        const [savedLayout, liveInstances] = await Promise.all([
          loadWorkspaceLayout(),
          listAgentInstances(),
        ]);

        if (cancelled) return;

        // Build a map of saved card layouts by instance_id
        const savedCardMap = new Map<string, CardLayout>();
        if (savedLayout) {
          for (const card of savedLayout.cards) {
            savedCardMap.set(card.instance_id, card);
          }
        }

        // Merge: use saved layout if available, otherwise create default
        const mergedCards = liveInstances.map((instance, index) => {
          const saved = savedCardMap.get(instance.instance_id);
          if (saved) return saved;
          return createDefaultCardLayout(instance, index);
        });

        // Only overwrite cards when the backend actually reported instances.
        // Otherwise leave the store untouched so the demo seed written by
        // App.tsx survives initialization under real `tauri:dev`. New real
        // instances arriving later flow through onAgentStatusChanged below.
        if (mergedCards.length > 0) {
          setCards(mergedCards);
        }

        if (savedLayout) {
          setLayoutMode(savedLayout.layout_mode);
          if (savedLayout.auto_pack_config) {
            setAutoPackConfig(savedLayout.auto_pack_config);
          }
        }
      } catch (err) {
        // On error (e.g., backend not ready), initialize with empty state
        console.error("[useWorkspaceLayout] initialization failed:", err);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [setCards, setLayoutMode, setAutoPackConfig]);

  // ===== Event listener: AgentStatusChanged =====
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    onAgentStatusChanged((payload) => {
      // When a new agent appears that we don't have a card for, add one
      const currentCards = useWorkspaceStore.getState().cards;
      const exists = currentCards.some(
        (c) => c.instance_id === payload.instance_id
      );
      if (!exists) {
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
   * Trigger backend AutoPack algorithm.
   * Replaces all card positions/sizes with the backend-computed layout.
   */
  const triggerAutoPack = useCallback(async () => {
    try {
      const result: WorkspaceLayout = await autoPackLayout(autoPackConfig);
      setCards(result.cards);
      if (result.auto_pack_config) {
        setAutoPackConfig(result.auto_pack_config);
      }
    } catch (err) {
      console.error("[useWorkspaceLayout] autoPackLayout failed:", err);
    }
  }, [autoPackConfig, setCards, setAutoPackConfig]);

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

  return {
    cards,
    layoutMode,
    autoPackConfig,
    triggerAutoPack,
    saveLayout,
  };
}
