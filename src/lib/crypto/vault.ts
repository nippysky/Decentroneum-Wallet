// src/lib/vault.ts
//
// Multi-account encrypted vault (V2).
//
// One passcode encrypts the whole vault (one scrypt-derived key). Each
// account's mnemonic is boxed individually (own nonce) under that same key,
// so unlocking once lets the user add/switch/remove accounts for the rest of
// the session without re-entering the passcode. The derived key lives in
// memory only (state/session.ts) and is never persisted.
//
// V1 (single-mnemonic) vaults from earlier app versions are transparently
// migrated to V2 the first time the user unlocks after upgrading — no
// re-onboarding required.

import * as SecureStore from "expo-secure-store";
import nacl from "tweetnacl";
import { STORAGE_KEYS } from "../storage/keys";
import { b64, unb64, randomBytes, randomNonce } from "./primitives";
import { deriveKeyScrypt, DEFAULT_SCRYPT, ScryptParams } from "./kdf";
import { addressFromMnemonic } from "./derive";

export type Account = {
  id: string;
  label: string;
  address: string;
  createdAt: string;
};

type EncryptedAccount = Account & {
  nonce: string; // b64
  ciphertext: string; // b64(secretbox(mnemonic))
};

type VaultV1 = {
  v: 1;
  kdf: { alg: "scrypt"; params: ScryptParams; salt: string };
  box: { nonce: string; ciphertext: string };
  meta: { createdAt: string };
};

type VaultV2 = {
  v: 2;
  kdf: { alg: "scrypt"; params: ScryptParams; salt: string };
  accounts: EncryptedAccount[];
  activeAccountId: string;
  meta: { createdAt: string; updatedAt: string };
};

export type UnlockedVault = {
  key: Uint8Array;
  accounts: Account[];
  activeAccountId: string;
};

const MAX_ACCOUNTS = 8;

function genId(): string {
  // Not a secret — just needs to be unique within the vault.
  return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readRaw(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function loadV1(): Promise<VaultV1 | null> {
  const raw = await readRaw(STORAGE_KEYS.VAULT_V1);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VaultV1;
  } catch {
    return null;
  }
}

async function loadV2(): Promise<VaultV2 | null> {
  const raw = await readRaw(STORAGE_KEYS.VAULT_V2);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VaultV2;
  } catch {
    return null;
  }
}

async function saveV2(vault: VaultV2): Promise<void> {
  vault.meta.updatedAt = new Date().toISOString();
  await writeRaw(STORAGE_KEYS.VAULT_V2, JSON.stringify(vault));
}

function toPublicAccounts(vault: VaultV2): Account[] {
  return vault.accounts.map(({ id, label, address, createdAt }) => ({ id, label, address, createdAt }));
}

function encryptMnemonic(key: Uint8Array, mnemonic: string, nonce: Uint8Array): string {
  const msg = new TextEncoder().encode(mnemonic);
  const boxed = nacl.secretbox(msg, nonce, key);
  return b64(boxed);
}

function decryptMnemonic(key: Uint8Array, nonceB64: string, ciphertextB64: string): string {
  const nonce = unb64(nonceB64);
  const ciphertext = unb64(ciphertextB64);
  const opened = nacl.secretbox.open(ciphertext, nonce, key);
  if (!opened) throw new Error("Invalid passcode");
  return new TextDecoder().decode(opened);
}

/* --------------------------------- status --------------------------------- */

export async function hasWallet(): Promise<boolean> {
  const v = await readRaw(STORAGE_KEYS.HAS_WALLET);
  return v === "1";
}

export async function setHasWallet(): Promise<void> {
  await writeRaw(STORAGE_KEYS.HAS_WALLET, "1");
}

export async function clearVault(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_KEYS.VAULT_V1),
    SecureStore.deleteItemAsync(STORAGE_KEYS.VAULT_V2),
    SecureStore.deleteItemAsync(STORAGE_KEYS.HAS_WALLET),
    SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED),
  ]);
}

/** Public account metadata only (no secrets) — safe to read without unlocking. */
export async function listAccounts(): Promise<Account[]> {
  const v2 = await loadV2();
  if (v2) return toPublicAccounts(v2);
  return [];
}

export async function getActiveAccountId(): Promise<string | null> {
  const v2 = await loadV2();
  return v2?.activeAccountId ?? null;
}

/* -------------------------------- creation -------------------------------- */

export async function initializeVault(
  passcode: string,
  first: { mnemonic: string; label?: string }
): Promise<UnlockedVault> {
  const salt = await randomBytes(16);
  const key = await deriveKeyScrypt(passcode, salt, DEFAULT_SCRYPT);
  const nonce = await randomNonce();

  const account: EncryptedAccount = {
    id: genId(),
    label: first.label ?? "Account 1",
    address: addressFromMnemonic(first.mnemonic),
    createdAt: new Date().toISOString(),
    nonce: b64(nonce),
    ciphertext: encryptMnemonic(key, first.mnemonic, nonce),
  };

  const vault: VaultV2 = {
    v: 2,
    kdf: { alg: "scrypt", params: DEFAULT_SCRYPT, salt: b64(salt) },
    accounts: [account],
    activeAccountId: account.id,
    meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  };

  await saveV2(vault);
  await setHasWallet();

  return { key, accounts: toPublicAccounts(vault), activeAccountId: vault.activeAccountId };
}

/* --------------------------------- unlock ---------------------------------- */

