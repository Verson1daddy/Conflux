export interface SystemNotificationPayload {
  title: string;
  body: string;
  tag?: string;
}

function getBrowserNotification(): typeof Notification | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return typeof window.Notification === "function"
    ? window.Notification
    : undefined;
}

export async function showSystemNotification(
  payload: SystemNotificationPayload
): Promise<boolean> {
  const NotificationCtor = getBrowserNotification();

  if (!NotificationCtor) {
    return false;
  }

  try {
    let permission = NotificationCtor.permission;

    if (permission === "default" && typeof NotificationCtor.requestPermission === "function") {
      permission = await NotificationCtor.requestPermission();
    }

    if (permission !== "granted") {
      return false;
    }

    new NotificationCtor(payload.title, {
      body: payload.body,
      tag: payload.tag,
    });
    return true;
  } catch {
    return false;
  }
}
