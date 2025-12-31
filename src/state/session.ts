// src/state/session.ts
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { clearVault } from "@/src/lib/vault";
import { STORAGE_KEYS } from "@/src/lib/storageKeys";

export type SessionState = {
  isUnlocked: boolean;
  mnemonic: string | null; // in-memory only
  address: string | null;

  autoLockEnabled: boolean;
  biometricEnabled: boolean;

  hydrate: () => Promise<void>;

  setUnlocked: (mnemonic: string, address: string) => void;
  lock: () => void;

  setAutoLockEnabled: (v: boolean) => Promise<void>;
  setBiometricEnabled: (v: boolean) => Promise<void>;

  // Used by biometric unlock flow
  setBioPin: (pin: string) => Promise<void>;
  clearBioPin: () => Promise<void>;
  getBioPin: () => Promise<string | null>;

  resetDeviceWallet: () => Promise<void>;
};

export const useSession = create<SessionState>((set, get) => ({
  isUnlocked: false,
  mnemonic: null,
  address: null,

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
      // keep defaults
      set({
        autoLockEnabled: true,
        biometricEnabled: false,
      });
    }
  },

  setUnlocked: (mnemonic, address) => set({ isUnlocked: true, mnemonic, address }),

  // Lock wipes mnemonic (secret). Keeping address is fine.
  lock: () => set({ isUnlocked: false, mnemonic: null }),

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
      // Turning off: remove flag + stored biometric pin
      await SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED);
      await get().clearBioPin();
    }
  },

  setBioPin: async (pin) => {
    // Store passcode behind OS biometrics (Face ID / Touch ID).
    // Reading it later will trigger a biometric prompt.
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
      const v = await SecureStore.getItemAsync(STORAGE_KEYS.BIO_PIN, {
        requireAuthentication: true,
      });
      return v ?? null;
    } catch {
      // user cancelled Face ID / Touch ID, or not enrolled, etc.
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

    set({
      isUnlocked: false,
      mnemonic: null,
      address: null,
      biometricEnabled: false,
      autoLockEnabled: true,
    });
  },
}));
