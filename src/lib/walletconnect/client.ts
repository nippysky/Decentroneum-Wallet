// src/lib/walletconnect/client.ts
//
// WalletConnect v2 singleton client. Lets external dapps (running in a
// desktop or mobile browser — anywhere outside our in-app browser) pair with
// Decent Wallet via a WC URI, propose a session, and send signing/tx
// requests, the same way MetaMask Mobile / Trust Wallet do.
//
// IMPORTANT: get a free Project ID from https://cloud.reown.com (formerly
// cloud.walletconnect.com) and set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID in
// your .env before shipping — WalletConnect's relay network requires one
// per app, and pairing will silently fail without a real value. This id is
// not a secret (it's embedded in the client bundle either way), so
// EXPO_PUBLIC_ exposure is intentional and safe.
import "@walletconnect/react-native-compat";
import { SignClient } from "@walletconnect/sign-client";
import type SignClientType from "@walletconnect/sign-client";

const PLACEHOLDER = "REPLACE_WITH_WALLETCONNECT_PROJECT_ID";

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || PLACEHOLDER;

if (__DEV__ && WALLETCONNECT_PROJECT_ID === PLACEHOLDER) {
  console.warn(
    "[WalletConnect] EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID is not set — get a free Project ID from https://cloud.reown.com and add it to .env. Pairing with external dapps will fail until this is set."
  );
}

export const WC_METADATA = {
  name: "Decent Wallet",
  description: "The non-custodial mobile wallet for the Electroneum Smart Chain ecosystem.",
  url: "https://decentroneum.com",
  icons: ["https://decentroneum.com/opengraph-image.png"],
};

let clientPromise: Promise<SignClientType> | null = null;

/** Lazily initializes (once) and returns the shared SignClient instance. */
export function getWalletConnectClient(): Promise<SignClientType> {
  if (!clientPromise) {
    clientPromise = SignClient.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: WC_METADATA,
    });
  }
  return clientPromise;
}
