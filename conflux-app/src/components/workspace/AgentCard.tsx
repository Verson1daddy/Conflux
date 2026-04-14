// ===== AgentCard Component =====
// Glass-morphism card for a single Agent instance on the workspace canvas.
// Performance: drag/resize use DOM manipulation via refs; store commits only on pointerup.
// Free resize via corner handle, no min size constraint for manual operations.
// Content adapts to card dimensions.

import { useCallback, useRef, useLayoutEffect, useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAgentStore } from "@/stores/agentStore";
import { destroyAgentInstance, renameAgentInstance } from "@/lib/tauri-bridge";
import { SNAP_GRID_PX } from "@/types/layout";
import type { CardLayout, AgentStatus, Position, LayoutMode } from "@/types";
import { XtermTerminal } from "./XtermTerminal";
import { ExpandedAgentCard } from "./ExpandedAgentCard";

// ===== C2-A4 Shield permission tier =====

type ShieldTier = "autonomous" | "smart" | "manual";

const SHIELD_META: Record<ShieldTier, { icon: string; color: string; label: string; desc: string }> = {
  autonomous: { icon: "shield-check", color: "#34C759", label: "Autonomous", desc: "All commands auto-approved" },
  smart:      { icon: "shield-alert", color: "#FFD60A", label: "Smart",      desc: "Only destructive actions need confirm" },
  manual:     { icon: "shield-off",   color: "#FF6B6B", label: "Manual",     desc: "Every tool call requires approval" },
};

const SHIELD_ORDER: ShieldTier[] = ["autonomous", "smart", "manual"];

// Shield SVG paths (lucide subset)
const SHIELD_PATHS: Record<string, string> = {
  "shield-check": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4",
  "shield-alert": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM12 8v4M12 16h.01",
  "shield-off":   "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
};

// ===== Vendor badge mapping =====

const ADAPTER_VENDOR: Record<string, string> = {
  "claude-code": "anthropic",
  codex: "openai",
  aider: "paul-gauthier",
  opencode: "opencode",
};

// Default card accent colors per adapter, used when user hasn't picked a custom color.
const ADAPTER_DEFAULT_COLORS: Record<string, string> = {
  "claude-code": "#B8D4E3",
  "codex": "#FFB800",
  "aider": "#8EA4B8",
  "opencode": "#C9B894",
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
  isPinned: boolean;
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
  onTogglePin?: () => void;
}

// ===== Layout breakpoints =====

const HEADER_H = 42;
const FOOTER_H = 32;
const MIN_TERM_H = 40;

// Minimum card dimensions. Lowered from 580x380 so cards can be made compact
// on the canvas. Font scaling in XtermTerminal adapts to the narrower width.
const MIN_CARD_W = 320;
const MIN_CARD_H = 220;

// ===== Apple-style magnetic snap with hysteresis =====
//
// Two snap categories per axis:
//   ALIGNMENT — edges/centers line up (left↔left, right↔right, center↔center).
//              Works at any canvas distance for visual consistency.
//   ADJACENCY — place card next to another with consistent 16px gap.
//              Only when cards are nearby on the perpendicular axis.
//
// Hysteresis: snap-on 6px, snap-off 12px — eliminates edge jitter.

const SNAP_ON = 6;
const SNAP_OFF = 12;
const SNAP_GAP = 16;

let _wasSnappedX = false;
let _wasSnappedY = false;

