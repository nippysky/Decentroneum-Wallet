// src/lib/walletconnect/client.ts
//
// WalletConnect v2 singleton client. Lets external dapps (running in a
// desktop or mobile browser — anywhere outside our in-app browser) pair with
// Decent Wallet via a WC URI, propose a session, and send signing/tx
// requests, the same way MetaMask Mobile / Trust Wallet do.
//
// IMPORTANT: get a free Project ID from https://cloud.reown.com (formerly
// cloud.walletconnect.com) and replace the placeholder below before
// shipping — WalletConnect's relay network requires one per app.
import "@walletconnect/react-native-compat";
import { SignClient } from "@walletconnect/sign-client";
import type SignClientType from "@walletconnect/sign-client";

export const WALLETCONNECT_PROJECT_ID = "REPLACE_WITH_WALLETCONNECT_PROJECT_ID";

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
