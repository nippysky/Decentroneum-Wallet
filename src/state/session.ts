// src/state/session.ts
//
// Auth/security session state only. Account data (addresses, active account,
// switching) lives in state/accounts.ts. The only secret held here is the
// in-memory vault key produced by unlocking — never the raw mnemonic, and
// never persisted.
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { clearVault, unlockVault, hasWallet as vaultHasWallet } from "@/src/lib/crypto/vault";
import { STORAGE_KEYS } from "@/src/lib/storage/keys";
import { useAccounts } from "@/src/state/accounts";

export type SessionState = {
  isUnlocked: boolean;
  vaultKey: Uint8Array | null; // in-memory only, derived from passcode via scrypt

  autoLockEnabled: boolean;
  biometricEnabled: boolean;

  hydrate: () => Promise<void>;

  unlock: (passcode: string) => Promise<void>;
  lock: () => void;

  setAutoLockEnabled: (v: boolean) => Promise<void>;
  setBiometricEnabled: (v: boolean) => Promise<void>;

  setBioPin: (pin: string) => Promise<void>;
  clearBioPin: () => Promise<void>;
  getBioPin: () => Promise<string | null>;

  resetDeviceWallet: () => Promise<void>;
};

export const useSession = create<SessionState>((set, get) => ({
  isUnlocked: false,
  vaultKey: null,

  autoLockEnabled: true,
  biometricEnabled: false,

  hydrate: async () => {
    try {
      const [a, b] = await Promise.all([
        SecureStore.getItemAsync(STORAGE_KEYS.AUTOLOCK_ENABLED),
        SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED),
      ]);

      set({
        autoLockEnabled: a ? a === "1" : true,
        biometricEnabled: b ? b === "1" : false,
      });
    } catch {
      set({ autoLockEnabled: true, biometricEnabled: false });
    }
  },

  unlock: async (passcode: string) => {
    const { key, accounts, seeds, activeAccountId } = await unlockVault(passcode);
    useAccounts.getState().setAccounts(accounts, seeds, activeAccountId);
    set({ isUnlocked: true, vaultKey: key });
  },

  // Lock wipes the derived key (secret). Account metadata (addresses/labels) is fine to keep.
  lock: () => set({ isUnlocked: false, vaultKey: null }),

  setAutoLockEnabled: async (v) => {
    set({ autoLockEnabled: v });
    await SecureStore.setItemAsync(STORAGE_KEYS.AUTOLOCK_ENABLED, v ? "1" : "0", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },

  setBiometricEnabled: async (v) => {
    set({ biometricEnabled: v });

    if (v) {
      await SecureStore.setItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED, "1", {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    } else {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED);
      await get().clearBioPin();
    }
  },

  setBioPin: async (pin) => {
    await SecureStore.setItemAsync(STORAGE_KEYS.BIO_PIN, pin, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      requireAuthentication: true,
    });
  },

  clearBioPin: async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.BIO_PIN);
  },

  getBioPin: async () => {
    try {
      const v = await SecureStore.getItemAsync(STORAGE_KEYS.BIO_PIN, { requireAuthentication: true });
      return v ?? null;
    } catch {
      return null;
    }
  },

  resetDeviceWallet: async () => {
    try {
      await clearVault();
    } catch {}

    await Promise.all([
      SecureStore.deleteItemAsync(STORAGE_KEYS.AUTOLOCK_ENABLED),
      SecureStore.deleteItemAsync(STORAGE_KEYS.BIO_PIN),
      SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED),
    ]);

    useAccounts.getState().reset();

    set({
      isUnlocked: false,
      vaultKey: null,
      biometricEnabled: false,
      autoLockEnabled: true,
    });
  },
}));

export async function deviceHasWallet(): Promise<boolean> {
  return vaultHasWallet();
}
