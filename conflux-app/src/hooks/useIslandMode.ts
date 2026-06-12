import { useCallback, useEffect, useState } from "react";
import { useIslandStore } from "@/stores/islandStore";
import { useAttentionStore } from "@/stores/attentionStore";
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
  onAttentionExpired,
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
  const [isHydrated, setIsHydrated] = useState(false);
  const preferBackendMode = options.preferBackendMode === true;

  // 控制面 P5：注意力态唯一真相源是后端 AttentionQueue。挂载时启动一次投影
  // （list_attention_items 重放 + attention_updated 订阅）；卸载时取消订阅。
  // 主窗与紧凑岛窗各自独立 webview，各跑一次互不影响（后端 emit 广播全窗）。
  useEffect(() => {
    let stop: (() => void) | null = null;
    let disposed = false;
    void useAttentionStore
      .getState()
      .start()
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        stop = unlisten;
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

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

  // 权限请求的队列态由 attentionStore 投影（后端 AttentionQueue）拥有，这里
  // 不再写入任何 store；仅触发一条瞬态 OS 通知（后台时把用户拉回处理）。
  // tag 用 request.id，OS 按 tag 去重，主窗/岛窗双订阅不会叠出两条。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    onPermissionRequested((payload) => {
      const sourceAdapterName = resolveAgentName(payload.instance_id);
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
  }, []);

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

  // spec §4.1：权限请求超时（sweep 落定 Expired）→ 通知中心条目。
  // id 用 attention_item_id 派生（幂等：双窗口/重复 emit 经 upsert 合一）。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    onAttentionExpired((items) => {
      for (const item of items) {
        const notification: NotificationItem = {
          id: `attention-expired-${item.attention_item_id}`,
          level: "warning",
          source_instance_id: item.instance_id,
          source_adapter_name: resolveAgentName(item.instance_id),
          content: `权限请求已超时（未处理）：${item.payload_summary}`,
          actions: [{ label: "Dismiss", action_type: "dismiss" }],
          created_at: item.resolved_at ?? Date.now(),
          read: false,
        };
        publishNotification(addNotification, notification);
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
