// src/lib/crypto/vault.ts
//
// Encrypted vault. Many recovery phrases, many accounts under each.
//
// ─── The model ──────────────────────────────────────────────────────────────
//
// A vault holds one or more SEEDS (recovery phrases). Each seed owns accounts
// derived from it at BIP-44 indexes m/44'/60'/0'/0/N — the standard path, so
// the same phrase produces the same addresses in MetaMask, Trust, Rabby and
// Ledger. "Add account" increments N under one seed. Nothing new is generated
// and there is nothing new to write down, because index 3 is recoverable from
// the same twelve words as index 0.
//
//   Vault
//   ├── Seed "Recovery phrase 1"   ← the phrase from onboarding
//   │   ├── Account 1  (index 0)
//   │   └── Account 2  (index 1)
//   └── Seed "Recovery phrase 2"   ← a phrase imported later
//       ├── Account 1  (index 0)
//       └── Account 2  (index 1)
//
// ─── Why there is no "imported account" kind ────────────────────────────────
//
// MetaMask has two shapes: accounts under a Secret Recovery Phrase, and
// loose "imported accounts" that belong to no phrase and are silently left
// out of a seed backup. That second category is where people lose money —
// they back up their phrase, assume they are covered, and are not.
//
// Here, importing a phrase creates a SEED. It is a first-class citizen with
// its own accounts and its own "Add account" button. Every account in the
// vault therefore belongs to exactly one phrase, and backing up all the
// phrases genuinely backs up everything. There is no third state to explain
// and no silent gap in a backup.
//
// (Raw private-key import is deliberately unsupported. A bare key has no
// phrase to back it up, which would reintroduce exactly the category this
// design removes.)
//
// ─── There is no migration path, on purpose ─────────────────────────────────
//
// Earlier development formats existed (v1 single phrase, v2 phrase-per-account,
// v3 single seed). Nothing shipped, so nothing is owed to them, and migration
// code that will never run in production can only be a liability — it cannot
// be exercised and it cannot be trusted.
//
// Any vault record that is not the current version is DELETED on launch (see
// purgeLegacyVaults). A dev build carrying an old vault lands on onboarding,
// which is the honest outcome: those were test phrases. Once the app ships,
// this stops being acceptable and a format change needs a real migration.
//
// ─── Encryption ─────────────────────────────────────────────────────────────
//
// One passcode → one scrypt-derived key → NaCl secretbox per seed, each with
// its own nonce. Account records hold no secrets at all: just which seed they
// came from and at which index. The derived key lives in memory only
// (state/session.ts) and is never persisted.

import * as SecureStore from "expo-secure-store";
import nacl from "tweetnacl";
import { LEGACY_VAULT_KEYS, STORAGE_KEYS } from "../storage/keys";
import { b64, unb64, randomBytes, randomNonce } from "./primitives";
import { deriveKeyScrypt, DEFAULT_SCRYPT, ScryptParams } from "./kdf";
import { addressAtIndex, pathForIndex } from "./derive";

/** Current on-disk format. Anything else is deleted rather than upgraded. */
export const VAULT_VERSION = 4;

/* ---------------------------------- types ---------------------------------- */

export type Account = {
  id: string;
  label: string;
  address: string;
  createdAt: string;
  /** Which recovery phrase this account comes from. */
  seedId: string;
  /** BIP-44 address index within that phrase. */
  index: number;
  /**
   * Hidden accounts stay in the vault, keep their index, and can be unhidden
   * exactly. See hideAccount for why nothing is ever truly deleted here.
   */
  hidden: boolean;
};

/** Public seed metadata — safe to show without unlocking. Never the phrase. */
export type SeedInfo = {
  id: string;
  label: string;
  createdAt: string;
  /** How many accounts this phrase currently backs up, hidden ones included. */
  accountCount: number;
  /** How many of those are visible in the accounts list. */
  visibleAccountCount: number;
  /** True for the phrase created or imported during onboarding. */
  isPrimary: boolean;
};

