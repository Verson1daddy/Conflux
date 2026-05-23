import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem, PermissionRequest } from "@/types";

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

function permission(
  overrides: Partial<PermissionRequest> & { source_adapter_name?: string }
): PermissionRequest & { source_adapter_name?: string } {
  return {
    id: "perm-1",
    instance_id: "agent-1",
    action: "shell",
    description: "Approve shell command",
    raw_context: [],
    status: "pending",
    created_at: 1000,
    timeout_seconds: 120,
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
    pendingPermissions: [],
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

  it("deduplicates pending permission requests by id", async () => {
    const store = await loadFreshStore();

    store.getState().addPermissionRequest(
      permission({ id: "perm-1", description: "First copy" })
    );
    store.getState().addPermissionRequest(
      permission({ id: "perm-1", description: "Updated copy" })
    );

    const state = store.getState();
    expect(state.pendingPermissions).toHaveLength(1);
    expect(state.pendingPermissions[0].description).toBe("Updated copy");
  });

  it("adds a visible unread notification whenever a permission request is queued", async () => {
    const store = await loadFreshStore();

    store.getState().addPermissionRequest(
      permission({
        id: "perm-1",
        instance_id: "agent-1",
        action: "shell",
        description: "Approve shell command",
        created_at: 1234,
      })
    );

    const state = store.getState();
    expect(state.pendingPermissions).toHaveLength(1);
    expect(state.notifications).toEqual([
      expect.objectContaining({
        id: "perm-1",
        level: "permission_required",
        source_instance_id: "agent-1",
        content: "Permission needed: shell - Approve shell command",
        read: false,
        created_at: 1234,
      }),
    ]);
    expect(state.unreadCount).toBe(1);
  });

  it("removing a permission request also removes its mirrored notification and unread count", async () => {
    const store = await loadFreshStore();

    store.getState().addPermissionRequest(
      permission({
        id: "perm-1",
        instance_id: "agent-1",
        action: "shell",
        description: "Approve shell command",
        created_at: 1234,
      })
    );

    store.getState().removePermissionRequest("perm-1");

    const state = store.getState();
    expect(state.pendingPermissions).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
  });

  it("preserves the adapter name on permission request notifications", async () => {
    const store = await loadFreshStore();

    store.getState().addPermissionRequest(
      permission({
        id: "perm-1",
        instance_id: "agent-1",
        action: "shell",
        description: "Approve shell command",
        source_adapter_name: "Codex",
      })
    );

    expect(store.getState().notifications[0]).toEqual(
      expect.objectContaining({
        id: "perm-1",
        source_instance_id: "agent-1",
        source_adapter_name: "Codex",
      })
    );
  });
});