async function migrateV1ToV2(v1: VaultV1, passcode: string): Promise<VaultV2> {
  const salt = unb64(v1.kdf.salt);
  const key = await deriveKeyScrypt(passcode, salt, v1.kdf.params);

  const nonce = unb64(v1.box.nonce);
  const ciphertext = unb64(v1.box.ciphertext);
  const opened = nacl.secretbox.open(ciphertext, nonce, key);
  if (!opened) throw new Error("Invalid passcode");
  const mnemonic = new TextDecoder().decode(opened);

  const newNonce = await randomNonce();
  const account: EncryptedAccount = {
    id: genId(),
    label: "Account 1",
    address: addressFromMnemonic(mnemonic),
    createdAt: v1.meta.createdAt ?? new Date().toISOString(),
    nonce: b64(newNonce),
    ciphertext: encryptMnemonic(key, mnemonic, newNonce),
  };

  const vault: VaultV2 = {
    v: 2,
    kdf: v1.kdf,
    accounts: [account],
    activeAccountId: account.id,
    meta: { createdAt: v1.meta.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() },
  };

  await saveV2(vault);
  // Best-effort cleanup of the legacy record — safe no-op if it fails.
  await SecureStore.deleteItemAsync(STORAGE_KEYS.VAULT_V1).catch(() => {});

  return vault;
}

export async function unlockVault(passcode: string): Promise<UnlockedVault> {
  const v2 = await loadV2();

  if (v2) {
    const salt = unb64(v2.kdf.salt);
    const key = await deriveKeyScrypt(passcode, salt, v2.kdf.params);

    // Verify the passcode against the active account (or first account).
    const target = v2.accounts.find((a) => a.id === v2.activeAccountId) ?? v2.accounts[0];
    if (!target) throw new Error("Vault not found");
    decryptMnemonic(key, target.nonce, target.ciphertext); // throws if wrong passcode

    return { key, accounts: toPublicAccounts(v2), activeAccountId: v2.activeAccountId };
  }

  const v1 = await loadV1();
  if (v1) {
    const migrated = await migrateV1ToV2(v1, passcode);
    const salt = unb64(migrated.kdf.salt);
    const key = await deriveKeyScrypt(passcode, salt, migrated.kdf.params);
    return { key, accounts: toPublicAccounts(migrated), activeAccountId: migrated.activeAccountId };
  }

  throw new Error("Vault not found");
}

/* ----------------------------- mnemonic access ------------------------------ */

/** Decrypt one account's mnemonic. Requires the in-memory session key from unlockVault(). */
export async function getDecryptedMnemonic(key: Uint8Array, accountId: string): Promise<string> {
  const v2 = await loadV2();
  if (!v2) throw new Error("Vault not found");
  const account = v2.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Account not found");
  return decryptMnemonic(key, account.nonce, account.ciphertext);
}

/* ------------------------------- mutations ---------------------------------- */

export async function addAccount(
  key: Uint8Array,
  opts: { mnemonic: string; label?: string }
): Promise<{ account: Account; accounts: Account[] }> {
  const v2 = await loadV2();
  if (!v2) throw new Error("Vault not found");
  if (v2.accounts.length >= MAX_ACCOUNTS) throw new Error(`You can add up to ${MAX_ACCOUNTS} accounts.`);

  const address = addressFromMnemonic(opts.mnemonic);
  const exists = v2.accounts.some((a) => a.address.toLowerCase() === address.toLowerCase());
  if (exists) throw new Error("This account is already in your wallet.");

  const nonce = await randomNonce();
  const account: EncryptedAccount = {
    id: genId(),
    label: opts.label ?? `Account ${v2.accounts.length + 1}`,
    address,
    createdAt: new Date().toISOString(),
    nonce: b64(nonce),
    ciphertext: encryptMnemonic(key, opts.mnemonic, nonce),
  };

  v2.accounts.push(account);
  v2.activeAccountId = account.id;
  await saveV2(v2);

  return { account: { id: account.id, label: account.label, address: account.address, createdAt: account.createdAt }, accounts: toPublicAccounts(v2) };
}

export async function renameAccount(id: string, label: string): Promise<Account[]> {
  const v2 = await loadV2();
  if (!v2) throw new Error("Vault not found");
  const account = v2.accounts.find((a) => a.id === id);
  if (!account) throw new Error("Account not found");
  account.label = label.trim().slice(0, 32) || account.label;
  await saveV2(v2);
  return toPublicAccounts(v2);
}

export async function removeAccount(id: string): Promise<{ accounts: Account[]; activeAccountId: string }> {
  const v2 = await loadV2();
  if (!v2) throw new Error("Vault not found");
  if (v2.accounts.length <= 1) throw new Error("You must keep at least one account.");

  v2.accounts = v2.accounts.filter((a) => a.id !== id);
  if (v2.activeAccountId === id) {
    v2.activeAccountId = v2.accounts[0].id;
  }
  await saveV2(v2);
  return { accounts: toPublicAccounts(v2), activeAccountId: v2.activeAccountId };
}

export async function setActiveAccount(id: string): Promise<void> {
  const v2 = await loadV2();
  if (!v2) throw new Error("Vault not found");
  if (!v2.accounts.some((a) => a.id === id)) throw new Error("Account not found");
  v2.activeAccountId = id;
  await saveV2(v2);
}

/* ------------------------- back-compat (legacy V1 API) ----------------------- */
/** @deprecated kept only so old call sites still type-check during migration. */
export async function unlockVaultV1(passcode: string): Promise<string> {
  const { key, activeAccountId } = await unlockVault(passcode);
  return getDecryptedMnemonic(key, activeAccountId);
}