function magnetSnap(
  rawX: number, rawY: number, w: number, h: number,
  cards: CardLayout[], selfId: string,
): { x: number; y: number; snappedX: boolean; snappedY: boolean } {
  let bestDX = Infinity, bestDY = Infinity;
  let snapX = rawX, snapY = rawY;

  for (const c of cards) {
    if (c.instance_id === selfId) continue;
    const ol = c.position.x, ow = c.size.width, or_ = ol + ow;
    const ot = c.position.y, oh = c.size.height, ob = ot + oh;

    // Proximity on perpendicular axis — for adjacency snaps
    const yNear = Math.min(rawY + h, ob) - Math.max(rawY, ot) > -SNAP_GAP;
    const xNear = Math.min(rawX + w, or_) - Math.max(rawX, ol) > -SNAP_GAP;

    // ---- X-axis ----
    // Alignment: edges/centers match
    const xA: [number, number][] = [
      [Math.abs(rawX - ol), ol],                                    // left ↔ left
      [Math.abs(rawX + w - or_), or_ - w],                         // right ↔ right
      [Math.abs(rawX + w / 2 - (ol + ow / 2)), ol + ow / 2 - w / 2], // center ↔ center
    ];
    // Adjacency: consistent gap (only if vertically nearby)
    if (yNear) {
      xA.push(
        [Math.abs(rawX - (or_ + SNAP_GAP)), or_ + SNAP_GAP],      // place right of other
        [Math.abs(rawX + w - (ol - SNAP_GAP)), ol - SNAP_GAP - w], // place left of other
      );
    }
    for (const [d, s] of xA) {
      if (d < bestDX) { bestDX = d; snapX = s; }
    }

    // ---- Y-axis ----
    const yA: [number, number][] = [
      [Math.abs(rawY - ot), ot],
      [Math.abs(rawY + h - ob), ob - h],
      [Math.abs(rawY + h / 2 - (ot + oh / 2)), ot + oh / 2 - h / 2],
    ];
    if (xNear) {
      yA.push(
        [Math.abs(rawY - (ob + SNAP_GAP)), ob + SNAP_GAP],
        [Math.abs(rawY + h - (ot - SNAP_GAP)), ot - SNAP_GAP - h],
      );
    }
    for (const [d, s] of yA) {
      if (d < bestDY) { bestDY = d; snapY = s; }
    }
  }

  const threshX = _wasSnappedX ? SNAP_OFF : SNAP_ON;
  const threshY = _wasSnappedY ? SNAP_OFF : SNAP_ON;
  const doSnapX = bestDX <= threshX;
  const doSnapY = bestDY <= threshY;
  _wasSnappedX = doSnapX;
  _wasSnappedY = doSnapY;

  return {
    x: doSnapX ? snapX : rawX,
    y: doSnapY ? snapY : rawY,
    snappedX: doSnapX,
    snappedY: doSnapY,
  };
}

function resetSnapState() {
  _wasSnappedX = false;
  _wasSnappedY = false;
}


