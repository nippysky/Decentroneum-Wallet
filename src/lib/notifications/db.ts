// src/lib/notifications/db.ts
//
// Local, per-device notification log backed by SQLite (expo-sqlite). This is
// what powers the in-app notification list (bell icon on the Home screen) —
// separate from the OS notification banner itself (see local.ts), so a
// user can always scroll back through everything that's happened even if
// they swiped away or missed the system banner.
import * as SQLite from "expo-sqlite";

const DB_NAME = "dw_notifications.db";

export type StoredNotification = {
  id: string;
  title: string;
  body: string;
  data: string; // JSON-encoded
  createdAt: number;
  read: number; // 0 | 1
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          data TEXT NOT NULL DEFAULT '{}',
          createdAt INTEGER NOT NULL,
          read INTEGER NOT NULL DEFAULT 0
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function insertNotification(n: {
  id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      "INSERT OR REPLACE INTO notifications (id, title, body, data, createdAt, read) VALUES (?, ?, ?, ?, ?, 0)",
      n.id,
      n.title,
      n.body,
      JSON.stringify(n.data ?? {}),
      Date.now()
    );
  } catch {
    // Best-effort — never let local persistence break a notification.
  }
}

export async function listNotifications(limit = 50): Promise<StoredNotification[]> {
  try {
    const db = await getDb();
    return await db.getAllAsync<StoredNotification>(
      "SELECT * FROM notifications ORDER BY createdAt DESC LIMIT ?",
      limit
    );
  } catch {
    return [];
  }
}

export async function unreadNotificationCount(): Promise<number> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM notifications WHERE read = 0");
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync("UPDATE notifications SET read = 1 WHERE read = 0");
  } catch {
    // ignore
  }
}

export async function clearAllNotifications(): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync("DELETE FROM notifications");
  } catch {
    // ignore
  }
}

/**
 * Deletes only the notifications tied to one account (matched via the
 * JSON-encoded `data.accountId` field) — used when a single account is
 * removed (not a full device erase), so its activity doesn't linger in the
 * shared notification log after it's gone.
 */
export async function deleteNotificationsForAccount(accountId: string): Promise<void> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<{ id: string; data: string }>("SELECT id, data FROM notifications");
    const staleIds = rows
      .filter((r) => {
        try {
          return JSON.parse(r.data)?.accountId === accountId;
        } catch {
          return false;
        }
      })
      .map((r) => r.id);
    for (const id of staleIds) {
      await db.runAsync("DELETE FROM notifications WHERE id = ?", id);
    }
  } catch {
    // ignore
  }
}
