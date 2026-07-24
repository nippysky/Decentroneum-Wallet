// src/lib/permissions.ts
import * as SecureStore from "expo-secure-store";

const KEY = "dw_connected_domains_v1";

type Store = Record<string, { connected: boolean; updatedAt: string }>;

async function read(): Promise<Store> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

async function write(s: Store) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function isDomainConnected(domain: string): Promise<boolean> {
  const s = await read();
  return !!s[domain]?.connected;
}

export async function setDomainConnected(domain: string, connected: boolean): Promise<void> {
  const s = await read();
  s[domain] = { connected, updatedAt: new Date().toISOString() };
  await write(s);
}

export async function disconnectDomain(domain: string): Promise<void> {
  const s = await read();
  delete s[domain];
  await write(s);
}
