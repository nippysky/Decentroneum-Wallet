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
  rpcFallbackUrls: ["https://rpc.ankr.com/electroneum"], // Ankr's public (unkeyed) endpoint
  symbol: "ETN",
  decimals: 18,
  explorer: "https://blockexplorer.electroneum.com/",
} as const;
