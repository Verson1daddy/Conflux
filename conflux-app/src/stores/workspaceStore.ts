// ===== Workspace Store =====
// zustand store for workspace canvas state management
// Manages card layouts, zoom, pan, layout mode, and selection

import { create } from "zustand";
import { useAgentStore } from "@/stores/agentStore";
import { GRID_MIN_ZOOM, GRID_MAX_ZOOM } from "@/lib/grid-model";
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
  /** Append a single card to the canvas */
  addCard: (card: CardLayout) => void;
  /** Remove a card by instance_id */
  removeCard: (instanceId: string) => void;
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
  /** After drag-end: resolve overlaps */
  resolveOverlaps: (movedCardId: string) => void;
  /** Fit all cards into the current viewport */
  fitAll: (viewportWidth: number, viewportHeight: number) => void;
  /** Auto-arrange all cards into a compact grid with consistent gap */
  autoArrange: () => void;
  /** jump-back 聚焦高亮脉冲的目标卡（一次性，动画后清空） */
  pulseCardId: string | null;
  setPulseCard: (id: string | null) => void;
}

// ===== Constants =====
// zoom 钳制必须与相机/网格同源（grid-model）——否则 setZoom 提交被钳、
// liveZoom 与 storeZoom 脱钩，>MAX 处网格与卡片层撕裂（审计 P0）。

