// server/src/marketData.ts
//
// Market data: token prices, market stats, and price history for the chart.
//
// ─── Why this lives on the server and not in the app ────────────────────────
//
// The upstream limit is enforced PER IP. If the wallet called the API
// directly, every install would be its own bucket — which sounds fine until
// you realise CoinGecko explicitly scopes the keyless tier to "low-volume,
// client-side testing... non-commercial educational use", with limits that
// are "dynamic and managed to prioritize fair access". Shipping a commercial
// wallet on that is both against the intent and unpredictable in practice.
//
// So: exactly one origin makes upstream calls, on a fixed schedule, and every
// install reads the resulting cache. User count has no effect on API usage.
// Ten users or a million: the same handful of calls per hour.
//
// ─── The pricing rule (one rule, no per-token config) ───────────────────────
//
// Every token is priced through its pool against WETN. Not "its deepest
// pool" — its deepest pool *paired with WETN*, above a liquidity floor.
//
// That distinction is load-bearing. BOLT's deepest pool is DYNO/BOLT
// ($23k), and DYNO's only real pool is DYNO/BOLT — so pricing BOLT through
// its deepest pool means pricing it against a token whose own price comes
// from BOLT. Circular. Anchoring on WETN makes every price terminate at
// something we already trust.
//
// The floor exists because this chain has pools with real-looking names and
// no money in them. BOLT alone has `USDT / BOLT`, `eUSDC / BOLT` and
// `BOLT / WETN 1%` holding between $1e-5 and $4e-19. Those pools will
// happily return a spot price and it will be arbitrary garbage. Observed
// data has a clean two-orders-of-magnitude gap: real pools at $7k–$23k,
// junk at $9.81 and below.
//
// ─── One pool for both price AND history ───────────────────────────────────
//
// GeckoTerminal's token endpoint documents `price_usd` as "the USD price of
// the token in the FIRST pool listed under top_pools", ranked by liquidity
// and volume. For BOLT that first pool is DYNO/BOLT. So using the token
// endpoint for the headline price while drawing the chart from the WETN
// pool's OHLCV would make the big number disagree with the last point on
// the line. We therefore resolve one canonical pool and read BOTH from it —
// the two agree by construction, not by coincidence.
//
// ─── Tiers ──────────────────────────────────────────────────────────────────
//
// Two free tiers, failing in opposite ways. Keyless has no monthly cap but a
// dynamic, unreadable per-minute ceiling. The Demo key (free signup) has a
// stable 100/min but a hard 10,000 calls/month. See config.ts; the cadences
// here are sized to fit inside the Demo cap, so either tier works.
//
// Docs: https://apiguide.geckoterminal.com/ and
// https://docs.coingecko.com/docs/keyless-public-api
// (attribution requested — the app shows a "Price data by GeckoTerminal" link)
import { config } from "./config";
import {
  getPriceHistory,
  getStoredPrices,
  getTokenPool,
  listTokenPools,
  pruneTokenPools,
  replacePriceHistory,
  upsertTokenPool,
  upsertTokenPrice,
} from "./db";
import { getTrackedTokens } from "./tokenRegistry";
import { acquireCall, budgetStatus, recordRateLimited } from "./apiBudget";

const FETCH_TIMEOUT_MS = 12_000;

/**
 * Chart ranges the app can ask for, and how each maps onto the upstream OHLCV
 * params. We request OHLCV because that's the only history endpoint offered,
 * then keep the close price only — the app draws a plain line, never candles.
 */