type Box = { nonce: string; ciphertext: string };

type StoredSeed = {
  id: string;
  label: string;
  createdAt: string;
  box: Box;
};

type StoredAccount = {
  id: string;
  label: string;
  address: string;
  createdAt: string;
  seedId: string;
  index: number;
  /** Absent on older records in memory; treated as false. */
  hidden?: boolean;
};

type Vault = {
  v: typeof VAULT_VERSION;
  kdf: { alg: "scrypt"; params: ScryptParams; salt: string };
  /** In creation order. seeds[0] is the onboarding phrase. */
  seeds: StoredSeed[];
  accounts: StoredAccount[];
  activeAccountId: string;
  meta: { createdAt: string; updatedAt: string };
};

export type UnlockedVault = {
  key: Uint8Array;
  accounts: Account[];
  seeds: SeedInfo[];
  activeAccountId: string;
};

/**
 * What the signing layer needs: a phrase AND the path within it.
 *
 * Both, always. The phrase alone derives index 0 every time, which for any
 * account past the first means signing with the wrong key — spending from the
 * wrong balance, with no error to notice.
 */
export type AccountSecret = { mnemonic: string; path: string };

/** The phrase behind one account, plus what it does and does not cover. */
export type BackupPhrase = {
  mnemonic: string;
  seedId: string;
  seedLabel: string;
  /** Accounts this phrase restores. */
  accountCount: number;
  /** Other phrases in this wallet that this one does NOT cover. */
  otherSeedCount: number;
};

/**
 * Limits, and why they exist.
 *
 * MetaMask publishes no cap at all: accounts are derived on demand and cost
 * nothing to exist. The same is true here, so these are not cryptographic
 * limits — they are guards against a list nobody can navigate and against a
 * runaway loop creating thousands of records. They sit far above any plausible
 * real use, and can be raised without any format change.
 */
const MAX_SEEDS = 10;
const MAX_ACCOUNTS_PER_SEED = 50;

/* -------------------------------- internals -------------------------------- */

