import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@/types";

function createStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function notification(overrides: Partial<NotificationItem>): NotificationItem {
  return {
    id: "notif-1",
    level: "info",
    source_instance_id: "agent-1",
    source_adapter_name: "Codex",
    content: "Task completed",
    actions: [],
    created_at: 1000,
    read: false,
    ...overrides,
  };
}

async function loadFreshStore() {
  vi.resetModules();
  vi.stubGlobal("localStorage", createStorageMock());
  const { useIslandStore } = await import("./islandStore");
  useIslandStore.setState({
    mode: "top_island",
    notifications: [],
    unreadCount: 0,
  });
  return useIslandStore;
}

describe("island store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps unreadCount equal to the unread notification list", async () => {
    const store = await loadFreshStore();

    store.getState().addNotification(notification({ id: "n1", read: false }));
    store.getState().addNotification(notification({ id: "n2", read: true }));
    expect(store.getState().unreadCount).toBe(1);

    store.getState().markRead("n1");
    expect(store.getState().unreadCount).toBe(0);

    store.getState().addNotification(notification({ id: "n3", read: false }));
    store.getState().clearNotification("n3");

    const state = store.getState();
    expect(state.unreadCount).toBe(
      state.notifications.filter((item) => !item.read).length
    );
  });

  it("upserts notifications with duplicate ids instead of double counting them", async () => {
    const store = await loadFreshStore();

    store.getState().addNotification(
      notification({ id: "perm-1", content: "First copy", read: false })
    );
    store.getState().addNotification(
      notification({ id: "perm-1", content: "Updated copy", read: false })
    );

    const state = store.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].content).toBe("Updated copy");
    expect(state.unreadCount).toBe(1);
  });

  it("does not expose any permission-queue surface (moved to attentionStore)", async () => {
    const store = await loadFreshStore();
    const state = store.getState() as unknown as Record<string, unknown>;

    // 控制面 P5：权限/注意力态唯一真相源是后端 AttentionQueue，islandStore 不再镜像。
    expect(state.pendingPermissions).toBeUndefined();
    expect(state.addPermissionRequest).toBeUndefined();
    expect(state.removePermissionRequest).toBeUndefined();
  });
});
