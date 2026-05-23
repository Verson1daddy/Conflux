import {
  type CSSProperties,
  type FC,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveTopIslandState } from "@/lib/compact-mode";
import type { TopIslandPopoverView } from "@/lib/compact-mode";
import {
  COMPACT_WINDOW_METRICS,
  resolveTopIslandPopoverWindowHeight,
  px,
} from "@/lib/compact-window-metrics";
import { getLiveAgentInstances } from "@/lib/workspace-status";
import { respondToPermission, setTopIslandPopoverHeight } from "@/lib/tauri-bridge";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentInstanceInfo, NotificationItem, PermissionDecision } from "@/types";

interface TopIslandPopoverProps {
  anchor: { x: number; y: number };
  view: TopIslandPopoverView;
  onClose: () => void;
  onRestoreWorkspace: () => void;
}

const BUBBLE_WIDTH = COMPACT_WINDOW_METRICS.topIsland.popoverWidth;
const BUBBLE_HEIGHT = COMPACT_WINDOW_METRICS.topIsland.popoverMaxHeight;
const BUBBLE_MARGIN = COMPACT_WINDOW_METRICS.topIsland.popoverMargin;
const MIN_BUBBLE_TOP =
  COMPACT_WINDOW_METRICS.topIsland.shellPaddingY +
  COMPACT_WINDOW_METRICS.topIsland.expandedHeight +
  BUBBLE_MARGIN;

function formatStatusLabel(state: ReturnType<typeof resolveTopIslandState>) {
  switch (state) {
    case "permission":
      return "Permission";
    case "active":
      return "Active";
    default:
      return "Idle";
  }
}

function formatViewTitle(view: TopIslandPopoverView) {
  switch (view) {
    case "notifications":
      return "Notifications";
    case "quick_reply":
      return "Quick Reply";
    default:
      return "Dynamic Island";
  }
}

function formatAgentLabel(agent: AgentInstanceInfo | undefined) {
  if (!agent) return "No active agent";
  return agent.display_name ? `${agent.adapter_name} - ${agent.display_name}` : agent.adapter_name;
}

function formatNotificationSource(notification: NotificationItem) {
  return notification.source_adapter_name || notification.level.replaceAll("_", " ");
}

