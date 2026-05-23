// ===== Canvas Component =====
// The main workspace canvas container.
// Performance: zoom/pan use ref + direct DOM transform; store commits only on idle.

import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useAgentStore } from "@/stores/agentStore";
import {
  shouldAutoFitOnCardsRestored,
  useWorkspaceLayout,
} from "@/hooks/useWorkspaceLayout";
import {
  fitCardsIntoViewport,
  shouldDisablePinnedFilter,
  shouldFitCardsIntoViewport,
} from "@/lib/canvas-viewport";
import { togglePinInstance } from "@/lib/tauri-bridge";
import { AgentCard } from "./AgentCard";
import { LayoutManager } from "./LayoutManager";
import type { AgentStatus, AgentInstanceInfo } from "@/types";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 7;
const ZOOM_SENSITIVITY = 0.0007;
const GRID_LEVELS = [1280, 640, 320, 160, 80, 40, 20, 10, 5, 2.5, 1.25, 0.625, 0.3125] as const;
const GRID_TARGET_MAJOR_PX = 168;
const GRID_SIGMA = 1.05;

function normalizeZoomForGrid(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function levelDistance(levelSize: number, zoom: number) {
  const pixelSize = levelSize * zoom;
  return Math.abs(Math.log2(pixelSize / GRID_TARGET_MAJOR_PX));
}

function gridWeight(distance: number) {
  return Math.exp(-(distance * distance) / (2 * GRID_SIGMA * GRID_SIGMA));
}

type GridLevelVisual = {
  size: number;
  color: string;
  lineWidth: number;
  prominence: number;
};

function resolveGridVisuals(zoom: number): GridLevelVisual[] {
  const normalizedZoom = normalizeZoomForGrid(zoom);
  const weighted = GRID_LEVELS.map((size) => {
    const distance = levelDistance(size, normalizedZoom);
    return { size, weight: gridWeight(distance) };
  }).filter((level) => level.weight > 0.01);

  const maxWeight = Math.max(...weighted.map((level) => level.weight), 1);
  const majorLevels = weighted.map((level) => {
    const prominence = level.weight / maxWeight;
    const eased = Math.pow(prominence, 0.82);
    const brightness = Math.round(176 + eased * 28);
    const alpha = 0.018 + level.weight * (0.12 + eased * 0.08);
    const lineWidth = eased > 0.94 ? 1.2 : eased > 0.62 ? 1.02 : 1;

    return {
      size: level.size,
      color: `rgba(${brightness}, ${brightness}, ${brightness}, ${Math.min(0.16, alpha)})`,
      lineWidth,
      prominence: eased,
    } satisfies GridLevelVisual;
  });

  const fineLevels = GRID_LEVELS.filter((size) => size <= 10).map((size, index, arr) => {
    const progress = 1 - index / Math.max(1, arr.length - 1);
    const alpha = 0.018 + progress * 0.026;
    const brightness = Math.round(124 + progress * 20);

    return {
      size,
      color: `rgba(${brightness}, ${brightness}, ${brightness}, ${Math.min(0.065, alpha)})`,
      lineWidth: 1,
      prominence: 0.16 + progress * 0.12,
    } satisfies GridLevelVisual;
  });

  const merged = new Map<number, GridLevelVisual>();
  for (const level of fineLevels) merged.set(level.size, level);
  for (const level of majorLevels) {
    const existing = merged.get(level.size);
    if (!existing || existing.prominence < level.prominence) {
      merged.set(level.size, level);
    }
  }

  return [...merged.values()];
}

interface CanvasProps {
  agents: Map<string, AgentInstanceInfo>;
  agentStatuses: Map<string, AgentStatus>;
  /** When true, the expanded card is rendered in-place via AgentCard's 3D
   *  flip rather than as an overlay. App.tsx decides based on window
   *  fullscreen state. */
  isFullscreen: boolean;
}

function Canvas({ agents, agentStatuses, isFullscreen }: CanvasProps) {
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
  const [pinnedFilter, setPinnedFilter] = useState(false);
  const knownCardCount = useMemo(
    () => cards.filter((card) => agents.has(card.instance_id)).length,
    [agents, cards]
  );
  const pinnedCards = useMemo(
    () =>
      cards.filter((card) => {
        const agentInfo = agents.get(card.instance_id);
        return agentInfo?.is_pinned === true;
      }),
    [agents, cards]
  );
  const shouldFailOpenPinnedFilter = shouldDisablePinnedFilter({
    pinnedFilter,
    totalCardCount: cards.length,
    knownCardCount,
    visiblePinnedCardCount: pinnedCards.length,
  });
  const shouldRenderAllForPinnedFilter =
    pinnedFilter && cards.length > 0 && pinnedCards.length === 0;
  const visibleCards =
    pinnedFilter && !shouldRenderAllForPinnedFilter ? pinnedCards : cards;

  const containerRef = useRef<HTMLDivElement>(null);
  const transformLayerRef = useRef<HTMLDivElement>(null);
  const worldGridRef = useRef<HTMLCanvasElement>(null);
  const zoomIndicatorRef = useRef<HTMLSpanElement>(null);

  // Live zoom/pan refs - mutated during interaction, no re-render
  const liveZoom = useRef(storeZoom);
  const livePan = useRef({ x: storePan.x, y: storePan.y });
  const spaceHeldRef = useRef(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRafRef = useRef<number | null>(null);
  const previousCardCountRef = useRef(visibleCards.length);

  useEffect(() => {
    liveZoom.current = storeZoom;
  }, [storeZoom]);

  useEffect(() => {
    livePan.current = { x: storePan.x, y: storePan.y };
  }, [storePan.x, storePan.y]);

  const drawGrid = useCallback(() => {
    const canvas = worldGridRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    const levels = resolveGridVisuals(liveZoom.current)
      .sort((a, b) => a.size - b.size)
      .map((level) => ({
        ...level,
        pixelSize: level.size * liveZoom.current,
      }))
      .filter((level) => level.pixelSize >= 2.5);

    for (const level of levels) {
      const worldSpacing = level.size;
      const worldLeft = -livePan.current.x / liveZoom.current;
      const worldTop = -livePan.current.y / liveZoom.current;
      const worldRight = (width - livePan.current.x) / liveZoom.current;
      const worldBottom = (height - livePan.current.y) / liveZoom.current;

      const startWorldX = Math.floor(worldLeft / worldSpacing) * worldSpacing;
      const startWorldY = Math.floor(worldTop / worldSpacing) * worldSpacing;

      ctx.beginPath();
      ctx.strokeStyle = level.color;
      ctx.lineWidth = level.lineWidth;
      ctx.shadowBlur = level.prominence > 0.95 ? 0.55 : 0;
      ctx.shadowColor = level.prominence > 0.95 ? "rgba(255,255,255,0.035)" : "transparent";

      for (let worldX = startWorldX; worldX <= worldRight + worldSpacing; worldX += worldSpacing) {
        const screenX = livePan.current.x + worldX * liveZoom.current;
        const alignedX = Math.round(screenX) + 0.5;
        ctx.moveTo(alignedX, 0);
        ctx.lineTo(alignedX, height);
      }

      for (let worldY = startWorldY; worldY <= worldBottom + worldSpacing; worldY += worldSpacing) {
        const screenY = livePan.current.y + worldY * liveZoom.current;
        const alignedY = Math.round(screenY) + 0.5;
        ctx.moveTo(0, alignedY);
        ctx.lineTo(width, alignedY);
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.stroke();
    }
  }, []);

  const enableZoomTransition = useCallback(() => {
    const el = transformLayerRef.current;
    if (!el) return;
    el.dataset.zooming = "true";
    if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
    zoomRafRef.current = requestAnimationFrame(() => {
      zoomRafRef.current = requestAnimationFrame(() => {
        el.dataset.zooming = "false";
      });
    });
  }, []);

  const applyTransform = useCallback(() => {
    const el = transformLayerRef.current;
    if (el) {
      el.style.transform = `translate(${livePan.current.x}px,${livePan.current.y}px) scale(${liveZoom.current})`;
    }
    const gridEl = worldGridRef.current;
    if (gridEl) {
      drawGrid();
    }
    const zi = zoomIndicatorRef.current;
    if (zi) {
      zi.textContent = `${Math.round(liveZoom.current * 100)}%`;
    }
  }, []);

  const scheduleCommit = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      setZoom(liveZoom.current);
      setPan({ ...livePan.current });
    }, 100);
  }, [setZoom, setPan]);

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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const worldX = (cursorX - livePan.current.x) / liveZoom.current;
      const worldY = (cursorY - livePan.current.y) / liveZoom.current;
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, liveZoom.current * (1 + delta))
      );
      liveZoom.current = newZoom;
      livePan.current = {
        x: cursorX - worldX * newZoom,
        y: cursorY - worldY * newZoom,
      };
      enableZoomTransition();
      applyTransform();
      scheduleCommit();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyTransform, scheduleCommit, enableZoomTransition]);

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
        try {
          (ue.target as HTMLElement).releasePointerCapture(ue.pointerId);
        } catch {
          // ignore
        }
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
    const state = useWorkspaceStore.getState();
    liveZoom.current = state.zoom;
    livePan.current = { x: state.pan.x, y: state.pan.y };
    enableZoomTransition();
    applyTransform();
  }, [fitAll, applyTransform, enableZoomTransition]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      drawGrid();
      return;
    }

    const observer = new ResizeObserver(() => {
      drawGrid();
    });
    observer.observe(container);
    drawGrid();

    return () => observer.disconnect();
  }, [drawGrid]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      drawGrid();
      return;
    }

    const observer = new ResizeObserver(() => {
      drawGrid();
    });
    observer.observe(container);
    drawGrid();

    return () => observer.disconnect();
  }, [drawGrid]);

  useEffect(() => {
    if (shouldFailOpenPinnedFilter) {
      setPinnedFilter(false);
    }
  }, [shouldFailOpenPinnedFilter]);

  useEffect(() => {
    const previousCardCount = previousCardCountRef.current;
    previousCardCountRef.current = visibleCards.length;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const shouldFit =
      shouldAutoFitOnCardsRestored(previousCardCount, visibleCards.length) ||
      shouldFitCardsIntoViewport({
        previousCardCount,
        cards: visibleCards,
        pan: livePan.current,
        zoom: liveZoom.current,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
      });

    if (!shouldFit) {
      return;
    }

    const nextViewport = fitCardsIntoViewport({
      cards: visibleCards,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    });
    if (!nextViewport) {
      return;
    }

    liveZoom.current = nextViewport.zoom;
    livePan.current = nextViewport.pan;
    setZoom(nextViewport.zoom);
    setPan(nextViewport.pan);
    enableZoomTransition();
    applyTransform();
  }, [applyTransform, enableZoomTransition, setPan, setZoom, visibleCards]);

  return (
    <div
      ref={containerRef}
      className="canvas-shell relative w-full h-full overflow-hidden rounded-xl"
      style={{
        background: "#050507",
        border: "1px solid rgba(255,255,255,0.082)",
      }}
      onPointerDown={handlePointerDown}
    >
      <canvas
        aria-hidden="true"
        ref={worldGridRef}
        className="canvas-grid-layer"
        data-layout-mode={layoutMode}
        style={{
          width: "100%",
          height: "100%",
        } as CSSProperties}
      />
      <div aria-hidden="true" className="canvas-vignette-layer" />

      <div
        ref={transformLayerRef}
        className="absolute top-0 left-0 origin-top-left canvas-transform-layer"
        style={{
          transform: `translate(${storePan.x}px,${storePan.y}px) scale(${storeZoom})`,
          width: 0,
          height: 0,
          ["--world-grid-scale" as const]: String(storeZoom),
        } as CSSProperties}
      >
        {visibleCards.map((card) => {
          const agentInfo = agents.get(card.instance_id);
          const agentStatus = agentStatuses.get(card.instance_id) ?? "idle";
          const agentName = agentInfo
            ? agentInfo.display_name
              ? `${agentInfo.adapter_name} - ${agentInfo.display_name}`
              : agentInfo.adapter_name
            : "Unknown Agent";
          const adapterBadge = agentInfo?.adapter_id ?? "---";

          const isFlipped = isFullscreen && expandedCardId === card.instance_id;
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
              isPinned={agentInfo?.is_pinned ?? false}
              layoutMode={layoutMode}
              zoom={liveZoom.current}
              fileCount={null}
              lastActivity={agentInfo?.last_activity_at ?? 0}
              isFlipped={isFlipped}
              isDimmed={isDimmed}
              onTogglePin={() => {
                useAgentStore.getState().togglePin(card.instance_id);
                togglePinInstance(card.instance_id).catch(() => {});
              }}
            />
          );
        })}
      </div>

      <LayoutManager onAutoPack={triggerAutoPack} />

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
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
        <button
          className="glass rounded-md px-2 py-1 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors"
          style={{ cursor: "pointer", border: "none" }}
          onClick={autoArrange}
          title="Auto-arrange cards"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        <button
          className={`glass rounded-md px-2 py-1 text-[10px] font-mono transition-colors flex items-center gap-1 ${
            pinnedFilter
              ? "text-accent bg-accent/15"
              : "text-white/40 hover:text-white/70"
          }`}
          style={{ cursor: "pointer", border: "none" }}
          onClick={() => setPinnedFilter((value) => !value)}
          title={
            pinnedFilter
              ? "Show all cards (currently filtering pinned only)"
              : "Filter: show only pinned cards"
          }
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill={pinnedFilter ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
          {pinnedFilter && <span>Pinned</span>}
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
