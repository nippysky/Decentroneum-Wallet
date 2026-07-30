// src/lib/tokens/registry.ts
//
// Token registry v2 — replaces the old hardcoded ALLOWLIST_TOKENS.
//
// How new tokens get listed (see PLAN.md §5 for the full pipeline):
//   1. A project submits contract + metadata to decentroneum.com/tokens/submit.
//   2. Automated checks verify the contract, ERC-20 interface, symbol
//      uniqueness, and logo requirements.
//   3. The Decentroneum team approves the submission.
//   4. The token is published to REGISTRY_URL — it appears in every wallet
//      install on the next refresh, with no app release required.
//
// This client fetches that published list, validates every entry, and caches
// the last-known-good result so the wallet keeps working offline or if the
// registry is temporarily unreachable. The two tokens that matter most —
// native ETN and the Electroneum default token DCNT — are always bundled so
// the wallet is fully usable with zero network dependency.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_KEYS } from "@/src/lib/storage/keys";
import { TokenEntrySchema, TokenListResponseSchema } from "./schema";

export type ListedToken = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

const REGISTRY_URL = "https://decentroneum.com/api/token-list.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const FETCH_TIMEOUT_MS = 8000;

/** Always available offline — the Electroneum Smart Chain default token. */
export const DEFAULT_TOKENS: ListedToken[] = [
  {
    address: "0xE74e4E7A064310466f3bdBd3F3Ce4e8c8F7CF1d5",
    symbol: "DCNT",
    name: "Decentroneum",
    decimals: 18,
    logoURI: "https://static.electroswap.io/launchpad/presales/0x34b0dde73Ce7Dc241444B2d8A6Fe3dcB44c5FbEC_logo.webp",
  },
];

type Cache = { fetchedAt: number; tokens: ListedToken[] };

async function readCache(): Promise<Cache | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.TOKEN_REGISTRY_CACHE);
    if (!raw) return null;
    return JSON.parse(raw) as Cache;
  } catch {
    return null;
  }
}

async function writeCache(tokens: ListedToken[]): Promise<void> {
  const cache: Cache = { fetchedAt: Date.now(), tokens };
  await AsyncStorage.setItem(STORAGE_KEYS.TOKEN_REGISTRY_CACHE, JSON.stringify(cache)).catch(() => {});
}

function dedupeMergeWithDefaults(tokens: ListedToken[]): ListedToken[] {
  const byAddress = new Map<string, ListedToken>();
  for (const t of DEFAULT_TOKENS) byAddress.set(t.address.toLowerCase(), t);
  for (const t of tokens) byAddress.set(t.address.toLowerCase(), t); // remote wins on conflict (fresher metadata)
  return Array.from(byAddress.values());
}

function parseTokenList(json: unknown): ListedToken[] {
  const top = TokenListResponseSchema.safeParse(json);
  const rawTokens = top.success ? top.data.tokens : Array.isArray(json) ? json : [];

  const out: ListedToken[] = [];
  for (const raw of rawTokens) {
    const parsed = TokenEntrySchema.safeParse(raw);
    if (!parsed.success) continue; // drop malformed entries individually, never throw
    if (parsed.data.status && parsed.data.status !== "approved") continue;
    out.push({
      address: parsed.data.address,
      symbol: parsed.data.symbol,
      name: parsed.data.name,
      decimals: parsed.data.decimals,
      logoURI: parsed.data.logoURI,
    });
  }
  return out;
}

async function fetchRemote(): Promise<ListedToken[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return parseTokenList(json);
  } catch {
    return null; // offline, timeout, or malformed JSON — caller falls back
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the merged token list (bundled defaults + registry), preferring a
 * warm cache when it's fresh, otherwise refetching. Never throws — worst
 * case it returns DEFAULT_TOKENS.
 */
export async function getTokenList(opts: { forceRefresh?: boolean } = {}): Promise<ListedToken[]> {
  const cache = await readCache();
  const cacheFresh = !!cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;

  if (cacheFresh && !opts.forceRefresh) {
    return dedupeMergeWithDefaults(cache.tokens);
  }

  const remote = await fetchRemote();
  if (remote) {
    await writeCache(remote);
    return dedupeMergeWithDefaults(remote);
  }

  // Offline / unreachable — fall back to last-known-good cache, else bundled defaults.
  if (cache) return dedupeMergeWithDefaults(cache.tokens);
  return DEFAULT_TOKENS;
}

/**
 * Manual "Add token" escape hatch (same pattern as Trust Wallet / MetaMask):
 * reads symbol/name/decimals directly from the contract rather than the
 * registry, and the UI must clearly mark it "unverified" until it matches
 * the official list.
 */
export async function readErc20Metadata(address: string): Promise<{ symbol: string; name: string; decimals: number }> {
  const { ethers } = await import("ethers");
  const { getProvider } = await import("@/src/lib/chain/wallet");
  const abi = [
    "function symbol() view returns (string)",
    "function name() view returns (string)",
    "function decimals() view returns (uint8)",
  ];
  const c = new ethers.Contract(address, abi, getProvider());
  const [symbol, name, decimals] = await Promise.all([c.symbol(), c.name(), c.decimals()]);
  return { symbol, name, decimals: Number(decimals) };
}