function AgentCard({
  card,
  agentName,
  adapterBadge,
  status: _status,
  isSelected,
  isPinned,
  layoutMode,
  zoom,
  isFlipped = false,
  isDimmed = false,
  onTogglePin,
}: AgentCardProps) {
  const updateCardPosition = useWorkspaceStore((s) => s.updateCardPosition);
  const updateCardSize = useWorkspaceStore((s) => s.updateCardSize);
  const resolveOverlaps = useWorkspaceStore((s) => s.resolveOverlaps);
  const selectCard = useWorkspaceStore((s) => s.selectCard);
  const bringToFront = useWorkspaceStore((s) => s.bringToFront);
  const removeCard = useWorkspaceStore((s) => s.removeCard);
  const setExpandedCard = useAgentStore((s) => s.setExpandedCard);
  const removeInstance = useAgentStore((s) => s.removeInstance);

  // C2-A4 Shield permission tier — read from store so card + expanded stay in sync
  const shieldTier = (useAgentStore(
    (s) => s.permissionTiers.get(card.instance_id)
  ) ?? "smart") as ShieldTier;
  const setShieldTierStore = useAgentStore((s) => s.setPermissionTier);
  const [shieldOpen, setShieldOpen] = useState(false);
  const shieldRef = useRef<HTMLDivElement>(null);
  const shieldPopoverRef = useRef<HTMLDivElement>(null);

  // C2-A4b Card color — read from store, fallback to adapter default color
  const cardColors = useAgentStore((s) => s.cardColors);
  const agentInfo = useAgentStore((s) => s.instances.get(card.instance_id));
  const cardColor = cardColors.get(card.instance_id)
    ?? ADAPTER_DEFAULT_COLORS[agentInfo?.adapter_id ?? ""]
    ?? "#6B7280";
  const setCardColorStore = useAgentStore((s) => s.setCardColor);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Inline rename state
  const setDisplayName = useAgentStore((s) => s.setDisplayName);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleStartRename = useCallback(() => {
    setRenameValue(agentInfo?.display_name ?? "");
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [agentInfo?.display_name]);

  const handleCommitRename = useCallback(async () => {
    setRenaming(false);
    const trimmed = renameValue.trim();
    const newName = trimmed.length > 0 ? trimmed : null;
    // Skip if unchanged
    if (newName === (agentInfo?.display_name ?? null)) return;
    setDisplayName(card.instance_id, newName);
    try {
      await renameAgentInstance(card.instance_id, newName);
    } catch {
      // Revert on failure
      setDisplayName(card.instance_id, agentInfo?.display_name ?? null);
    }
  }, [renameValue, agentInfo?.display_name, card.instance_id, setDisplayName]);

  useEffect(() => {
    if (!colorPickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [colorPickerOpen]);

  // Close popover on outside click
  useEffect(() => {
    if (!shieldOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check both the trigger button area AND the portal popover
      if (
        shieldRef.current && !shieldRef.current.contains(target) &&
        shieldPopoverRef.current && !shieldPopoverRef.current.contains(target)
      ) {
        setShieldOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [shieldOpen]);

  // Close all popovers when expanded view opens/closes or when flipping.
  // Prevents portaled menus from lingering on top of the header.
  const expandedCardId = useAgentStore((s) => s.expandedCardId);
  useEffect(() => {
    setShieldOpen(false);
    setColorPickerOpen(false);
    setRenaming(false);
  }, [expandedCardId, isFlipped]);

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

  // Sync refs when store props change (e.g., from overlap push or auto-pack).
  // applyTransform writes to DOM; CSS transition on .card-appear handles smooth animation.
  useLayoutEffect(() => {
    livePos.current = { x: card.position.x, y: card.position.y };
    liveSize.current = { width: card.size.width, height: card.size.height };
    applyTransform();
  }, [card.position.x, card.position.y, card.size.width, card.size.height, applyTransform]);

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

      // Mark as dragging — disables CSS position transition
      if (cardRef.current) cardRef.current.setAttribute("data-dragging", "true");
      resetSnapState();

      const onMove = (me: PointerEvent) => {
        const dx = (me.clientX - startMouseX) / zoom;
        const dy = (me.clientY - startMouseY) / zoom;
        const rawX = startX + dx;
        const rawY = startY + dy;

        // Magnetic snap to nearby card edges/centers (priority over grid)
        const allCards = useWorkspaceStore.getState().cards;
        const mag = magnetSnap(rawX, rawY, liveSize.current.width, liveSize.current.height, allCards, card.instance_id);
        livePos.current = {
          x: mag.snappedX ? mag.x : snapToGrid(rawX),
          y: mag.snappedY ? mag.y : snapToGrid(rawY),
        };
        applyTransform();
      };

      const onUp = (ue: PointerEvent) => {
        (ue.target as HTMLElement).releasePointerCapture(ue.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (cardRef.current) cardRef.current.removeAttribute("data-dragging");
        // Commit final position to store + resolve any overlaps
        updateCardPosition(card.instance_id, livePos.current);
        resolveOverlaps(card.instance_id);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layoutMode, zoom, card.instance_id, selectCard, bringToFront, updateCardPosition, resolveOverlaps, applyTransform]
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
      className="absolute card-appear agent-card-container"
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
            ? `1.5px solid ${cardColor}88`
            : `1px solid ${cardColor}30`,
          borderRadius: 12,
          boxShadow: isSelected
            ? `0 8px 32px rgba(0,0,0,0.19), 0 0 24px ${cardColor}20`
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
          borderBottom: `1px solid ${cardColor}18`,
        }}
      >
        {/* C2-A4b Clickable color dot — shows custom card color, click to change */}
        <div ref={colorPickerRef} className="relative shrink-0" data-no-expand>
          <button
            className="rounded-full"
            style={{
              width: 10, height: 10,
              background: cardColor,
              border: "1px solid rgba(255,255,255,0.2)",
              cursor: "pointer", padding: 0,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setColorPickerOpen((v) => !v); }}
            title="Change card color"
          />
          {colorPickerOpen && (
            <div
              style={{
                position: "absolute", top: 18, left: -4, zIndex: 100,
                padding: 8, borderRadius: 10,
                background: "#1C1E22",
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
                display: "flex", flexWrap: "wrap", gap: 6, width: 130,
              }}
            >
              {[
                "#B8D4E3", "#FFB800", "#5FD47F", "#FF6B6B",
                "#C8B5E3", "#E3C0A8", "#D4C88A", "#7FC8FF",
              ].map((c) => (
                <button
                  key={c}
                  onClick={(e) => { e.stopPropagation(); setCardColorStore(card.instance_id, c); setColorPickerOpen(false); }}
                  style={{
                    width: 22, height: 22, borderRadius: 9999,
                    background: c, padding: 0, cursor: "pointer",
                    border: cardColor === c ? "2px solid #F2F2F2" : "2px solid transparent",
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {renaming ? (
          <input
            ref={renameInputRef}
            data-no-expand
            className="truncate outline-none"
            style={{
              fontFamily: "'Geist Sans',sans-serif", fontSize: 14, fontWeight: 600, color: "#F2F2F2",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4, padding: "1px 6px", minWidth: 60, maxWidth: 180,
            }}
            value={renameValue}
            maxLength={32}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") handleCommitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={handleCommitRename}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="Nickname..."
          />
        ) : (
          <span
            className="truncate"
            style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 14, fontWeight: 600, color: "#F2F2F2", cursor: "default" }}
            data-no-expand
            onDoubleClick={(e) => { e.stopPropagation(); handleStartRename(); }}
            title="Double-click to rename"
          >
            {agentName}
          </span>
        )}
        {/* Pin indicator/button */}
        <button
          className="shrink-0 flex items-center justify-center agent-card-pin"
          data-no-expand
          style={{
            width: 16, height: 16, padding: 0, cursor: "pointer",
            color: isPinned ? "#B8D4E3" : "#6B7280",
            opacity: isPinned ? 1 : 0,
            transition: "opacity 0.15s",
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onTogglePin?.(); }}
          title={isPinned ? "Pinned (click to unpin)" : "Pin"}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        </button>
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
        {/* C2-A4 Shield permission tier button + popover */}
        <div ref={shieldRef} className="relative shrink-0" data-no-expand>
          <button
            className="flex items-center justify-center"
            style={{
              width: 18, height: 18,
              color: SHIELD_META[shieldTier].color,
              opacity: 0.8,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setShieldOpen((v) => !v); }}
            title={`Permissions: ${SHIELD_META[shieldTier].label}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={SHIELD_PATHS[SHIELD_META[shieldTier].icon]} />
            </svg>
          </button>
          {shieldOpen && (() => {
            // Portal to document.body — bypasses overflow:hidden on the
            // card container and the 3D flip transform containing block.
            const rect = shieldRef.current?.getBoundingClientRect();
            const top = (rect?.bottom ?? 0) + 6;
            const right = window.innerWidth - (rect?.right ?? 0);
            return createPortal(
            <div
              ref={shieldPopoverRef}
              className="popover-enter"
              style={{
                position: "fixed", top, right, zIndex: 99999,
                width: 250, padding: 5, borderRadius: 12,
                background: "#1C1E22",
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
                display: "flex", flexDirection: "column", gap: 2,
                transformOrigin: "top right",
              }}
            >
              {SHIELD_ORDER.map((tier) => {
                const meta = SHIELD_META[tier];
                const isSel = shieldTier === tier;
                return (
                  <button
                    key={tier}
                    onClick={(e) => { e.stopPropagation(); setShieldTierStore(card.instance_id, tier); setShieldOpen(false); }}
                    className="flex items-center w-full text-left"
                    style={{
                      padding: "9px 10px", gap: 10, borderRadius: 8,
                      background: isSel ? `${meta.color}12` : "transparent",
                      border: "none", cursor: "pointer",
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={SHIELD_PATHS[meta.icon]} />
                    </svg>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 12, fontWeight: 600, color: "#F2F2F2" }}>
                        {meta.label}
                      </span>
                      <span style={{ fontFamily: "'Geist Sans',sans-serif", fontSize: 10, color: "#6B7280" }}>
                        {meta.desc}
                      </span>
                    </div>
                    {isSel && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>,
            document.body,
            );
          })()}
        </div>
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
            cardWidth={card.size.width}
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
