// ===== AgentCard Component =====
// Glass-morphism card shell for a single Agent instance on the workspace canvas.
// Supports drag-to-reposition in Free layout mode with 8px snap grid.
// 5 discrete size slots: Mini, Small, Medium, Large, Wide.

import { useCallback, useRef, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { SNAP_GRID_PX } from "@/types/layout";
import type {
  CardLayout,
  AgentStatus,
  CardSizeSlot,
  Position,
  Size,
  LayoutMode,
} from "@/types";

// ===== Size slot dimensions =====

const SIZE_SLOT_MAP: Record<CardSizeSlot, Size> = {
  mini: { width: 200, height: 140 },
  small: { width: 200, height: 288 },
  medium: { width: 408, height: 288 },
  large: { width: 408, height: 436 },
  wide: { width: 616, height: 288 },
};

/** Ordered list of size slots for cycling */
const SIZE_SLOT_ORDER: CardSizeSlot[] = [
  "mini",
  "small",
  "medium",
  "large",
  "wide",
];

/**
 * Determine which slot best matches a given size.
 * Uses minimum Euclidean distance to the slot dimensions.
 */
function detectSizeSlot(size: Size): CardSizeSlot {
  let bestSlot: CardSizeSlot = "medium";
  let bestDist = Infinity;

  for (const slot of SIZE_SLOT_ORDER) {
    const ref = SIZE_SLOT_MAP[slot];
    const dist = Math.abs(ref.width - size.width) + Math.abs(ref.height - size.height);
    if (dist < bestDist) {
      bestDist = dist;
      bestSlot = slot;
    }
  }
  return bestSlot;
}

/**
 * Get the next size slot in the cycling order.
 */
function nextSizeSlot(current: CardSizeSlot): CardSizeSlot {
  const idx = SIZE_SLOT_ORDER.indexOf(current);
  return SIZE_SLOT_ORDER[(idx + 1) % SIZE_SLOT_ORDER.length];
}

// ===== Status indicator colors =====

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "bg-gray-500",
  thinking: "bg-accent",
  coding: "bg-green-500",
  waiting_permission: "bg-yellow-500",
  done: "bg-green-500",
  error: "bg-red-500",
};

const STATUS_GLOW: Record<AgentStatus, string> = {
  idle: "",
  thinking: "shadow-[0_0_8px_rgba(184,212,227,0.6)]",
  coding: "shadow-[0_0_8px_rgba(74,222,128,0.5)]",
  waiting_permission: "shadow-[0_0_8px_rgba(250,204,21,0.5)]",
  done: "",
  error: "shadow-[0_0_8px_rgba(239,68,68,0.5)]",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  thinking: "Thinking",
  coding: "Coding",
  waiting_permission: "Awaiting",
  done: "Done",
  error: "Error",
};

// ===== Snap helper =====

function snapToGrid(value: number): number {
  return Math.round(value / SNAP_GRID_PX) * SNAP_GRID_PX;
}

// ===== Props =====

interface AgentCardProps {
  /** Card layout data (position, size, z_index) */
  card: CardLayout;
  /** Agent display name */
  agentName: string;
  /** Adapter badge text (e.g., "Claude", "GPT") */
  adapterBadge: string;
  /** Current agent status */
  status: AgentStatus;
  /** Whether this card is currently selected */
  isSelected: boolean;
  /** Current layout mode — dragging only enabled in "free" mode */
  layoutMode: LayoutMode;
  /** Current canvas zoom level (for translating mouse deltas) */
  zoom: number;
  /** Number of files associated with this agent (display in footer) */
  fileCount: number;
  /** Last activity timestamp (display in footer) */
  lastActivity: number;
}

/**
 * AgentCard renders a single agent's card on the workspace canvas.
 *
 * Features:
 * - Glass-morphism appearance (.glass class)
 * - Status indicator dot with glow
 * - Drag-to-reposition via grip handle (free mode only)
 * - 8px snap grid alignment
 * - Double-click grip to cycle size slot
 * - Pointer capture for reliable drag outside window bounds
 */
