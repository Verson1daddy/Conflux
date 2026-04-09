// ===== Workspace Store =====
// zustand store for workspace canvas state management
// Manages card layouts, zoom, pan, layout mode, and selection

import { create } from "zustand";
import type {
  CardLayout,
  LayoutMode,
  AutoPackConfig,
  Position,
  Size,
} from "@/types";

// ===== State Interface =====

interface WorkspaceState {
  /** All card layouts on the canvas */
  cards: CardLayout[];
  /** Current layout mode */
  layoutMode: LayoutMode;
  /** AutoPack configuration (used when layoutMode === "auto_pack") */
  autoPackConfig: AutoPackConfig;
  /** Current zoom level (0.25 - 3.0) */
  zoom: number;
  /** Current pan offset in canvas coordinates */
  pan: { x: number; y: number };
  /** Currently selected card instance_id, or null */
  selectedCardId: string | null;

  // ===== Actions =====

  /** Replace all cards */
  setCards: (cards: CardLayout[]) => void;
  /** Update a single card's position */
  updateCardPosition: (instanceId: string, position: Position) => void;
  /** Update a single card's size */
  updateCardSize: (instanceId: string, size: Size) => void;
  /** Switch layout mode */
  setLayoutMode: (mode: LayoutMode) => void;
  /** Update AutoPack configuration */
  setAutoPackConfig: (config: AutoPackConfig) => void;
  /** Set zoom level (clamped to 0.25 - 3.0) */
  setZoom: (zoom: number) => void;
  /** Set pan offset */
  setPan: (pan: { x: number; y: number }) => void;
  /** Select a card (or deselect with null) */
  selectCard: (id: string | null) => void;
  /** Bring a card to the front by setting its z_index above all others */
  bringToFront: (instanceId: string) => void;
}

// ===== Constants =====

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

const DEFAULT_AUTO_PACK_CONFIG: AutoPackConfig = {
  sort_strategy: "by_activity",
  size_preset: "smart",
  auto_repack_on_add: true,
};

// ===== Store =====

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  cards: [],
  layoutMode: "free",
  autoPackConfig: DEFAULT_AUTO_PACK_CONFIG,
  zoom: 1,
  pan: { x: 0, y: 0 },
  selectedCardId: null,

  setCards: (cards) => set({ cards }),

  updateCardPosition: (instanceId, position) =>
    set((state) => ({
      cards: state.cards.map((card) =>
        card.instance_id === instanceId ? { ...card, position } : card
      ),
    })),

  updateCardSize: (instanceId, size) =>
    set((state) => ({
      cards: state.cards.map((card) =>
        card.instance_id === instanceId ? { ...card, size } : card
      ),
    })),

  setLayoutMode: (mode) => set({ layoutMode: mode }),

  setAutoPackConfig: (config) => set({ autoPackConfig: config }),

  setZoom: (zoom) =>
    set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }),

  setPan: (pan) => set({ pan }),

  selectCard: (id) => set({ selectedCardId: id }),

  bringToFront: (instanceId) =>
    set((state) => {
      const maxZ = state.cards.reduce(
        (max, card) => Math.max(max, card.z_index),
        0
      );
      return {
        cards: state.cards.map((card) =>
          card.instance_id === instanceId
            ? { ...card, z_index: maxZ + 1 }
            : card
        ),
      };
    }),
}));
