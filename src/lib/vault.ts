import * as SecureStore from "expo-secure-store";
import nacl from "tweetnacl";
import { STORAGE_KEYS } from "./storageKeys";
import { b64, unb64, randomBytes, randomNonce } from "./crypto";
import { deriveKeyScrypt, DEFAULT_SCRYPT, ScryptParams } from "./kdf";

type VaultV1 = {
  v: 1;
  kdf: { alg: "scrypt"; params: ScryptParams; salt: string };
  box: { nonce: string; ciphertext: string };
  meta: { createdAt: string };
};

export async function hasWallet(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(STORAGE_KEYS.HAS_WALLET);
  return v === "1";
}

export async function setHasWallet(): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.HAS_WALLET, "1", {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function saveVaultV1(mnemonic: string, passcode: string): Promise<void> {
  // IMPORTANT: never log mnemonic/passcode
  const salt = await randomBytes(16);
  const key = await deriveKeyScrypt(passcode, salt, DEFAULT_SCRYPT);
  const nonce = await randomNonce();

  const msg = new TextEncoder().encode(mnemonic);
  const boxed = nacl.secretbox(msg, nonce, key);

  const vault: VaultV1 = {
    v: 1,
    kdf: { alg: "scrypt", params: DEFAULT_SCRYPT, salt: b64(salt) },
    box: { nonce: b64(nonce), ciphertext: b64(boxed) },
    meta: { createdAt: new Date().toISOString() },
  };

  await SecureStore.setItemAsync(STORAGE_KEYS.VAULT_V1, JSON.stringify(vault), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function loadVaultV1(): Promise<VaultV1 | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEYS.VAULT_V1);
  if (!raw) return null;
  return JSON.parse(raw) as VaultV1;
}

export async function unlockVaultV1(passcode: string): Promise<string> {
  const vault = await loadVaultV1();
  if (!vault || vault.v !== 1) throw new Error("Vault not found");

  const salt = unb64(vault.kdf.salt);
  const key = await deriveKeyScrypt(passcode, salt, vault.kdf.params);

  const nonce = unb64(vault.box.nonce);
  const ciphertext = unb64(vault.box.ciphertext);

  const opened = nacl.secretbox.open(ciphertext, nonce, key);
  if (!opened) throw new Error("Invalid passcode");

  return new TextDecoder().decode(opened);
}

export async function clearVault(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEYS.VAULT_V1);
  await SecureStore.deleteItemAsync(STORAGE_KEYS.HAS_WALLET);
  await SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED);
}