function AgentCard({
  card,
  agentName,
  adapterBadge,
  status,
  isSelected,
  layoutMode,
  zoom,
  fileCount,
  lastActivity,
}: AgentCardProps) {
  const {
    updateCardPosition,
    updateCardSize,
    selectCard,
    bringToFront,
  } = useWorkspaceStore();

  const dragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startCardX: number;
    startCardY: number;
  } | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  const isMini = card.size.width <= 200 && card.size.height <= 160;
  const currentSlot = detectSizeSlot(card.size);

  // ===== Card click: select + bring to front =====

  const handleCardPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only respond to primary button
      if (e.button !== 0) return;
      selectCard(card.instance_id);
      bringToFront(card.instance_id);
    },
    [card.instance_id, selectCard, bringToFront]
  );

  // ===== Drag start (on grip handle) =====

  const handleGripPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (layoutMode !== "free") return;
      if (e.button !== 0) return;

      e.stopPropagation();
      e.preventDefault();

      // Set pointer capture for reliable tracking outside the window
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      dragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startCardX: card.position.x,
        startCardY: card.position.y,
      };
      setIsDragging(true);
      selectCard(card.instance_id);
      bringToFront(card.instance_id);
    },
    [layoutMode, card.position.x, card.position.y, card.instance_id, selectCard, bringToFront]
  );

  // ===== Drag move =====

  const handleGripPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;

      const dx = (e.clientX - dragRef.current.startMouseX) / zoom;
      const dy = (e.clientY - dragRef.current.startMouseY) / zoom;

      const newX = snapToGrid(dragRef.current.startCardX + dx);
      const newY = snapToGrid(dragRef.current.startCardY + dy);

      const newPos: Position = { x: newX, y: newY };
      updateCardPosition(card.instance_id, newPos);
    },
    [zoom, card.instance_id, updateCardPosition]
  );

  // ===== Drag end =====

  const handleGripPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;

      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
      setIsDragging(false);
    },
    []
  );

  // ===== Double-click grip: cycle size slot =====

  const handleGripDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const next = nextSizeSlot(currentSlot);
      updateCardSize(card.instance_id, SIZE_SLOT_MAP[next]);
    },
    [currentSlot, card.instance_id, updateCardSize]
  );

  // ===== Format timestamp =====

  const formattedTime = formatRelativeTime(lastActivity);

  // ===== Render =====

  return (
    <div
      className={[
        "glass absolute rounded-lg overflow-hidden flex flex-col",
        "transition-shadow duration-200",
        isSelected
          ? "ring-1 ring-accent/40 shadow-elevated"
          : "shadow-card",
        isDragging ? "cursor-grabbing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        left: card.position.x,
        top: card.position.y,
        width: card.size.width,
        height: card.size.height,
        zIndex: card.z_index,
      }}
      onPointerDown={handleCardPointerDown}
    >
      {/* ===== Header ===== */}
      <div className="glass-header flex items-center gap-2 px-3 py-2 shrink-0">
        {/* Status dot */}
        <span
          className={[
            "w-2.5 h-2.5 rounded-full shrink-0",
            STATUS_COLORS[status],
            STATUS_GLOW[status],
          ]
            .filter(Boolean)
            .join(" ")}
          title={STATUS_LABELS[status]}
        />

        {/* Agent name */}
        <span className="font-body text-sm text-white/90 truncate flex-1">
          {agentName}
        </span>

        {/* Adapter badge */}
        <span className="text-[10px] font-mono text-accent/60 bg-accent/10 px-1.5 py-0.5 rounded shrink-0">
          {adapterBadge}
        </span>

        {/* Grip handle (drag target) */}
        <button
          className={[
            "text-white/30 hover:text-white/60 text-sm leading-none shrink-0 select-none",
            layoutMode === "free" ? "cursor-grab" : "cursor-default opacity-30",
            isDragging ? "cursor-grabbing" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onPointerDown={handleGripPointerDown}
          onPointerMove={handleGripPointerMove}
          onPointerUp={handleGripPointerUp}
          onDoubleClick={handleGripDoubleClick}
          title={
            layoutMode === "free"
              ? "Drag to move, double-click to resize"
              : "Dragging disabled in this layout mode"
          }
        >
          &#x2807;&#x2807;
        </button>
      </div>

      {/* ===== Body: terminal preview ===== */}
      {!isMini && (
        <div className="flex-1 px-3 py-2 overflow-hidden min-h-0">
          <div className="font-mono text-xs text-white/40 leading-relaxed select-text">
            Terminal content here
          </div>
        </div>
      )}

      {/* ===== Footer ===== */}
      {!isMini && (
        <div className="glass-header flex items-center justify-between px-3 py-1.5 shrink-0">
          <span className="font-mono text-[10px] text-white/30">
            {formattedTime}
          </span>
          <span className="font-mono text-[10px] text-white/30">
            {fileCount} files
          </span>
        </div>
      )}
    </div>
  );
}

// ===== Helpers =====

/**
 * Formats a Unix timestamp (ms) as a relative time string.
 */
function formatRelativeTime(timestamp: number): string {
  if (timestamp === 0) return "---";

  const now = Date.now();
  const diffMs = now - timestamp;

  if (diffMs < 0) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

export { AgentCard };
export type { AgentCardProps };
export { SIZE_SLOT_MAP, SIZE_SLOT_ORDER, detectSizeSlot };
