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
import {
  resolveGridLevels,
  CROSS_ARM_PX,
  CROSS_GRAY,
  DOT_GRAY,
  LEVEL_INTERSECTION_BUDGET,
} from "@/lib/grid-model";
import {
  approachLog,
  clampLogZoom,
  wheelLogDelta,
  anchorWorldPoint,
  panForAnchor,
  type AnchorWorld,
} from "@/lib/camera-math";

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

  // v5 网格渲染（spec §1.3）：连续权重层级，先点后十字；
  // 无像素对齐——亚像素 + AA（tldraw/Excalidraw 纪律），dpr 物理像素画布。
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

    const zoom = liveZoom.current;
    const pan = livePan.current;

    const eachIntersection = (ws: number, cb: (x: number, y: number) => void) => {
      const worldLeft = -pan.x / zoom;
      const worldTop = -pan.y / zoom;
      const worldRight = (width - pan.x) / zoom;
      const worldBottom = (height - pan.y) / zoom;
      const startWX = Math.floor(worldLeft / ws) * ws;
      const startWY = Math.floor(worldTop / ws) * ws;
      const cols = Math.ceil((worldRight - startWX) / ws) + 2;
      const rows = Math.ceil((worldBottom - startWY) / ws) + 2;
      if (cols * rows > LEVEL_INTERSECTION_BUDGET) return;
      for (let wx = startWX; wx <= worldRight + ws; wx += ws) {
        const x = pan.x + wx * zoom;
        for (let wy = startWY; wy <= worldBottom + ws; wy += ws) {
          cb(x, pan.y + wy * zoom);
        }
      }
    };

    const levels = resolveGridLevels(zoom);
    for (const lv of levels) {
      if (lv.dotAlpha <= 0.004) continue;
      ctx.fillStyle = `rgba(${DOT_GRAY},${DOT_GRAY},${DOT_GRAY},${lv.dotAlpha})`;
      const r = lv.dotR;
      if (r <= 0.75) {
        const s = r * 2;
        eachIntersection(lv.worldSpacing, (x, y) => ctx.fillRect(x - r, y - r, s, s));
      } else {
        ctx.beginPath();
        eachIntersection(lv.worldSpacing, (x, y) => {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        });
        ctx.fill();
      }
    }
    for (const lv of levels) {
      if (lv.crossAlpha <= 0.004) continue;
      ctx.strokeStyle = `rgba(${CROSS_GRAY},${CROSS_GRAY},${CROSS_GRAY},${lv.crossAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      eachIntersection(lv.worldSpacing, (x, y) => {
        ctx.moveTo(x - CROSS_ARM_PX, y);
        ctx.lineTo(x + CROSS_ARM_PX, y);
        ctx.moveTo(x, y - CROSS_ARM_PX);
        ctx.lineTo(x, y + CROSS_ARM_PX);
      });
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

  // ===== 滚轮缩放平滑（spec §1.4）=====
  // log 空间指数趋近（τ=90ms）+ 锚点闭式重算 pan = p − w·zoom + 拖拽打断。
  const logZoomRef = useRef(Math.log2(storeZoom));
  const targetLogZoomRef = useRef(Math.log2(storeZoom));
  const zoomAnchorRef = useRef<{
    cursor: { x: number; y: number };
    world: AnchorWorld;
  } | null>(null);
  const zoomAnimRef = useRef<number | null>(null);
  const zoomAnimLastTRef = useRef(0);

  useEffect(() => {
    // store 提交 / fitAll / 自动 fit 等外部 zoom 变更：log 域状态跟随。
    logZoomRef.current = Math.log2(storeZoom);
    targetLogZoomRef.current = logZoomRef.current;
  }, [storeZoom]);

  const stepZoomAnimation = useCallback(
    (now: number) => {
      zoomAnimRef.current = null;
      const dt = Math.min(64, now - (zoomAnimLastTRef.current || now));
      zoomAnimLastTRef.current = now;
      logZoomRef.current = approachLog(logZoomRef.current, targetLogZoomRef.current, dt);
      liveZoom.current = 2 ** logZoomRef.current;
      const anchor = zoomAnchorRef.current;
      if (anchor) {
        livePan.current = panForAnchor(anchor.cursor, anchor.world, liveZoom.current);
      }
      markInteraction();
      applyTransform();
      if (logZoomRef.current !== targetLogZoomRef.current) {
        zoomAnimRef.current = requestAnimationFrame(stepZoomAnimation);
      } else {
        zoomAnchorRef.current = null;
        zoomAnimLastTRef.current = 0;
        scheduleCommit();
      }
    },
    [applyTransform, markInteraction, scheduleCommit]
  );

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
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // 锚点跟最新光标（pixi-viewport 行为）；rAF 循环本身就是动画，
      // 不再触发 CSS zoom transition（两者会打架）。
      zoomAnchorRef.current = {
        cursor,
        world: anchorWorldPoint(cursor, livePan.current, liveZoom.current),
      };
      targetLogZoomRef.current = clampLogZoom(
        targetLogZoomRef.current + wheelLogDelta(e.deltaY, e.deltaMode)
      );
      if (zoomAnimRef.current === null) {
        zoomAnimRef.current = requestAnimationFrame(stepZoomAnimation);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stepZoomAnimation]);

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
      // 拖拽打断缩放动画（tldraw 相机行为：用户输入即接管）。
      targetLogZoomRef.current = logZoomRef.current;
      zoomAnchorRef.current = null;
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
      if (zoomAnimRef.current !== null) {
        cancelAnimationFrame(zoomAnimRef.current);
        zoomAnimRef.current = null;
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
