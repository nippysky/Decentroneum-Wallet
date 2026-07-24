// src/lib/notifications/local.ts
import * as Notifications from "expo-notifications";

export async function notifyLocal(opts: { title: string; body: string; data?: Record<string, unknown> }) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: opts.title, body: opts.body, data: opts.data ?? {} },
      trigger: null, // fire immediately
    });
  } catch {
    // Best-effort — never let a notification failure break the app.
  }
}
