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
import {
  respondToPermission,
  ignoreAttentionItem,
  setTopIslandPopoverHeight,
} from "@/lib/tauri-bridge";
import { executeJumpBack } from "@/lib/jump-back";
import { formatPermissionSummary } from "@/lib/attention-format";
import { useIslandStore } from "@/stores/islandStore";
import { useActivePermissions } from "@/stores/attentionStore";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentInstanceInfo, NotificationItem, PermissionDecision } from "@/types";
import { ConfluxBrandMark } from "./ConfluxBrandMark";

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
  // 同源（控制面 P5）：权限态从后端 AttentionQueue 投影读取。
  const permissions = useActivePermissions();
  const notifications = useIslandStore((s) => s.notifications);
  const unreadCount = useIslandStore((s) => s.unreadCount);
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

  const permissionRequest = permissions[0];
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

  // 权限请求的来源 agent 是否仍活着。孤儿权限（agent 已退出/关闭）无法再注入 Y/N，
  // Allow/Deny 会静默失败并把请求永久卡在队列里——此时必须能「清除」而非「回应」。
  const permissionAgent = useMemo(
    () =>
      permissionRequest
        ? liveAgents.find(
            (agent) => agent.instance_id === permissionRequest.instance_id
          )
        : undefined,
    [liveAgents, permissionRequest]
  );
  const isPermissionOrphaned = Boolean(permissionRequest) && !permissionAgent;

  const visualState = useMemo(
    () =>
      resolveTopIslandState({
        activeCount,
        permissionCount: permissions.length,
        unreadCount,
      }),
    [activeCount, permissions.length, unreadCount]
  );

  const summary = useMemo(() => {
    if (visualState === "permission" && permissionRequest) {
      return permissionRequest.payload_summary;
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
    permissions.length,
    unreadNotifications.length,
    replyDraft,
    summary,
    isPermissionOrphaned,
  ]);

  async function handlePermissionDecision(decision: PermissionDecision) {
    if (!permissionRequest || pendingDecisionRef.current) {
      return;
    }

    pendingDecisionRef.current = true;
    setPendingDecision(decision);

    try {
      if (isPermissionOrphaned || !permissionRequest.interaction_id) {
        // 孤儿权限（agent 已退出）/ 无 interaction：没有活着的 PTY 可注入 Y/N，
        // 不假装回应——直接从注意力队列清除，避免请求永久卡住。
        await ignoreAttentionItem(permissionRequest.attention_item_id);
      } else {
        // 唯一注入路径（MF-1）：注入 + 后端 resolve 对应 AttentionItem + emit 新快照。
        // 不在前端移除，attentionStore 收到 attention_updated 后整体替换、自然丢弃已处置项。
        await respondToPermission(
          permissionRequest.instance_id,
          permissionRequest.interaction_id,
          decision
        );
      }
    } catch {
      // 保留请求，用户可重试或点「清除请求」。
    } finally {
      pendingDecisionRef.current = false;
      setPendingDecision(null);
    }
  }

  // 逃生口：无条件从注意力队列清除本请求（不注入 agent）。用于孤儿权限，
  // 或用户就是想忽略这条。走后端 ignore（落审计 + emit 新快照，前端不本地删）。
  async function handleClearRequest() {
    if (!permissionRequest || pendingDecisionRef.current) {
      return;
    }
    pendingDecisionRef.current = true;
    setPendingDecision("deny");
    try {
      await ignoreAttentionItem(permissionRequest.attention_item_id);
    } catch {
      /* 后端不可用（demo）：静默，快照不变 */
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
    // 权限态：给用户真正要看的——哪个 agent、请求什么、是否已成孤儿——
    // 而不是「Mode: Top-centered capsule」这类内部调试字段。
    if (visualState === "permission" && permissionRequest) {
      return (
        <div className="top-island-bubble__body">
          <div className="top-island-bubble__summary-row">
            <span className="top-island-bubble__label">Agent</span>
            <span className="top-island-bubble__value">
              {isPermissionOrphaned
                ? "已退出（孤儿请求）"
                : formatAgentLabel(permissionAgent)}
            </span>
          </div>
          <p className="top-island-bubble__summary">
            {formatPermissionSummary(permissionRequest.payload_summary)}
          </p>
          {isPermissionOrphaned && (
            <p className="top-island-bubble__hint">
              请求它的 agent 已经退出，无法再回应——点「清除请求」把它移出队列。
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="top-island-bubble__body">
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
      <div className="top-island-bubble__brand-row">
        <span className="top-island-bubble__brand-mark" aria-hidden="true">
          <ConfluxBrandMark artwork="light" />
        </span>
        <span className="top-island-bubble__brand-copy">
          <span className="top-island-bubble__brand-title">Conflux attention</span>
          <span className="top-island-bubble__eyebrow">{formatViewTitle(view)}</span>
        </span>
        <span className="top-island-bubble__status" data-visual-state={visualState}>
          {formatStatusLabel(visualState)}
        </span>
      </div>

      {renderBody()}

      {permissionRequest && permissionRequest.signal_source === "scrape" && (
        <span
          className="signal-scrape-badge"
          title="此请求来自 PTY 刮屏推断（非 agent hook），可能误报，请核实终端后再批"
        >
          刮屏推断 · 可能误报
        </span>
      )}

      {permissionRequest && (
        <div className="top-island-bubble__permission-actions">
          {isPermissionOrphaned ? (
            // 孤儿权限：Allow/Deny 无处可发，主操作直接是「清除请求」。
            <button
              type="button"
              onClick={() => void handleClearRequest()}
              className="top-island-popover__button top-island-bubble__button top-island-popover__button--primary top-island-bubble__button--primary"
              disabled={pendingDecision !== null}
            >
              清除请求
            </button>
          ) : (
            <>
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
            </>
          )}
          {permissionRequest.jump_back_target_id && (
            <button
              type="button"
              onClick={() => {
                void executeJumpBack(permissionRequest.jump_back_target_id!).catch(() => {});
                void onRestoreWorkspace();
              }}
              className="top-island-popover__button top-island-bubble__button top-island-popover__button--secondary top-island-bubble__button--secondary"
            >
              Jump
            </button>
          )}
          {!isPermissionOrphaned && (
            // 活跃权限也给个逃生口：卡住 / 就是想忽略时，清出队列而不回应 agent。
            <button
              type="button"
              onClick={() => void handleClearRequest()}
              className="top-island-popover__button top-island-bubble__button top-island-popover__button--secondary top-island-bubble__button--secondary"
              disabled={pendingDecision !== null}
              title="从注意力队列移除本请求，不向 agent 注入回应"
            >
              清除
            </button>
          )}
        </div>
      )}

      <div className="top-island-bubble__footer">
        <button
          type="button"
          onClick={onRestoreWorkspace}
          className="top-island-popover__button top-island-bubble__button top-island-popover__button--primary top-island-bubble__button--primary"
        >
          Open workspace
        </button>
        <button
          type="button"
          onClick={onClose}
          className="top-island-popover__button top-island-bubble__button top-island-popover__button--secondary top-island-bubble__button--secondary"
          title="收起浮层（不影响队列里的请求）"
        >
          Close
        </button>
      </div>
    </div>
  );
};
