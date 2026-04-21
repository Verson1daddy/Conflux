import { type FC, useMemo } from "react";
import { resolveFloatBallSemanticState } from "@/lib/compact-mode";
import { useIslandStore } from "@/stores/islandStore";

interface FloatBallPanelProps {
  onClose: () => void;
  onOpenWorkspace: () => void;
}

function formatSemanticLabel(state: "normal" | "notification" | "error") {
  switch (state) {
    case "notification":
      return "Notification";
    case "error":
      return "Error";
    default:
      return "Normal";
  }
}

function formatActivitySummary(input: {
  unreadNotificationCount: number;
  pendingPermissionCount: number;
}) {
  const segments: string[] = [];

  if (input.unreadNotificationCount > 0) {
    segments.push(`${input.unreadNotificationCount} unread notification${input.unreadNotificationCount > 1 ? "s" : ""}`);
  }
  if (input.pendingPermissionCount > 0) {
    segments.push(`${input.pendingPermissionCount} pending permission${input.pendingPermissionCount > 1 ? "s" : ""}`);
  }

  return segments.length > 0 ? segments.join(" · ") : "All clear. No unread notifications or pending permissions.";
}

export const FloatBallPanel: FC<FloatBallPanelProps> = ({
  onClose,
  onOpenWorkspace,
}) => {
  const notifications = useIslandStore((s) => s.notifications);
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.read),
    [notifications]
  );

  const semanticState = useMemo(
    () =>
      resolveFloatBallSemanticState({
        unreadCount: unreadNotifications.length + pendingPermissions.length,
        hasError: unreadNotifications.some((notification) => notification.level === "error"),
      }),
    [pendingPermissions.length, unreadNotifications]
  );

  const latestNotification = unreadNotifications[0];
  const latestPermission = pendingPermissions[0];

  return (
    <div
      data-testid="float-ball-panel"
      className="fixed compact-detail float-ball-panel"
      style={{ zIndex: 40 }}
    >
      <div className="float-ball-panel__anchor" aria-hidden="true" />

      <div className="float-ball-panel__header">
        <div className="float-ball-panel__eyebrow-group">
          <span className="float-ball-panel__badge">Float Ball</span>
          <span className="float-ball-panel__title">Assistant surface</span>
        </div>
        <span
          className="float-ball-panel__status"
          data-semantic-state={semanticState}
        >
          {formatSemanticLabel(semanticState)}
        </span>
      </div>

      <div className="float-ball-panel__section">
        <span className="float-ball-panel__label">Status summary</span>
        <span className="float-ball-panel__value">
          {formatActivitySummary({
            unreadNotificationCount: unreadNotifications.length,
            pendingPermissionCount: pendingPermissions.length,
          })}
        </span>
      </div>

      <div className="float-ball-panel__section">
        <span className="float-ball-panel__label">Recent activity</span>
        <div className="float-ball-panel__activity-list">
          <div className="float-ball-panel__activity-item">
            <span className="float-ball-panel__activity-type">Notification</span>
            <span className="float-ball-panel__activity-copy">
              {latestNotification?.content ||
                latestNotification?.source_adapter_name ||
                "No unread notifications."}
            </span>
          </div>
          <div className="float-ball-panel__activity-item">
            <span className="float-ball-panel__activity-type">Permission</span>
            <span className="float-ball-panel__activity-copy">
              {latestPermission?.description ||
                latestPermission?.action ||
                "No pending permission requests."}
            </span>
          </div>
        </div>
      </div>

      <div className="float-ball-panel__footer">
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="float-ball-panel__button float-ball-panel__button--primary"
        >
          Open Workspace
        </button>
        <button
          type="button"
          onClick={onClose}
          className="float-ball-panel__button float-ball-panel__button--secondary"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
