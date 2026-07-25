// src/state/notifications.ts
//
// "Funds received" notifications are on by default for every user — there is
// no user-facing toggle for this anymore. hydrate() always requests the OS
// permission and starts the watcher; the only thing that can turn this off
// is the user denying the OS permission prompt (permissionGranted reflects
// that, and Settings offers a link to the system Settings app in that case).
import { create } from "zustand";
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
  enabled: true,
  permissionGranted: false,
  watcherActive: false,
  _stopWatcher: null,

  hydrate: async () => {
    const status = await getNotificationPermissionStatus();
    set({ permissionGranted: status === "granted", enabled: true });
    get().enable().catch(() => {});
  },

  enable: async () => {
    const granted = await requestNotificationPermission();
    set({ permissionGranted: granted, enabled: true });

    if (!granted) return false;

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

    return true;
  },

  // Only used internally (e.g. erasing the wallet from this device) — there
  // is no user-facing switch that calls this anymore.
  disable: async () => {
    const stop = get()._stopWatcher;
    if (stop) stop();
    set({ watcherActive: false, _stopWatcher: null });
  },
}));