export const RANGES = {
  // `windowMs` is the real definition of each range; `limit` is only how many
  // candles we ASK for.
  //
  // Those are different things, and conflating them was a bug. The upstream
  // OHLCV endpoint returns the last N candles that EXIST, and a candle only
  // exists where a trade happened. BOLT trades about six times a day, so
  // asking for 96 fifteen-minute candles reached back TEN DAYS — and we
  // labelled it "1D". The chart was drawn from a ten-day window while the
  // headline "▲1.73% today" came from a genuine 24-hour figure, so the line
  // could fall while the percentage rose. Both numbers were internally
  // correct; they described different periods.
  //
  // Now every series is trimmed to `windowMs` after fetching. On a chain this
  // quiet that sometimes leaves two or three points, or none — which is the
  // honest answer, and the chart says "No trades in this period" rather than
  // silently widening its own window to find some.
  //
  // `limit` is generous relative to the window so a busy period is fully
  // covered; extra candles are simply trimmed away.
  "1D": {
    timeframe: "minute",
    aggregate: 15,
    limit: 200,
    windowMs: 24 * 60 * 60_000,
    refreshMs: 30 * 60_000,
  },
  "1W": {
    timeframe: "hour",
    aggregate: 4,
    limit: 200,
    windowMs: 7 * 24 * 60 * 60_000,
    refreshMs: 4 * 60 * 60_000,
  },
  "1M": {
    timeframe: "hour",
    aggregate: 12,
    limit: 200,
    windowMs: 30 * 24 * 60 * 60_000,
    refreshMs: 12 * 60 * 60_000,
  },
  "1Y": {
    timeframe: "day",
    aggregate: 1,
    limit: 365,
    windowMs: 365 * 24 * 60 * 60_000,
    refreshMs: 24 * 60 * 60_000,
  },
} as const;

export type Range = keyof typeof RANGES;
export const RANGE_KEYS = Object.keys(RANGES) as Range[];

// ─────────────────────────────────────────────────────────────────────────────
// Upstream fetch
//
// Rate limiting lives in apiBudget.ts, backed by SQLite, because the limit is
// enforced PER IP and this droplet runs more than one process that calls the
// API (the pm2 service and `npm run verify:market`). An in-process limiter
// cannot see the other process's calls, so each one believed it owned the full
// allowance and the real rate against the API was double what either intended.
// That was the cause of the 429s, not the nominal ceiling.
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER = "geckoterminal";

const GT_MAX_RETRIES = 3;

/**
 * Which host + auth we're currently using.
 *
 * Mutable because of the 401 fallback below: if a configured key is rejected,
 * we drop to the keyless root and keep serving rather than going dark. A
 * misconfigured key should degrade the tier, not the product.
 */
let activeBaseUrl = config.marketApiKey ? config.marketApiKeyedBaseUrl : config.marketApiKeylessBaseUrl;
let activeKey = config.marketApiKey;
let fellBackToKeyless = false;

/** Counts upstream failures so the verifier can't report success on cache hits. */
let upstreamFailures = 0;
export function upstreamFailureCount(): number {
  return upstreamFailures;
}
export function resetUpstreamFailureCount(): void {
  upstreamFailures = 0;
}

function buildRequest(path: string): { url: string; headers: Record<string, string> } {
  const url = new URL(`${activeBaseUrl}${path}`);
  const headers: Record<string, string> = { accept: "application/json" };

  if (activeKey) {
    switch (config.marketApiAuthMode) {
      case "header-pro":
        headers["x-cg-pro-api-key"] = activeKey;
        break;
      case "query-demo":
        url.searchParams.set("x_cg_demo_api_key", activeKey);
        break;
      case "query-pro":
        url.searchParams.set("x_cg_pro_api_key", activeKey);
        break;
      default:
        headers["x-cg-demo-api-key"] = activeKey;
    }
  }

  return { url: url.toString(), headers };
}

