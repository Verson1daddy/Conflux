// ===== 灵动岛模式管理 hook =====
// 负责：初始化模式、监听窗口 resize 自动切换、监听后端事件更新 store
// 所有事件监听在 useEffect 中注册，组件卸载时自动清理

import { useEffect, useCallback, useRef } from "react";
import { useIslandStore } from "@/stores/islandStore";
import {
  getIslandMode,
  switchIslandMode,
  listAgentInstances,
} from "@/lib/tauri-bridge";
import {
  onPermissionRequested,
  onErrorOccurred,
  onAgentStatusChanged,
} from "@/lib/event-listener";
import type { IslandMode, NotificationLevel } from "@/types";

/** 悬浮球自动切换的窗口宽度阈值（px） */
const FLOAT_BALL_BREAKPOINT = 1200;

/** 生成唯一通知 ID */
function generateNotificationId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * useIslandMode — 灵动岛模式管理 hook
 *
 * 功能：
 * 1. 初始化时从后端获取当前模式
 * 2. 监听窗口 resize，< 1200px 自动切换为 float_ball
 * 3. 监听 PermissionRequested 事件 → 添加到 pendingPermissions + 通知
 * 4. 监听 ErrorOccurred 事件 → 添加通知
 * 5. 监听 AgentStatusChanged 事件 → 添加通知
 * 6. 提供 switchMode 方法调用后端 + 更新 store
 */
export function useIslandMode() {
  const mode = useIslandStore((s) => s.mode);
  const setMode = useIslandStore((s) => s.setMode);
  const addNotification = useIslandStore((s) => s.addNotification);
  const addPermissionRequest = useIslandStore((s) => s.addPermissionRequest);

  // 保留用户手动选择的模式（resize 恢复时使用）
  const userPreferredModeRef = useRef<IslandMode>("top_island");
  // 标记当前是否因为窗口过窄处于 float_ball 模式
  const isAutoFloatRef = useRef(false);

  // ===== 初始化：获取后端当前模式 =====
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const backendMode = await getIslandMode();
        if (!cancelled) {
          setMode(backendMode);
          userPreferredModeRef.current = backendMode;
        }
      } catch {
        // 后端不可用时保持默认 top_island
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [setMode]);

  // ===== 窗口 resize 监听 =====
  useEffect(() => {
    function handleResize() {
      const width = window.innerWidth;
      if (width < FLOAT_BALL_BREAKPOINT) {
        if (!isAutoFloatRef.current) {
          isAutoFloatRef.current = true;
          setMode("float_ball");
          switchIslandMode("float_ball").catch(() => {
            // 后端切换失败时 store 已更新，不回退
          });
        }
      } else {
        if (isAutoFloatRef.current) {
          isAutoFloatRef.current = false;
          const restoreMode = userPreferredModeRef.current;
          setMode(restoreMode);
          switchIslandMode(restoreMode).catch(() => {
            // 后端切换失败时 store 已更新，不回退
          });
        }
      }
    }

    // 初次检测
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [setMode]);

  // ===== 事件监听：PermissionRequested =====
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onPermissionRequested((payload) => {
      // 添加到权限请求队列
      addPermissionRequest(payload.request);
      // 同时生成一条 permission_required 通知
      addNotification({
        id: generateNotificationId(),
        level: "permission_required" as NotificationLevel,
        source_instance_id: payload.instance_id,
        source_adapter_name: "",
        content: `Permission needed: ${payload.request.action} - ${payload.request.description}`,
        actions: [
          { label: "View", action_type: "view_details" },
        ],
        created_at: payload.timestamp,
        read: false,
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [addPermissionRequest, addNotification]);

  // ===== 事件监听：ErrorOccurred =====
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onErrorOccurred((payload) => {
      const level: NotificationLevel =
        payload.severity === "Warning" ? "warning" : "error";
      addNotification({
        id: generateNotificationId(),
        level,
        source_instance_id: payload.instance_id,
        source_adapter_name: "",
        content: payload.error_message,
        actions: [{ label: "Dismiss", action_type: "dismiss" }],
        created_at: payload.timestamp,
        read: false,
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [addNotification]);

  // ===== 事件监听：AgentStatusChanged =====
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onAgentStatusChanged((payload) => {
      // 只对关键状态变化生成通知
      const importantStatuses = ["error", "waiting_permission", "done"];
      if (importantStatuses.includes(payload.new_status)) {
        const level: NotificationLevel =
          payload.new_status === "error"
            ? "error"
            : payload.new_status === "waiting_permission"
              ? "warning"
              : "info";
        addNotification({
          id: generateNotificationId(),
          level,
          source_instance_id: payload.instance_id,
          source_adapter_name: "",
          content: `Agent status: ${payload.old_status} -> ${payload.new_status}`,
          actions: [{ label: "Dismiss", action_type: "dismiss" }],
          created_at: payload.timestamp,
          read: false,
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [addNotification]);

  // ===== switchMode：用户手动切换模式 =====
  const switchMode = useCallback(
    async (newMode: IslandMode) => {
      userPreferredModeRef.current = newMode;
      isAutoFloatRef.current = false;
      setMode(newMode);
      try {
        await switchIslandMode(newMode);
      } catch {
        // 后端调用失败时 store 已更新前端状态，避免回退导致闪烁
      }
    },
    [setMode]
  );

  return {
    mode,
    switchMode,
    listAgentInstances,
  };
}
