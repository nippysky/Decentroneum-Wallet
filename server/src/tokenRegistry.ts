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

/** Lowercased contract addresses currently being watched. */
let tracked: string[] = [];
let lastGoodAt: number | null = null;
let usingCache = false;
let timer: NodeJS.Timeout | null = null;

function normalize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const raw of list) {
    const addr =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && typeof (raw as any).address === "string"
        ? (raw as any).address
        : null;
    if (!addr) continue;
    // Accept anything address-shaped; the RPC will reject genuine nonsense.
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr.trim())) continue;
    out.add(addr.trim().toLowerCase());
  }
  return Array.from(out);
}

async function fetchRegistry(): Promise<string[] | null> {
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
    next.length !== tracked.length || next.some((a) => !tracked.includes(a));

  tracked = next;
  lastGoodAt = Date.now();
  usingCache = false;
  // Persist on every success, so the cold-start fallback is never older than
  // the last time the registry was actually reachable.
  saveRegistryCache(next);

  if (changed) {
    console.log(`[registry] tracking ${tracked.length} token(s): ${tracked.join(", ")}`);
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
 * The live list. Call this per use rather than caching a reference — it
 * changes when a new token is listed, without a redeploy or restart.
 */
export function getTrackedTokens(): string[] {
  return tracked;
}

/** Exposed on /health so you can confirm sync without SSH-ing in. */
export function tokenRegistryStatus() {
  return {
    source: REGISTRY_URL,
    count: tracked.length,
    tokens: tracked,
    lastGoodAt: lastGoodAt ? new Date(lastGoodAt).toISOString() : null,
    // True when serving the SQLite cache because the registry is unreachable.
    usingCache,
  };
}