export const TopIslandPopover: FC<TopIslandPopoverProps> = ({
  anchor,
  view,
  onClose,
  onRestoreWorkspace,
}) => {
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const notifications = useIslandStore((s) => s.notifications);
  const unreadCount = useIslandStore((s) => s.unreadCount);
  const removePermissionRequest = useIslandStore((s) => s.removePermissionRequest);
  const instances = useAgentStore((s) => s.instances);
  const openDiscussionWizard = useAgentStore((s) => s.openDiscussionWizard);
  const setDiscussionDirection = useAgentStore((s) => s.setDiscussionDirection);
  const [pendingDecision, setPendingDecision] = useState<PermissionDecision | null>(null);
  const pendingDecisionRef = useRef(false);
  const [replyDraft, setReplyDraft] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const measureGenerationRef = useRef(0);

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

  const permissionRequest = pendingPermissions[0];
  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.read),
    [notifications]
  );
  const unreadNotification = useMemo(
    () => unreadNotifications[0],
    [unreadNotifications]
  );
  const primaryAgent = liveAgents[0];
  const replyTargetLabel = formatAgentLabel(primaryAgent);

  const visualState = useMemo(
    () =>
      resolveTopIslandState({
        activeCount,
        permissionCount: pendingPermissions.length,
        unreadCount,
      }),
    [activeCount, pendingPermissions.length, unreadCount]
  );

  const summary = useMemo(() => {
    if (visualState === "permission" && permissionRequest) {
      return permissionRequest.description || permissionRequest.action;
    }

    if (visualState === "active") {
      return (
        unreadNotification?.content ||
        unreadNotification?.source_adapter_name ||
        `${activeCount} agents active`
      );
    }

    return "No active agents or unread notifications.";
  }, [activeCount, permissionRequest, unreadNotification, visualState]);

  const statusLine = useMemo(
    () =>
      `${activeCount} active / ${pendingPermissions.length} permission / ${unreadCount} unread`,
    [activeCount, pendingPermissions.length, unreadCount]
  );

  const bubblePosition = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        left: anchor.x,
        top: anchor.y,
      };
    }

    const requestedTop = Math.max(anchor.y, MIN_BUBBLE_TOP);
    const maxLeft = Math.max(BUBBLE_MARGIN, window.innerWidth - BUBBLE_WIDTH - BUBBLE_MARGIN);
    const maxTop = Math.max(BUBBLE_MARGIN, window.innerHeight - BUBBLE_HEIGHT - BUBBLE_MARGIN);
    const hasEnoughViewportHeight =
      window.innerHeight >= requestedTop + BUBBLE_HEIGHT + BUBBLE_MARGIN;

    return {
      left: Math.max(BUBBLE_MARGIN, Math.min(anchor.x, maxLeft)),
      top: hasEnoughViewportHeight ? Math.min(requestedTop, maxTop) : requestedTop,
    };
  }, [anchor.x, anchor.y]);

  useLayoutEffect(() => {
    const node = popoverRef.current;
    if (!node) {
      return;
    }

    const generation = measureGenerationRef.current + 1;
    measureGenerationRef.current = generation;
    let active = true;

    const syncWindowHeight = () => {
      if (!active || measureGenerationRef.current !== generation) {
        return;
      }

      const rectHeight = node.getBoundingClientRect().height;
      const contentHeight = Math.max(node.scrollHeight, rectHeight);
      const nextHeight = resolveTopIslandPopoverWindowHeight({
        top: bubblePosition.top,
        contentHeight,
      });

      void setTopIslandPopoverHeight(nextHeight).catch(() => undefined);
    };

    syncWindowHeight();

    const deactivateMeasurement = () => {
      active = false;
      if (measureGenerationRef.current === generation) {
        measureGenerationRef.current += 1;
      }
    };

    if (typeof ResizeObserver === "undefined") {
      return deactivateMeasurement;
    }

    const resizeObserver = new ResizeObserver(syncWindowHeight);
    resizeObserver.observe(node);
    return () => {
      deactivateMeasurement();
      resizeObserver.disconnect();
    };
  }, [
    bubblePosition.top,
    view,
    pendingPermissions.length,
    unreadNotifications.length,
    replyDraft,
    summary,
    statusLine,
  ]);

  async function handlePermissionDecision(decision: PermissionDecision) {
    if (!permissionRequest || pendingDecisionRef.current) {
      return;
    }

    pendingDecisionRef.current = true;
    setPendingDecision(decision);

    try {
      await respondToPermission(permissionRequest.instance_id, permissionRequest.id, decision);
      removePermissionRequest(permissionRequest.id);
    } catch {
      // Keep the request available so the user can retry from the bubble.
    } finally {
      pendingDecisionRef.current = false;
      setPendingDecision(null);
    }
  }

  function handleOpenDiscussion() {
    openDiscussionWizard({
      sourceInstanceId: primaryAgent?.instance_id,
    });

    const trimmedDraft = replyDraft.trim();
    if (trimmedDraft) {
      setDiscussionDirection(trimmedDraft);
    }

    onRestoreWorkspace();
  }

  function renderDetailsBody() {
    return (
      <div className="top-island-bubble__body">
        <div className="top-island-bubble__summary-row">
          <span className="top-island-bubble__label">Mode</span>
          <span className="top-island-bubble__value">Top-centered capsule</span>
        </div>
        <div className="top-island-bubble__summary-row">
          <span className="top-island-bubble__label">Status</span>
          <span className="top-island-bubble__value">{statusLine}</span>
        </div>
        <p className="top-island-bubble__summary">{summary}</p>
      </div>
    );
  }

  function renderNotificationsBody() {
    const visibleNotifications = unreadNotifications.slice(0, 3);

    return (
      <div className="top-island-bubble__body top-island-bubble__body--notifications">
        <div className="top-island-bubble__summary-row">
          <span className="top-island-bubble__label">Unread</span>
          <span className="top-island-bubble__value">{unreadNotifications.length}</span>
        </div>
        {visibleNotifications.length > 0 ? (
          <div className="top-island-bubble__notification-list">
            {visibleNotifications.map((notification) => (
              <div
                className="top-island-bubble__notification-item"
                data-level={notification.level}
                key={notification.id}
              >
                <span className="top-island-bubble__notification-source">
                  {formatNotificationSource(notification)}
                </span>
                <span className="top-island-bubble__notification-copy">
                  {notification.content || "No message body"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="top-island-bubble__summary">No unread notifications.</p>
        )}
      </div>
    );
  }

  function renderQuickReplyBody() {
    return (
      <div className="top-island-bubble__body top-island-bubble__body--quick-reply">
        <label className="top-island-bubble__reply-label" htmlFor="top-island-quick-reply">
          {`Reply to ${replyTargetLabel}`}
        </label>
        <textarea
          id="top-island-quick-reply"
          className="top-island-bubble__reply-input"
          value={replyDraft}
          onChange={(event) => setReplyDraft(event.currentTarget.value)}
          placeholder={
            primaryAgent
              ? `Message ${replyTargetLabel}`
              : "Open a workspace agent before replying"
          }
          disabled={!primaryAgent}
          rows={2}
        />
        <div className="top-island-bubble__reply-actions">
          <button
            type="button"
            onClick={handleOpenDiscussion}
            className="top-island-popover__button top-island-bubble__button top-island-popover__button--primary top-island-bubble__button--primary"
          >
            Open Discussion
          </button>
        </div>
      </div>
    );
  }

  function renderBody() {
    if (view === "notifications") return renderNotificationsBody();
    if (view === "quick_reply") return renderQuickReplyBody();
    return renderDetailsBody();
  }

  return (
    <div
      ref={popoverRef}
      className="fixed top-island-popover top-island-bubble compact-detail"
      data-view={view}
      onMouseLeave={onClose}
      style={{
        zIndex: 2147483647,
        left: bubblePosition.left,
        top: bubblePosition.top,
        "--top-island-popover-width": px(BUBBLE_WIDTH),
        "--top-island-popover-measure-height": px(BUBBLE_HEIGHT),
        "--top-island-popover-body-max-height": px(
          COMPACT_WINDOW_METRICS.topIsland.popoverBodyMaxHeight
        ),
      } as CSSProperties}
    >
      <div className="top-island-bubble__eyebrow-row">
        <span className="top-island-bubble__eyebrow">{formatViewTitle(view)}</span>
        <span className="top-island-bubble__status" data-visual-state={visualState}>
          {formatStatusLabel(visualState)}
        </span>
      </div>

      {renderBody()}

      {permissionRequest && (
        <div className="top-island-bubble__permission-actions">
          <button
            type="button"
            onClick={() => void handlePermissionDecision("approve")}
            className="top-island-popover__button top-island-bubble__button top-island-popover__button--primary top-island-bubble__button--primary"
            disabled={pendingDecision !== null}
          >
            Allow
          </button>
          <button
            type="button"
            onClick={() => void handlePermissionDecision("deny")}
            className="top-island-popover__button top-island-bubble__button top-island-popover__button--secondary top-island-bubble__button--secondary"
            disabled={pendingDecision !== null}
          >
            Deny
          </button>
        </div>
      )}

      <div className="top-island-bubble__footer">
        <button
          type="button"
          onClick={onRestoreWorkspace}
          className="top-island-popover__button top-island-bubble__button top-island-popover__button--primary top-island-bubble__button--primary"
        >
          Open Workspace
        </button>
        <button
          type="button"
          onClick={onClose}
          className="top-island-popover__button top-island-bubble__button top-island-popover__button--secondary top-island-bubble__button--secondary"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
