// ===== Canvas Component =====
// The main workspace canvas container.
// Performance: zoom/pan use ref + direct DOM transform; store commits only on idle.

import { useCallback, useRef, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAgentStore } from "@/stores/agentStore";
import { useWorkspaceLayout } from "@/hooks/useWorkspaceLayout";
import { AgentCard } from "./AgentCard";
import { LayoutManager } from "./LayoutManager";
import type { AgentStatus, AgentInstanceInfo } from "@/types";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_SENSITIVITY = 0.001;

interface CanvasProps {
  agents: Map<string, AgentInstanceInfo>;
  agentStatuses: Map<string, AgentStatus>;
  /** When true, the expanded card is rendered in-place via AgentCard's 3D
   *  flip rather than as an overlay. App.tsx decides based on window
   *  fullscreen state. */
  isFullscreen: boolean;
  /** Callback to open the Add Agent modal from empty-state CTA. */
  onAddAgent?: () => void;
}

function Canvas({ agents, agentStatuses, isFullscreen, onAddAgent }: CanvasProps) {
  const expandedCardId = useAgentStore((s) => s.expandedCardId);
  const cards = useWorkspaceStore((s) => s.cards);
  const layoutMode = useWorkspaceStore((s) => s.layoutMode);
  const selectedCardId = useWorkspaceStore((s) => s.selectedCardId);
  const selectCard = useWorkspaceStore((s) => s.selectCard);
  const storeZoom = useWorkspaceStore((s) => s.zoom);
  const storePan = useWorkspaceStore((s) => s.pan);
  const setZoom = useWorkspaceStore((s) => s.setZoom);
  const setPan = useWorkspaceStore((s) => s.setPan);

  const fitAll = useWorkspaceStore((s) => s.fitAll);
  const autoArrange = useWorkspaceStore((s) => s.autoArrange);
  const { triggerAutoPack } = useWorkspaceLayout();

  const containerRef = useRef<HTMLDivElement>(null);
  const transformLayerRef = useRef<HTMLDivElement>(null);
  const zoomIndicatorRef = useRef<HTMLSpanElement>(null);

  // Live zoom/pan refs — mutated during interaction, no re-render
  const liveZoom = useRef(storeZoom);
  const livePan = useRef({ x: storePan.x, y: storePan.y });
  const spaceHeldRef = useRef(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync refs from store on external changes
  useEffect(() => { liveZoom.current = storeZoom; }, [storeZoom]);
  useEffect(() => { livePan.current = { x: storePan.x, y: storePan.y }; }, [storePan.x, storePan.y]);

  // Direct DOM update for transform layer
  const applyTransform = useCallback(() => {
    const el = transformLayerRef.current;
    if (el) {
      el.style.transform = `translate(${livePan.current.x}px,${livePan.current.y}px) scale(${liveZoom.current})`;
    }
    const zi = zoomIndicatorRef.current;
    if (zi) {
      zi.textContent = `${Math.round(liveZoom.current * 100)}%`;
    }
  }, []);

  // Debounced commit to store (for selectors that depend on zoom/pan)
  const scheduleCommit = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      setZoom(liveZoom.current);
      setPan({ ...livePan.current });
    }, 100);
  }, [setZoom, setPan]);

  // ===== Space key tracking =====
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        spaceHeldRef.current = true;
        containerRef.current?.classList.add("cursor-grab");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
        containerRef.current?.classList.remove("cursor-grab", "cursor-grabbing");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ===== Wheel zoom (native event for passive:false) =====
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Zoom only when Ctrl/⌘ is held (mac touchpad pinch emits ctrlKey=true).
      // Otherwise let wheel bubble naturally so xterm / panels can scroll.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const worldX = (cursorX - livePan.current.x) / liveZoom.current;
      const worldY = (cursorY - livePan.current.y) / liveZoom.current;
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, liveZoom.current * (1 + delta)));
      liveZoom.current = newZoom;
      livePan.current = {
        x: cursorX - worldX * newZoom,
        y: cursorY - worldY * newZoom,
      };
      applyTransform();
      scheduleCommit();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyTransform, scheduleCommit]);

  // ===== Pan start =====
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const isMiddle = e.button === 1;
      const isSpaceLeft = e.button === 0 && spaceHeldRef.current;

      if (!isMiddle && !isSpaceLeft) {
        if (e.button === 0 && e.target === containerRef.current) {
          selectCard(null);
        }
        return;
      }

      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      containerRef.current?.classList.add("cursor-grabbing");

      const startMX = e.clientX;
      const startMY = e.clientY;
      const startPX = livePan.current.x;
      const startPY = livePan.current.y;

      const onMove = (me: PointerEvent) => {
        livePan.current = {
          x: startPX + (me.clientX - startMX),
          y: startPY + (me.clientY - startMY),
        };
        applyTransform();
      };

      const onUp = (ue: PointerEvent) => {
        try { (ue.target as HTMLElement).releasePointerCapture(ue.pointerId); } catch { /* ok */ }
        containerRef.current?.classList.remove("cursor-grabbing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setPan({ ...livePan.current });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [selectCard, setPan, applyTransform]
  );

  const handleFitAll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    fitAll(rect.width, rect.height);
    // Also sync live refs so subsequent scroll zoom continues from the new state
    const state = useWorkspaceStore.getState();
    liveZoom.current = state.zoom;
    livePan.current = { x: state.pan.x, y: state.pan.y };
    applyTransform();
  }, [fitAll, applyTransform]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden rounded-xl"
      style={{
        background: "#050507",
        border: "1px solid rgba(255,255,255,0.082)",
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Empty-state fallback — shown when no cards exist */}
      {cards.length === 0 ? (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 28, color: "#6B7280" }}>+</span>
          </div>
          <span
            style={{
              fontFamily: "'Fraunces Variable', Georgia, serif",
              fontSize: 24,
              fontWeight: 600,
              color: "#B8B3B0",
            }}
          >
            No agents yet
          </span>
          <span
            style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 14,
              color: "rgba(107,114,128,0.56)",
            }}
          >
            Add your first agent to get started
          </span>
          <button
            onClick={() => onAddAgent?.()}
            style={{
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: "#050507",
              background: "#B8D4E3",
              border: "none",
              borderRadius: 9999,
              padding: "10px 20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>+</span> Add Agent
          </button>
        </div>
      ) : (
        /* Transformed canvas layer */
        <div
          ref={transformLayerRef}
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate(${storePan.x}px,${storePan.y}px) scale(${storeZoom})`,
            width: 0,
            height: 0,
          }}
        >
          {cards.map((card) => {
            const agentInfo = agents.get(card.instance_id);
            const agentStatus = agentStatuses.get(card.instance_id) ?? "idle";
            const agentName = agentInfo?.adapter_name ?? "Unknown Agent";
            const adapterBadge = agentInfo?.adapter_id ?? "---";

            const isFlipped =
              isFullscreen && expandedCardId === card.instance_id;
            const isDimmed =
              isFullscreen &&
              expandedCardId !== null &&
              expandedCardId !== card.instance_id;
            return (
              <AgentCard
                key={card.instance_id}
                card={card}
                agentName={agentName}
                adapterBadge={adapterBadge}
                status={agentStatus}
                isSelected={selectedCardId === card.instance_id}
                layoutMode={layoutMode}
                zoom={liveZoom.current}
                fileCount={0}
                lastActivity={agentInfo?.created_at ?? 0}
                isFlipped={isFlipped}
                isDimmed={isDimmed}
              />
            );
          })}
        </div>
      )}

      <LayoutManager onAutoPack={triggerAutoPack} />

      {/* Zoom indicator + Fit All */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
        <span
          ref={zoomIndicatorRef}
          className="glass rounded-md px-2 py-1 text-[10px] font-mono text-white/40"
        >
          {Math.round(storeZoom * 100)}%
        </span>
        <button
          className="glass rounded-md px-2 py-1 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors"
          style={{ cursor: "pointer", border: "none" }}
          onClick={handleFitAll}
          title="Fit all cards in view"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
        <button
          className="glass rounded-md px-2 py-1 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors"
          style={{ cursor: "pointer", border: "none" }}
          onClick={autoArrange}
          title="Auto-arrange cards"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        <span className="text-[10px] font-mono text-white/25 select-none">
          Ctrl+Scroll to zoom
        </span>
      </div>
    </div>
  );
}

export { Canvas };
export type { CanvasProps };
