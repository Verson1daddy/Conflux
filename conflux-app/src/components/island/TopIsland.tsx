import { type FC, type MouseEvent, useMemo } from "react";
import { resolveTopIslandState } from "@/lib/compact-mode";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore } from "@/stores/agentStore";

interface TopIslandProps {
  onExpand: (anchor: { x: number; y: number }) => void;
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
      aria-hidden="true"
    >
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 12-8.58 3.91a2 2 0 0 1-1.66 0L3.18 12" opacity="0.6" />
      <path d="m22 17-8.58 3.91a2 2 0 0 1-1.66 0L3.18 17" opacity="0.3" />
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
      stroke="#FFB800"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFB800"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}

export const TopIsland: FC<TopIslandProps> = ({ onExpand }) => {
  const pendingPermissions = useIslandStore((s) => s.pendingPermissions);
  const notifications = useIslandStore((s) => s.notifications);
  const unreadCount = useIslandStore((s) => s.unreadCount);
  const instances = useAgentStore((s) => s.instances);

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

  const copy = useMemo(() => {
    if (visualState === "permission" && permissionRequest) {
      return {
        badge: "Permission",
        title: permissionRequest.description || permissionRequest.action,
        meta: `${pendingPermissions.length} request pending`,
        icon: <ShieldIcon />,
      };
    }

    if (visualState === "active") {
      const source = unreadNotification?.source_adapter_name || "Conflux";
      const title =
        unreadNotification?.content ||
        (activeCount > 0 ? `${activeCount} agents active` : `${unreadCount} unread updates`);

      return {
        badge: "Active",
        title,
        meta:
          unreadCount > 0
            ? `${source} · ${unreadCount} unread`
            : `${activeCount} agents running`,
        icon: <BoltIcon />,
      };
    }

    return {
      badge: "Idle",
      title: "All systems idle",
      meta: "Open workspace or review recent activity",
      icon: <LayersIcon size={13} />,
    };
  }, [
    activeCount,
    pendingPermissions.length,
    permissionRequest,
    unreadCount,
    unreadNotification,
    visualState,
  ]);

  const capsuleWidth =
    visualState === "permission" ? 400 : visualState === "active" ? 360 : 248;

  function handleExpand(event: MouseEvent<HTMLButtonElement>) {
    onExpand({
      x: event.clientX + 12,
      y: event.clientY - 12,
    });
  }

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden">
      <button
        type="button"
        onClick={handleExpand}
        className="top-island-capsule island-pressable"
        data-visual-state={visualState}
        style={{ width: capsuleWidth }}
      >
        <span className="top-island-capsule__icon">{copy.icon}</span>
        <span className="top-island-capsule__copy">
          <span className="top-island-capsule__eyebrow">{copy.badge}</span>
          <span className="top-island-capsule__title">{copy.title}</span>
        </span>
        <span className="top-island-capsule__meta">{copy.meta}</span>
      </button>
    </div>
  );
};
