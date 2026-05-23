import type { NotificationItem, PermissionRequest } from "@/types";

const FLOAT_PANEL_SNAPSHOT_KEY = "conflux.floatPanelSnapshot";

export interface FloatPanelSnapshot {
  notifications: NotificationItem[];
  pendingPermissions: PermissionRequest[];
  savedAt: number;
}

export function writeFloatPanelSnapshot(
  snapshot: Omit<FloatPanelSnapshot, "savedAt">
): void {
  if (typeof localStorage === "undefined") return;

  localStorage.setItem(
    FLOAT_PANEL_SNAPSHOT_KEY,
    JSON.stringify({
      ...snapshot,
      savedAt: Date.now(),
    })
  );
}

export function readFloatPanelSnapshot(): FloatPanelSnapshot {
  if (typeof localStorage === "undefined") {
    return { notifications: [], pendingPermissions: [], savedAt: 0 };
  }

  try {
    const raw = localStorage.getItem(FLOAT_PANEL_SNAPSHOT_KEY);
    if (!raw) {
      return { notifications: [], pendingPermissions: [], savedAt: 0 };
    }

    const parsed = JSON.parse(raw) as Partial<FloatPanelSnapshot>;
    return {
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      pendingPermissions: Array.isArray(parsed.pendingPermissions)
        ? parsed.pendingPermissions
        : [],
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return { notifications: [], pendingPermissions: [], savedAt: 0 };
  }
}