function genId(prefix: string): string {
  // Not a secret — just needs to be unique within the vault.
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePhrase(m: string): string {
  return m.trim().toLowerCase().replace(/\s+/g, " ");
}

async function readRaw(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

/**
 * Reads the vault, treating a record of any other version as absent.
 *
 * Returning null rather than throwing is what lets purgeLegacyVaults and the
 * launch gate agree: an unreadable record is the same as no wallet.
 */
async function loadVault(): Promise<Vault | null> {
  const raw = await readRaw(STORAGE_KEYS.VAULT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Vault;
    return parsed?.v === VAULT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

async function saveVault(vault: Vault): Promise<void> {
  vault.meta.updatedAt = new Date().toISOString();
  await writeRaw(STORAGE_KEYS.VAULT, JSON.stringify(vault));
}

function toPublicAccounts(vault: Vault): Account[] {
  return vault.accounts.map((a) => ({
    id: a.id,
    label: a.label,
    address: a.address,
    createdAt: a.createdAt,
    seedId: a.seedId,
    index: a.index,
    hidden: !!a.hidden,
  }));
}

function toPublicSeeds(vault: Vault): SeedInfo[] {
  return vault.seeds.map((s, i) => ({
    id: s.id,
    label: s.label,
    createdAt: s.createdAt,
    accountCount: vault.accounts.filter((a) => a.seedId === s.id).length,
    visibleAccountCount: vault.accounts.filter((a) => a.seedId === s.id && !a.hidden).length,
    isPrimary: i === 0,
  }));
}

function seal(key: Uint8Array, plaintext: string, nonce: Uint8Array): Box {
  const boxed = nacl.secretbox(new TextEncoder().encode(plaintext), nonce, key);
  return { nonce: b64(nonce), ciphertext: b64(boxed) };
}

function open(key: Uint8Array, box: Box): string {
  const opened = nacl.secretbox.open(unb64(box.ciphertext), unb64(box.nonce), key);
  if (!opened) throw new Error("Invalid passcode");
  return new TextDecoder().decode(opened);
}

/**
 * The LOWEST unused index under a seed.
 *
 * Lowest-free rather than highest-plus-one, so a gap can never be stranded.
 * Hidden accounts still hold their index, so this only ever returns an index
 * that genuinely has no account — "Add account" always means a new address,
 * and getting a hidden one back is done by unhiding it, by name.
 *
 * Highest-plus-one had a real failure: with accounts at 0 and 1, removing 0
 * left `used = [1]` and the next add produced index 2 — leaving index 0's
 * funds unreachable from the UI entirely.
 */
function nextIndexFor(vault: Vault, seedId: string): number {
  const used = new Set(vault.accounts.filter((a) => a.seedId === seedId).map((a) => a.index));
  let i = 0;
  while (used.has(i)) i += 1;
  return i;
}

/**
 * "Account 3" — numbered by INDEX within its own phrase.
 *
 * Index-based rather than count-based so the name matches what other wallets
 * call the same address: index 2 is "Account 3" in MetaMask too, whether or
 * not anything is hidden here.
 */
function defaultAccountLabel(index: number): string {
  return `Account ${index + 1}`;
}

function defaultSeedLabel(count: number): string {
  return `Recovery phrase ${count + 1}`;
}

function requireSeed(vault: Vault, seedId: string): StoredSeed {
  const seed = vault.seeds.find((s) => s.id === seedId);
  if (!seed) throw new Error("Recovery phrase not found");
  return seed;
}

/* --------------------------------- status --------------------------------- */

export async function hasWallet(): Promise<boolean> {
  return (await readRaw(STORAGE_KEYS.HAS_WALLET)) === "1";
}

export async function setHasWallet(): Promise<void> {
  await writeRaw(STORAGE_KEYS.HAS_WALLET, "1");
}

export async function clearVault(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_KEYS.VAULT),
    SecureStore.deleteItemAsync(STORAGE_KEYS.HAS_WALLET),
    SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED),
    ...LEGACY_VAULT_KEYS.map((k) => SecureStore.deleteItemAsync(k)),
  ]);
}

/**
 * Deletes any vault record this build cannot read — an old storage key, or a
 * record at the current key whose version is not VAULT_VERSION — and, if that
 * leaves no wallet, clears the flags that would otherwise strand the app.
 *
 * Called once at launch, before anything decides unlock-vs-onboarding.
 * Without it a dev install would show an unlock screen forever: HAS_WALLET
 * says a wallet exists, but nothing can open it. Landing on onboarding is the
 * honest state.
 *
 * Returns true if anything was removed, so the caller can log it.
 */
export async function purgeLegacyVaults(): Promise<boolean> {
  const stale: string[] = [];

  for (const key of LEGACY_VAULT_KEYS) {
    if (await readRaw(key)) stale.push(key);
  }

  // A record at the CURRENT key but an older version is just as unreadable.
  const raw = await readRaw(STORAGE_KEYS.VAULT);
  if (raw) {
    let version: unknown = null;
    try {
      version = (JSON.parse(raw) as { v?: unknown }).v;
    } catch {
      version = null;
    }
    if (version !== VAULT_VERSION) stale.push(STORAGE_KEYS.VAULT);
  }

  if (stale.length === 0) return false;

  await Promise.all(stale.map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));

  if (!(await loadVault())) {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.HAS_WALLET).catch(() => {});
    await SecureStore.deleteItemAsync(STORAGE_KEYS.BIO_PIN).catch(() => {});
    await SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED).catch(() => {});
  }
  return true;
}

/** Public account metadata only (no secrets) — safe to read without unlocking. */
export async function listAccounts(): Promise<Account[]> {
  const vault = await loadVault();
  return vault ? toPublicAccounts(vault) : [];
}

/** Public phrase metadata only (no phrases) — safe to read without unlocking. */
export async function listSeeds(): Promise<SeedInfo[]> {
  const vault = await loadVault();
  return vault ? toPublicSeeds(vault) : [];
}

