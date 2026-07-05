import { type CSSProperties, type FC, useCallback, useMemo, useRef, useState } from "react";
import { startCurrentWindowDrag } from "@/lib/window-drag";
import { useIslandStore } from "@/stores/islandStore";
import {
  useActivePermissions,
  useDeferredAttentionItems,
} from "@/stores/attentionStore";
import { useAgentStore, agentDisplayLabel } from "@/stores/agentStore";
import {
  focusAgentCard,
  respondToPermission,
  ignoreAttentionItem,
} from "@/lib/tauri-bridge";
import { executeJumpBack } from "@/lib/jump-back";
import { COMPACT_WINDOW_METRICS, px } from "@/lib/compact-window-metrics";
import { getLiveAgentInstances } from "@/lib/workspace-status";
import {
  formatPermissionSummary,
  formatRelativeTime,
} from "@/lib/attention-format";
import type { AgentStatus, NotificationItem, PermissionDecision } from "@/types";
import type { AttentionItem } from "@/types/interaction";
import { Icon } from "@/components/ui/Icon";
import { ConfluxBrandMark } from "./ConfluxBrandMark";

interface SidebarProps {
  expanded: boolean;
  onCollapse: () => void;
  onOpenWorkspace: () => void;
  onUndock?: () => void;
  onDragStart?: () => void;
}

