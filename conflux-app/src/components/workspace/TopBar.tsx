import { type FC, type MouseEvent, useMemo, useRef, useState } from "react";
import { getLiveAgentInstances } from "@/lib/workspace-status";
import { useAgentStore } from "@/stores/agentStore";

interface TopBarProps {
  onIslandOpen: () => void;
  onMinimize: () => void;
  onQuickReplyOpen: () => void;
  onDiscussionOpen: () => void;
  onAddAgent: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

const TopBar: FC<TopBarProps> = ({
  onIslandOpen,
  onMinimize,
  onQuickReplyOpen,
  onDiscussionOpen,
  onAddAgent,
  onSearch,
  onSettings,
  onToggleFullscreen,
  onClose,
}) => {
  const instances = useAgentStore((s) => s.instances);
  const [capsuleHovered, setCapsuleHovered] = useState(false);
  const lastCompactShortcutAtRef = useRef(0);

  const liveAgents = useMemo(
    () => getLiveAgentInstances(instances),
    [instances]
  );
  const instanceCount = liveAgents.length;
  const activeCount = useMemo(() => {
    return liveAgents.filter((agent) =>
      agent.status === "thinking" || agent.status === "coding" || agent.status === "waiting_permission"
    ).length;
  }, [liveAgents]);

  const capsuleText =
    activeCount > 0
      ? `${activeCount} Agent${activeCount > 1 ? "s" : ""} Active`
      : instanceCount > 0
        ? `${instanceCount} Agent${instanceCount > 1 ? "s" : ""} Open`
        : "No Agents";

  const dotColor = instanceCount > 0 ? "#34C759" : "#6B7280";
  const requestTopBarCompactMode = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as EventTarget | null;
    const closest =
      target && "closest" in target
        ? (target as Element).closest?.bind(target)
        : undefined;

    if (closest?.("button,a,input,textarea,select,[role='button']")) {
      return;
    }

    const now = Date.now();
    if (now - lastCompactShortcutAtRef.current < 250) {
      return;
    }

    lastCompactShortcutAtRef.current = now;
    event.preventDefault?.();
    event.stopPropagation?.();
    onMinimize();
  };
  const handleTopBarMouseDownCapture = (event: MouseEvent<HTMLElement>) => {
    if (event.detail < 2) {
      return;
    }

    requestTopBarCompactMode(event);
  };
  const handleTopBarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    requestTopBarCompactMode(event);
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDownCapture={handleTopBarMouseDownCapture}
      onDoubleClick={handleTopBarDoubleClick}
      className="flex items-center h-[52px] px-5 shrink-0 relative z-30"
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <button
        type="button"
        onClick={onAddAgent}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center gap-[5px] px-[10px] py-[5px] rounded-lg"
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.07)",
          color: "#B8B3B0",
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B8D4E3" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>Add Agent</span>
      </button>

      <div className="flex-1" />

      <div
        className="relative flex items-center"
        onPointerEnter={() => setCapsuleHovered(true)}
        onPointerLeave={() => setCapsuleHovered(false)}
      >
        <button
          type="button"
          onClick={onIslandOpen}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex items-center justify-center gap-2 rounded-full"
          style={{
            width: 276,
            height: 34,
            paddingLeft: 14,
            paddingRight: 42,
            border: "1px solid rgba(255,255,255,0.07)",
            background: "#000000",
            boxShadow:
              "0 5px 12px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
            cursor: "pointer",
            transition:
              "transform var(--duration-fast) var(--ease-apple), box-shadow var(--duration-normal) var(--ease-apple)",
          }}
          aria-label="Open island window"
        >
          <span
            className="shrink-0 rounded-full"
            style={{ width: 6, height: 6, background: dotColor }}
          />
          <span
            style={{
              color: "#FFFFFF",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: 0.3,
            }}
          >
            {capsuleText}
          </span>
          <span
            style={{
              width: 1,
              height: 16,
              background: "rgba(255,255,255,0.1)",
            }}
          />
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B8D4E3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
            <path d="m22 12-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12" opacity="0.6" />
            <path d="m22 17-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17" opacity="0.3" />
          </svg>
          <span
            style={{
              color: "#B8D4E3",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.6,
            }}
          >
            Conflux
          </span>
        </button>

        <button
          type="button"
          onClick={onQuickReplyOpen}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute flex items-center justify-center rounded-full text-[#B8B3B0] hover:text-[#F2F2F2] transition-colors"
          style={{
            top: "50%",
            right: 7,
            width: 24,
            height: 24,
            transform: capsuleHovered
              ? "translateY(-50%) scale(1)"
              : "translateY(-50%) scale(0.9)",
            opacity: capsuleHovered ? 1 : 0,
            pointerEvents: capsuleHovered ? "auto" : "none",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.06)",
            transition:
              "opacity var(--duration-fast) var(--ease-apple), transform var(--duration-fast) var(--ease-apple), color var(--duration-fast) var(--ease-apple), background var(--duration-fast) var(--ease-apple)",
          }}
          title="Quick reply"
          aria-label="Open quick reply"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
            <path d="m15 5 4 4" />
          </svg>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onDiscussionOpen}
          onPointerDown={(e) => e.stopPropagation()}
          title="New Discussion"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z" />
            <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
          </svg>
        </button>
        <button
          type="button"
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onSearch}
          onPointerDown={(e) => e.stopPropagation()}
          title="Search"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
        <button
          type="button"
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onSettings}
          onPointerDown={(e) => e.stopPropagation()}
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
          </svg>
        </button>
        <button
          type="button"
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onToggleFullscreen}
          onPointerDown={(e) => e.stopPropagation()}
          title="Toggle fullscreen"
          aria-label="Toggle fullscreen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onMinimize}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          title="Minimize to compact mode"
          aria-label="Minimize to compact mode"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[#6B7280] hover:text-[#FF3B30] transition-colors"
          title="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export { TopBar };