/* -------------------------------- creation -------------------------------- */

export async function initializeVault(
  passcode: string,
  first: { mnemonic: string; label?: string }
): Promise<UnlockedVault> {
  const salt = await randomBytes(16);
  const key = await deriveKeyScrypt(passcode, salt, DEFAULT_SCRYPT);
  const now = new Date().toISOString();
  const mnemonic = normalizePhrase(first.mnemonic);

  const seed: StoredSeed = {
    id: genId("seed"),
    label: defaultSeedLabel(0),
    createdAt: now,
    box: seal(key, mnemonic, await randomNonce()),
  };

  // The first account is index 0 of that phrase — not a separate wallet.
  const account: StoredAccount = {
    id: genId("acc"),
    label: first.label ?? "Account 1",
    address: addressAtIndex(mnemonic, 0),
    createdAt: now,
    seedId: seed.id,
    index: 0,
    hidden: false,
  };

  const vault: Vault = {
    v: VAULT_VERSION,
    kdf: { alg: "scrypt", params: DEFAULT_SCRYPT, salt: b64(salt) },
    seeds: [seed],
    accounts: [account],
    activeAccountId: account.id,
    meta: { createdAt: now, updatedAt: now },
  };

  await saveVault(vault);
  await setHasWallet();

  return {
    key,
    accounts: toPublicAccounts(vault),
    seeds: toPublicSeeds(vault),
    activeAccountId: vault.activeAccountId,
  };
}

/* --------------------------------- unlock ---------------------------------- */

export async function unlockVault(passcode: string): Promise<UnlockedVault> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");

  const key = await deriveKeyScrypt(passcode, unb64(vault.kdf.salt), vault.kdf.params);

  const check = vault.seeds[0];
  if (!check) throw new Error("Vault not found");
  open(key, check.box); // throws "Invalid passcode" on a wrong PIN

  return {
    key,
    accounts: toPublicAccounts(vault),
    seeds: toPublicSeeds(vault),
    activeAccountId: vault.activeAccountId,
  };
}

/* ----------------------------- secret access ------------------------------ */

/**
 * The phrase AND path needed to sign for one account.
 *
 * Callers must pass BOTH to the signer — see the AccountSecret note above.
 */
export async function getAccountSecret(key: Uint8Array, accountId: string): Promise<AccountSecret> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");

  const account = vault.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Account not found");

  const seed = requireSeed(vault, account.seedId);
  return { mnemonic: open(key, seed.box), path: pathForIndex(account.index) };
}

/**
 * The phrase to display under "View recovery phrase", with the context needed
 * to describe it truthfully.
 *
 * `otherSeedCount` exists so the screen can say "this phrase does not cover
 * your other 1 phrase" when a wallet holds more than one. A user who writes
 * down one phrase and believes they are done is the failure this prevents.
 */
export async function getBackupPhrase(key: Uint8Array, accountId: string): Promise<BackupPhrase> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");

  const account = vault.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Account not found");

  const seed = requireSeed(vault, account.seedId);
  return {
    mnemonic: open(key, seed.box),
    seedId: seed.id,
    seedLabel: seed.label,
    accountCount: vault.accounts.filter((a) => a.seedId === seed.id).length,
    otherSeedCount: vault.seeds.length - 1,
  };
}

/** The same, addressed by phrase rather than by account. */
export async function getSeedPhrase(key: Uint8Array, seedId: string): Promise<BackupPhrase> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");

  const seed = requireSeed(vault, seedId);
  return {
    mnemonic: open(key, seed.box),
    seedId: seed.id,
    seedLabel: seed.label,
    accountCount: vault.accounts.filter((a) => a.seedId === seed.id).length,
    otherSeedCount: vault.seeds.length - 1,
  };
}

/* ------------------------------- mutations ---------------------------------- */

type Mutation = { account: Account; accounts: Account[]; seeds: SeedInfo[] };

