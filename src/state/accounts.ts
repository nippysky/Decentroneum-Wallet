// src/state/accounts.ts
//
// Non-secret account metadata + the multi-account (dual wallet) switcher.
// Mutations that need to encrypt/decrypt a mnemonic take the in-memory vault
// key from state/session.ts as an explicit argument — this store never holds
// secrets itself.
import { create } from "zustand";
import {
  Account,
  addAccount as vaultAddAccount,
  getDecryptedMnemonic,
  listAccounts,
  removeAccount as vaultRemoveAccount,
  renameAccount as vaultRenameAccount,
  setActiveAccount as vaultSetActiveAccount,
} from "@/src/lib/crypto/vault";

export type AccountsState = {
  accounts: Account[];
  activeAccountId: string | null;

  hydrate: () => Promise<void>;
  setAccounts: (accounts: Account[], activeAccountId: string) => void;

  activeAccount: () => Account | null;

  switchAccount: (id: string) => Promise<void>;
  addAccount: (vaultKey: Uint8Array, opts: { mnemonic: string; label?: string }) => Promise<Account>;
  renameAccount: (id: string, label: string) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;

  revealMnemonic: (vaultKey: Uint8Array, accountId?: string) => Promise<string>;

  reset: () => void;
};

export const useAccounts = create<AccountsState>((set, get) => ({
  accounts: [],
  activeAccountId: null,

  hydrate: async () => {
    try {
      const accounts = await listAccounts();
      set({ accounts, activeAccountId: accounts[0]?.id ?? null });
    } catch {
      set({ accounts: [], activeAccountId: null });
    }
  },

  setAccounts: (accounts, activeAccountId) => set({ accounts, activeAccountId }),

  activeAccount: () => {
    const { accounts, activeAccountId } = get();
    return accounts.find((a) => a.id === activeAccountId) ?? null;
  },

  switchAccount: async (id: string) => {
    await vaultSetActiveAccount(id);
    set({ activeAccountId: id });
  },

  addAccount: async (vaultKey, opts) => {
    const { account, accounts } = await vaultAddAccount(vaultKey, opts);
    set({ accounts, activeAccountId: account.id });
    return account;
  },

  renameAccount: async (id, label) => {
    const accounts = await vaultRenameAccount(id, label);
    set({ accounts });
  },

  removeAccount: async (id) => {
    const { accounts, activeAccountId } = await vaultRemoveAccount(id);
    set({ accounts, activeAccountId });
  },

  revealMnemonic: async (vaultKey, accountId) => {
    const id = accountId ?? get().activeAccountId;
    if (!id) throw new Error("No active account");
    return getDecryptedMnemonic(vaultKey, id);
  },

  reset: () => set({ accounts: [], activeAccountId: null }),
}));
