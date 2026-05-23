import { useCallback, useEffect, useState } from "react";
import { useIslandStore } from "@/stores/islandStore";
import { useAgentStore } from "@/stores/agentStore";
import {
  getIslandMode,
  listAgentInstances,
  switchIslandMode,
} from "@/lib/tauri-bridge";
import {
  readPersistedIslandMode,
  shouldApplyBackendIslandModeHydration,
} from "@/lib/island-mode-preference";
import {
  onErrorOccurred,
  onIslandModeChanged,
  onPermissionRequested,
  onTaskCompleted,
} from "@/lib/event-listener";
import { showSystemNotification } from "@/lib/system-notifications";
import type { IslandMode, NotificationItem, NotificationLevel } from "@/types";

interface UseIslandModeOptions {
  preferBackendMode?: boolean;
}

function generateNotificationId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveAgentName(instanceId: string): string {
  return useAgentStore.getState().instances.get(instanceId)?.adapter_name ?? "";
}

function publishNotification(
  addNotification: (notification: NotificationItem) => void,
  notification: NotificationItem
) {
  addNotification(notification);
  void showSystemNotification({
    title: notification.source_adapter_name || "Conflux",
    body: notification.content,
    tag: notification.id,
  });
}

export function useIslandMode(options: UseIslandModeOptions = {}) {
  const mode = useIslandStore((s) => s.mode);
  const setMode = useIslandStore((s) => s.setMode);
  const addNotification = useIslandStore((s) => s.addNotification);
  const addPermissionRequest = useIslandStore((s) => s.addPermissionRequest);
  const [isHydrated, setIsHydrated] = useState(false);
  const preferBackendMode = options.preferBackendMode === true;

  useEffect(() => {
    let cancelled = false;
    const hydrationFallback = setTimeout(() => {
      if (!cancelled) {
        setIsHydrated(true);
      }
    }, 180);

    async function init() {
      try {
        const backendMode = await getIslandMode();
        const persistedMode = preferBackendMode ? null : readPersistedIslandMode();
        if (!cancelled) {
          if (
            shouldApplyBackendIslandModeHydration({
              persistedMode,
              backendMode,
            })
          ) {
            setMode(backendMode);
          }
          setIsHydrated(true);
        }
      } catch {
        // Keep local preference when backend is not ready yet.
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
      clearTimeout(hydrationFallback);
    };
  }, [preferBackendMode, setMode]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    onIslandModeChanged((backendMode) => {
      const persistedMode = preferBackendMode ? null : readPersistedIslandMode();
      if (
        shouldApplyBackendIslandModeHydration({
          persistedMode,
          backendMode,
        })
      ) {
        setMode(backendMode);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [preferBackendMode, setMode]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    onPermissionRequested((payload) => {
      const sourceAdapterName = resolveAgentName(payload.instance_id);
      addPermissionRequest({
        ...payload.request,
        created_at: payload.timestamp,
        source_adapter_name: sourceAdapterName,
      });
      void showSystemNotification({
        title: sourceAdapterName || "Conflux",
        body: `Permission needed: ${payload.request.action} - ${payload.request.description}`,
        tag: payload.request.id,
      });
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addNotification, addPermissionRequest]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    onErrorOccurred((payload) => {
      const level: NotificationLevel =
        payload.severity === "Warning" ? "warning" : "error";
      const notification: NotificationItem = {
        id: generateNotificationId(),
        level,
        source_instance_id: payload.instance_id,
        source_adapter_name: resolveAgentName(payload.instance_id),
        content: payload.error_message,
        actions: [{ label: "Dismiss", action_type: "dismiss" }],
        created_at: payload.timestamp,
        read: false,
      };

      publishNotification(addNotification, notification);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addNotification]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    onTaskCompleted((payload) => {
      const notification: NotificationItem = {
        id: generateNotificationId(),
        level: "info",
        source_instance_id: payload.instance_id,
        source_adapter_name: resolveAgentName(payload.instance_id),
        content: payload.summary || "Task completed",
        actions: [{ label: "Dismiss", action_type: "dismiss" }],
        created_at: payload.timestamp,
        read: false,
      };

      publishNotification(addNotification, notification);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addNotification]);

  const switchMode = useCallback(
    async (newMode: IslandMode) => {
      setMode(newMode);
      try {
        await switchIslandMode(newMode);
      } catch {
        // Keep local preference even if the backend call fails.
      }
    },
    [setMode]
  );

  return {
    mode,
    switchMode,
    listAgentInstances,
    isHydrated,
  };
}
