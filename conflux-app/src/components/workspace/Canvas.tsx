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

const GRID_BASE_SPACING = 5;
const GRID_FREQUENCY_MIN_EXP = -3;
const GRID_FREQUENCY_MAX_EXP = 9;
const GRID_CROSSFADE_DISTANCE_THRESHOLD = 0.015;

const GRID_VISUAL_CONFIG = {
  majorTargetPx: 148,
  majorBlendBandPx: [120, 196] as const,
  blackClampPx: 5,
  hideBelowPx: 1.5,
  majorRampStartPx: 112,
  majorRampEndPx: 184,
  lineBudget: 1200,
};

const GRID_VISUAL_PRESET = {
  major: { gray: 214, baseAlpha: 0.22, lineWidth: 1.15 },
  subMajor: { gray: 156, baseAlpha: 0.12, lineWidth: 1 },
  minor: { gray: 118, baseAlpha: 0.08, lineWidth: 1 },
  micro: { gray: 88, baseAlpha: 0.04, lineWidth: 1 },
  blackClamped: { gray: 24, baseAlpha: 0.9, lineWidth: 1 },
} as const;

type GridVisibleKind = "major" | "subMajor" | "minor" | "micro" | "majorCandidate";
type GridVisualState = "weighted" | "blackClamped" | "hidden";

type ResolvedGridLevelVisual = {
  kind: GridVisibleKind;
  worldSpacing: number;
  pixelSize: number;
  distanceToTarget: number;
  alpha: number;
  gray: number;
  lineWidth: number;
  state: GridVisualState;
  visible: boolean;
};

