// ===== AgentCard Component =====
// Glass-morphism card for a single Agent instance on the workspace canvas.
// Performance: drag/resize use DOM manipulation via refs; store commits only on pointerup.
// Free resize via corner handle, no min size constraint for manual operations.
// Content adapts to card dimensions.

import { useCallback, useRef, useLayoutEffect, useMemo, useState, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAgentStore } from "@/stores/agentStore";
import { destroyAgentInstance } from "@/lib/tauri-bridge";
import { SNAP_GRID_PX } from "@/types/layout";
import { XtermTerminal } from "./XtermTerminal";
import { ExpandedAgentCard } from "./ExpandedAgentCard";
import type {
  CardLayout,
  AgentStatus,
  Position,
  LayoutMode,
} from "@/types";

// ===== Status colors =====

const STATUS_DOT_COLORS: Record<AgentStatus, string> = {
  idle: "#6B7280",
  thinking: "#FFB800",
  coding: "#34C759",
  waiting_permission: "#FFB800",
  done: "#34C759",
  error: "#FF3B30",
};

// ===== Vendor badge mapping =====

const ADAPTER_VENDOR: Record<string, string> = {
  "claude-code": "anthropic",
  codex: "openai",
  aider: "paul-gauthier",
  opencode: "opencode",
};

// ===== Demo terminal content =====
// Colors are encoded as 24-bit ANSI escape sequences so xterm.js renders them
// with our Conflux palette exactly. Keep these in sync with CONFLUX_THEME.

const ANSI = {
  reset: "\x1b[0m",
  muted: "\x1b[38;2;107;114;128m",    // #6B7280
  accent: "\x1b[38;2;184;212;227m",   // #B8D4E3
  secondary: "\x1b[38;2;184;179;176m", // #B8B3B0
  success: "\x1b[38;2;52;199;89m",    // #34C759
  warning: "\x1b[38;2;255;184;0m",    // #FFB800
};

function line(color: string, text: string): string {
  return `${color}${text}${ANSI.reset}\r\n`;
}

const DEMO_TERMINAL_ANSI: Record<string, string> = {
  "claude-code":
    line(ANSI.muted, "> claude --model opus task.md") +
    line(ANSI.accent, "╭─ Task: Implement workspace canvas") +
    line(ANSI.secondary, "│  Reading src\\components\\Canvas.tsx...") +
    line(ANSI.accent, "╰─") +
    line(ANSI.success, "  ✓ Created Canvas.tsx (142 lines)") +
    line(ANSI.success, "  ✓ Added react-grid-layout dependency") +
    line(ANSI.success, "  ✓ Updated LayoutManager.tsx") +
    line(ANSI.accent, "⠋ Writing AgentCard component..."),
  codex:
    line(ANSI.muted, "> codex analyze src\\lib\\") +
    line(ANSI.warning, "Analyzing 14 files...") +
    line(ANSI.secondary, "  [████████░░] 78%") +
    line(ANSI.secondary, "  Found 3 optimization targets"),
  aider:
    line(ANSI.muted, "Aider v0.82.0") +
    line(ANSI.secondary, "Model: opus-4 with architect mode") +
    line(ANSI.secondary, "Repo: D:\\Projects\\conflux-app") +
    line(ANSI.muted, "Ready for input. > _"),
  opencode:
    line(ANSI.success, "> Reviewing PR #42...") +
    line(ANSI.secondary, "  3 files, 0 issues"),
};

const DEMO_FOOTER: Record<string, { time: string; detail: string }> = {
  "claude-code": { time: "3m 24s", detail: "4 files changed" },
  codex: { time: "1m 47s", detail: "1 sub-agent" },
  aider: { time: "", detail: "idle" },
  opencode: { time: "0m 38s", detail: "" },
};

// ===== Snap helper =====

function snapToGrid(value: number): number {
  return Math.round(value / SNAP_GRID_PX) * SNAP_GRID_PX;
}

// ===== Props =====

interface AgentCardProps {
  card: CardLayout;
  agentName: string;
  adapterBadge: string;
  status: AgentStatus;
  isSelected: boolean;
  layoutMode: LayoutMode;
  zoom: number;
  fileCount: number;
  lastActivity: number;
  /** When true, the card flips in place to reveal the expanded agent view on
   *  its back face. Used in fullscreen mode; non-fullscreen uses an overlay
   *  panel instead (see App.tsx). */
  isFlipped?: boolean;
  /** When true, this card is NOT the focused one but another card IS expanded
   *  in fullscreen flip mode — the card fades out of the way so attention
   *  collapses onto the flipped card. */
  isDimmed?: boolean;
}

