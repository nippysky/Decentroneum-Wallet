// src/state/accounts.ts
//
// Non-secret account and recovery-phrase metadata, plus the account switcher.
//
// Mutations that need to encrypt or decrypt a phrase take the in-memory vault
// key from state/session.ts as an explicit argument — this store never holds
// secrets itself, and the explicit argument is what makes that visible at
// every call site.
import { create } from "zustand";
import {
  Account,
  BackupPhrase,
  SeedInfo,
  addDerivedAccount as vaultAddDerivedAccount,
  addSeed as vaultAddSeed,
  getBackupPhrase,
  getSeedPhrase,
  getActiveAccountId,
  listAccounts,
  listSeeds,
  hideAccount as vaultHideAccount,
  unhideAccount as vaultUnhideAccount,
  removeSeed as vaultRemoveSeed,
  renameAccount as vaultRenameAccount,
  renameSeed as vaultRenameSeed,
  setActiveAccount as vaultSetActiveAccount,
} from "@/src/lib/crypto/vault";

export type AccountsState = {
  accounts: Account[];
  /** One entry per recovery phrase, in creation order. seeds[0] is primary. */
  seeds: SeedInfo[];
  activeAccountId: string | null;

  hydrate: () => Promise<void>;
  setAccounts: (accounts: Account[], seeds: SeedInfo[], activeAccountId: string) => void;

  activeAccount: () => Account | null;
  /** The phrase the active account belongs to. */
  activeSeed: () => SeedInfo | null;
  /** Visible accounts under one phrase. */
  accountsForSeed: (seedId: string) => Account[];
  /** Hidden accounts under one phrase, for the "Hidden" section. */
  hiddenAccountsForSeed: (seedId: string) => Account[];

  switchAccount: (id: string) => Promise<void>;

  /** Next account under one phrase — nothing new to back up. */
  addDerivedAccount: (
    vaultKey: Uint8Array,
    opts?: { seedId?: string; label?: string }
  ) => Promise<Account>;

  /** Another recovery phrase, with its first account. */
  addSeed: (vaultKey: Uint8Array, opts: { mnemonic: string; label?: string }) => Promise<Account>;

  renameAccount: (id: string, label: string) => Promise<void>;
  renameSeed: (id: string, label: string) => Promise<void>;

  /**
   * Hides an account from the list. Nothing is deleted — a derived address
   * cannot be — so this is reversible and exact.
   */
  hideAccount: (id: string) => Promise<void>;
  unhideAccount: (id: string) => Promise<void>;
  /** Removes a phrase AND every account under it. Not allowed for primary. */
  removeSeed: (id: string) => Promise<void>;

  /** The phrase behind an account, with what it covers. */
  revealMnemonic: (vaultKey: Uint8Array, accountId?: string) => Promise<BackupPhrase>;
  /** The same, addressed by phrase. */
  revealSeed: (vaultKey: Uint8Array, seedId: string) => Promise<BackupPhrase>;

  reset: () => void;
};

export const useAccounts = create<AccountsState>((set, get) => ({
  accounts: [],
  seeds: [],
  activeAccountId: null,

  hydrate: async () => {
    try {
      // The persisted selection, not accounts[0]. This runs at launch, before
      // the passcode screen, so defaulting to the first account here is what
      // made the switcher forget which account you were on between sessions.
      const [accounts, seeds, activeAccountId] = await Promise.all([
        listAccounts(),
        listSeeds(),
        getActiveAccountId(),
      ]);
      set({ accounts, seeds, activeAccountId: activeAccountId ?? accounts[0]?.id ?? null });
    } catch {
      set({ accounts: [], seeds: [], activeAccountId: null });
    }
  },

  setAccounts: (accounts, seeds, activeAccountId) => set({ accounts, seeds, activeAccountId }),

  activeAccount: () => {
    const { accounts, activeAccountId } = get();
    return accounts.find((a) => a.id === activeAccountId) ?? null;
  },

  activeSeed: () => {
    const active = get().activeAccount();
    if (!active) return null;
    return get().seeds.find((s) => s.id === active.seedId) ?? null;
  },

  accountsForSeed: (seedId) => get().accounts.filter((a) => a.seedId === seedId && !a.hidden),

  hiddenAccountsForSeed: (seedId) => get().accounts.filter((a) => a.seedId === seedId && a.hidden),

  switchAccount: async (id: string) => {
    await vaultSetActiveAccount(id);
    set({ activeAccountId: id });
  },

  addDerivedAccount: async (vaultKey, opts = {}) => {
    const { account, accounts, seeds } = await vaultAddDerivedAccount(vaultKey, opts);
    set({ accounts, seeds, activeAccountId: account.id });
    return account;
  },

  addSeed: async (vaultKey, opts) => {
    const { account, accounts, seeds } = await vaultAddSeed(vaultKey, opts);
    set({ accounts, seeds, activeAccountId: account.id });
    return account;
  },

  renameAccount: async (id, label) => {
    const accounts = await vaultRenameAccount(id, label);
    set({ accounts });
  },

  renameSeed: async (id, label) => {
    const seeds = await vaultRenameSeed(id, label);
    set({ seeds });
  },

  hideAccount: async (id) => {
    const { accounts, seeds, activeAccountId } = await vaultHideAccount(id);
    set({ accounts, seeds, activeAccountId });
  },

  unhideAccount: async (id) => {
    const { accounts, seeds, activeAccountId } = await vaultUnhideAccount(id);
    set({ accounts, seeds, activeAccountId });
  },

  removeSeed: async (id) => {
    const { accounts, seeds, activeAccountId } = await vaultRemoveSeed(id);
    set({ accounts, seeds, activeAccountId });
  },

  revealMnemonic: async (vaultKey, accountId) => {
    const id = accountId ?? get().activeAccountId;
    if (!id) throw new Error("No active account");
    return getBackupPhrase(vaultKey, id);
  },

  revealSeed: async (vaultKey, seedId) => getSeedPhrase(vaultKey, seedId),

  reset: () => set({ accounts: [], seeds: [], activeAccountId: null }),
}));