/**
 * Adds the next account under one recovery phrase.
 *
 * No new phrase, nothing to write down — this is index N of a phrase the user
 * already has. Defaults to the phrase behind the currently active account, so
 * "Add account" from a given group adds to that group.
 */
export async function addDerivedAccount(
  key: Uint8Array,
  opts: { seedId?: string; label?: string } = {}
): Promise<Mutation> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");

  const active = vault.accounts.find((a) => a.id === vault.activeAccountId);
  const seedId = opts.seedId ?? active?.seedId ?? vault.seeds[0]?.id;
  if (!seedId) throw new Error("This wallet has no recovery phrase to derive from.");

  const seed = requireSeed(vault, seedId);

  const existing = vault.accounts.filter((a) => a.seedId === seedId).length;
  if (existing >= MAX_ACCOUNTS_PER_SEED) {
    throw new Error(`You can add up to ${MAX_ACCOUNTS_PER_SEED} accounts per recovery phrase.`);
  }

  const mnemonic = open(key, seed.box);
  const index = nextIndexFor(vault, seedId);
  const address = addressAtIndex(mnemonic, index);

  if (vault.accounts.some((a) => a.address.toLowerCase() === address.toLowerCase())) {
    throw new Error("This account is already in your wallet.");
  }

  const account: StoredAccount = {
    id: genId("acc"),
    label: opts.label ?? defaultAccountLabel(index),
    address,
    createdAt: new Date().toISOString(),
    seedId,
    index,
    hidden: false,
  };

  vault.accounts.push(account);
  vault.activeAccountId = account.id;
  await saveVault(vault);

  return {
    account: { ...account, hidden: false },
    accounts: toPublicAccounts(vault),
    seeds: toPublicSeeds(vault),
  };
}

/**
 * Adds another recovery phrase to the wallet, with its first account.
 *
 * The phrase becomes a full seed — it gets its own "Add account", so an
 * outside wallet's sub-accounts can all be restored, not just its first.
 * Importing a phrase the wallet already holds is refused: the right action
 * there is "Add account" under that phrase.
 */
export async function addSeed(
  key: Uint8Array,
  opts: { mnemonic: string; label?: string }
): Promise<Mutation & { seedId: string }> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");
  if (vault.seeds.length >= MAX_SEEDS) {
    throw new Error(`You can add up to ${MAX_SEEDS} recovery phrases.`);
  }

  const mnemonic = normalizePhrase(opts.mnemonic);

  for (const existing of vault.seeds) {
    if (normalizePhrase(open(key, existing.box)) === mnemonic) {
      throw new Error(
        `You already have this recovery phrase (${existing.label}). Use “Add account” under it instead.`
      );
    }
  }

  const address = addressAtIndex(mnemonic, 0);
  if (vault.accounts.some((a) => a.address.toLowerCase() === address.toLowerCase())) {
    throw new Error("This account is already in your wallet.");
  }

  const now = new Date().toISOString();
  const seed: StoredSeed = {
    id: genId("seed"),
    label: opts.label?.trim().slice(0, 32) || defaultSeedLabel(vault.seeds.length),
    createdAt: now,
    box: seal(key, mnemonic, await randomNonce()),
  };

  const account: StoredAccount = {
    id: genId("acc"),
    label: "Account 1",
    address,
    createdAt: now,
    seedId: seed.id,
    index: 0,
    hidden: false,
  };

  vault.seeds.push(seed);
  vault.accounts.push(account);
  vault.activeAccountId = account.id;
  await saveVault(vault);

  return {
    seedId: seed.id,
    account: { ...account, hidden: false },
    accounts: toPublicAccounts(vault),
    seeds: toPublicSeeds(vault),
  };
}

export async function renameAccount(id: string, label: string): Promise<Account[]> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");
  const account = vault.accounts.find((a) => a.id === id);
  if (!account) throw new Error("Account not found");
  account.label = label.trim().slice(0, 32) || account.label;
  await saveVault(vault);
  return toPublicAccounts(vault);
}

