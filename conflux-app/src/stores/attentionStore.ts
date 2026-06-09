// ===== 注意力队列投影 store（控制面 P5 同源） =====
// 唯一真相源是后端 AttentionQueue（F1 §6）。本 store 仅做投影缓存：
//   - start() 时 list_attention_items 重放全量活跃项 + 订阅 attention_updated
//   - 收到快照后整体替换 items（不在前端拼装/派生状态）
// TopIsland / Sidebar / PermissionDialog 通过下面的 selector 同源读取，不再各自
// 维护 pendingPermissions / notificationForPermissionRequest 逻辑。

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { AttentionItem, InteractionKind } from "@/types/interaction";
import { listAttentionItems } from "@/lib/tauri-bridge";
import { onAttentionUpdated } from "@/lib/event-listener";

interface AttentionState {
  /** 后端投影的全量活跃注意力项（快照，后端已按优先级 + 时间排序）。 */
  items: AttentionItem[];
  /** 是否已完成首次重放/快照（区分"空"与"未加载"）。 */
  hydrated: boolean;
  /** 用后端快照整体替换（重放 + attention_updated 的唯一写入口）。 */
  replaceFromBackend: (items: AttentionItem[]) => void;
  /** 启动：list_attention_items 重放 + 订阅 attention_updated。返回 unlisten。 */
  start: () => Promise<() => void>;
}

export const useAttentionStore = create<AttentionState>((set) => ({
  items: [],
  hydrated: false,

  replaceFromBackend: (items) => set({ items, hydrated: true }),

  start: async () => {
    // 重放当前快照（与后端 list_active 同序）。后端不可用则退化为 hydrated 空。
    try {
      const items = await listAttentionItems();
      set({ items, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
    // 订阅未来快照；事件总线不可用（demo / 无后端）则静默退化。
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await onAttentionUpdated((items) => {
        set({ items, hydrated: true });
      });
    } catch {
      /* 无事件总线 */
    }
    return () => {
      unlisten?.();
    };
  },
}));

// ===== 纯 selector（测试 / 非 hook 复用） =====

/** 活跃项（resolution === null）。后端 list_active 已只返回活跃，这里再保证一次幂等。 */
export function activeItems(items: AttentionItem[]): AttentionItem[] {
  return items.filter((it) => it.resolution === null);
}

/** 按 kind 过滤的活跃项。 */
export function activeByKind(
  items: AttentionItem[],
  kind: InteractionKind
): AttentionItem[] {
  return items.filter((it) => it.resolution === null && it.kind === kind);
}

// ===== Hook selector（useShallow 防止新数组引用导致多余 re-render，组件统一从这里读） =====

/** 全部活跃注意力项。 */
export function useActiveAttentionItems(): AttentionItem[] {
  return useAttentionStore(useShallow((s) => activeItems(s.items)));
}

/** 活跃的权限请求（kind === "permission"）——取代 islandStore.pendingPermissions。 */
export function useActivePermissions(): AttentionItem[] {
  return useAttentionStore(useShallow((s) => activeByKind(s.items, "permission")));
}

/** 活跃项总数（TopIsland / CompactModeController 的 badge 计数）。 */
export function useActiveAttentionCount(): number {
  return useAttentionStore((s) => activeItems(s.items).length);
}
