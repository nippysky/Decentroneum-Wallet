// src/lib/notifications/register.ts
//
// Client side of the server-push registration contract implemented in
// server/src/verify.ts + server/src/server.ts. Proves ownership of an
// address by signing a short message with its private key, then registers
// the device's Expo push token against that address so the backend watcher
// (server/src/chainWatcher.ts) can notify this device even when the app is
// backgrounded or killed — which the in-app watcher (watcher.ts) can't do.
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { getDecryptedMnemonic } from "@/src/lib/crypto/vault";
import { getSigner } from "@/src/lib/chain/wallet";

// REPLACE once server/ is deployed (see server/README.md).
export const PUSH_SERVER_URL = "https://push.decentroneum.com";

function buildRegistrationMessage(address: string, pushToken: string, timestamp: string): string {
  // Must exactly match server/src/verify.ts#buildRegistrationMessage.
  return [
    "Register this device for Decent Wallet notifications.",
    `address:${address.toLowerCase()}`,
    `pushToken:${pushToken}`,
    `timestamp:${timestamp}`,
  ].join("\n");
}

export async function getExpoPushToken(): Promise<string | null> {
  try {
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return token.data;
  } catch {
    return null; // simulator, no EAS project configured yet, etc. — non-fatal
  }
}

/** Registers one account's address against this device's push token. Best-effort, never throws. */
export async function registerAddressForPush(opts: { address: string; vaultKey: Uint8Array; accountId: string }): Promise<void> {
  try {
    const pushToken = await getExpoPushToken();
    if (!pushToken) return;

    const timestamp = new Date().toISOString();
    const message = buildRegistrationMessage(opts.address, pushToken, timestamp);

    const mnemonic = await getDecryptedMnemonic(opts.vaultKey, opts.accountId);
    const signer = getSigner(mnemonic);
    const signature = await signer.signMessage(message);

    await fetch(`${PUSH_SERVER_URL}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: opts.address, pushToken, platform: Platform.OS, timestamp, signature }),
    });
  } catch {
    // No backend deployed yet, offline, etc. — the client-side watcher in
    // watcher.ts still covers foregrounded notifications regardless.
  }
}

export async function unregisterPush(pushToken: string): Promise<void> {
  try {
    await fetch(`${PUSH_SERVER_URL}/unregister`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pushToken }),
    });
  } catch {
    // best effort
  }
}
