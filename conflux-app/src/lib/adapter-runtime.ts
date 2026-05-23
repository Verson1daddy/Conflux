import type { AdapterAuthStatus } from "@/types";

export type AdapterRuntimeBadgeId =
  | "installed"
  | "authenticated"
  | "runnable"
  | "session";

export type AdapterRuntimeBadgeTone = "ok" | "warn" | "muted";

export interface AdapterRuntimeBadge {
  id: AdapterRuntimeBadgeId;
  label: string;
  ok: boolean;
  tone: AdapterRuntimeBadgeTone;
  detail: string;
}

export function buildAdapterRuntimeBadges(
  status: AdapterAuthStatus | undefined,
  previewOnly: boolean
): AdapterRuntimeBadge[] {
  if (previewOnly) {
    return [
      previewBadge("installed", "Installed"),
      previewBadge("authenticated", "Authenticated"),
      previewBadge("runnable", "Runnable"),
      previewBadge("session", "Session"),
    ];
  }

  if (!status) {
    return [
      checkingBadge("installed", "Installed"),
      checkingBadge("authenticated", "Authenticated"),
      checkingBadge("runnable", "Runnable"),
      checkingBadge("session", "Session"),
    ];
  }

  return [
    runtimeBadge("installed", status.installed, status.install_message),
    runtimeBadge("authenticated", status.authenticated, status.auth_message),
    runtimeBadge("runnable", status.runnable, status.runtime_message),
    runtimeBadge("session", status.session_supported, status.session_message),
  ];
}

export function canCreateAdapter(
  status: AdapterAuthStatus | undefined,
  previewOnly: boolean
): boolean {
  return getCreateDisabledReason(status, previewOnly) === null;
}

export function getCreateDisabledReason(
  status: AdapterAuthStatus | undefined,
  previewOnly: boolean
): string | null {
  if (previewOnly) {
    return "Backend unavailable; preview adapters cannot be created.";
  }
  if (!status) {
    return "Checking adapter runtime...";
  }
  if (!status.installed) {
    return status.install_message || status.message || "Adapter binary is not installed.";
  }
  if (!status.authenticated) {
    return status.auth_message || status.message || "Adapter is not authenticated.";
  }
  if (!status.runnable) {
    return status.runtime_message || status.message || "Adapter is not runnable.";
  }
  return null;
}

function runtimeBadge(
  id: AdapterRuntimeBadgeId,
  ok: boolean,
  detail: string | null
): AdapterRuntimeBadge {
  const labels = RUNTIME_BADGE_LABELS[id];
  return {
    id,
    label: ok ? labels.ok : labels.unavailable,
    ok,
    tone: ok ? "ok" : labels.unavailableTone,
    detail: detail || (ok ? `${labels.ok} ready` : `${labels.unavailable} unavailable`),
  };
}

const RUNTIME_BADGE_LABELS: Record<
  AdapterRuntimeBadgeId,
  { ok: string; unavailable: string; unavailableTone: AdapterRuntimeBadgeTone }
> = {
  installed: { ok: "Installed", unavailable: "Not Installed", unavailableTone: "warn" },
  authenticated: { ok: "Authenticated", unavailable: "Auth Missing", unavailableTone: "warn" },
  runnable: { ok: "Runnable", unavailable: "Not Runnable", unavailableTone: "warn" },
  session: { ok: "Session", unavailable: "Session Pending", unavailableTone: "muted" },
};

function checkingBadge(id: AdapterRuntimeBadgeId, label: string): AdapterRuntimeBadge {
  return {
    id,
    label,
    ok: false,
    tone: "muted",
    detail: "Checking adapter runtime...",
  };
}

function previewBadge(id: AdapterRuntimeBadgeId, label: string): AdapterRuntimeBadge {
  return {
    id,
    label,
    ok: false,
    tone: "muted",
    detail: "Backend unavailable; preview only.",
  };
}
