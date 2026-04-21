import { type FC, useCallback, useMemo, useRef, useState } from "react";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore, agentDisplayLabel } from "@/stores/agentStore";
import { focusAgentCard, respondToPermission } from "@/lib/tauri-bridge";
import type { AgentStatus, PermissionDecision } from "@/types";

interface SidebarProps {
  expanded: boolean;
  onCollapse: () => void;
  onOpenWorkspace: () => void;
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

export const Sidebar: FC<SidebarProps> = ({
  expanded,
  onCollapse,
  onOpenWorkspace,
}) => {
  const notifications = useIslandStore((s) => s.notifications);
  const removePermissionRequest = useIslandStore((s) => s.removePermissionRequest);
  const clearNotification = useIslandStore((s) => s.clearNotification);
  const instances = useAgentStore((s) => s.instances);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());

  const agents = useMemo(() => {
    return Array.from(instances.values()).sort((a, b) => a.created_at - b.created_at);
  }, [instances]);

  const summary = useMemo(() => {
    const activeCount = agents.filter((agent) => agent.status !== "idle").length;
    const permissionCount = notifications.filter(
      (notification) => notification.level === "permission_required",
    ).length;
    const unreadCount = notifications.filter((notification) => !notification.read).length;

    if (permissionCount > 0) {
      return `${permissionCount} approval request${permissionCount > 1 ? "s are" : " is"} waiting while ${activeCount} agent${activeCount === 1 ? "" : "s"} stay in motion.`;
    }
    if (unreadCount > 0) {
      return `${unreadCount} fresh update${unreadCount > 1 ? "s" : ""} ready to review without reopening the full workspace.`;
    }
    if (activeCount > 0) {
      return `${activeCount} agent${activeCount === 1 ? "" : "s"} still running. Reveal the panel when you need status, then dismiss it back into the edge.`;
    }
    return "No urgent activity. Keep the panel tucked away until you need a quick workspace pulse.";
  }, [agents, notifications]);

  const stats = useMemo(
    () => [
      { label: "Active", value: agents.filter((agent) => agent.status !== "idle").length },
      { label: "Alerts", value: notifications.filter((notification) => !notification.read).length },
      {
        label: "Permissions",
        value: notifications.filter(
          (notification) => notification.level === "permission_required",
        ).length,
      },
    ],
    [agents, notifications],
  );

  const handleAgentClick = useCallback(async (id: string) => {
    try {
      await focusAgentCard(id);
    } catch {
      // Ignore if workspace window is not ready yet.
    }
  }, []);

  const handlePermissionDecision = useCallback(
    async (
      instanceId: string,
      permissionId: string,
      decision: PermissionDecision,
    ) => {
      if (pendingRef.current.has(permissionId)) return;

      pendingRef.current.add(permissionId);
      setPendingIds((prev) => new Set(prev).add(permissionId));
      let completed = false;

      try {
        await respondToPermission(instanceId, permissionId, decision);
        completed = true;
      } catch {
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
      clearNotification(permissionId);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(permissionId);
        return next;
      });
    },
    [clearNotification, removePermissionRequest],
  );

  return (
    <aside
      aria-hidden={!expanded}
      className={expanded ? "sidebar-panel is-expanded" : "sidebar-panel"}
      data-testid="sidebar-panel"
    >
      <div className="sidebar-panel__brand">
        <div className="sidebar-panel__brand-mark" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
            <path d="m22 12-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12" opacity="0.6" />
            <path d="m22 17-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17" opacity="0.3" />
          </svg>
        </div>
        <div className="sidebar-panel__brand-copy">
          <span className="sidebar-panel__brand-name">Conflux</span>
          <span className="sidebar-panel__brand-meta">Compact Assistant</span>
        </div>
        <span className="sidebar-panel__edge-pill">Right Edge Reveal</span>
      </div>

      <section className="sidebar-panel__hero">
        <span className="sidebar-panel__eyebrow">Assistant</span>
        <h2 className="sidebar-panel__title">Compact workspace pulse</h2>
        <p className="sidebar-panel__summary">{summary}</p>

        <div className="sidebar-panel__stats" aria-label="Sidebar assistant stats">
          {stats.map((stat) => (
            <div key={stat.label} className="sidebar-panel__stat">
              <span className="sidebar-panel__stat-value">{stat.value}</span>
              <span className="sidebar-panel__stat-label">{stat.label}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-panel__actions">
          <button
            type="button"
            className="sidebar-panel__action sidebar-panel__action--primary"
            onClick={onOpenWorkspace}
          >
            Open Workspace
          </button>
          <button
            type="button"
            className="sidebar-panel__action sidebar-panel__action--secondary"
            onClick={onCollapse}
          >
            Dismiss
          </button>
        </div>
      </section>

      <div className="sidebar-panel__body">
        <section className="sidebar-panel__section">
          <div className="sidebar-panel__section-header">
            <span className="sidebar-panel__section-label">Agents</span>
            <span className="sidebar-panel__section-count">{agents.length}</span>
          </div>

          <div className="sidebar-panel__list">
            {agents.length === 0 ? (
              <p className="sidebar-panel__empty">No active agents</p>
            ) : (
              agents.map((agent) => (
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
                    {agent.status === "idle" ? "--" : formatElapsedTime(agent.created_at)}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="sidebar-panel__section">
          <div className="sidebar-panel__section-header">
            <span className="sidebar-panel__section-label">Notifications</span>
            <span className="sidebar-panel__section-count">
              {Math.min(notifications.length, 6)}
            </span>
          </div>

          <div className="sidebar-panel__list">
            {notifications.length === 0 ? (
              <p className="sidebar-panel__empty">No notifications</p>
            ) : (
              notifications.slice(0, 6).map((notif) => {
                const isPermission = notif.level === "permission_required";
                const isError = notif.level === "error";

                return (
                  <div key={notif.id} className="sidebar-panel__notification">
                    <div
                      className="sidebar-panel__notification-icon"
                      data-level={notif.level}
                      aria-hidden="true"
                    >
                      {isPermission ? "!" : isError ? "×" : "•"}
                    </div>

                    <div className="sidebar-panel__notification-copy">
                      <div className="sidebar-panel__notification-row">
                        <span className="sidebar-panel__notification-title">
                          {isPermission
                            ? "Permission Request"
                            : isError
                              ? "Error"
                              : "Task Complete"}
                        </span>
                        <span className="sidebar-panel__notification-time">
                          {formatNotificationTime(notif.created_at)}
                        </span>
                      </div>
                      <p className="sidebar-panel__notification-body">
                        {notif.content}
                      </p>

                      {isPermission && (
                        <div className="sidebar-panel__permission-actions">
                          <button
                            type="button"
                            className="sidebar-panel__mini-action sidebar-panel__mini-action--approve"
                            onClick={() =>
                              void handlePermissionDecision(
                                notif.source_instance_id,
                                notif.id,
                                "approve",
                              )
                            }
                            disabled={pendingIds.has(notif.id)}
                          >
                            Allow
                          </button>
                          <button
                            type="button"
                            className="sidebar-panel__mini-action"
                            onClick={() =>
                              void handlePermissionDecision(
                                notif.source_instance_id,
                                notif.id,
                                "deny",
                              )
                            }
                            disabled={pendingIds.has(notif.id)}
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
      </div>
    </aside>
  );
};
