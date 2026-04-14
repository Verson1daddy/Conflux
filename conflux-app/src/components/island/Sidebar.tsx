// ===== Sidebar 组件 =====
// 灵动岛侧边栏态 420×full height
// 设计稿结构:
//   isTopBar (h:52): layers图标 + "Conflux" (Playfair Display 18px bold) | spacer | panel-right-close
//   isBody (flex-1, bg surface-dark-primary, p:16, gap:20):
//     AGENTS 区域 (gap:4) — 每项 padding [10,12], radius-md
//     NOTIFICATIONS 区域 (gap:8) — 图标圆圈 + 内容

import { type FC, useState, useCallback, useMemo, useRef } from "react";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore, agentDisplayLabel } from "@/stores/agentStore";
import { focusAgentCard, respondToPermission, togglePinInstance } from "@/lib/tauri-bridge";
import type { AgentStatus, PermissionDecision } from "@/types";

interface SidebarProps {
  visible: boolean;
  onCollapse: () => void;
}

const STATUS_DOT_COLORS: Record<AgentStatus, string> = {
  idle: "#6B7280",
  thinking: "#FFB800",
  coding: "#34C759",
  waiting_permission: "#FFB800",
  done: "#34C759",
  error: "#FF3B30",
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  thinking: "Thinking...",
  coding: "Writing...",
  waiting_permission: "Awaiting approval",
  done: "Done",
  error: "Error",
};

