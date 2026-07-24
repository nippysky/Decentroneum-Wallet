import { removeRegistration } from "./db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100; // Expo's documented per-request limit

export type PushMessage = {
  to: string; // "ExponentPushToken[...]"
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Sends a batch of push messages via the Expo Push API. Tokens Expo reports
 * as no longer valid (DeviceNotRegistered — app uninstalled, etc.) are
 * pruned from our registrations table automatically.
 */
export async function sendPushNotifications(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  for (const batch of chunk(messages, BATCH_SIZE)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch.map((m) => ({ ...m, sound: "default" }))),
      });

      if (!res.ok) {
        console.error(`[expoPush] HTTP ${res.status} sending batch of ${batch.length}`);
        continue;
      }

      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];

      tickets.forEach((ticket, i) => {
        if (ticket.status === "error") {
          const msg = batch[i];
          console.error(`[expoPush] error for ${msg.to}: ${ticket.message}`);
          if (ticket.details?.error === "DeviceNotRegistered") {
            removeRegistration(msg.to);
          }
        }
      });
    } catch (err) {
      console.error("[expoPush] batch send failed:", err);
    }
  }
}
