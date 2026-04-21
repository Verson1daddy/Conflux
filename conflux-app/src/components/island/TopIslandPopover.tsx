import { type FC, useMemo, useState } from "react";
import { resolveTopIslandState } from "@/lib/compact-mode";
import { respondToPermission } from "@/lib/tauri-bridge";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore } from "@/stores/agentStore";
import type { PermissionDecision } from "@/types";

interface TopIslandPopoverProps {
  anchor: { x: number; y: number };
  onClose: () => void;
  onRestoreWorkspace: () => void;
}

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

export const TopIslandPopover: FC<TopIslandPopoverProps> = ({
  anchor,
  onClose,
  onRestoreWorkspace,
}) => {
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const notifications = useIslandStore((s) => s.notifications);
  const unreadCount = useIslandStore((s) => s.unreadCount);
  const removePermissionRequest = useIslandStore((s) => s.removePermissionRequest);
  const clearNotification = useIslandStore((s) => s.clearNotification);
  const instances = useAgentStore((s) => s.instances);
  const [pendingDecision, setPendingDecision] = useState<PermissionDecision | null>(null);

  const activeCount = useMemo(
    () =>
      Array.from(instances.values()).filter(
        (agent) =>
          agent.status === "thinking" ||
          agent.status === "coding" ||
          agent.status === "waiting_permission"
      ).length,
    [instances]
  );

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
      // Keep the request available so the user can retry from the popover.
    } finally {
      setPendingDecision(null);
    }
  }

  return (
    <div
      className="fixed top-island-popover compact-detail"
      style={{
        zIndex: 40,
        left: anchor.x,
        top: anchor.y,
      }}
    >
      <div className="top-island-popover__header">
        <span className="top-island-popover__badge">Dynamic Island</span>
        <span
          className="top-island-popover__status"
          data-visual-state={visualState}
        >
          {formatStatusLabel(visualState)}
        </span>
      </div>

      <div className="top-island-popover__section">
        <span className="top-island-popover__label">Mode</span>
        <span className="top-island-popover__value">Top-centered capsule</span>
      </div>

      <div className="top-island-popover__section">
        <span className="top-island-popover__label">Status</span>
        <span className="top-island-popover__value">
          {activeCount} active · {pendingPermissions.length} permission · {unreadCount} unread
        </span>
      </div>

      <div className="top-island-popover__section">
        <span className="top-island-popover__label">Summary</span>
        <span className="top-island-popover__value">{summary}</span>
      </div>

      {permissionRequest && (
        <div className="top-island-popover__permission-actions">
          <button
            type="button"
            onClick={() => void handlePermissionDecision("approve")}
            className="top-island-popover__button top-island-popover__button--primary"
            disabled={pendingDecision !== null}
          >
            Allow
          </button>
          <button
            type="button"
            onClick={() => void handlePermissionDecision("deny")}
            className="top-island-popover__button top-island-popover__button--secondary"
            disabled={pendingDecision !== null}
          >
            Deny
          </button>
        </div>
      )}

      <div className="top-island-popover__footer">
        <button
          type="button"
          onClick={onRestoreWorkspace}
          className="top-island-popover__button top-island-popover__button--primary"
        >
          Open Workspace
        </button>
        <button
          type="button"
          onClick={onClose}
          className="top-island-popover__button top-island-popover__button--secondary"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