const Sidebar: FC<SidebarProps> = ({ visible, onCollapse }) => {
  const notifications = useIslandStore((s) => s.notifications);
  const removePermissionRequest = useIslandStore((s) => s.removePermissionRequest);
  const clearNotification = useIslandStore((s) => s.clearNotification);
  const instances = useAgentStore((s) => s.instances);
  const togglePin = useAgentStore((s) => s.togglePin);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());

  // 从 agentStore 读取 agents（保持和 canvas/TopBar 一致）
  // Pinned agents 排在顶部
  const agents = useMemo(() => {
    const all = Array.from(instances.values());
    return all.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return 0;
    });
  }, [instances]);

  const handleAgentClick = useCallback(async (id: string) => {
    try { await focusAgentCard(id); } catch { /* ignore */ }
  }, []);

  const handleTogglePin = useCallback(
    async (e: React.MouseEvent, instanceId: string) => {
      e.stopPropagation();
      // 即时本地反馈
      togglePin(instanceId);
      // 后端同步
      try { await togglePinInstance(instanceId); } catch { /* ignore */ }
    },
    [togglePin]
  );

  const handlePermissionDecision = useCallback(
    async (instanceId: string, permissionId: string, decision: PermissionDecision) => {
      if (pendingRef.current.has(permissionId)) return;
      pendingRef.current.add(permissionId);
      setPendingIds((prev) => new Set(prev).add(permissionId));
      try {
        await respondToPermission(instanceId, permissionId, decision);
      } catch { /* 即使失败也清理 UI */ } finally {
        pendingRef.current.delete(permissionId);
      }
      removePermissionRequest(permissionId);
      clearNotification(permissionId);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(permissionId);
        return next;
      });
    },
    [removePermissionRequest, clearNotification]
  );

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className={`
          fixed inset-0 z-30 bg-black/20 backdrop-blur-sm
          transition-opacity duration-300
          ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
        `}
        onClick={onCollapse}
        aria-hidden="true"
      />

      {/* 侧边栏面板 */}
      <div
        className={`
          fixed top-0 right-0 z-40 h-full w-[420px]
          flex flex-col overflow-hidden
          transition-transform duration-300
          ${visible ? "translate-x-0" : "translate-x-full"}
        `}
        style={{ background: "#050507", transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        role="complementary"
        aria-label="Island sidebar"
      >
        {/* ===== isTopBar h:52 ===== */}
        <div
          className="flex items-center shrink-0"
          style={{
            height: 52,
            padding: "0 20px",
            gap: 10,
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(24px)",
            borderBottom: "1px solid rgba(255,255,255,0.082)",
          }}
        >
          {/* Logo: layers icon + Conflux (Playfair Display) */}
          <div className="flex items-center" style={{ gap: 6 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B8D4E3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
              <path d="m22 12-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12" opacity="0.6" />
              <path d="m22 17-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17" opacity="0.3" />
            </svg>
            <span
              style={{
                fontFamily: "'Fraunces Variable', Georgia, serif",
                fontSize: 18,
                fontWeight: 700,
                color: "#F2F2F2",
              }}
            >
              Conflux
            </span>
          </div>

          <div className="flex-1" />

          {/* 关闭按钮 — panel-right-close */}
          <button
            className="transition-colors"
            style={{ color: "#6B7280" }}
            onClick={onCollapse}
            aria-label="Close sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M15 3v18" />
              <path d="m10 15 3-3-3-3" />
            </svg>
          </button>
        </div>

        {/* ===== isBody ===== */}
        <div
          className="flex-1 overflow-y-auto flex flex-col"
          style={{
            background: "#050507",
            padding: 16,
            gap: 20,
          }}
        >
          {/* AGENTS 区域 */}
          <div className="flex flex-col" style={{ gap: 4 }}>
            <span
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 1.5,
                color: "#6B7280",
                textTransform: "uppercase" as const,
                marginBottom: 8,
              }}
            >
              Agents
            </span>

            {agents.length === 0 ? (
              <p style={{ fontFamily: "'Geist Sans', sans-serif", fontSize: 11, color: "#6B7280", padding: "10px 12px" }}>
                No active agents
              </p>
            ) : (
              agents.map((agent) => (
                <button
                  key={agent.instance_id}
                  className="sidebar-agent-row flex items-center w-full text-left transition-colors"
                  style={{
                    padding: "10px 12px",
                    gap: 10,
                    borderRadius: 8,
                    background: agent.is_pinned ? "#1C1C1E" : "#0E0E10",
                    border: agent.is_pinned ? "1px solid #B8D4E3" : "1px solid transparent",
                  }}
                  onClick={() => handleAgentClick(agent.instance_id)}
                >
                  {/* Status dot — 8px */}
                  <span
                    className="shrink-0 rounded-full"
                    style={{
                      width: 8,
                      height: 8,
                      background: STATUS_DOT_COLORS[agent.status],
                    }}
                  />

                  {/* Agent info column */}
                  <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 2 }}>
                    <span
                      className="truncate"
                      style={{
                        fontFamily: "'Geist Sans', sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#F2F2F2",
                      }}
                    >
                      {agentDisplayLabel(agent)}
                    </span>
                    <span
                      className="truncate"
                      style={{
                        fontFamily: "'Geist Sans', sans-serif",
                        fontSize: 11,
                        color: "#6B7280",
                      }}
                    >
                      {STATUS_LABEL[agent.status]}
                    </span>
                  </div>

                  {/* Time */}
                  <span
                    className="shrink-0"
                    style={{
                      fontFamily: "'JetBrains Mono Variable', monospace",
                      fontSize: 11,
                      color: "#6B7280",
                    }}
                  >
                    {agent.status === "idle" ? "\u2014" : formatTime(agent.created_at)}
                  </span>

                  {/* Pin icon — hidden by default, only visible on row hover */}
                  <span
                    role="button"
                    aria-label={agent.is_pinned ? "Unpin" : "Pin"}
                    onClick={(e) => handleTogglePin(e, agent.instance_id)}
                    className={`shrink-0 flex items-center justify-center sidebar-pin ${agent.is_pinned ? "pinned" : ""}`}
                    style={{
                      width: 20,
                      height: 20,
                      color: agent.is_pinned ? "#B8D4E3" : "#6B7280",
                      cursor: "pointer",
                    }}
                    title={agent.is_pinned ? "Pinned (click to unpin)" : "Pin"}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill={agent.is_pinned ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 17v5" />
                      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                    </svg>
                  </span>
                </button>
              ))
            )}
          </div>

          {/* NOTIFICATIONS 区域 */}
          <div className="flex flex-col" style={{ gap: 8 }}>
            <span
              style={{
                fontFamily: "'Geist Sans', sans-serif",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 1.5,
                color: "#6B7280",
                textTransform: "uppercase" as const,
                marginBottom: 4,
              }}
            >
              Notifications
            </span>

            {notifications.length === 0 ? (
              <p style={{ fontFamily: "'Geist Sans', sans-serif", fontSize: 11, color: "#6B7280", padding: "10px 12px" }}>
                No notifications
              </p>
            ) : (
              notifications.slice(0, 10).map((notif) => {
                const isPermission = notif.level === "permission_required";
                const isError = notif.level === "error";
                const iconBg = isPermission
                  ? "rgba(255,184,0,0.125)"
                  : isError
                    ? "rgba(255,59,48,0.125)"
                    : "rgba(52,199,89,0.125)";
                const iconColor = isPermission
                  ? "#FFB800"
                  : isError
                    ? "#FF3B30"
                    : "#34C759";

                return (
                  <div
                    key={notif.id}
                    className="flex"
                    style={{
                      padding: "10px 12px",
                      gap: 10,
                      borderRadius: 8,
                      background: "#0E0E10",
                    }}
                  >
                    {/* Icon circle */}
                    <div
                      className="shrink-0 flex items-center justify-center"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9999,
                        background: iconBg,
                      }}
                    >
                      {isPermission ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 8v4M12 16h.01" />
                        </svg>
                      ) : isError ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="m15 9-6 6M9 9l6 6" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="m9 12 2 2 4-4" />
                        </svg>
                      )}
                    </div>

                    {/* Content column */}
                    <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
                      <span
                        style={{
                          fontFamily: "'Geist Sans', sans-serif",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#F2F2F2",
                        }}
                      >
                        {isPermission ? "Permission Request" : isError ? "Error" : "Task Complete"}
                      </span>
                      <span
                        className="truncate"
                        style={{
                          fontFamily: "'Geist Sans', sans-serif",
                          fontSize: 11,
                          color: "#6B7280",
                        }}
                      >
                        {notif.content}
                      </span>

                      {/* Allow/Deny 按钮 */}
                      {isPermission && (
                        <div className="flex items-center" style={{ gap: 8, marginTop: 4 }}>
                          <button
                            onClick={() => handlePermissionDecision(notif.source_instance_id, notif.id, "approve")}
                            disabled={pendingIds.has(notif.id)}
                            style={{
                              fontFamily: "'Geist Sans', sans-serif",
                              fontSize: 11,
                              fontWeight: 600,
                              color: "#FFFFFF",
                              background: "#34C759",
                              borderRadius: 9999,
                              padding: "4px 12px",
                              opacity: pendingIds.has(notif.id) ? 0.5 : 1,
                              cursor: pendingIds.has(notif.id) ? "not-allowed" : "pointer",
                            }}
                          >
                            Allow
                          </button>
                          <button
                            onClick={() => handlePermissionDecision(notif.source_instance_id, notif.id, "deny")}
                            disabled={pendingIds.has(notif.id)}
                            style={{
                              fontFamily: "'Geist Sans', sans-serif",
                              fontSize: 11,
                              color: "rgba(255,255,255,0.6)",
                              background: "rgba(255,255,255,0.063)",
                              borderRadius: 9999,
                              padding: "4px 12px",
                              opacity: pendingIds.has(notif.id) ? 0.5 : 1,
                              cursor: pendingIds.has(notif.id) ? "not-allowed" : "pointer",
                            }}
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
        </div>
      </div>
    </>
  );
};

function formatTime(timestamp: number): string {
  if (timestamp === 0) return "\u2014";
  const now = Date.now();
  const diff = now - timestamp;
  const totalSec = Math.floor(diff / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `0:${String(sec).padStart(2, "0")}`;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export { Sidebar };