const MIN_ZOOM = GRID_MIN_ZOOM;
const MAX_ZOOM = GRID_MAX_ZOOM;

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

  setCards: (cards: CardLayout[]) => set({ cards }),

  addCard: (card: CardLayout) =>
    set((state: WorkspaceState) => {
      const maxZ = state.cards.reduce((m: number, c: CardLayout) => Math.max(m, c.z_index), 0);
      return {
        cards: [...state.cards, { ...card, z_index: maxZ + 1 }],
      };
    }),

  removeCard: (instanceId: string) =>
    set((state: WorkspaceState) => ({
      cards: state.cards.filter((c: CardLayout) => c.instance_id !== instanceId),
      selectedCardId:
        state.selectedCardId === instanceId ? null : state.selectedCardId,
    })),

  updateCardPosition: (instanceId: string, position: Position) =>
    set((state: WorkspaceState) => ({
      cards: state.cards.map((card: CardLayout) =>
        card.instance_id === instanceId ? { ...card, position } : card
      ),
    })),

  updateCardSize: (instanceId: string, size: Size) =>
    set((state: WorkspaceState) => ({
      cards: state.cards.map((card: CardLayout) =>
        card.instance_id === instanceId ? { ...card, size } : card
      ),
    })),

  setLayoutMode: (mode: LayoutMode) => set({ layoutMode: mode }),

  setAutoPackConfig: (config: AutoPackConfig) => set({ autoPackConfig: config }),

  setZoom: (zoom: number) =>
    set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }),

  setPan: (pan: { x: number; y: number }) => set({ pan }),

  selectCard: (id: string | null) => set({ selectedCardId: id }),

  pulseCardId: null,
  setPulseCard: (id: string | null) => set({ pulseCardId: id }),

  bringToFront: (instanceId) =>
    set((state: WorkspaceState) => {
      const maxZ = state.cards.reduce(
        (max: number, card: CardLayout) => Math.max(max, card.z_index),
        0
      );
      return {
        cards: state.cards.map((card: CardLayout) =>
          card.instance_id === instanceId
            ? { ...card, z_index: maxZ + 1 }
            : card
        ),
      };
    }),

  resolveOverlaps: (anchorCardId) =>
    set((state: WorkspaceState) => {
      const GAP = 16;
      const GRID = 8;
      const MAX_ITER = 20;
      const snap = (v: number) => Math.round(v / GRID) * GRID;

      // Mutable position map — mutated during resolution
      const pos = new Map<string, { x: number; y: number }>();
      const sz = new Map<string, { w: number; h: number }>();
      for (const c of state.cards) {
        pos.set(c.instance_id, { x: c.position.x, y: c.position.y });
        sz.set(c.instance_id, { w: c.size.width, h: c.size.height });
      }
      if (!pos.has(anchorCardId)) return state;

      // Check if card `id` overlaps ANY other card
      const countOverlaps = (id: string): number => {
        const p = pos.get(id)!;
        const s = sz.get(id)!;
        let count = 0;
        for (const c of state.cards) {
          if (c.instance_id === id) continue;
          const op = pos.get(c.instance_id)!;
          const os = sz.get(c.instance_id)!;
          const ox = Math.min(p.x + s.w, op.x + os.w) - Math.max(p.x, op.x);
          const oy = Math.min(p.y + s.h, op.y + os.h) - Math.max(p.y, op.y);
          if (ox > 0 && oy > 0) count++;
        }
        return count;
      };

      for (let iter = 0; iter < MAX_ITER; iter++) {
        // Find the non-anchor card with the worst overlap against ANY card
        let targetId = "";
        let worstOtherId = "";
        let worstArea = 0;

        for (const c of state.cards) {
          if (c.instance_id === anchorCardId) continue;
          const p = pos.get(c.instance_id)!;
          const s = sz.get(c.instance_id)!;
          for (const o of state.cards) {
            if (o.instance_id === c.instance_id) continue;
            const op = pos.get(o.instance_id)!;
            const os = sz.get(o.instance_id)!;
            const ox = Math.min(p.x + s.w, op.x + os.w) - Math.max(p.x, op.x);
            const oy = Math.min(p.y + s.h, op.y + os.h) - Math.max(p.y, op.y);
            if (ox > 0 && oy > 0 && ox * oy > worstArea) {
              worstArea = ox * oy;
              targetId = c.instance_id;
              worstOtherId = o.instance_id;
            }
          }
        }

        if (worstArea <= 0) break; // no overlaps remain — done

        const tp = pos.get(targetId)!;
        const ts = sz.get(targetId)!;
        const savedX = tp.x;
        const savedY = tp.y;
        const op = pos.get(worstOtherId)!;
        const os = sz.get(worstOtherId)!;

        // 4 candidate positions: adjacent to the overlapping card
        const candidates = [
          { x: snap(op.x + os.w + GAP), y: savedY },  // right of other
          { x: snap(op.x - ts.w - GAP), y: savedY },   // left of other
          { x: savedX, y: snap(op.y + os.h + GAP) },   // below other
          { x: savedX, y: snap(op.y - ts.h - GAP) },   // above other
        ];

        // Sort by distance from current position (prefer smallest move)
        candidates.sort((a, b) =>
          (Math.abs(a.x - savedX) + Math.abs(a.y - savedY)) -
          (Math.abs(b.x - savedX) + Math.abs(b.y - savedY))
        );

        // Test each candidate, pick the one with fewest remaining overlaps
        let bestCand = candidates[0];
        let bestOverlaps = Infinity;
        for (const cand of candidates) {
          tp.x = cand.x;
          tp.y = cand.y;
          const n = countOverlaps(targetId);
          if (n < bestOverlaps) {
            bestOverlaps = n;
            bestCand = { x: cand.x, y: cand.y };
          }
          if (n === 0) break; // perfect spot
        }
        // Commit the best candidate
        tp.x = bestCand.x;
        tp.y = bestCand.y;
      }

      // Build updated cards
      const cards = state.cards.map((c: CardLayout) => {
        const np = pos.get(c.instance_id)!;
        if (np.x === c.position.x && np.y === c.position.y) return c;
        return { ...c, position: { x: np.x, y: np.y } };
      });
      return { cards };
    }),

  fitAll: (viewportWidth: number, viewportHeight: number) =>
    set((state: WorkspaceState) => {
      if (state.cards.length === 0) return state;
      const PAD = 60;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of state.cards) {
        minX = Math.min(minX, c.position.x);
        minY = Math.min(minY, c.position.y);
        maxX = Math.max(maxX, c.position.x + c.size.width);
        maxY = Math.max(maxY, c.position.y + c.size.height);
      }
      const bboxW = maxX - minX + PAD * 2;
      const bboxH = maxY - minY + PAD * 2;
      const zoom = Math.max(MIN_ZOOM, Math.min(1, Math.min(
        viewportWidth / bboxW,
        viewportHeight / bboxH,
      )));
      const contentW = bboxW * zoom;
      const contentH = bboxH * zoom;
      const panX = (viewportWidth - contentW) / 2 - (minX - PAD) * zoom;
      const panY = (viewportHeight - contentH) / 2 - (minY - PAD) * zoom;
      return { zoom, pan: { x: panX, y: panY } };
    }),

  autoArrange: () =>
    set((state: WorkspaceState) => {
      if (state.cards.length === 0) return state;
      const GAP = 16;
      const START = 24;

      // Sort: pinned first, then wider cards for better packing
      const agentInstances = useAgentStore.getState().instances;
      const sorted = [...state.cards].sort((a: CardLayout, b: CardLayout) => {
        const aPinned = agentInstances.get(a.instance_id)?.is_pinned ? 1 : 0;
        const bPinned = agentInstances.get(b.instance_id)?.is_pinned ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return b.size.width * b.size.height - a.size.width * a.size.height;
      });

      // Simple row-based packing: fill row left→right, wrap when exceeding
      // a reasonable max width (~3 cards wide or 2000px, whichever is smaller).
      const maxRowW = Math.max(
        1400,
        sorted.reduce((sum: number, c: CardLayout) => sum + c.size.width, 0) / Math.ceil(Math.sqrt(sorted.length)) + GAP * 4
      );

      const placed: { id: string; x: number; y: number }[] = [];
      let curX = START;
      let curY = START;
      let rowH = 0;

      for (const card of sorted) {
        if (curX + card.size.width > maxRowW && curX > START) {
          // Wrap to next row
          curX = START;
          curY += rowH + GAP;
          rowH = 0;
        }
        placed.push({ id: card.instance_id, x: curX, y: curY });
        curX += card.size.width + GAP;
        rowH = Math.max(rowH, card.size.height);
      }

      const posMap = new Map(placed.map((p) => [p.id, { x: p.x, y: p.y }]));
      const cards = state.cards.map((c: CardLayout) => {
        const np = posMap.get(c.instance_id);
        if (!np) return c;
        return { ...c, position: { x: np.x, y: np.y } };
      });
      return { cards };
    }),
}));
