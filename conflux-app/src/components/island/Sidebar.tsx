import { type CSSProperties, type FC, useCallback, useMemo, useRef, useState } from "react";
import { startCurrentWindowDrag } from "@/lib/window-drag";
import { useIslandStore } from "@/stores/islandStore";
import { useActivePermissions } from "@/stores/attentionStore";
import { useAgentStore, agentDisplayLabel } from "@/stores/agentStore";
import { focusAgentCard, respondToPermission } from "@/lib/tauri-bridge";
import { executeJumpBack } from "@/lib/jump-back";
import { COMPACT_WINDOW_METRICS, px } from "@/lib/compact-window-metrics";
import { getLiveAgentInstances } from "@/lib/workspace-status";
import type { AgentStatus, NotificationItem, PermissionDecision } from "@/types";
import type { AttentionItem } from "@/types/interaction";
import { ConfluxBrandMark } from "./ConfluxBrandMark";

interface SidebarProps {
  expanded: boolean;
  onCollapse: () => void;
  onOpenWorkspace: () => void;
  onUndock?: () => void;
  onDragStart?: () => void;
}

const STATUS_DOT_COLORS: Record<AgentStatus, string> = {
  idle: "#6B7280",
  thinking: "#FFB800",
  coding: "#34C759",
  waiting_permission: "#FFB800",
  done: "#34C759",
  error: "#FF3B30",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  thinking: "Thinking...",
  coding: "Writing...",
  waiting_permission: "Awaiting approval",
  done: "Done",
  error: "Error",
};

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v18" />
      <path d="m7 8 5-5 5 5" />
      <path d="m7 16 5 5 5-5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function formatElapsedTime(timestamp: number): string {
  if (timestamp <= 0) return "--";

  const diff = Math.max(0, Date.now() - timestamp);
  const totalSec = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;

  if (minutes === 0) return `0:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatNotificationTime(timestamp: number): string {
  if (timestamp <= 0) return "just now";

  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin <= 0) return "just now";
  if (diffMin === 1) return "1 min ago";
  return `${diffMin} min ago`;
}

function notificationPresentation(notification: NotificationItem) {
  if (notification.level === "permission_required") {
    return {
      icon: <ShieldIcon />,
      tone: "warning",
      title: "Permission Request",
    } as const;
  }

  if (notification.level === "error") {
    return {
      icon: <AlertIcon />,
      tone: "error",
      title: notification.source_adapter_name || "Error",
    } as const;
  }

  return {
    icon: <CheckIcon />,
    tone: "info",
    title: notification.source_adapter_name || "Task Complete",
  } as const;
}

function SidebarEmptyAgentState() {
  return (
    <div className="sidebar-panel__empty-mascot" aria-label="暂时还没创建 agent 框架哦">
      <div className="sidebar-panel__mascot-figure" aria-hidden="true">
        <span className="sidebar-panel__mascot-hair" />
        <span className="sidebar-panel__mascot-face">
          <span className="sidebar-panel__mascot-eye sidebar-panel__mascot-eye--left" />
          <span className="sidebar-panel__mascot-eye sidebar-panel__mascot-eye--right" />
          <span className="sidebar-panel__mascot-mouth" />
        </span>
        <span className="sidebar-panel__mascot-bow" />
      </div>
      <span className="sidebar-panel__empty-copy">
        <span className="sidebar-panel__empty-title">暂时还没创建 agent 框架哦</span>
        <span className="sidebar-panel__empty-text">创建后会在这里显示运行状态和需要处理的事项</span>
      </span>
    </div>
  );
}

function SidebarEmptyNotificationState() {
  return (
    <p className="sidebar-panel__empty-quiet">暂无需要处理的事项</p>
  );
}

export const Sidebar: FC<SidebarProps> = ({
  expanded,
  onCollapse,
  onOpenWorkspace,
  onUndock,
  onDragStart,
}) => {
  const notifications = useIslandStore((s) => s.notifications);
  // 同源（控制面 P5）：待处理权限项从后端 AttentionQueue 投影读取，与 TopIsland 共用 selector。
  const permissions = useActivePermissions();
  const instances = useAgentStore((s) => s.instances);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());

  const agents = useMemo(
    () =>
      getLiveAgentInstances(instances).sort(
        (a, b) => b.last_activity_at - a.last_activity_at
      ),
    [instances]
  );

  // 活动通知（error / task-completed）：权限请求不再镜像进通知队列。
  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.read),
    [notifications]
  );

  // "Needs attention" = 待处理权限（同源投影，优先）+ 活动通知，整体限 4 条。
  const visiblePermissions = useMemo(() => permissions.slice(0, 2), [permissions]);
  const activityNotifications = useMemo(
    () => unreadNotifications.slice(0, Math.max(0, 4 - visiblePermissions.length)),
    [unreadNotifications, visiblePermissions.length]
  );
  const attentionCount = permissions.length + unreadNotifications.length;

  const visibleAgents = useMemo(() => agents.slice(0, 3), [agents]);

  const handleAgentClick = useCallback(async (id: string) => {
    try {
      await focusAgentCard(id);
    } catch {
      // Ignore if workspace window is not ready yet.
    }
  }, []);

  // jump-back（spec §2.2）：点击权限行 → 取落点广播主窗执行；
  // 旧数据无落点 → 退化为既有 focusAgentCard 聚焦。
  const handleJumpBack = useCallback(async (item: AttentionItem) => {
    try {
      if (item.jump_back_target_id) {
        await executeJumpBack(item.jump_back_target_id);
      } else {
        await focusAgentCard(item.instance_id);
      }
    } catch {
      // 主窗未就绪等场景静默；用户可重试。
    }
  }, []);

  const handlePermissionDecision = useCallback(
    async (item: AttentionItem, decision: PermissionDecision) => {
      if (!item.interaction_id) return;
      const key = item.attention_item_id;
      if (pendingRef.current.has(key)) return;

      pendingRef.current.add(key);
      setPendingIds((prev) => new Set(prev).add(key));

      try {
        // 唯一注入路径（MF-1）：注入 + 后端 resolve 对应 AttentionItem + emit 新快照。
        // 不在前端手动移除——attentionStore 收到 attention_updated 后整体替换、自然丢弃。
        await respondToPermission(item.instance_id, item.interaction_id, decision);
      } catch {
        // Keep the permission request visible so the user can retry.
      } finally {
        pendingRef.current.delete(key);
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    []
  );

  return (
    <aside
      aria-hidden={!expanded}
      className={expanded ? "sidebar-panel is-expanded" : "sidebar-panel"}
      data-testid="sidebar-panel"
      style={
        {
          ["--sidebar-rail-width" as const]: px(
            COMPACT_WINDOW_METRICS.sidebar.expandedWidth
          ),
        } as CSSProperties
      }
    >
      <div className="sidebar-panel__spine">
        <div
          className="sidebar-panel__drag-handle"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            onDragStart?.();
            void startCurrentWindowDrag();
          }}
          aria-hidden="true"
        />
        <button
          type="button"
          className="sidebar-panel__header-action"
          onClick={onUndock}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          aria-label="Undock compact sidebar"
          title="Undock compact sidebar"
          disabled={!onUndock}
        >
          <MoveIcon />
        </button>
        <button
          type="button"
          className="sidebar-panel__dismiss"
          onClick={onCollapse}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          aria-label="Dismiss compact sidebar"
        >
          <CloseIcon />
        </button>
      </div>

      <div
        className="sidebar-panel__band"
        style={
          {
            ["--sidebar-band-width" as const]: px(
              COMPACT_WINDOW_METRICS.sidebar.bandWidth
            ),
          } as CSSProperties
        }
      >
        <header className="sidebar-panel__header">
          <div className="sidebar-panel__logo">
            <span className="sidebar-panel__logo-mark" aria-hidden="true">
              <ConfluxBrandMark artwork="light" />
            </span>
            <span className="sidebar-panel__header-copy">
              <span className="sidebar-panel__header-title">Conflux</span>
              <span className="sidebar-panel__header-subtitle">Assistant rail</span>
            </span>
          </div>
        </header>
        <div className="sidebar-panel__body sidebar-panel__body--stack">
          <p className="sidebar-panel__eyebrow">Attention</p>
          <section className="sidebar-panel__section sidebar-panel__section--plain sidebar-panel__section--agents">
            <div className="sidebar-panel__section-header">
              <span className="sidebar-panel__section-label">Live agents</span>
              <span className="sidebar-panel__section-count">{agents.length}</span>
            </div>

            <div className="sidebar-panel__list">
              {visibleAgents.length === 0 ? (
                <SidebarEmptyAgentState />
              ) : (
                visibleAgents.map((agent) => (
                  <button
                    key={agent.instance_id}
                    type="button"
                    className="sidebar-panel__agent"
                    onClick={() => void handleAgentClick(agent.instance_id)}
                  >
                    <span
                      className="sidebar-panel__agent-dot"
                      style={{ background: STATUS_DOT_COLORS[agent.status] }}
                    />
                    <div className="sidebar-panel__agent-copy">
                      <span className="sidebar-panel__agent-name">
                        {agentDisplayLabel(agent)}
                      </span>
                      <span className="sidebar-panel__agent-status">
                        {STATUS_LABELS[agent.status]}
                      </span>
                    </div>
                    <span className="sidebar-panel__agent-time">
                      {agent.ended_at
                        ? "ended"
                        : agent.status === "idle"
                          ? "--"
                          : formatElapsedTime(agent.last_activity_at)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="sidebar-panel__section sidebar-panel__section--plain sidebar-panel__section--notifications">
          <div className="sidebar-panel__section-header">
            <span className="sidebar-panel__section-label">Needs attention</span>
            <span className="sidebar-panel__section-count">
              {attentionCount}
            </span>
          </div>

          <div className="sidebar-panel__list">
            {visiblePermissions.length === 0 && activityNotifications.length === 0 ? (
              <SidebarEmptyNotificationState />
            ) : (
              <>
                {visiblePermissions.map((item) => {
                  const isPending = pendingIds.has(item.attention_item_id);
                  const canRespond = Boolean(item.interaction_id);

                  return (
                    <div
                      key={item.attention_item_id}
                      className="sidebar-panel__notification sidebar-panel__notification--jumpable"
                      role="button"
                      tabIndex={0}
                      onClick={() => void handleJumpBack(item)}
                    >
                      <div
                        className="sidebar-panel__notification-icon"
                        data-level="warning"
                        aria-hidden="true"
                      >
                        <ShieldIcon />
                      </div>

                      <div className="sidebar-panel__notification-copy">
                        <div className="sidebar-panel__notification-row">
                          <span className="sidebar-panel__notification-title">
                            Permission Request
                          </span>
                          <span className="sidebar-panel__notification-time">
                            {formatNotificationTime(item.created_at)}
                          </span>
                        </div>

                        <p className="sidebar-panel__notification-body">
                          {item.payload_summary}
                          {item.signal_source === "scrape" && (
                            <span
                              className="signal-scrape-badge"
                              title="此请求来自 PTY 刮屏推断（非 agent hook），可能误报，请核实终端后再批"
                            >
                              刮屏推断 · 可能误报
                            </span>
                          )}
                        </p>

                        <div className="sidebar-panel__permission-actions">
                          <button
                            type="button"
                            className="sidebar-panel__mini-action sidebar-panel__mini-action--approve"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePermissionDecision(item, "approve");
                            }}
                            disabled={isPending || !canRespond}
                          >
                            Allow
                          </button>
                          <button
                            type="button"
                            className="sidebar-panel__mini-action"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePermissionDecision(item, "deny");
                            }}
                            disabled={isPending || !canRespond}
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {activityNotifications.map((notification) => {
                  const presentation = notificationPresentation(notification);

                  return (
                    <div key={notification.id} className="sidebar-panel__notification">
                      <div
                        className="sidebar-panel__notification-icon"
                        data-level={presentation.tone}
                        aria-hidden="true"
                      >
                        {presentation.icon}
                      </div>

                      <div className="sidebar-panel__notification-copy">
                        <div className="sidebar-panel__notification-row">
                          <span className="sidebar-panel__notification-title">
                            {presentation.title}
                          </span>
                          <span className="sidebar-panel__notification-time">
                            {formatNotificationTime(notification.created_at)}
                          </span>
                        </div>

                        <p className="sidebar-panel__notification-body">
                          {notification.content}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
          </section>

          <div className="sidebar-panel__footer">
            <button
              type="button"
              className="sidebar-panel__action sidebar-panel__action--primary"
              onClick={onOpenWorkspace}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              Open workspace
            </button>
            <button
              type="button"
              className="sidebar-panel__action sidebar-panel__action--secondary"
              onClick={onCollapse}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
