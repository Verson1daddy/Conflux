import { type CSSProperties, type FC, useCallback, useMemo, useRef, useState } from "react";
import { startCurrentWindowDrag } from "@/lib/window-drag";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore, agentDisplayLabel } from "@/stores/agentStore";
import { focusAgentCard, respondToPermission } from "@/lib/tauri-bridge";
import { COMPACT_WINDOW_METRICS, px } from "@/lib/compact-window-metrics";
import { getLiveAgentInstances } from "@/lib/workspace-status";
import type { AgentStatus, NotificationItem, PermissionDecision } from "@/types";

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

function LayersIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 12-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12" opacity="0.6" />
      <path d="m22 17-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17" opacity="0.3" />
    </svg>
  );
}

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

export const Sidebar: FC<SidebarProps> = ({
  expanded,
  onCollapse,
  onOpenWorkspace,
  onUndock,
  onDragStart,
}) => {
  const notifications = useIslandStore((s) => s.notifications);
  const removePermissionRequest = useIslandStore((s) => s.removePermissionRequest);
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

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.read),
    [notifications]
  );

  const permissionNotifications = useMemo(
    () =>
      unreadNotifications.filter(
        (notification) => notification.level === "permission_required"
      ),
    [unreadNotifications]
  );

  const activityNotifications = useMemo(() => {
    const permissions = permissionNotifications.slice(0, 2);
    const nonPermissions = unreadNotifications
      .filter((notification) => notification.level !== "permission_required")
      .slice(0, Math.max(0, 4 - permissions.length));

    return [...permissions, ...nonPermissions];
  }, [permissionNotifications, unreadNotifications]);

  const visibleAgents = useMemo(() => agents.slice(0, 3), [agents]);

  const handleAgentClick = useCallback(async (id: string) => {
    try {
      await focusAgentCard(id);
    } catch {
      // Ignore if workspace window is not ready yet.
    }
  }, []);

  const handlePermissionDecision = useCallback(
    async (instanceId: string, permissionId: string, decision: PermissionDecision) => {
      if (pendingRef.current.has(permissionId)) return;

      pendingRef.current.add(permissionId);
      setPendingIds((prev) => new Set(prev).add(permissionId));
      let completed = false;

      try {
        await respondToPermission(instanceId, permissionId, decision);
        completed = true;
      } catch {
        // Keep the permission request visible so the user can retry.
      } finally {
        pendingRef.current.delete(permissionId);
      }

      if (!completed) {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(permissionId);
          return next;
        });
        return;
      }

      removePermissionRequest(permissionId);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(permissionId);
        return next;
      });
    },
    [removePermissionRequest]
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
      <header className="sidebar-panel__header">
        <div className="sidebar-panel__logo">
          <span className="sidebar-panel__logo-mark" aria-hidden="true">
            <LayersIcon />
          </span>
          <span className="sidebar-panel__header-title">Conflux</span>
        </div>

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
        <span className="sidebar-panel__header-spacer" aria-hidden="true" />
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
      </header>

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
        <div className="sidebar-panel__body sidebar-panel__body--stack">
          <p className="sidebar-panel__eyebrow">Assistant</p>
        <section className="sidebar-panel__section sidebar-panel__section--plain">
          <div className="sidebar-panel__section-header">
            <span className="sidebar-panel__section-label">Agents</span>
            <span className="sidebar-panel__section-count">{agents.length}</span>
          </div>

          <div className="sidebar-panel__list">
            {visibleAgents.length === 0 ? (
              <p className="sidebar-panel__empty">No active agents</p>
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

        <section className="sidebar-panel__section sidebar-panel__section--plain">
          <div className="sidebar-panel__section-header">
            <span className="sidebar-panel__section-label">Notifications</span>
            <span className="sidebar-panel__section-count">
              {unreadNotifications.length}
            </span>
          </div>

          <div className="sidebar-panel__list">
            {activityNotifications.length === 0 ? (
              <p className="sidebar-panel__empty">No unread notifications</p>
            ) : (
              activityNotifications.map((notification) => {
                const presentation = notificationPresentation(notification);
                const isPending = pendingIds.has(notification.id);

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

                      {notification.level === "permission_required" && (
                        <div className="sidebar-panel__permission-actions">
                          <button
                            type="button"
                            className="sidebar-panel__mini-action sidebar-panel__mini-action--approve"
                            onClick={() =>
                              void handlePermissionDecision(
                                notification.source_instance_id,
                                notification.id,
                                "approve"
                              )
                            }
                            disabled={isPending}
                          >
                            Allow
                          </button>
                          <button
                            type="button"
                            className="sidebar-panel__mini-action"
                            onClick={() =>
                              void handlePermissionDecision(
                                notification.source_instance_id,
                                notification.id,
                                "deny"
                              )
                            }
                            disabled={isPending}
                          >
                            Deny
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
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
            Open Workspace
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