function clampZoom(zoom: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function getGridPixelSize(spacing: number, zoom: number) {
  return spacing * zoom;
}

function getDistanceToTarget(pixelSize: number, targetPx: number) {
  return Math.abs(Math.log2(pixelSize / targetPx));
}

function buildCandidateSpacings() {
  return Array.from(
    { length: GRID_FREQUENCY_MAX_EXP - GRID_FREQUENCY_MIN_EXP + 1 },
    (_, index) => GRID_BASE_SPACING * 2 ** (GRID_FREQUENCY_MIN_EXP + index),
  );
}

function weightForDistance(distanceToTarget: number) {
  return Math.max(0, 1 - distanceToTarget / 1.6);
}

function getMajorRampWeight(pixelSize: number) {
  const { majorRampStartPx, majorRampEndPx } = GRID_VISUAL_CONFIG;
  const progress = (pixelSize - majorRampStartPx) / (majorRampEndPx - majorRampStartPx);
  return Math.max(0, Math.min(1, progress));
}

function resolveRetirementState(pixelSize: number): GridVisualState {
  if (pixelSize <= GRID_VISUAL_CONFIG.hideBelowPx) {
    return "hidden";
  }
  if (pixelSize <= GRID_VISUAL_CONFIG.blackClampPx) {
    return "blackClamped";
  }
  return "weighted";
}

function resolveWeightedStyle(
  kind: "major" | "subMajor" | "minor" | "micro",
  weight: number,
  pixelSize?: number,
) {
  const preset = GRID_VISUAL_PRESET[kind];
  const alpha = preset.baseAlpha * weight;

  if (kind === "major") {
    const rampWeight = pixelSize ? getMajorRampWeight(pixelSize) : 1;
    return {
      gray: preset.gray,
      alpha: 0.08 + alpha * (0.35 + rampWeight * 0.55),
      lineWidth: preset.lineWidth,
    };
  }

  return {
    gray: preset.gray,
    alpha,
    lineWidth: preset.lineWidth,
  };
}

function getAlignedGridStart(screenStart: number) {
  return Math.round(screenStart) + 0.5;
}

export function resolveGridVisuals(zoom: number): ResolvedGridLevelVisual[] {
  const normalizedZoom = clampZoom(zoom);
  const candidates = buildCandidateSpacings()
    .map((worldSpacing) => {
      const pixelSize = getGridPixelSize(worldSpacing, normalizedZoom);
      return {
        worldSpacing,
        pixelSize,
        distanceToTarget: getDistanceToTarget(pixelSize, GRID_VISUAL_CONFIG.majorTargetPx),
        state: resolveRetirementState(pixelSize),
      };
    })
    .sort((a, b) => a.distanceToTarget - b.distanceToTarget);

  const primary = candidates[0];
  const secondary = candidates.find(
    (candidate) =>
      candidate !== primary &&
      candidate.state === "weighted" &&
      candidate.distanceToTarget - primary.distanceToTarget <= GRID_CROSSFADE_DISTANCE_THRESHOLD,
  );

  const majorCandidates = [primary, secondary].filter(
    (candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate),
  );

  const majorLevels = majorCandidates.map((candidate, _index, all) => {
    const style = resolveWeightedStyle(
      all.length === 1 ? "major" : "major",
      all.length === 1 ? 1 : weightForDistance(candidate.distanceToTarget),
      candidate.pixelSize,
    );

    return {
      kind: all.length === 1 ? "major" : "majorCandidate",
      worldSpacing: candidate.worldSpacing,
      pixelSize: candidate.pixelSize,
      distanceToTarget: candidate.distanceToTarget,
      alpha: style.alpha,
      gray: style.gray,
      lineWidth: style.lineWidth,
      state: candidate.state,
      visible: candidate.state !== "hidden" && style.alpha > 0,
    } satisfies ResolvedGridLevelVisual;
  });

  const anchorSpacing = primary.worldSpacing;
  const subMajorSpacing = anchorSpacing / 2;
  const minorSpacing = anchorSpacing / 4;
  const microSpacing = anchorSpacing / 8;

  const resolveDetailLevel = (
    worldSpacing: number,
    kind: "subMajor" | "minor" | "micro",
    weight: number,
    forceHidden = false,
  ): ResolvedGridLevelVisual => {
    const pixelSize = getGridPixelSize(worldSpacing, normalizedZoom);
    const distanceToTarget = getDistanceToTarget(pixelSize, GRID_VISUAL_CONFIG.majorTargetPx);
    const state = forceHidden ? "hidden" : resolveRetirementState(pixelSize);

    if (state === "hidden") {
      return {
        kind,
        worldSpacing,
        pixelSize,
        distanceToTarget,
        alpha: 0,
        gray: 0,
        lineWidth: 0,
        state: "hidden",
        visible: false,
      };
    }

    if (state === "blackClamped") {
      return {
        kind,
        worldSpacing,
        pixelSize,
        distanceToTarget,
        alpha: GRID_VISUAL_PRESET.blackClamped.baseAlpha,
        gray: GRID_VISUAL_PRESET.blackClamped.gray,
        lineWidth: GRID_VISUAL_PRESET.blackClamped.lineWidth,
        state: "blackClamped",
        visible: true,
      };
    }

    const style = resolveWeightedStyle(kind, weight);
    return {
      kind,
      worldSpacing,
      pixelSize,
      distanceToTarget,
      alpha: style.alpha,
      gray: style.gray,
      lineWidth: style.lineWidth,
      state: "weighted",
      visible: true,
    };
  };

  const detailLevels: ResolvedGridLevelVisual[] = [
    resolveDetailLevel(subMajorSpacing, "subMajor", 0.78),
    resolveDetailLevel(minorSpacing, "minor", 0.56),
    resolveDetailLevel(microSpacing, "micro", 0.32),
  ];

  const clampedRetirementSpacing = anchorSpacing / 32;
  const clampedRetirement = {
    ...resolveDetailLevel(clampedRetirementSpacing, "micro", 0.18),
    visible: false,
  } satisfies ResolvedGridLevelVisual;
  const hiddenRetirementSpacing = anchorSpacing / 64;
  const hiddenRetirement = resolveDetailLevel(hiddenRetirementSpacing, "micro", 0, true);

  const visibleRuntimeLevels = [...majorLevels, ...detailLevels]
    .filter((level) => level.visible)
    .slice(0, 4);

  const retirementLevels: ResolvedGridLevelVisual[] = [];
  retirementLevels.push(clampedRetirement);
  if (hiddenRetirement.state === "hidden") {
    retirementLevels.push(hiddenRetirement);
  }

  return [...visibleRuntimeLevels, ...retirementLevels];
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
  const isInteractingRef = useRef(false);
  const interactionSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRafRef = useRef<number | null>(null);
  const gridDrawRafRef = useRef<number | null>(null);
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
      .filter((level) => level.visible)
      .filter(
        (level) =>
          (width / level.pixelSize) + (height / level.pixelSize) <= GRID_VISUAL_CONFIG.lineBudget,
      )
      .sort((a, b) => a.worldSpacing - b.worldSpacing);

    for (const level of levels) {
      const worldSpacing = level.worldSpacing;
      const worldLeft = -livePan.current.x / liveZoom.current;
      const worldTop = -livePan.current.y / liveZoom.current;
      const worldRight = (width - livePan.current.x) / liveZoom.current;
      const worldBottom = (height - livePan.current.y) / liveZoom.current;
      const startWorldX = Math.floor(worldLeft / worldSpacing) * worldSpacing;
      const startWorldY = Math.floor(worldTop / worldSpacing) * worldSpacing;

      const startScreenX = livePan.current.x + startWorldX * liveZoom.current;
      const alignedStartX = getAlignedGridStart(startScreenX);
      const xPhaseOffset = alignedStartX - startScreenX;
      const startScreenY = livePan.current.y + startWorldY * liveZoom.current;
      const alignedStartY = getAlignedGridStart(startScreenY);
      const yPhaseOffset = alignedStartY - startScreenY;

      ctx.beginPath();
      ctx.strokeStyle = `rgba(${level.gray}, ${level.gray}, ${level.gray}, ${level.alpha})`;
      ctx.lineWidth = level.lineWidth;
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      for (let worldX = startWorldX; worldX <= worldRight + worldSpacing; worldX += worldSpacing) {
        const screenX = livePan.current.x + worldX * liveZoom.current;
        const alignedX = screenX + xPhaseOffset;
        ctx.moveTo(alignedX, 0);
        ctx.lineTo(alignedX, height);
      }

      for (let worldY = startWorldY; worldY <= worldBottom + worldSpacing; worldY += worldSpacing) {
        const screenY = livePan.current.y + worldY * liveZoom.current;
        const alignedY = screenY + yPhaseOffset;
        ctx.moveTo(0, alignedY);
        ctx.lineTo(width, alignedY);
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.stroke();
    }
  }, []);

  const scheduleGridDraw = useCallback(() => {
    if (gridDrawRafRef.current !== null) {
      cancelAnimationFrame(gridDrawRafRef.current);
    }
    gridDrawRafRef.current = requestAnimationFrame(() => {
      gridDrawRafRef.current = null;
      drawGrid();
    });
  }, [drawGrid]);

  const markInteraction = useCallback(() => {
    isInteractingRef.current = true;
    if (interactionSettleTimerRef.current) {
      clearTimeout(interactionSettleTimerRef.current);
    }
    interactionSettleTimerRef.current = setTimeout(() => {
      isInteractingRef.current = false;
      if (gridDrawRafRef.current === null) {
        scheduleGridDraw();
      }
    }, 180);
  }, [scheduleGridDraw]);

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
    const gridEl = worldGridRef.current;
    if (gridEl) {
      drawGrid();
    }
    const el = transformLayerRef.current;
    if (el) {
      el.style.transform = `translate(${livePan.current.x}px,${livePan.current.y}px) scale(${liveZoom.current})`;
    }
    const zi = zoomIndicatorRef.current;
    if (zi) {
      zi.textContent = `${Math.round(liveZoom.current * 100)}%`;
    }
  }, [drawGrid]);

  const scheduleCommit = useCallback(() => {
    if (isInteractingRef.current) {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        if (isInteractingRef.current) {
          scheduleCommit();
          return;
        }
        setZoom(liveZoom.current);
        setPan({ ...livePan.current });
      }, 100);
      return;
    }

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
      markInteraction();
      enableZoomTransition();
      applyTransform();
      scheduleCommit();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyTransform, scheduleCommit, enableZoomTransition, markInteraction]);

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
        markInteraction();
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
    [selectCard, setPan, applyTransform, markInteraction]
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
      scheduleGridDraw();
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleGridDraw();
    });
    observer.observe(container);
    scheduleGridDraw();

    return () => {
      observer.disconnect();
      if (gridDrawRafRef.current !== null) {
        cancelAnimationFrame(gridDrawRafRef.current);
        gridDrawRafRef.current = null;
      }
      if (interactionSettleTimerRef.current) {
        clearTimeout(interactionSettleTimerRef.current);
        interactionSettleTimerRef.current = null;
      }
    };
  }, [scheduleGridDraw]);

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
