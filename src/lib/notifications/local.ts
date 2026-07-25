// src/lib/notifications/local.ts
import * as Notifications from "expo-notifications";
import { insertNotification } from "./db";

function genId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fires an OS notification banner AND persists it to the local SQLite log
 * that backs the in-app notification list (bell icon on Home). `data.route`
 * — an expo-router path — is what the bell list and the OS banner tap both
 * deep-link to; callers should always include one.
 */
export async function notifyLocal(opts: { title: string; body: string; data?: Record<string, unknown> }) {
  const id = genId();

  await insertNotification({ id, title: opts.title, body: opts.body, data: opts.data });

  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: opts.title, body: opts.body, data: { ...(opts.data ?? {}), notifId: id } },
      trigger: null, // fire immediately
    });
  } catch {
    // Best-effort — never let a notification failure break the app.
  }
}
