import {
  type CSSProperties,
  type FC,
  type KeyboardEvent,
  type MouseEvent,
  useMemo,
} from "react";
import { resolveTopIslandState } from "@/lib/compact-mode";
import type { TopIslandPopoverView } from "@/lib/compact-mode";
import { COMPACT_WINDOW_METRICS, px } from "@/lib/compact-window-metrics";
import { getLiveAgentInstances } from "@/lib/workspace-status";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore } from "@/stores/agentStore";
import { ConfluxBrandMark } from "./ConfluxBrandMark";

interface TopIslandProps {
  presentation?: TopIslandPresentation;
  onExpand: (anchor: { x: number; y: number }, view: TopIslandPopoverView) => void;
  onExpandShell?: () => void;
  onCollapseShell?: () => void;
  onSnapToMonitor?: (presentation: TopIslandPresentation) => void;
}

export type TopIslandPresentation = "collapsed" | "expanded";

function ChevronDownIcon({ color = "rgba(255,255,255,0.72)" }: { color?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function BellIcon({ color = "rgba(255,255,255,0.7)" }: { color?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function PencilIcon({ color = "rgba(255,255,255,0.7)" }: { color?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export const TopIsland: FC<TopIslandProps> = ({
  presentation = "collapsed",
  onExpand,
  onExpandShell,
  onCollapseShell,
  onSnapToMonitor,
}) => {
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const notifications = useIslandStore((s) => s.notifications);
  const unreadCount = useIslandStore((s) => s.unreadCount);
  const instances = useAgentStore((s) => s.instances);

  const liveAgents = useMemo(
    () => getLiveAgentInstances(instances),
    [instances]
  );
  const activeCount = useMemo(
    () =>
      liveAgents.filter(
        (agent) =>
          agent.status === "thinking" ||
          agent.status === "coding" ||
          agent.status === "waiting_permission"
        ).length,
    [liveAgents]
  );
  const instanceCount = liveAgents.length;

  const permissionRequest = pendingPermissions[0];
  const unreadNotification = useMemo(
    () => notifications.find((notification) => !notification.read),
    [notifications]
  );

  const visualState = useMemo(
    () =>
      resolveTopIslandState({
        activeCount,
        permissionCount: pendingPermissions.length,
        unreadCount,
      }),
    [activeCount, pendingPermissions.length, unreadCount]
  );

  const shellKind = visualState === "active" && unreadCount > 0 ? "unread" : "normal";
  const requiresExpanded = visualState === "permission" || shellKind === "unread";
  const resolvedPresentation: TopIslandPresentation =
    requiresExpanded ? "expanded" : presentation;
  const isExpanded = resolvedPresentation === "expanded";
  const capsuleWidth = isExpanded
    ? COMPACT_WINDOW_METRICS.topIsland.expandedWidth
    : COMPACT_WINDOW_METRICS.topIsland.collapsedWidth;
  const capsuleHeight = isExpanded
    ? COMPACT_WINDOW_METRICS.topIsland.expandedHeight
    : COMPACT_WINDOW_METRICS.topIsland.collapsedHeight;
  const primaryCopy = useMemo(() => {
    if (visualState === "permission" && permissionRequest) {
      return permissionRequest.description || permissionRequest.action;
    }

    if (shellKind === "unread") {
      const source = unreadNotification?.source_adapter_name;
      const summary =
        unreadNotification?.content ||
        `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`;

      return source && source !== "Conflux" ? `${source} · ${summary}` : summary;
    }

    if (visualState === "active") {
      return activeCount > 0 ? `${activeCount} Agents Active` : "Recent activity";
    }

    return instanceCount > 0 ? `${instanceCount} Agents Open` : "All systems idle";
  }, [activeCount, instanceCount, permissionRequest, shellKind, unreadCount, unreadNotification, visualState]);

  const leadingTone = visualState === "permission" ? "warning" : visualState === "active" ? "success" : "idle";

  const collapsedCopy = useMemo(() => {
    if (instanceCount > 0) {
      return `Conflux · ${instanceCount} ${instanceCount === 1 ? "agent" : "agents"}`;
    }
    if (unreadCount > 0) {
      return `Conflux · ${unreadCount} update${unreadCount === 1 ? "" : "s"}`;
    }
    return "Conflux · idle";
  }, [instanceCount, unreadCount]);

  const popoverAnchor = useMemo(
    () => ({
      x:
        COMPACT_WINDOW_METRICS.topIsland.expandedWidth -
        COMPACT_WINDOW_METRICS.topIsland.popoverWidth -
        12,
      y:
        COMPACT_WINDOW_METRICS.topIsland.shellPaddingY +
        COMPACT_WINDOW_METRICS.topIsland.expandedHeight +
        12,
    }),
    []
  );

  function handleExpand(view: TopIslandPopoverView) {
    onExpand({
      x: popoverAnchor.x,
      y: popoverAnchor.y,
    }, view);
  }

  function handleCollapsedClick() {
    onExpandShell?.();
  }

  function handleCapsuleMouseEnter() {
    if (requiresExpanded) return;
    onExpandShell?.();
  }

  function handleCapsuleMouseLeave(event: MouseEvent<HTMLDivElement>) {
    if (requiresExpanded) return;
    if (event.buttons !== 0) return;
    onCollapseShell?.();
  }

  function handleCollapsedKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onExpandShell?.();
  }

  function handleCapsulePointerUp() {
    onSnapToMonitor?.(resolvedPresentation);
  }

  function stopCapsuleActionPropagation(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  const expandedActions = (
    <span className="top-island-capsule__actions">
      <button
        type="button"
        className="top-island-capsule__action island-pressable"
        aria-label="Open notifications"
        onClick={() => handleExpand("notifications")}
        onPointerDown={stopCapsuleActionPropagation}
        onPointerUp={stopCapsuleActionPropagation}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="top-island-capsule__action-badge" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="top-island-capsule__action island-pressable"
        aria-label="Open quick reply"
        onClick={() => handleExpand("quick_reply")}
        onPointerDown={stopCapsuleActionPropagation}
        onPointerUp={stopCapsuleActionPropagation}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        className="top-island-capsule__detail-trigger island-pressable"
        aria-label="Open dynamic island details"
        onClick={() => handleExpand("details")}
        onPointerDown={stopCapsuleActionPropagation}
        onPointerUp={stopCapsuleActionPropagation}
      >
        <ChevronDownIcon />
      </button>
    </span>
  );

  return (
    <div
      className="top-island-shell"
      style={
        {
          "--top-island-shell-padding-y": px(
            COMPACT_WINDOW_METRICS.topIsland.shellPaddingY
          ),
        } as CSSProperties
      }
    >
      <div
        className="top-island-capsule"
        data-tauri-drag-region={true}
        data-visual-state={visualState}
        data-shell-kind={shellKind}
        data-presentation={resolvedPresentation}
        role={isExpanded ? undefined : "button"}
        tabIndex={isExpanded ? undefined : 0}
        aria-label={isExpanded ? undefined : "Expand dynamic island capsule"}
        onClick={isExpanded ? undefined : handleCollapsedClick}
        onKeyDown={isExpanded ? undefined : handleCollapsedKeyDown}
        onMouseEnter={handleCapsuleMouseEnter}
        onMouseLeave={handleCapsuleMouseLeave}
        onPointerUp={handleCapsulePointerUp}
        style={
          {
            "--top-island-width": px(capsuleWidth),
            "--top-island-height": px(capsuleHeight),
            width: "var(--top-island-width)",
            height: "var(--top-island-height)",
          } as CSSProperties
        }
      >
        {!isExpanded ? (
          <>
            <span className="top-island-capsule__brand-mark" aria-hidden="true">
              <ConfluxBrandMark artwork="light" />
            </span>
            <span className="top-island-capsule__primary">{collapsedCopy}</span>
            <span className="top-island-capsule__state-dot" data-visual-state={visualState} aria-hidden="true" />
          </>
        ) : shellKind === "unread" ? (
          <>
            <span className="top-island-capsule__leading" data-indicator="badge">
              <span className="top-island-capsule__badge" aria-label={`${unreadCount} unread updates`}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            </span>
            <span className="top-island-capsule__primary">{primaryCopy}</span>
            <span className="top-island-capsule__brand">
              <span className="top-island-capsule__brand-mark" aria-hidden="true">
                <ConfluxBrandMark artwork="light" />
              </span>
            <span className="top-island-capsule__brand-copy">Conflux</span>
            </span>
            {expandedActions}
          </>
        ) : (
          <>
            <span
              className="top-island-capsule__leading"
              data-indicator="dot"
              data-tone={leadingTone}
              aria-hidden="true"
            >
              <span className="top-island-capsule__dot" />
            </span>
            <span className="top-island-capsule__primary">{primaryCopy}</span>
            <span className="top-island-capsule__separator" aria-hidden="true" />
            <span className="top-island-capsule__brand">
              <span className="top-island-capsule__brand-mark" aria-hidden="true">
                <ConfluxBrandMark artwork="light" />
              </span>
            <span className="top-island-capsule__brand-copy">Conflux</span>
            </span>
            {expandedActions}
          </>
        )}
      </div>
    </div>
  );
};
