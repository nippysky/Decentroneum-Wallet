// src/lib/tokens/native.ts
//
// The chain's own currency, described once.
//
// This file exists because the opposite happened: a CoinMarketCap image URL
// for ETN was pasted into the token detail screen, the send flow AND the
// balance watcher. Three copies meant three chances to be wrong, and they
// were — the URL pointed at the wrong coin, so Home showed one mark and the
// detail screen showed another for the same asset.
//
// The rule now: nothing outside this module names, describes or illustrates
// native ETN. The logo in particular is BUNDLED (see TokenLogo's `native`
// prop) rather than fetched, because the chain's own currency appears on the
// first row of the first screen and must not depend on a CDN that can move,
// rate-limit, or serve a different token's artwork.
import { ELECTRONEUM } from "@/src/lib/chain/networks";

export const NATIVE_ASSET = {
  /** "ETN" — what a balance is denominated in. */
  symbol: ELECTRONEUM.symbol,
  /** "Electroneum" — what a person calls it. Used for titles and headers. */
  name: "Electroneum",
  decimals: ELECTRONEUM.decimals,
} as const;

/**
 * The route param that means "the native currency".
 *
 * Native ETN has no contract address, so it needs a sentinel to travel through
 * routes and notification payloads that otherwise carry one.
 */
export const NATIVE_ASSET_ID = "native";

/** True when an address-or-sentinel refers to native ETN. */
export function isNativeAssetId(id: string | null | undefined): boolean {
  return !id || id.toLowerCase() === NATIVE_ASSET_ID;
}