// ===== Layout breakpoints =====

const HEADER_H = 42;
const FOOTER_H = 32;
const MIN_TERM_H = 40;

// Minimum card dimensions. The design requires the card's back face (the
// expanded agent view) to always be legible — sidebar 200 + terminal area +
// header/footer + padding add up to roughly this footprint. Enforced both
// at manual-resize time and in the demo layout.
const MIN_CARD_W = 580;
const MIN_CARD_H = 380;

function AgentCard({
  card,
  agentName,
  adapterBadge,
  status,
  isSelected,
  layoutMode,
  zoom,
  isFlipped = false,
  isDimmed = false,
}: AgentCardProps) {
  const updateCardPosition = useWorkspaceStore((s) => s.updateCardPosition);
  const updateCardSize = useWorkspaceStore((s) => s.updateCardSize);
  const selectCard = useWorkspaceStore((s) => s.selectCard);
  const bringToFront = useWorkspaceStore((s) => s.bringToFront);
  const removeCard = useWorkspaceStore((s) => s.removeCard);
  const setExpandedCard = useAgentStore((s) => s.setExpandedCard);
  const removeInstance = useAgentStore((s) => s.removeInstance);

  // Keep the back face mounted during flip-back so the transition animates
  // out cleanly; unmount ~660ms after isFlipped becomes false to free the
  // xterm instance.
  const [showBack, setShowBack] = useState(isFlipped);
  useEffect(() => {
    if (isFlipped) {
      setShowBack(true);
    } else if (showBack) {
      const t = setTimeout(() => setShowBack(false), 660);
      return () => clearTimeout(t);
    }
  }, [isFlipped, showBack]);

  // Track whether the overlay ExpandedAgentCard is/was open for this card.
  // When expanded closes, increment termRefreshKey so the card-preview's
  // XtermTerminal remounts — it re-fetches PTY history at the card's
  // (smaller) grid size, re-sends initial resize, and renders correctly.
  // Without this the card preview keeps showing content formatted for the
  // expanded terminal's (larger) column count → visual corruption.
  const isExpandedOverlay = useAgentStore(
    (s) => !isFlipped && s.expandedCardId === card.instance_id
  );
  const [termRefreshKey, setTermRefreshKey] = useState(0);
  const wasExpandedRef = useRef(isExpandedOverlay);
  useEffect(() => {
    if (wasExpandedRef.current && !isExpandedOverlay) {
      // Expanded just closed → force xterm remount
      setTermRefreshKey((k) => k + 1);
    }
    wasExpandedRef.current = isExpandedOverlay;
  }, [isExpandedOverlay]);

  const cardRef = useRef<HTMLDivElement>(null);

  // Live position/size refs — updated during drag/resize without triggering re-render
  const livePos = useRef<Position>({ x: card.position.x, y: card.position.y });
  const liveSize = useRef({ width: card.size.width, height: card.size.height });

  // Sync refs when store props change (e.g., from auto-pack or external update)
  useLayoutEffect(() => {
    livePos.current = { x: card.position.x, y: card.position.y };
    liveSize.current = { width: card.size.width, height: card.size.height };
  }, [card.position.x, card.position.y, card.size.width, card.size.height]);

  const vendorBadge = ADAPTER_VENDOR[adapterBadge] ?? adapterBadge;
  // Real instances subscribe to the live PTY event stream; demo instances
  // (instance_id prefixed with `demo-`) keep replaying the static ANSI reel.
  const isDemo = card.instance_id.startsWith("demo-");
  const demoContent = useMemo(
    () => (isDemo ? (DEMO_TERMINAL_ANSI[adapterBadge] ?? "") : ""),
    [adapterBadge, isDemo]
  );
  const footerInfo = DEMO_FOOTER[adapterBadge] ?? { time: "", detail: "" };

  // Content adaptation based on card size
  const h = card.size.height;
  const w = card.size.width;
  const showFooter = h >= HEADER_H + FOOTER_H + MIN_TERM_H;
  const showTerminal = h >= HEADER_H + MIN_TERM_H;
  const showBadge = w >= 240;

  // ===== Shared DOM update helper =====

  const applyTransform = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.left = `${livePos.current.x}px`;
    el.style.top = `${livePos.current.y}px`;
    el.style.width = `${liveSize.current.width}px`;
    el.style.height = `${liveSize.current.height}px`;
  }, []);

  // ===== Card click: select + bring to front =====

  const handleCardPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      selectCard(card.instance_id);
      bringToFront(card.instance_id);
    },
    [card.instance_id, selectCard, bringToFront]
  );

  // ===== Expand: button click or double-click anywhere on the card =====
  // Double-click honors the macOS convention for "open in focused view".
  // The explicit expand icon in the header is the discoverable path.

  const handleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedCard(card.instance_id);
    },
    [card.instance_id, setExpandedCard]
  );

  const handleCardDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Ignore double-clicks originating from drag/resize/button controls
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-expand]")) return;
      e.stopPropagation();
      // Toggle: if this card is already the expanded one, collapse it.
      // Read via getState to avoid re-rendering every card on expandedCardId change.
      const current = useAgentStore.getState().expandedCardId;
      setExpandedCard(current === card.instance_id ? null : card.instance_id);
    },
    [card.instance_id, setExpandedCard]
  );

  // Close a card: destroy the backend PTY process (real instances only),
  // then drop it from the frontend stores so the card disappears from the
  // canvas. Demo cards (instance_id prefixed with `demo-`) skip the backend
  // call because there's no real process behind them.
  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const instanceId = card.instance_id;
      const isDemo = instanceId.startsWith("demo-");
      const finish = () => {
        removeCard(instanceId);
        removeInstance(instanceId);
      };
      if (isDemo) {
        finish();
        return;
      }
      destroyAgentInstance(instanceId)
        .then(finish)
        .catch((err) => {
          // Backend rejected the destroy call — log and still remove the
          // card from the UI so the user isn't stuck with a dead tile.
          console.error("[AgentCard] destroyAgentInstance failed:", err);
          finish();
        });
    },
    [card.instance_id, removeCard, removeInstance]
  );

  // ===== DRAG (on grip handle) =====

  const handleGripPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (layoutMode !== "free" || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startX = livePos.current.x;
      const startY = livePos.current.y;

      selectCard(card.instance_id);
      bringToFront(card.instance_id);

      const onMove = (me: PointerEvent) => {
        const dx = (me.clientX - startMouseX) / zoom;
        const dy = (me.clientY - startMouseY) / zoom;
        livePos.current = {
          x: snapToGrid(startX + dx),
          y: snapToGrid(startY + dy),
        };
        applyTransform();
      };

      const onUp = (ue: PointerEvent) => {
        (ue.target as HTMLElement).releasePointerCapture(ue.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // Commit final position to store
        updateCardPosition(card.instance_id, livePos.current);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layoutMode, zoom, card.instance_id, selectCard, bringToFront, updateCardPosition, applyTransform]
  );

  // ===== RESIZE (on corner handle) =====

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startW = liveSize.current.width;
      const startH = liveSize.current.height;

      selectCard(card.instance_id);
      bringToFront(card.instance_id);

      const onMove = (me: PointerEvent) => {
        const dw = (me.clientX - startMouseX) / zoom;
        const dh = (me.clientY - startMouseY) / zoom;
        liveSize.current = {
          width: Math.max(MIN_CARD_W, snapToGrid(startW + dw)),
          height: Math.max(MIN_CARD_H, snapToGrid(startH + dh)),
        };
        applyTransform();
      };

      const onUp = (ue: PointerEvent) => {
        (ue.target as HTMLElement).releasePointerCapture(ue.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        updateCardSize(card.instance_id, liveSize.current);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [zoom, card.instance_id, selectCard, bringToFront, updateCardSize, applyTransform]
  );

  return (
    <div
      ref={cardRef}
      className="absolute"
      style={{
        left: card.position.x,
        top: card.position.y,
        width: card.size.width,
        height: card.size.height,
        zIndex: card.z_index,
        perspective: "1600px",
        // Focus fade: other cards dim out of the way while one card flips.
        // Transition matches the flip duration so both animations resolve together.
        opacity: isDimmed ? 0.12 : 1,
        pointerEvents: isDimmed ? "none" : undefined,
        transition: "opacity 0.62s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onPointerDown={handleCardPointerDown}
      onDoubleClick={handleCardDoubleClick}
    >
      {/* ===== 3D flip stage ===== */}
      <div
        className="absolute inset-0"
        style={{
          transformStyle: "preserve-3d",
          WebkitTransformStyle: "preserve-3d",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 0.62s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
      {/* ===== FRONT FACE ===== */}
      <div
        className="absolute inset-0 flex flex-col overflow-hidden"
        style={{
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: isSelected
            ? "1px solid rgba(184,212,227,0.4)"
            : "1px solid rgba(255,255,255,0.082)",
          borderRadius: 12,
          boxShadow: isSelected
            ? "0 8px 32px rgba(0,0,0,0.19), 0 20px 60px rgba(0,0,0,0.7)"
            : "0 8px 32px rgba(0,0,0,0.19)",
        }}
      >
      {/* ===== Header (42px) ===== */}
      <div
        className="flex items-center shrink-0"
        style={{
          height: HEADER_H,
          padding: "0 16px",
          gap: 8,
          background: "rgba(255,255,255,0.024)",
        }}
      >
        <span
          className="shrink-0 rounded-full"
          style={{ width: 8, height: 8, background: STATUS_DOT_COLORS[status] }}
        />
        <span
          className="truncate"
          style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 14, fontWeight: 600, color: "#F2F2F2" }}
        >
          {agentName}
        </span>
        {showBadge && vendorBadge && (
          <span
            className="shrink-0"
            style={{
              fontFamily: "'Geist Sans',sans-serif", fontSize: 10, fontWeight: 500,
              letterSpacing: 0.4, color: "#B8D4E3",
              background: "rgba(184,212,227,0.15)", borderRadius: 9999, padding: "2px 8px",
            }}
          >
            {vendorBadge}
          </span>
        )}
        <div className="flex-1" />
        <button
          data-no-expand
          className="shrink-0 select-none flex items-center justify-center"
          style={{
            color: "#6B7280",
            width: 18,
            height: 18,
            opacity: 0.7,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleExpand}
          title="Expand (double-click card)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
        <button
          data-no-expand
          className="shrink-0 select-none flex items-center justify-center transition-colors"
          style={{
            color: "#6B7280",
            width: 18,
            height: 18,
            opacity: 0.7,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#FF6B6B";
            (e.currentTarget as HTMLButtonElement).style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#6B7280";
            (e.currentTarget as HTMLButtonElement).style.opacity = "0.7";
          }}
          title="Close agent (destroy PTY process)"
          aria-label="Close agent"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <button
          data-no-expand
          className="shrink-0 select-none flex items-center justify-center"
          style={{
            color: "#6B7280",
            cursor: layoutMode === "free" ? "grab" : "default",
            opacity: layoutMode === "free" ? 1 : 0.3,
          }}
          onPointerDown={handleGripPointerDown}
          title={layoutMode === "free" ? "Drag to move" : "Dragging disabled"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" />
          </svg>
        </button>
      </div>

      {/* ===== Terminal area (xterm.js, read-only in card view) ===== */}
      {showTerminal && (
        <div
          className="flex-1 min-h-0 overflow-hidden"
          style={{ padding: "10px 14px 6px 14px" }}
        >
          <XtermTerminal
            key={`${card.instance_id}-${termRefreshKey}`}
            instanceId={card.instance_id}
            content={isDemo ? demoContent : undefined}
            subscribeToPty={!isDemo}
          />
        </div>
      )}

      {/* ===== Footer (32px) ===== */}
      {showFooter && (
        <div
          className="flex items-center shrink-0"
          style={{
            height: FOOTER_H, padding: "0 16px", gap: 8,
            background: "rgba(255,255,255,0.024)",
            borderTop: "1px solid rgba(255,255,255,0.082)",
          }}
        >
          {footerInfo.time && (
            <span style={{ fontFamily: "'JetBrains Mono Variable',monospace", fontSize: 10, color: "#6B7280" }}>
              {footerInfo.time}
            </span>
          )}
          <div className="flex-1" />
          {footerInfo.detail && (
            <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, color: "#6B7280" }}>
              {footerInfo.detail}
            </span>
          )}
        </div>
      )}

      {/* ===== Resize handle (bottom-right corner) ===== */}
      <div
        data-no-expand
        className="absolute"
        style={{
          right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize",
        }}
        onPointerDown={handleResizePointerDown}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10"
          style={{ position: "absolute", right: 3, bottom: 3, opacity: 0.25 }}
        >
          <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>
      </div>
      {/* ===== BACK FACE (3D flipped view) =====
          data-no-expand so clicks inside the expanded view (xterm text
          selection, buttons, etc.) do NOT trigger the card-level double-
          click toggle. Use the Close/Minimize buttons or ESC to exit. */}
      {showBack && (
        <div
          data-no-expand
          className="absolute inset-0 overflow-hidden"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            borderRadius: 12,
          }}
        >
          <ExpandedAgentCard instanceId={card.instance_id} embedded />
        </div>
      )}
      </div>
    </div>
  );
}

export { AgentCard };
export type { AgentCardProps };