async function gt<T = any>(path: string, attempt = 0): Promise<T | null> {
  const allowed = await acquireCall(PROVIDER);
  if (!allowed) {
    console.warn(`[market] monthly API budget exhausted — skipping ${path}`);
    upstreamFailures++;
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { url, headers } = buildRequest(path);
    const res = await fetch(url, { signal: controller.signal, headers });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
      // Slows down EVERY process on this box, not just this one, and stays
      // slowed until a sustained clean period. The keyless ceiling is dynamic,
      // so reacting to feedback is the only way to respect a limit we can't
      // read.
      recordRateLimited(PROVIDER, retryAfterMs);

      if (attempt < GT_MAX_RETRIES) return gt<T>(path, attempt + 1);
      console.error(`[market] gave up on ${path} after ${GT_MAX_RETRIES} rate-limited attempts`);
      upstreamFailures++;
      return null;
    }

    // 401/403 = the key is being rejected, not rate-limited. Retrying is
    // pointless and the whole feature would go dark, so fall back to the
    // keyless root once and keep serving. Loud, because it silently degrades
    // the tier and someone needs to fix the key.
    if ((res.status === 401 || res.status === 403) && activeKey && !fellBackToKeyless) {
      fellBackToKeyless = true;
      activeKey = "";
      activeBaseUrl = config.marketApiKeylessBaseUrl;
      console.error(
        `[market] HTTP ${res.status} — the API key was REJECTED at ${config.marketApiKeyedBaseUrl}. ` +
          `Falling back to the keyless root (${activeBaseUrl}) so data keeps flowing. ` +
          `Run 'npm run verify:key' to find the base URL + auth mode this key actually needs.`
      );
      return gt<T>(path, attempt);
    }

    if (!res.ok) {
      console.error(`[market] GET ${path} → HTTP ${res.status}`);
      upstreamFailures++;
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[market] GET ${path} failed:`, err instanceof Error ? err.message : err);
    upstreamFailures++;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** GeckoTerminal ids look like "electroneum_0xabc…". We only want the address. */
function addressFromGtId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const m = id.match(/0x[0-9a-fA-F]{40}/);
  return m ? m[0].toLowerCase() : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const ANCHOR = config.anchorTokenAddress.toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// Job A — resolve each token's canonical WETN pool.
//
// Re-run rather than resolved once and cached forever, because liquidity
// migrates between fee tiers. BOLT currently has WETN pools at 0.05%, 0.3%
// and 1%; today the 0.3% tier holds $10,680 and the other two hold under
// $2.50 combined. That ordering can change, and when it does we should
// follow it without an app release.
// ─────────────────────────────────────────────────────────────────────────────

type ResolvedPool = {
  token: string;
  pool: string;
  /** Is our token the pool's base or quote? Decides which price field to read. */
  side: "base" | "quote";
  label: string;
  dex: string;
  liquidityUsd: number;
};

async function resolvePoolForToken(token: string): Promise<ResolvedPool | null> {
  const json = await gt(`/networks/${config.geckoTerminalNetwork}/tokens/${token}/pools`);
  const pools = Array.isArray(json?.data) ? json.data : [];
  if (pools.length === 0) {
    console.warn(`[market] ${token}: GeckoTerminal knows no pools`);
    return null;
  }

  const candidates: ResolvedPool[] = [];

  for (const p of pools) {
    const attrs = p?.attributes ?? {};
    const rels = p?.relationships ?? {};

    const base = addressFromGtId(rels?.base_token?.data?.id);
    const quote = addressFromGtId(rels?.quote_token?.data?.id);
    const poolAddr = typeof attrs.address === "string" ? attrs.address.toLowerCase() : null;
    const liquidityUsd = num(attrs.reserve_in_usd);

    if (!base || !quote || !poolAddr || liquidityUsd === null) continue;

    // Which side is our token, and is the OTHER side the anchor?
    let side: "base" | "quote" | null = null;
    if (base === token && quote === ANCHOR) side = "base";
    else if (quote === token && base === ANCHOR) side = "quote";

    // Anchor-only. This is the line that prevents pricing BOLT through DYNO.
    if (!side) continue;

    // Floor. This is the line that prevents pricing anything through a pool
    // holding $0.0000000001.
    if (liquidityUsd < config.minPoolLiquidityUsd) continue;

    candidates.push({
      token,
      pool: poolAddr,
      side,
      label: typeof attrs.name === "string" ? attrs.name : "",
      dex: addressFromGtId(rels?.dex?.data?.id) ?? String(rels?.dex?.data?.id ?? ""),
      liquidityUsd,
    });
  }

  if (candidates.length === 0) {
    console.warn(
      `[market] ${token}: no ${config.anchorSymbol} pool above $${config.minPoolLiquidityUsd} — no price will be published`
    );
    return null;
  }

  // Deepest survivor wins: the deeper the pool, the less a single trade can
  // move the number we display.
  candidates.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  return candidates[0];
}

export async function resolveAllPools(): Promise<void> {
  const tokens = getTrackedTokens();

  // Anything no longer in the published registry stops being priced, rather
  // than lingering in the cache forever with a number nobody refreshes.
  pruneTokenPools(tokens);

  for (const token of tokens) {
    const resolved = await resolvePoolForToken(token);
    if (!resolved) continue;

    const previous = getTokenPool(token);
    upsertTokenPool(resolved);

    if (previous?.pool !== resolved.pool) {
      console.log(
        `[market] ${token} → pool ${resolved.pool} (${resolved.label}, $${resolved.liquidityUsd.toFixed(2)} liquidity)`
      );
      // A different pool means the cached candles describe a different
      // market. Drop them and let the backfill repopulate.
      for (const range of RANGE_KEYS) replacePriceHistory(resolved.pool, range, []);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job B — refresh prices. ONE call covers every token.
//
// pools/multi takes up to 30 pool addresses per request, so this stays a
// single call until we list more than 30 tokens.
// ─────────────────────────────────────────────────────────────────────────────

export async function refreshPrices(): Promise<void> {
  const mapped = listTokenPools();
  if (mapped.length === 0) return;

  // 30 addresses per request is the documented maximum.
  for (let i = 0; i < mapped.length; i += 30) {
    const batch = mapped.slice(i, i + 30);
    const addresses = batch.map((m) => m.pool).join(",");
    const json = await gt(`/networks/${config.geckoTerminalNetwork}/pools/multi/${addresses}`);
    const rows = Array.isArray(json?.data) ? json.data : [];

    const byPool = new Map<string, any>();
    for (const row of rows) {
      const addr = typeof row?.attributes?.address === "string" ? row.attributes.address.toLowerCase() : null;
      if (addr) byPool.set(addr, row.attributes);
    }

    for (const m of batch) {
      const attrs = byPool.get(m.pool);
      if (!attrs) {
        console.warn(`[market] pools/multi returned nothing for ${m.pool} (${m.token})`);
        continue;
      }

      // Read the side our token actually sits on. Getting this backwards
      // yields the reciprocal price, which looks plausible enough to ship.
      const priceUsd =
        m.side === "base" ? num(attrs.base_token_price_usd) : num(attrs.quote_token_price_usd);
      const priceEtn =
        m.side === "base"
          ? num(attrs.base_token_price_native_currency)
          : num(attrs.quote_token_price_native_currency);

      upsertTokenPrice({
        token: m.token,
        pool: m.pool,
        priceUsd,
        priceEtn,
        liquidityUsd: num(attrs.reserve_in_usd),
        volume24hUsd: num(attrs.volume_usd?.h24),
        change24h: num(attrs.price_change_percentage?.h24),
        // Always present — total on-chain supply × price.
        fdvUsd: num(attrs.fdv_usd),
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Job C — refresh the price line. Staggered per range.
//
// The app never waits on GeckoTerminal for a chart; it reads our SQLite
// cache. This is also what makes a newly listed token show a full year of
// history a minute after listing instead of a blank rectangle for a month.
// ─────────────────────────────────────────────────────────────────────────────

const lastHistoryRefresh = new Map<string, number>();

async function refreshPriceHistoryFor(pool: string, side: "base" | "quote", range: Range): Promise<boolean> {
  const spec = RANGES[range];
  const path =
    `/networks/${config.geckoTerminalNetwork}/pools/${pool}/ohlcv/${spec.timeframe}` +
    `?aggregate=${spec.aggregate}&limit=${spec.limit}&currency=usd&token=${side}`;

  const json = await gt(path);
  const list = json?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) {
    console.warn(`[market] no ohlcv_list for ${pool} ${range}`);
    return false;
  }

  // Each entry is [timestamp, open, high, low, close, volume]; timestamps are
  // epoch SECONDS (not milliseconds). A line chart needs the close only.
  const all = list
    .map((row: unknown[]) => ({ t: num(row?.[0]), c: num(row?.[4]) }))
    .filter((p): p is { t: number; c: number } => p.t !== null && p.c !== null)
    .sort((a, b) => a.t - b.t);

  // Trim to the range's ACTUAL time window. Without this, a sparsely traded
  // token's "1D" chart silently stretches back however far it needs to go to
  // find `limit` candles — ten days, in BOLT's case.
  const cutoffSec = Math.floor((Date.now() - spec.windowMs) / 1000);
  const points = all.filter((p) => p.t >= cutoffSec);

  if (points.length !== all.length) {
    console.log(
      `[market] ${pool} ${range}: trimmed ${all.length - points.length} point(s) older than the ${range} window ` +
        `(${points.length} remain)`
    );
  }

  // An empty result is a real answer — "nothing traded in this window" — and
  // must be stored as such. Returning early would leave yesterday's wider
  // series in place, which is exactly the mislabelling this fixes.
  replacePriceHistory(pool, range, points);
  return true;
}

export async function refreshPriceHistory(force = false): Promise<void> {
  const mapped = listTokenPools();
  const now = Date.now();

  // Native ETN first — it's the asset every user holds, so it's the one chart
  // most likely to be looked at.
  for (const range of RANGE_KEYS) {
    const key = `${NATIVE_HISTORY_KEY}:${range}`;
    const due = force || now - (lastHistoryRefresh.get(key) ?? 0) >= RANGES[range].refreshMs;
    const empty = getPriceHistory(NATIVE_HISTORY_KEY, range).length === 0;
    if (!due && !empty) continue;

    if (await refreshNativeHistoryFor(range)) lastHistoryRefresh.set(key, now);
  }

  for (const m of mapped) {
    for (const range of RANGE_KEYS) {
      const key = `${m.pool}:${range}`;
      const due = force || now - (lastHistoryRefresh.get(key) ?? 0) >= RANGES[range].refreshMs;
      // An empty cache means this is a newly listed token — backfill it now
      // regardless of where it sits in the refresh cycle.
      const empty = getPriceHistory(m.pool, range).length === 0;
      if (!due && !empty) continue;

      const ok = await refreshPriceHistoryFor(m.pool, m.side, range);
      // Only record the attempt if it WORKED. Marking a failed fetch as
      // "refreshed" meant a throttled request had to wait out the range's
      // full interval before being retried — 24 hours for 1Y. The next
      // scheduler tick (60s) now picks failures back up.
      if (ok) lastHistoryRefresh.set(key, now);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ETN/USD — the one number that does NOT come from GeckoTerminal.
//
// ETN has a real listed market, so CoinGecko is the right source for it, and
// it's the only thing CoinGecko is used for. Every *token* price comes from
// on-chain pools via GeckoTerminal; mixing the two per-token would give us
// two code paths that eventually disagree about the same token.
// ─────────────────────────────────────────────────────────────────────────────

let etnUsd: { usd: number; change24h: number | null; at: number } | null = null;

/**
 * Storage key for native ETN's price line.
 *
 * The history table is keyed by POOL address, but ETN has no pool of its own —
 * it IS the thing every pool is priced against. So it gets a sentinel key.
 * Not a real address, and deliberately not address-shaped, so it can never
 * collide with one.
 */
export const NATIVE_HISTORY_KEY = "native:etn";

/** How many days of CoinGecko history each range needs. */
const NATIVE_RANGE_DAYS: Record<Range, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "1Y": 365,
};

/**
 * Native ETN price history, from CoinGecko rather than a DEX pool.
 *
 * ETN is a genuinely listed coin with real exchange volume, so its history is
 * a market fact rather than one pool's opinion — and there is no ETN/ETN pool
 * to read anyway. This is the same source as the spot ETN price above, so the
 * chart and the headline stay consistent, exactly as they do for tokens.
 */
async function refreshNativeHistoryFor(range: Range): Promise<boolean> {
  const days = NATIVE_RANGE_DAYS[range];
  const url = new URL(`https://api.coingecko.com/api/v3/coins/${config.coingeckoEtnId}/market_chart`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("days", String(days));
  if (config.marketApiKey) url.searchParams.set("x_cg_demo_api_key", config.marketApiKey);

  const allowed = await acquireCall(PROVIDER);
  if (!allowed) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal, headers: { accept: "application/json" } });
    if (res.status === 429) {
      recordRateLimited(PROVIDER, 0);
      upstreamFailures++;
      return false;
    }
    if (!res.ok) {
      console.error(`[market] coingecko market_chart ${range} → HTTP ${res.status}`);
      upstreamFailures++;
      return false;
    }

    const json: any = await res.json();
    // `prices` is [[ms, price], ...] — MILLISECONDS here, unlike the OHLCV
    // endpoint's seconds. Converted on the way in so everything downstream
    // speaks one unit.
    const raw: unknown[] = Array.isArray(json?.prices) ? json.prices : [];
    const points = raw
      .map((row: any) => {
        const ms = num(row?.[0]);
        const price = num(row?.[1]);
        if (ms === null || price === null) return null;
        // → seconds, matching the OHLCV path so everything downstream (SQLite,
        // the API, the chart) speaks exactly one time unit.
        return { t: Math.floor(ms / 1000), c: price };
      })
      .filter((p): p is { t: number; c: number } => p !== null && p.t > 0)
      .sort((a, b) => a.t - b.t);

    if (points.length === 0) return false;

    // CoinGecko returns 5-minute granularity for 1 day, which is ~288 points.
    // Thin to roughly 120 so the phone draws a smooth line without shipping
    // three times the data it can resolve on a 350pt-wide chart.
    const stride = Math.max(1, Math.ceil(points.length / 120));
    const thinned = points.filter((_, i) => i % stride === 0 || i === points.length - 1);

    replacePriceHistory(NATIVE_HISTORY_KEY, range, thinned);
    return true;
  } catch (err) {
    console.error(`[market] coingecko market_chart ${range} failed:`, err instanceof Error ? err.message : err);
    upstreamFailures++;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshEtnPrice(): Promise<void> {
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", config.coingeckoEtnId);
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    // Optional: CoinGecko's keyless public tier is heavily throttled. A free
    // demo key raises it substantially and changes nothing else.
    if (config.coingeckoApiKey) headers["x-cg-demo-api-key"] = config.coingeckoApiKey;

    const res = await fetch(url.toString(), { signal: controller.signal, headers });
    if (!res.ok) {
      console.error(`[market] coingecko HTTP ${res.status}`);
      return;
    }
    const json: any = await res.json();
    const usd = num(json?.[config.coingeckoEtnId]?.usd);
    if (usd === null) return;
    etnUsd = {
      usd,
      change24h: num(json?.[config.coingeckoEtnId]?.usd_24h_change),
      at: Date.now(),
    };
  } catch (err) {
    console.error("[market] coingecko fetch failed:", err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read side — what the HTTP endpoints serve
// ─────────────────────────────────────────────────────────────────────────────

export function marketSnapshot() {
  const prices = getStoredPrices();
  const pools = new Map(listTokenPools().map((m) => [m.token, m]));

  return {
    updatedAt: new Date().toISOString(),
    // Attribution — requested by GeckoTerminal in exchange for the free tier,
    // and surfaced in the app rather than buried here.
    attribution: {
      prices: "GeckoTerminal",
      pricesUrl: `https://www.geckoterminal.com/${config.geckoTerminalNetwork}/pools`,
      native: "CoinGecko",
    },
    native: etnUsd
      ? { symbol: "ETN", priceUsd: etnUsd.usd, change24h: etnUsd.change24h, updatedAt: new Date(etnUsd.at).toISOString() }
      : null,
    tokens: prices.map((p) => {
      const pool = pools.get(p.token);
      return {
        address: p.token,
        priceUsd: p.priceUsd,
        priceEtn: p.priceEtn,
        change24h: p.change24h,
        liquidityUsd: p.liquidityUsd,
        volume24hUsd: p.volume24hUsd,
        fdvUsd: p.fdvUsd,
        // Stays null for tokens CoinGecko hasn't verified the supply of.
        // The app hides the row when it's null instead of showing a zero.
        pool: p.pool,
        poolLabel: pool?.label ?? null,
        dex: pool?.dex ?? null,
        updatedAt: p.updatedAt,
      };
    }),
  };
}

export function priceSeries(token: string, range: Range) {
  // "native" is how the app asks for ETN itself, which has no contract address
  // and no pool — see NATIVE_HISTORY_KEY.
  if (token.toLowerCase() === "native") {
    return {
      token: "native",
      pool: NATIVE_HISTORY_KEY,
      poolLabel: "ETN / USD",
      range,
      points: getPriceHistory(NATIVE_HISTORY_KEY, range),
    };
  }

  const mapping = getTokenPool(token.toLowerCase());
  if (!mapping) return null;
  return {
    token: token.toLowerCase(),
    pool: mapping.pool,
    poolLabel: mapping.label,
    range,
    points: getPriceHistory(mapping.pool, range),
  };
}

export function marketStatus() {
  return {
    network: config.geckoTerminalNetwork,
    anchor: { symbol: config.anchorSymbol, address: config.anchorTokenAddress },
    minPoolLiquidityUsd: config.minPoolLiquidityUsd,
    api: budgetStatus(PROVIDER),
    keyed: !!activeKey,
    baseUrl: activeBaseUrl,
    keyRejected: fellBackToKeyless,
    pools: listTokenPools(),
    nativePriceLoaded: etnUsd !== null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────────────────────────────────────

export function startMarketData(): () => void {
  const timers: NodeJS.Timeout[] = [];

  const run = (label: string, fn: () => Promise<void>) => {
    fn().catch((err) => console.error(`[market] ${label} failed:`, err));
  };

  // Boot order matters: pools must exist before prices or candles can be
  // fetched for them.
  (async () => {
    await resolveAllPools().catch((e) => console.error("[market] initial pool resolve failed:", e));
    await refreshPrices().catch((e) => console.error("[market] initial price refresh failed:", e));
    await refreshEtnPrice().catch(() => {});
    await refreshPriceHistory(true).catch((e) => console.error("[market] initial price-history backfill failed:", e));
    console.log(
      `[market] started — ${activeKey ? "keyed" : "keyless"} ${activeBaseUrl}, ` +
        `anchor ${config.anchorSymbol}, floor $${config.minPoolLiquidityUsd}, ` +
        `${listTokenPools().length} priced token(s), ` +
        `${budgetStatus(PROVIDER).monthlyUsed} call(s) used this month`
    );
  })();

  timers.push(setInterval(() => run("pool resolve", resolveAllPools), config.poolResolveIntervalMs));
  timers.push(setInterval(() => run("price refresh", () => refreshPrices()), config.priceRefreshIntervalMs));
  timers.push(setInterval(() => run("etn price", refreshEtnPrice), config.priceRefreshIntervalMs));
  // Runs often; each (pool, range) decides internally whether it's actually due.
  timers.push(setInterval(() => run("price history refresh", () => refreshPriceHistory()), 60_000));

  for (const t of timers) t.unref?.();

  return () => {
    for (const t of timers) clearInterval(t);
  };
}
