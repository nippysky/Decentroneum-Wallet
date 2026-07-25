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
// Now the registry is the single source of truth and this fetches it. The
// env var survives as a fallback so the watcher can never go dark:
//
//   1. Fetch the published registry (authoritative).
//   2. On failure, keep the last good list we already had in memory.
//   3. If we never got one — e.g. a restart during an outage — fall back to
//      TRACKED_TOKENS from the environment.
//
// Keep TRACKED_TOKENS populated for exactly that third case.
import { config } from "./config";

const REGISTRY_URL = process.env.TOKEN_REGISTRY_URL ?? "https://decentroneum.com/api/token-list.json";
const REFRESH_INTERVAL_MS = Number(process.env.TOKEN_REGISTRY_REFRESH_MS ?? 30 * 60 * 1000); // 30m
const FETCH_TIMEOUT_MS = 10_000;

/** Lowercased contract addresses currently being watched. */
let tracked: string[] = [];
let lastGoodAt: number | null = null;
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
      const fallback = normalize(config.trackedTokens);
      if (fallback.length > 0) {
        tracked = fallback;
        console.warn(`[registry] using TRACKED_TOKENS fallback (${tracked.length} token(s))`);
      } else {
        console.warn("[registry] no registry and no TRACKED_TOKENS — watching native transfers only");
      }
    }
    return;
  }

  const changed =
    next.length !== tracked.length || next.some((a) => !tracked.includes(a));

  tracked = next;
  lastGoodAt = Date.now();

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
    usingFallback: lastGoodAt === null && tracked.length > 0,
  };
}
