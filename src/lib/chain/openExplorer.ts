// src/lib/chain/openExplorer.ts
//
// Single entry point for "show this on the block explorer".
//
// Everything opens in the app's own in-app browser (app/browser/web.tsx)
// rather than handing off to the OS with Linking.openURL. Two reasons:
//
//  1. Correctness — Linking.openURL throws "Unable to open URL" whenever no
//     external handler is available (notably the iOS Simulator, and any
//     device where the default browser is restricted). That was surfacing
//     as an uncaught promise rejection after sending a transaction.
//  2. UX — the user stays inside Decent Wallet, which is also what makes
//     the explorer feel like part of the product instead of an ejection.
import { router } from "expo-router";
import { explorerAddressUrl, explorerTokenUrl, explorerTxUrl } from "@/src/lib/chain/activity";

function openInAppBrowser(url: string) {
  router.push({ pathname: "/browser/web" as any, params: { url } });
}

export function openExplorerTx(hash: string) {
  if (!hash) return;
  openInAppBrowser(explorerTxUrl(hash));
}

export function openExplorerAddress(address: string) {
  if (!address) return;
  openInAppBrowser(explorerAddressUrl(address));
}

export function openExplorerToken(address: string) {
  if (!address) return;
  openInAppBrowser(explorerTokenUrl(address));
}

/** Escape hatch for arbitrary URLs that should still stay in-app. */
export function openInApp(url: string) {
  if (!url) return;
  openInAppBrowser(url);
}

/**
 * Open a plain web page with NO wallet provider and NO unlock requirement.
 *
 * Use this for anything reachable before a wallet exists — Terms of Service,
 * Privacy Policy, support pages. openInApp() routes through the full dApp
 * browser, which redirects to /unlock when the session is locked; on the
 * onboarding screen that is a dead end, because the user has not created a
 * passcode yet.
 */
export function openInfoPage(url: string) {
  if (!url) return;
  router.push({ pathname: "/browser/web" as any, params: { url, readonly: "1" } });
}
