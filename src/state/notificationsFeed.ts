// src/state/notificationsFeed.ts
//
// Reactive view over the local SQLite notification log (src/lib/notifications/db.ts)
// — powers the bell icon's unread badge and the in-app notification list.
import { create } from "zustand";
import {
  clearAllNotifications,
  deleteNotificationsForAccount,
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
  type StoredNotification,
} from "@/src/lib/notifications/db";

export type FeedItem = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  data: Record<string, unknown>;
};

function parse(n: StoredNotification): FeedItem {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(n.data);
  } catch {
    // ignore malformed rows
  }
  return { id: n.id, title: n.title, body: n.body, createdAt: n.createdAt, read: n.read === 1, data };
}

type State = {
  items: FeedItem[];
  unread: number;

  /** Re-reads from SQLite — safe to call often (e.g. on screen focus). */
  refresh: () => Promise<void>;
  /** Marks everything read and refreshes — call when the notification sheet opens. */
  markAllRead: () => Promise<void>;
  clear: () => Promise<void>;
  /** Drops just one account's notifications — call when removing a single account. */
  removeForAccount: (accountId: string) => Promise<void>;
};

export const useNotificationFeed = create<State>((set) => ({
  items: [],
  unread: 0,

  refresh: async () => {
    const [items, unread] = await Promise.all([listNotifications(), unreadNotificationCount()]);
    set({ items: items.map(parse), unread });
  },

  markAllRead: async () => {
    await markAllNotificationsRead();
    const items = await listNotifications();
    set({ items: items.map(parse), unread: 0 });
  },

  clear: async () => {
    await clearAllNotifications();
    set({ items: [], unread: 0 });
  },

  removeForAccount: async (accountId) => {
    await deleteNotificationsForAccount(accountId);
    const [items, unread] = await Promise.all([listNotifications(), unreadNotificationCount()]);
    set({ items: items.map(parse), unread });
  },
}));
