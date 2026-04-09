// ===== Canvas Component =====
// The main workspace canvas container. Provides:
// - Dark gradient background (canvas-gradient)
// - Mouse wheel zoom (0.25x - 3x)
// - Pan via middle-click drag or Space+left-click drag
// - Renders AgentCards at their layout positions
// - Contains LayoutManager toolbar

import { useCallback, useRef, useState, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceLayout } from "@/hooks/useWorkspaceLayout";
import { AgentCard } from "./AgentCard";
import { LayoutManager } from "./LayoutManager";
import type { AgentStatus, AgentInstanceInfo } from "@/types";

// ===== Constants =====

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_SENSITIVITY = 0.001;

// ===== Props =====

interface CanvasProps {
  /** Map of instance_id -> AgentInstanceInfo for rendering card details */
  agents: Map<string, AgentInstanceInfo>;
  /** Map of instance_id -> current AgentStatus */
  agentStatuses: Map<string, AgentStatus>;
}

/**
 * Canvas is the root workspace container.
 *
 * Interactions:
 * - Scroll wheel: zoom in/out (centered on cursor)
 * - Middle mouse drag: pan the canvas
 * - Space + left mouse drag: pan the canvas
 * - Click on empty space: deselect cards
 *
 * Renders all AgentCards within a transformed (zoom + pan) coordinate space.
 * The LayoutManager toolbar floats above the canvas in screen-space.
 */
function Canvas({ agents, agentStatuses }: CanvasProps) {
  const { cards, layoutMode, zoom, pan, selectedCardId, setZoom, setPan, selectCard } =
    useWorkspaceStore();

  const { triggerAutoPack } = useWorkspaceLayout();

  const containerRef = useRef<HTMLDivElement>(null);

  // ===== Pan state =====
  const panDragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPanX: number;
    startPanY: number;
    pointerId: number;
  } | null>(null);

  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // ===== Space key tracking =====
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" && !e.repeat) {
        // Prevent page scroll
        e.preventDefault();
        setSpaceHeld(true);
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        setSpaceHeld(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ===== Wheel zoom =====
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Cursor position relative to container
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      // Current world position under cursor
      const worldX = (cursorX - pan.x) / zoom;
      const worldY = (cursorY - pan.y) / zoom;

      // Compute new zoom
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (1 + delta)));

      // Adjust pan so the world point under cursor stays fixed
      const newPanX = cursorX - worldX * newZoom;
      const newPanY = cursorY - worldY * newZoom;

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    },
    [zoom, pan, setZoom, setPan]
  );

  // ===== Pan start =====
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Middle button (1) or Space+Left button (0)
      const isMiddleButton = e.button === 1;
      const isSpaceLeftButton = e.button === 0 && spaceHeld;

      if (!isMiddleButton && !isSpaceLeftButton) {
        // Left click on empty canvas space: deselect card
        if (e.button === 0 && e.target === containerRef.current) {
          selectCard(null);
        }
        return;
      }

      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      panDragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        pointerId: e.pointerId,
      };
      setIsPanning(true);
    },
    [spaceHeld, pan, selectCard]
  );

  // ===== Pan move =====
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!panDragRef.current) return;

      const dx = e.clientX - panDragRef.current.startMouseX;
      const dy = e.clientY - panDragRef.current.startMouseY;

      setPan({
        x: panDragRef.current.startPanX + dx,
        y: panDragRef.current.startPanY + dy,
      });
    },
    [setPan]
  );

  // ===== Pan end =====
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!panDragRef.current) return;

      try {
        (e.target as HTMLElement).releasePointerCapture(panDragRef.current.pointerId);
      } catch {
        // Pointer capture may have already been released
      }
      panDragRef.current = null;
      setIsPanning(false);
    },
    []
  );

  // ===== Cursor style =====
  const cursorClass = isPanning
    ? "cursor-grabbing"
    : spaceHeld
      ? "cursor-grab"
      : "";

  return (
    <div
      ref={containerRef}
      className={[
        "canvas-gradient relative w-full h-full overflow-hidden",
        cursorClass,
      ]
        .filter(Boolean)
        .join(" ")}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* ===== Transformed canvas layer ===== */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          // Allow transform to extend beyond container
          width: 0,
          height: 0,
        }}
      >
        {cards.map((card) => {
          const agentInfo = agents.get(card.instance_id);
          const agentStatus = agentStatuses.get(card.instance_id) ?? "idle";
          const agentName = agentInfo?.adapter_name ?? "Unknown Agent";
          const adapterBadge = agentInfo?.adapter_id ?? "---";

          return (
            <AgentCard
              key={card.instance_id}
              card={card}
              agentName={agentName}
              adapterBadge={adapterBadge}
              status={agentStatus}
              isSelected={selectedCardId === card.instance_id}
              layoutMode={layoutMode}
              zoom={zoom}
              fileCount={0}
              lastActivity={agentInfo?.created_at ?? 0}
            />
          );
        })}
      </div>

      {/* ===== Layout manager toolbar (screen-space overlay) ===== */}
      <LayoutManager onAutoPack={triggerAutoPack} />

      {/* ===== Zoom indicator ===== */}
      <div className="absolute bottom-4 left-4 z-50">
        <span className="glass rounded-md px-2 py-1 text-[10px] font-mono text-white/40">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}

export { Canvas };
export type { CanvasProps };
