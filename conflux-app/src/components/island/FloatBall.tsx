import { type FC, useMemo } from "react";
import { resolveFloatBallSemanticState } from "@/lib/compact-mode";
import { useIslandStore } from "@/stores/islandStore";

interface FloatBallProps {
  onExpand: () => void;
}

type SemanticState = "normal" | "notification" | "error";

function semanticConfig(state: SemanticState) {
  switch (state) {
    case "notification":
      return {
        glow: "0 0 18px rgba(255, 184, 0, 0.25), 0 4px 10px rgba(0, 0, 0, 0.5)",
        color: "#FFB800",
        icon: "layers" as const,
      };
    case "error":
      return {
        glow: "0 0 18px rgba(255, 59, 48, 0.25), 0 4px 10px rgba(0, 0, 0, 0.5)",
        color: "#FF3B30",
        icon: "triangle-alert" as const,
      };
    default:
      return {
        glow: "0 0 18px rgba(184, 212, 227, 0.31), 0 4px 10px rgba(0, 0, 0, 0.5)",
        color: "#B8D4E3",
        icon: "layers" as const,
      };
  }
}

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
    >
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 12-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12" opacity="0.6" />
      <path d="m22 17-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17" opacity="0.3" />
    </svg>
  );
}

export const FloatBall: FC<FloatBallProps> = ({ onExpand }) => {
  const notifications = useIslandStore((s) => s.notifications);
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const unreadCount = useIslandStore((s) => s.unreadCount);

  const semanticState = useMemo<SemanticState>(() => {
    const hasError = notifications.some((n) => !n.read && n.level === "error");
    const hasNotificationActivity =
      pendingPermissions.length > 0 ||
      notifications.some((n) => !n.read && n.level !== "error");

    return resolveFloatBallSemanticState({
      unreadCount: hasNotificationActivity ? Math.max(unreadCount, 1) : 0,
      hasError,
    });
  }, [notifications, pendingPermissions, unreadCount]);

  const config = semanticConfig(semanticState);

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      <button
        type="button"
        onClick={onExpand}
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: 52,
          height: 52,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#000000",
          boxShadow: config.glow,
          cursor: "pointer",
          transition:
            "transform var(--duration-fast) var(--ease-apple), box-shadow var(--duration-normal) var(--ease-apple)",
        }}
      >
        <FloatIcon kind={config.icon} color={config.color} />
        {semanticState === "notification" && unreadCount > 0 && (
          <span
            className="absolute flex items-center justify-center rounded-full"
            style={{
              top: 4,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              background: "#FFB800",
              color: "#FFFFFF",
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
};
