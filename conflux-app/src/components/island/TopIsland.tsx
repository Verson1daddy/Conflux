import { type FC, useMemo, useState } from "react";
import { resolveTopIslandState } from "@/lib/compact-mode";
import { respondToPermission } from "@/lib/tauri-bridge";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore } from "@/stores/agentStore";
import type { PermissionDecision } from "@/types";

interface TopIslandProps {
  onExpand: () => void;
}

function LayersIcon({ color = "#B8D4E3", size = 14 }: { color?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 12-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12" opacity="0.6" />
      <path d="m22 17-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17" opacity="0.3" />
    </svg>
  );
}

export const TopIsland: FC<TopIslandProps> = ({ onExpand }) => {
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const notifications = useIslandStore((s) => s.notifications);
  const unreadCount = useIslandStore((s) => s.unreadCount);
  const removePermissionRequest = useIslandStore((s) => s.removePermissionRequest);
  const clearNotification = useIslandStore((s) => s.clearNotification);
  const instances = useAgentStore((s) => s.instances);
  const [pendingDecision, setPendingDecision] = useState<PermissionDecision | null>(null);

  const activeCount = useMemo(() => {
    return Array.from(instances.values()).filter((agent) =>
      agent.status === "thinking" || agent.status === "coding" || agent.status === "waiting_permission"
    ).length;
  }, [instances]);

  const permissionRequest = pendingPermissions[0];
  const unreadNotification = useMemo(
    () => notifications.find((notification) => !notification.read),
    [notifications]
  );

  const notificationLabel = useMemo(() => {
    if (!unreadNotification) {
      return null;
    }

    const source = unreadNotification.source_adapter_name || "Conflux";
    const suffix =
      unreadNotification.level === "error"
        ? "error"
        : unreadNotification.level === "permission_required"
          ? "needs approval"
          : "task done";

    return `${source} - ${suffix}`;
  }, [unreadNotification]);

  const visualState = useMemo(
    () =>
      resolveTopIslandState({
        activeCount,
        permissionCount: pendingPermissions.length,
        unreadCount,
      }),
    [activeCount, pendingPermissions.length, unreadCount]
  );

  async function handlePermissionDecision(decision: PermissionDecision) {
    if (!permissionRequest || pendingDecision) {
      return;
    }

    setPendingDecision(decision);
    try {
      await respondToPermission(permissionRequest.instance_id, permissionRequest.id, decision);
      removePermissionRequest(permissionRequest.id);
      clearNotification(permissionRequest.id);
    } catch {
      // Keep the request available so the user can retry.
    } finally {
      setPendingDecision(null);
    }
  }

  if (visualState === "permission" && permissionRequest) {
    return (
      <div className="w-full h-full flex items-center justify-center overflow-hidden">
        <div
          className="flex items-center gap-2 px-[18px] pr-[6px] rounded-full"
          style={{
            width: 400,
            height: 44,
            background: "#000000",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow:
              "0 0 20px rgba(184, 212, 227, 0.31), 0 4px 12px rgba(0, 0, 0, 0.38)",
          }}
        >
          <button
            type="button"
            onClick={onExpand}
            className="flex items-center gap-2 flex-1 min-w-0 bg-transparent"
            style={{ border: "none", padding: 0, cursor: "pointer" }}
          >
            <div
              className="shrink-0 flex items-center justify-center rounded-full"
              style={{ width: 32, height: 32, background: "rgba(184, 212, 227, 0.145)" }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FFB800"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0 flex flex-col items-start">
              <span
                style={{
                  color: "#FFFFFF",
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Permission Request
              </span>
              <span
                className="truncate w-full"
                style={{
                  color: "rgba(255,255,255,0.56)",
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 10,
                }}
              >
                {permissionRequest.description || permissionRequest.action}
              </span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => void handlePermissionDecision("approve")}
            disabled={pendingDecision !== null}
            style={{
              border: "none",
              borderRadius: 9999,
              padding: "5px 12px",
              background: "#34C759",
              color: "#FFFFFF",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              cursor: pendingDecision ? "not-allowed" : "pointer",
              opacity: pendingDecision ? 0.6 : 1,
            }}
          >
            Allow
          </button>
          <button
            type="button"
            onClick={() => void handlePermissionDecision("deny")}
            disabled={pendingDecision !== null}
            style={{
              border: "none",
              borderRadius: 9999,
              padding: "5px 12px",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.72)",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              cursor: pendingDecision ? "not-allowed" : "pointer",
              opacity: pendingDecision ? 0.6 : 1,
            }}
          >
            Deny
          </button>
        </div>
      </div>
    );
  }

  if (visualState === "active" && unreadNotification && unreadCount > 0 && notificationLabel) {
    return (
      <div className="w-full h-full flex items-center justify-center overflow-hidden">
        <button
          type="button"
          onClick={onExpand}
          className="flex items-center gap-[10px] px-[14px] pr-[10px] rounded-full"
          style={{
            width: 420,
            height: 40,
            border: "1px solid rgba(255,184,0,0.25)",
            background: "#000000",
            boxShadow:
              "0 0 24px rgba(255,184,0,0.27), 0 4px 12px rgba(0,0,0,0.38)",
            cursor: "pointer",
            transition:
              "transform var(--duration-fast) var(--ease-apple), box-shadow var(--duration-normal) var(--ease-apple)",
          }}
        >
          <span
            className="shrink-0 flex items-center justify-center rounded-full"
            style={{
              width: 22,
              height: 22,
              background: "#FFB800",
              color: "#0A0F15",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FFB800"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
          </svg>
          <span
            className="truncate"
            style={{
              color: "#FFFFFF",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: 0.3,
            }}
          >
            {notificationLabel}
          </span>
          <span className="flex-1" />
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.72)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3H8a2 2 0 0 0-2 2v6" />
            <path d="m13 16-5 5-5-5" />
            <path d="M8 21v-9" />
          </svg>
        </button>
      </div>
    );
  }

  if (visualState === "active" && activeCount > 0) {
    return (
      <div className="w-full h-full flex items-center justify-center overflow-hidden">
        <button
          type="button"
          onClick={onExpand}
          className="flex items-center justify-center gap-[10px] px-[18px] rounded-full"
          style={{
            width: 320,
            height: 40,
            border: "1px solid rgba(255,255,255,0.07)",
            background: "#000000",
            boxShadow:
              "0 0 14px rgba(184, 212, 227, 0.25), 0 4px 12px rgba(0, 0, 0, 0.38)",
            transition:
              "transform var(--duration-fast) var(--ease-apple), box-shadow var(--duration-normal) var(--ease-apple)",
            cursor: "pointer",
          }}
        >
          <span
            className="shrink-0 rounded-full"
            style={{ width: 7, height: 7, background: "#34C759" }}
          />
          <span
            style={{
              color: "#FFFFFF",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: 0.3,
            }}
          >
            {activeCount} Agents Active
          </span>
          <span
            style={{
              width: 1,
              height: 18,
              background: "rgba(255,255,255,0.125)",
            }}
          />
          <LayersIcon />
          <span
            style={{
              color: "#B8D4E3",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.6,
            }}
          >
            Conflux
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      <button
        type="button"
        onClick={onExpand}
        className="flex items-center justify-center gap-2 px-[14px] rounded-full"
        style={{
          width: 220,
          height: 36,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#000000",
          boxShadow:
            "0 0 14px rgba(184, 212, 227, 0.24), 0 4px 12px rgba(0, 0, 0, 0.38)",
          cursor: "pointer",
        }}
      >
        <LayersIcon size={12} />
        <span
          style={{
            color: "rgba(255,255,255,0.5)",
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          All Idle
        </span>
        <span
          style={{
            width: 1,
            height: 14,
            background: "rgba(255,255,255,0.08)",
          }}
        />
        <div className="flex items-center gap-1">
          <span className="rounded-full" style={{ width: 5, height: 5, background: "#6B7280" }} />
          <span className="rounded-full" style={{ width: 5, height: 5, background: "#6B7280" }} />
          <span className="rounded-full" style={{ width: 5, height: 5, background: "#6B7280" }} />
        </div>
      </button>
    </div>
  );
};
