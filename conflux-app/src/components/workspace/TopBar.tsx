import { type FC, type MouseEvent, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
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
  // 批3 §3：不订阅整张 instances Map（任意实例字段变化都重渲染顶栏）——
  // 胶囊只消费两个计数，selector 直接派生 primitive（Object.is 去抖）。
  const instanceCount = useAgentStore(
    (s) => getLiveAgentInstances(s.instances).length
  );
  const activeCount = useAgentStore(
    (s) =>
      getLiveAgentInstances(s.instances).filter(
        (agent) =>
          agent.status === "thinking" ||
          agent.status === "coding" ||
          agent.status === "waiting_permission"
      ).length
  );
  const [capsuleHovered, setCapsuleHovered] = useState(false);
  const lastCompactShortcutAtRef = useRef(0);

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
        <span style={{ color: "#B8D4E3", display: "inline-flex" }}>
          <Icon name="plus" size={16} />
        </span>
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
          <span style={{ color: "#B8D4E3", display: "inline-flex" }}>
            <Icon name="layers" size={16} />
          </span>
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
          <Icon name="edit" size={14} />
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
          <Icon name="message" size={16} />
        </button>
        <button
          type="button"
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onSearch}
          onPointerDown={(e) => e.stopPropagation()}
          title="Search"
        >
          <Icon name="search" size={16} />
        </button>
        <button
          type="button"
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onSettings}
          onPointerDown={(e) => e.stopPropagation()}
          title="Settings"
        >
          <Icon name="settings" size={16} />
        </button>
        <button
          type="button"
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          onClick={onToggleFullscreen}
          onPointerDown={(e) => e.stopPropagation()}
          title="Toggle fullscreen"
          aria-label="Toggle fullscreen"
        >
          <Icon name="maximize" size={16} />
        </button>
        <button
          type="button"
          onClick={onMinimize}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[#6B7280] hover:text-[#B8B3B0] transition-colors"
          title="Minimize to compact mode"
          aria-label="Minimize to compact mode"
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[#6B7280] hover:text-[#FF3B30] transition-colors"
          title="Close"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </header>
  );
};

export { TopBar };