/** deferred 提醒时刻（HH:MM；异常无 remind_at 显示占位）。 */
function formatRemindTime(remindAt: number | null): string {
  if (!remindAt) return "—";
  return new Date(remindAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_DOT_COLORS: Record<AgentStatus, string> = {
  idle: "#6B7280",
  thinking: "#F5B547",
  coding: "#4ADE80",
  waiting_permission: "#F5B547",
  done: "#4ADE80",
  error: "#FF6B60",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  thinking: "Thinking…",
  coding: "Writing…",
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

function notificationPresentation(notification: NotificationItem) {
  if (notification.level === "permission_required") {
    return { icon: <Icon name="shield" size={16} />, tone: "warning", title: "Permission Request" } as const;
  }
  if (notification.level === "error") {
    return { icon: <Icon name="alert" size={16} />, tone: "error", title: notification.source_adapter_name || "Error" } as const;
  }
  return { icon: <Icon name="check" size={16} />, tone: "info", title: notification.source_adapter_name || "Task Complete" } as const;
}

/** 空态：没有运行中的 agent。诚实交代「还没有」+ 怎么接入，不编造运行数据、不用卡通吉祥物。 */
function SidebarEmptyAgentState() {
  return (
    <div className="sidebar-panel__empty-card" aria-label="还没有运行中的 agent">
      <span className="sidebar-panel__empty-glyph" aria-hidden="true">
        <Icon name="terminal" size={26} strokeWidth={1.6} />
      </span>
      <span className="sidebar-panel__empty-copy">
        <span className="sidebar-panel__empty-title">还没有运行中的 agent</span>
        <span className="sidebar-panel__empty-text">
          从顶栏「+ Add Agent」接入，运行状态会实时显示在这里
        </span>
      </span>
    </div>
  );
}

function SidebarEmptyNotificationState() {
  return <p className="sidebar-panel__empty-quiet">暂无需要处理的事项</p>;
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
  const deferredItems = useDeferredAttentionItems();
  const [deferredOpen, setDeferredOpen] = useState(false);
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
  // 活着的实例 id 集合——权限项的来源 agent 若不在其中即为「孤儿」（已退出/关闭），
  // 无法再注入 Y/N，必须给「清除请求」而不是假装能 Allow/Deny（与 TopIsland 同口径）。
  const liveIds = useMemo(
    () => new Set(agents.map((agent) => agent.instance_id)),
    [agents]
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

  const markPending = useCallback((key: string, on: boolean) => {
    if (on) {
      pendingRef.current.add(key);
      setPendingIds((prev) => new Set(prev).add(key));
    } else {
      pendingRef.current.delete(key);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const handlePermissionDecision = useCallback(
    async (item: AttentionItem, decision: PermissionDecision) => {
      if (!item.interaction_id) return;
      const key = item.attention_item_id;
      if (pendingRef.current.has(key)) return;

      markPending(key, true);
      try {
        // 唯一注入路径（MF-1）：注入 + 后端 resolve 对应 AttentionItem + emit 新快照。
        // 不在前端手动移除——attentionStore 收到 attention_updated 后整体替换、自然丢弃。
        await respondToPermission(item.instance_id, item.interaction_id, decision);
      } catch {
        // Keep the permission request visible so the user can retry.
      } finally {
        markPending(key, false);
      }
    },
    [markPending]
  );

  // 逃生口：从注意力队列清除本请求（不向 agent 注入）。孤儿权限的唯一出路，
  // 也给活跃权限一个「卡住就清掉」的退路。走后端 ignore（落审计 + emit 新快照）。
  const handleClearRequest = useCallback(
    async (item: AttentionItem) => {
      const key = item.attention_item_id;
      if (pendingRef.current.has(key)) return;

      markPending(key, true);
      try {
        await ignoreAttentionItem(item.attention_item_id);
      } catch {
        // 后端不可用（demo）：静默，快照不变。
      } finally {
        markPending(key, false);
      }
    },
    [markPending]
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
          <Icon name="move" size={16} />
        </button>
        <button
          type="button"
          className="sidebar-panel__dismiss"
          onClick={onCollapse}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          aria-label="Dismiss compact sidebar"
          title="Dismiss compact sidebar"
        >
          <Icon name="close" size={16} />
        </button>
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
              <span className="sidebar-panel__section-count">{attentionCount}</span>
            </div>

            <div className="sidebar-panel__list">
              {visiblePermissions.length === 0 && activityNotifications.length === 0 ? (
                <SidebarEmptyNotificationState />
              ) : (
                <>
                  {visiblePermissions.map((item) => {
                    const isPending = pendingIds.has(item.attention_item_id);
                    const isOrphaned = !liveIds.has(item.instance_id);
                    const canRespond = Boolean(item.interaction_id) && !isOrphaned;
                    const sourceAgent = agents.find(
                      (agent) => agent.instance_id === item.instance_id
                    );

                    return (
                      <div
                        key={item.attention_item_id}
                        className="sidebar-panel__notification sidebar-panel__notification--jumpable"
                        data-orphaned={isOrphaned ? "true" : undefined}
                        role="button"
                        tabIndex={0}
                        onClick={() => void handleJumpBack(item)}
                      >
                        <div
                          className="sidebar-panel__notification-icon"
                          data-level={isOrphaned ? "muted" : "warning"}
                          aria-hidden="true"
                        >
                          {isOrphaned ? <Icon name="power-off" size={16} /> : <Icon name="shield" size={16} />}
                        </div>

                        <div className="sidebar-panel__notification-copy">
                          <div className="sidebar-panel__notification-row">
                            <span className="sidebar-panel__notification-title">
                              {sourceAgent
                                ? agentDisplayLabel(sourceAgent)
                                : "权限请求"}
                            </span>
                            <span className="sidebar-panel__notification-time">
                              {formatRelativeTime(item.created_at)}
                            </span>
                          </div>

                          <p className="sidebar-panel__notification-body">
                            {formatPermissionSummary(item.payload_summary)}
                          </p>

                          {isOrphaned && (
                            <span className="sidebar-panel__orphan-note">
                              请求它的 agent 已退出，无法再回应
                            </span>
                          )}

                          {item.signal_source === "scrape" && (
                            <span
                              className="signal-scrape-badge"
                              title="此请求来自 PTY 刮屏推断（非 agent hook），可能误报，请核实终端后再批"
                            >
                              刮屏推断 · 可能误报
                            </span>
                          )}

                          <div className="sidebar-panel__permission-actions">
                            {isOrphaned ? (
                              <button
                                type="button"
                                className="sidebar-panel__mini-action sidebar-panel__mini-action--clear"
                                onClick={(e) => {
                                  e?.stopPropagation();
                                  void handleClearRequest(item);
                                }}
                                disabled={isPending}
                              >
                                清除请求
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="sidebar-panel__mini-action sidebar-panel__mini-action--approve"
                                  onClick={(e) => {
                                    e?.stopPropagation();
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
                                    e?.stopPropagation();
                                    void handlePermissionDecision(item, "deny");
                                  }}
                                  disabled={isPending || !canRespond}
                                >
                                  Deny
                                </button>
                              </>
                            )}
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
                              {formatRelativeTime(notification.created_at)}
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

              {deferredItems.length > 0 && (
                <>
                  <button
                    type="button"
                    className="sidebar-deferred-row"
                    data-testid="sidebar-deferred-row"
                    onClick={() => setDeferredOpen((v) => !v)}
                  >
                    已推迟 {deferredItems.length} 项 · 最近提醒{" "}
                    {formatRemindTime(deferredItems[0].remind_at)}
                  </button>
                  {deferredOpen &&
                    deferredItems.map((item) => (
                      <div key={item.attention_item_id} className="sidebar-deferred-item">
                        <span className="sidebar-deferred-item__summary">
                          {item.payload_summary}
                        </span>
                        <span className="sidebar-deferred-item__time">
                          {formatRemindTime(item.remind_at)}
                        </span>
                      </div>
                    ))}
                </>
              )}
            </div>
          </section>

          <div className="sidebar-panel__spring" aria-hidden="true" />

          <div className="sidebar-panel__footer">
            <button
              type="button"
              className="sidebar-panel__action sidebar-panel__action--primary"
              onClick={onOpenWorkspace}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <Icon name="maximize" size={16} />
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
