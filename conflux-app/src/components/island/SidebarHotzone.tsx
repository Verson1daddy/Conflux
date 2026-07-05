import { type CSSProperties, type FC, type MouseEvent, type PointerEvent, useRef } from "react";
import { COMPACT_WINDOW_METRICS, px } from "@/lib/compact-window-metrics";
import { startCurrentWindowDrag } from "@/lib/window-drag";
import { Icon } from "@/components/ui/Icon";

interface SidebarHotzoneProps {
  expanded: boolean;
  onHoverChange: (hovered: boolean) => void;
  onActivate: () => void;
}

export const SidebarHotzone: FC<SidebarHotzoneProps> = ({
  expanded,
  onHoverChange,
  onActivate,
}) => {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const dragThresholdPx = 4;

  const markDragIfPastThreshold = (buttons: number, clientX: number, clientY: number) => {
    if ((buttons & 1) !== 1 || dragStartRef.current === null) return;

    const deltaX = clientX - dragStartRef.current.x;
    const deltaY = clientY - dragStartRef.current.y;
    if (Math.hypot(deltaX, deltaY) >= dragThresholdPx) {
      suppressNextClickRef.current = true;
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    void startCurrentWindowDrag();
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    markDragIfPastThreshold(event.buttons, event.clientX, event.clientY);
  };

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || dragStartRef.current !== null) return;

    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    void startCurrentWindowDrag();
  };

  const handleMouseMove = (event: MouseEvent<HTMLButtonElement>) => {
    markDragIfPastThreshold(event.buttons, event.clientX, event.clientY);
  };

  const handlePointerEnd = () => {
    dragStartRef.current = null;
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    onActivate();
  };

  return (
    <button
      type="button"
      aria-label={expanded ? "Compact sidebar is open" : "Open compact sidebar"}
      className={expanded ? "sidebar-hotzone is-active" : "sidebar-hotzone"}
      style={
        {
          ["--sidebar-dock-tab-width" as const]: px(
            COMPACT_WINDOW_METRICS.sidebar.dockTabWidth
          ),
          ["--sidebar-dock-tab-height" as const]: px(
            COMPACT_WINDOW_METRICS.sidebar.dockTabHeight
          ),
        } as CSSProperties
      }
      onPointerEnter={() => {
        onHoverChange(true);
      }}
      onPointerLeave={() => onHoverChange(false)}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onMouseEnter={() => {
        onHoverChange(true);
      }}
      onMouseLeave={() => onHoverChange(false)}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handlePointerEnd}
      onClick={handleClick}
    >
      <span className="sidebar-hotzone__icon" aria-hidden="true">
        <Icon name="layers" size={24} />
      </span>
      <span className="sidebar-hotzone__rail" aria-hidden="true" />
      <span className="sidebar-hotzone__chevron" aria-hidden="true">
        <Icon name="chevron-left" size={20} />
      </span>
    </button>
  );
};
