// src/state/notifications.ts
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { STORAGE_KEYS } from "@/src/lib/storage/keys";
import { getNotificationPermissionStatus, requestNotificationPermission } from "@/src/lib/notifications/permissions";
import { startTxWatcher } from "@/src/lib/notifications/watcher";
import { registerAddressForPush } from "@/src/lib/notifications/register";
import { useAccounts } from "@/src/state/accounts";
import { useTokens } from "@/src/state/tokens";
import { useSession } from "@/src/state/session";

export type NotificationsState = {
  enabled: boolean;
  permissionGranted: boolean;
  watcherActive: boolean;

  hydrate: () => Promise<void>;
  enable: () => Promise<boolean>; // returns whether permission was granted
  disable: () => Promise<void>;

  _stopWatcher: (() => void) | null;
};

export const useNotifications = create<NotificationsState>((set, get) => ({
  enabled: false,
  permissionGranted: false,
  watcherActive: false,
  _stopWatcher: null,

  hydrate: async () => {
    const [saved, status] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEYS.NOTIFICATIONS_ENABLED),
      getNotificationPermissionStatus(),
    ]);

    const enabled = saved === "1";
    const permissionGranted = status === "granted";
    set({ enabled, permissionGranted });

    if (enabled && permissionGranted) {
      get().enable().catch(() => {});
    }
  },

  enable: async () => {
    const granted = await requestNotificationPermission();
    set({ permissionGranted: granted });

    if (!granted) {
      set({ enabled: false });
      await SecureStore.setItemAsync(STORAGE_KEYS.NOTIFICATIONS_ENABLED, "0");
      return false;
    }

    await SecureStore.setItemAsync(STORAGE_KEYS.NOTIFICATIONS_ENABLED, "1");

    const existingStop = get()._stopWatcher;
    if (!existingStop) {
      const stop = startTxWatcher({
        getAccounts: () => useAccounts.getState().accounts,
        getTokens: () => useTokens.getState().tokens,
      });
      set({ _stopWatcher: stop, watcherActive: true });
    }

    // Best-effort: also register every account's address with the
    // server-push backend (if deployed) so notifications keep arriving
    // when the app is backgrounded or killed, not just foregrounded.
    const vaultKey = useSession.getState().vaultKey;
    if (vaultKey) {
      for (const account of useAccounts.getState().accounts) {
        registerAddressForPush({ address: account.address, vaultKey, accountId: account.id }).catch(() => {});
      }
    }

    set({ enabled: true });
    return true;
  },

  disable: async () => {
    const stop = get()._stopWatcher;
    if (stop) stop();
    set({ enabled: false, watcherActive: false, _stopWatcher: null });
    await SecureStore.setItemAsync(STORAGE_KEYS.NOTIFICATIONS_ENABLED, "0");
  },
}));