export async function renameSeed(id: string, label: string): Promise<SeedInfo[]> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");
  const seed = requireSeed(vault, id);
  seed.label = label.trim().slice(0, 32) || seed.label;
  await saveVault(vault);
  return toPublicSeeds(vault);
}

/**
 * Hides an account. Nothing is deleted, and that is not a euphemism.
 *
 * A derived address exists on the blockchain whether this app shows it or
 * not; there is no operation that can remove it. Calling this "delete" would
 * tell the user something false and frightening about their funds, so the
 * whole flow is framed as hiding — reversible, exact, and honest.
 *
 * The record keeps its index, so unhiding restores the same address with its
 * balance and history rather than approximating it. MetaMask reaches the same
 * conclusion for the same reason (its derived accounts can only be hidden,
 * never removed), though on mobile it offers no hide at all.
 */
export async function hideAccount(
  id: string
): Promise<{ accounts: Account[]; seeds: SeedInfo[]; activeAccountId: string }> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");

  const account = vault.accounts.find((a) => a.id === id);
  if (!account) throw new Error("Account not found");

  const visible = vault.accounts.filter((a) => !a.hidden);
  if (visible.length <= 1) throw new Error("You must keep at least one account visible.");

  account.hidden = true;

  // The active account must always be one the user can actually see.
  if (vault.activeAccountId === id) {
    vault.activeAccountId = vault.accounts.find((a) => !a.hidden)!.id;
  }
  await saveVault(vault);

  return {
    accounts: toPublicAccounts(vault),
    seeds: toPublicSeeds(vault),
    activeAccountId: vault.activeAccountId,
  };
}

/** Brings a hidden account back, at exactly the address it always had. */
export async function unhideAccount(
  id: string
): Promise<{ accounts: Account[]; seeds: SeedInfo[]; activeAccountId: string }> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");

  const account = vault.accounts.find((a) => a.id === id);
  if (!account) throw new Error("Account not found");

  account.hidden = false;
  await saveVault(vault);

  return {
    accounts: toPublicAccounts(vault),
    seeds: toPublicSeeds(vault),
    activeAccountId: vault.activeAccountId,
  };
}

/**
 * Removes a recovery phrase and every account under it.
 *
 * The primary phrase cannot be removed — it is the one the wallet was created
 * with, and dropping it would leave a "wallet" whose original accounts are
 * unreachable while the app still claims a wallet exists. Erase Wallet is the
 * honest action for that.
 */
export async function removeSeed(
  id: string
): Promise<{ accounts: Account[]; seeds: SeedInfo[]; activeAccountId: string }> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");

  const idx = vault.seeds.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error("Recovery phrase not found");
  if (idx === 0) {
    throw new Error("This is your wallet's original recovery phrase and can't be removed.");
  }

  vault.seeds.splice(idx, 1);
  vault.accounts = vault.accounts.filter((a) => a.seedId !== id);

  // Whatever is active afterwards has to be an account that both exists and
  // is visible — otherwise the wallet opens onto nothing.
  const stillActive = vault.accounts.find((a) => a.id === vault.activeAccountId && !a.hidden);
  if (!stillActive) {
    const firstVisible = vault.accounts.find((a) => !a.hidden) ?? vault.accounts[0];
    if (firstVisible) {
      firstVisible.hidden = false;
      vault.activeAccountId = firstVisible.id;
    }
  }
  await saveVault(vault);

  return {
    accounts: toPublicAccounts(vault),
    seeds: toPublicSeeds(vault),
    activeAccountId: vault.activeAccountId,
  };
}

export async function setActiveAccount(id: string): Promise<void> {
  const vault = await loadVault();
  if (!vault) throw new Error("Vault not found");
  const account = vault.accounts.find((a) => a.id === id);
  if (!account) throw new Error("Account not found");
  // Switching to something the accounts list doesn't show would leave the
  // wallet in a state the user can't navigate back out of.
  if (account.hidden) throw new Error("That account is hidden. Unhide it first.");
  vault.activeAccountId = id;
  await saveVault(vault);
}
