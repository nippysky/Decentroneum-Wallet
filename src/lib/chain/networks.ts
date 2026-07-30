// src/lib/networks.ts
//
// Both RPC URLs here are public/free endpoints — intentionally. This file
// ships inside the app bundle onto every user's device; a private/paid API
// key placed here would be extractable by anyone who unpacks the bundle.
// See getProvider() in chain/wallet.ts for how these combine into an
// ordered failover chain (try rpcUrl, fall back to rpcFallbackUrls in order
// only on error — never queried in parallel).
export const ELECTRONEUM = {
  name: "Electroneum Mainnet",
  chainId: 52014,
  rpcUrl: "https://rpc.electroneum.com", // Electroneum's own official public endpoint
  // Ordered fallbacks, tried one at a time only when the one before it
  // fails. Three independent operators, so an outage at any single company
  // can't take the wallet offline:
  //   1. Ankr   — public, unkeyed.
  //   2. thirdweb — public, unkeyed (https://thirdweb.com/electroneum).
  //      The 52014 prefix is just the chain ID; there is no account or API
  //      key in this URL, which is exactly why it's safe to ship in a client
  //      bundle. thirdweb rate-limits unkeyed traffic per IP, which for a
  //      third-in-line fallback is fine — it only ever sees traffic when two
  //      other providers are already down.
  rpcFallbackUrls: ["https://rpc.ankr.com/electroneum", "https://52014.rpc.thirdweb.com"],
  symbol: "ETN",
  decimals: 18,
  explorer: "https://blockexplorer.electroneum.com/",
} as const;
