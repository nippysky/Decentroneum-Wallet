// server/src/tokenRegistry.ts
//
// Which token contracts this watcher notifies on.
//
// This used to be a static TRACKED_TOKENS env var — a second, hand-copied
// list that had to be kept in step with the wallet's published registry at
// decentroneum.com/api/token-list.json. When the two drifted (and they
// would, silently) a token appeared in every user's wallet while generating
// zero notifications, with nothing anywhere reporting the mismatch.
//
// Now the registry is the single source of truth and this fetches it, with a
// three-tier chain so the watcher can never go dark:
//
//   1. Fetch the published registry (authoritative).
//   2. On failure, keep the last good list we already had in memory.
//   3. If we never got one — e.g. a restart during an outage — read the last
//      good list from SQLite.
//
// Tier 3 used to be a hand-maintained TRACKED_TOKENS env var, and it had
// already drifted: it listed DCNT but not BOLT, months after BOLT was listed.
// That is the worst possible kind of stale, because tier 3 is consulted ONLY
// during an outage — the one moment nobody is watching closely enough to
// notice the list is wrong. Persisting the real registry to disk on every
// successful fetch gives the same protection with no duplicate to maintain
// and no way for it to drift.
import { loadRegistryCache, saveRegistryCache } from "./db";

const REGISTRY_URL = process.env.TOKEN_REGISTRY_URL ?? "https://decentroneum.com/api/token-list.json";
const REFRESH_INTERVAL_MS = Number(process.env.TOKEN_REGISTRY_REFRESH_MS ?? 30 * 60 * 1000); // 30m
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Full metadata for every watched token, keyed by lowercased address.
 *
 * This used to be a bare address list, and the cost of that showed up in the
 * notifications: the watcher knew a transfer had happened but not what token
 * it was, so every ERC-20 alert read "Token received / +5 tokens" with
 * decimals hardcoded to 18. Carrying the registry's own symbol/decimals/logo
 * through means a notification can say "DCNT received / +5.00 DCNT" and show
 * the right icon, with no second source of truth to drift.
 */
export type TrackedToken = {
  /** Lowercased contract address. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

let tracked: TrackedToken[] = [];
let lastGoodAt: number | null = null;
let usingCache = false;
let timer: NodeJS.Timeout | null = null;

function normalize(list: unknown): TrackedToken[] {
  if (!Array.isArray(list)) return [];

  const out = new Map<string, TrackedToken>();
  for (const raw of list) {
    // A bare string is still accepted so an older/simpler registry payload
    // keeps working — it just yields a token with no symbol, which the
    // notification code falls back gracefully for.
    const entry = typeof raw === "string" ? { address: raw } : raw;
    if (!entry || typeof entry !== "object") continue;

    const address = typeof (entry as any).address === "string" ? (entry as any).address.trim() : null;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;

    const decimals = Number((entry as any).decimals);

    out.set(address.toLowerCase(), {
      address: address.toLowerCase(),
      symbol: typeof (entry as any).symbol === "string" ? (entry as any).symbol : "",
      name: typeof (entry as any).name === "string" ? (entry as any).name : "",
      // 18 is the ERC-20 convention and the right guess when the registry
      // omits it — but it is a GUESS, so it must never override a real value.
      decimals: Number.isFinite(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18,
      logoURI: typeof (entry as any).logoURI === "string" ? (entry as any).logoURI : undefined,
    });
  }
  return Array.from(out.values());
}

async function fetchRegistry(): Promise<TrackedToken[] | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) {
      console.error(`[registry] HTTP ${res.status} from ${REGISTRY_URL}`);
      return null;
    }
    const json: any = await res.json();
    const addresses = normalize(json?.tokens ?? json);
    // An empty registry is almost certainly a deploy/CDN glitch rather than
    // a deliberate "watch nothing" — refuse it and keep the previous list.
    if (addresses.length === 0) {
      console.error("[registry] registry returned zero tokens; keeping previous list");
      return null;
    }
    return addresses;
  } catch (err) {
    console.error("[registry] fetch failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function refresh(): Promise<void> {
  const next = await fetchRegistry();

  if (!next) {
    if (tracked.length === 0) {
      const cached = loadRegistryCache();
      if (cached) {
        tracked = normalize(cached.tokens);
        usingCache = true;
        console.warn(
          `[registry] registry unreachable — using cached list from ${cached.fetchedAt} ` +
            `(${tracked.length} token(s))`
        );
      } else {
        // Only reachable on a genuinely first boot that can't reach the
        // registry. Native ETN transfers still notify; token transfers don't
        // until the next successful fetch.
        console.warn("[registry] registry unreachable and no cache yet — watching native transfers only");
      }
    }
    return;
  }

  const changed =
    next.length !== tracked.length || next.some((n) => !tracked.some((t) => t.address === n.address));

  tracked = next;
  lastGoodAt = Date.now();
  usingCache = false;
  // Persist on every success, so the cold-start fallback is never older than
  // the last time the registry was actually reachable.
  saveRegistryCache(next);

  if (changed) {
    console.log(
      `[registry] tracking ${tracked.length} token(s): ` +
        tracked.map((t) => `${t.symbol || "?"} (${t.address})`).join(", ")
    );
  }
}

/**
 * Loads the registry once, then keeps it fresh in the background. Awaiting
 * this at boot means the first backfill already has the right token set.
 */
export async function startTokenRegistry(): Promise<void> {
  await refresh();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    refresh().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  // Don't hold the process open on this timer alone.
  timer.unref?.();
}

export function stopTokenRegistry(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Lowercased addresses only — what the log filters and the market resolver
 * need. Call per use rather than caching a reference: the list changes when a
 * token is listed, with no redeploy or restart.
 */
export function getTrackedTokens(): string[] {
  return tracked.map((t) => t.address);
}

/** Full metadata for one token, or null if it isn't in the registry. */
export function getTrackedToken(address: string): TrackedToken | null {
  const key = address.toLowerCase();
  return tracked.find((t) => t.address === key) ?? null;
}

/** Exposed on /health so you can confirm sync without SSH-ing in. */
export function tokenRegistryStatus() {
  return {
    source: REGISTRY_URL,
    count: tracked.length,
    tokens: tracked.map((t) => `${t.symbol || "?"} ${t.address}`),
    lastGoodAt: lastGoodAt ? new Date(lastGoodAt).toISOString() : null,
    // True when serving the SQLite cache because the registry is unreachable.
    usingCache,
  };
}
