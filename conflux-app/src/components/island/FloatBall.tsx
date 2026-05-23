import { type CSSProperties, type FC, useMemo } from "react";
import { resolveFloatBallSemanticState } from "@/lib/compact-mode";
import { COMPACT_WINDOW_METRICS, px } from "@/lib/compact-window-metrics";
import { useIslandStore } from "@/stores/islandStore";

interface FloatBallProps {
  onToggleDetail: () => void;
}

type SemanticState = "normal" | "notification" | "error";

function FloatIcon({
  kind,
  color,
}: {
  kind: "layers" | "triangle-alert";
  color: string;
}) {
  if (kind === "triangle-alert") {
    return (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
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

  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
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

function semanticConfig(state: SemanticState) {
  switch (state) {
    case "notification":
      return { color: "#FFB800", icon: "layers" as const };
    case "error":
      return { color: "#FF3B30", icon: "triangle-alert" as const };
    default:
      return { color: "#B8D4E3", icon: "layers" as const };
  }
}

export const FloatBall: FC<FloatBallProps> = ({ onToggleDetail }) => {
  const notifications = useIslandStore((s) => s.notifications);
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);

  const derivedState = useMemo(() => {
    const unreadNotifications = notifications.filter((notification) => !notification.read);
    const unreadNotificationCount = unreadNotifications.length;
    const unreadPermissionNotificationIds = new Set(
      unreadNotifications
        .filter((notification) => notification.level === "permission_required")
        .map((notification) => notification.id)
    );
    const unmatchedPendingPermissions = pendingPermissions.filter(
      (permission) => !unreadPermissionNotificationIds.has(permission.id)
    ).length;
    const hasError = unreadNotifications.some((notification) => notification.level === "error");
    const badgeCount = unreadNotificationCount + unmatchedPendingPermissions;

    return {
      badgeCount,
      semanticState: resolveFloatBallSemanticState({
        unreadCount: badgeCount,
        hasError,
      }),
    };
  }, [notifications, pendingPermissions]);

  const config = semanticConfig(derivedState.semanticState);

  return (
    <div
      className="float-ball-shell"
      style={
        {
          "--float-ball-window-padding": px(
            COMPACT_WINDOW_METRICS.floatBall.windowPadding
          ),
        } as CSSProperties
      }
    >
      <button
        type="button"
        onClick={onToggleDetail}
        className="float-ball island-pressable"
        data-semantic-state={derivedState.semanticState}
        style={
          {
            "--float-ball-size": px(COMPACT_WINDOW_METRICS.floatBall.buttonSize),
          } as CSSProperties
        }
        aria-label="Open float ball details"
      >
        <span className="float-ball__orb" aria-hidden="true">
          <FloatIcon kind={config.icon} color={config.color} />
        </span>
        {derivedState.badgeCount > 0 && (
          <span
            aria-label={`Float ball activity count ${derivedState.badgeCount}`}
            className="float-ball__badge"
          >
            {derivedState.badgeCount > 9 ? "9+" : derivedState.badgeCount}
          </span>
        )}
      </button>
    </div>
  );
};
