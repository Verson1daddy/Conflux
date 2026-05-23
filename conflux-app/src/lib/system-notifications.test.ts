import { afterEach, describe, expect, it, vi } from "vitest";
import { showSystemNotification } from "./system-notifications";

describe("system notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when browser notifications are unavailable", async () => {
    vi.stubGlobal("window", {});

    await expect(
      showSystemNotification({ title: "Conflux", body: "No API" })
    ).resolves.toBe(false);
  });

  it("requests permission and shows a notification when granted", async () => {
    const created: Array<{ title: string; options?: NotificationOptions }> = [];

    class MockNotification {
      static permission: NotificationPermission = "default";
      static requestPermission = vi.fn(async () => {
        MockNotification.permission = "granted";
        return "granted" as NotificationPermission;
      });

      constructor(title: string, options?: NotificationOptions) {
        created.push({ title, options });
      }
    }

    vi.stubGlobal("window", { Notification: MockNotification });

    await expect(
      showSystemNotification({
        title: "Codex",
        body: "Task completed",
        tag: "notif-1",
      })
    ).resolves.toBe(true);

    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(created).toEqual([
      {
        title: "Codex",
        options: { body: "Task completed", tag: "notif-1" },
      },
    ]);
  });

  it("does not show a notification when permission is denied", async () => {
    const created: Array<{ title: string; options?: NotificationOptions }> = [];

    class MockNotification {
      static permission: NotificationPermission = "denied";
      static requestPermission = vi.fn();

      constructor(title: string, options?: NotificationOptions) {
        created.push({ title, options });
      }
    }

    vi.stubGlobal("window", { Notification: MockNotification });

    await expect(
      showSystemNotification({ title: "Codex", body: "Denied" })
    ).resolves.toBe(false);

    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});
