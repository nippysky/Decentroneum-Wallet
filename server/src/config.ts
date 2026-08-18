import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Is a market-data API key configured?
 *
 * Read before the config object is built, because the safe pacing defaults
 * differ enormously between the two tiers: the keyless ceiling is dynamic and
 * invisible, so it has to be guessed at conservatively; the Demo tier's is a
 * published, fixed 100/min, so guessing is unnecessary.
 */
const HAS_MARKET_KEY = !!(process.env.MARKET_API_KEY ?? "");

export const config = {
  // Primary HTTP endpoint — your dedicated/paid RPC (e.g. Ankr's keyed URL).
  // Used for startup backfill, reconnect gap-filling, and the periodic
  // reconcile safety net (see chainWatcher.ts) — never the live delivery
  // path once the WebSocket is connected. Kept server-side only: this key
  // must never end up in the mobile app bundle (see src/lib/chain/networks.ts
  // in the main app for why).
  rpcUrl: required("RPC_URL", "https://rpc.ankr.com/electroneum"),
  // Ordered fallback chain, tried in order only if RPC_URL fails or times
  // out (see buildHttpProvider() in chainWatcher.ts — quorum:1 means we only
  // ever query ONE of these per call, never all of them, so cost doesn't
  // multiply). Defaults to Electroneum's own public endpoint, then Ankr's
  // public (unkeyed) one, then thirdweb's public endpoint for Electroneum
  // (https://thirdweb.com/electroneum — the 52014 in the hostname is the
  // chain ID, not an account key). Three independent operators, so the
  // watcher can only go fully dark if all three are down at once.
  rpcFallbackUrls: (process.env.RPC_FALLBACK_URLS ??
    "https://rpc.electroneum.com,https://rpc.ankr.com/electroneum,https://52014.rpc.thirdweb.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // WebSocket endpoint — the live delivery path. The node pushes new blocks
  // and matching logs to us over one persistent connection instead of us
  // polling for them. Get this from your RPC provider's dashboard (Ankr
  // exposes a wss:// URL alongside the https:// one for paid plans). There is
  // currently no known public wss:// fallback for Electroneum — if this goes
  // down, chainWatcher.ts degrades to faster HTTP polling via the fallback
  // chain above rather than going dark; see startDegradedPollingWatchdog().
  rpcWsUrl: required("RPC_WS_URL", "wss://rpc.ankr.com/electroneum/ws"),
  chainId: Number(required("CHAIN_ID", "52014")),

  // ── Market data API (see marketData.ts + apiBudget.ts) ────────────────────
  //
  // Two tiers exist, both free, and they fail in opposite ways:
  //
  //   KEYLESS  api.geckoterminal.com/api/v2  — no signup. But CoinGecko
  //            documents the limit as "dynamic and managed to prioritize fair
  //            access", and states the tier is "optimized for low-volume,
  //            client-side testing... non-commercial". A moving ceiling can't
  //            be respected by any fixed rate, which is why we saw 429s at
  //            well under the nominal 30/min. No monthly cap.
  //
  //   DEMO KEY api.coingecko.com/api/v3/onchain — free signup, real key.
  //            STABLE 100 calls/min, but a hard cap of 10,000 calls/month.
  //            Onchain/DEX endpoints are included in the Demo plan.
  //
  // Defaults below target the keyless tier conservatively. Set
  // MARKET_API_KEY to switch to Demo, which is the right tier for production:
  // a predictable ceiling beats a generous but unpredictable one.
  marketApiKey: process.env.MARKET_API_KEY ?? "",
  // Overridden automatically when a key is present — see marketApiBaseUrl below.
  marketApiKeylessBaseUrl: process.env.MARKET_API_KEYLESS_BASE_URL ?? "https://api.geckoterminal.com/api/v2",
  marketApiKeyedBaseUrl: process.env.MARKET_API_KEYED_BASE_URL ?? "https://api.coingecko.com/api/v3/onchain",
  // How the key is presented. CoinGecko's reference docs describe a header,
  // but their own onboarding screen passes it as a query parameter — and
  // nothing states which is correct for the ONCHAIN endpoints specifically.
  // `npm run verify:key` tests every combination against a live endpoint and
  // prints the one that works; set this to its answer rather than guessing.
  marketApiAuthMode: (process.env.MARKET_API_AUTH_MODE ?? "header-demo") as
    | "header-demo"
    | "header-pro"
    | "query-demo"
    | "query-pro",

  // Pacing, and the defaults differ by tier because the two ceilings are
  // fundamentally different kinds of thing.
  //
  // KEYLESS — 5/min, 12s apart. Set from live observation, not documentation:
  //   a 429 arrived at TWELVE calls spaced SIX seconds apart (~2/min) with no
  //   other process running. The real ceiling is dynamic and lower than any
  //   published figure, so the only safe approach is to stay far below a number
  //   we cannot read.
  //
  // KEYED — 30/min, 2s apart. The Demo tier publishes a FIXED 100/min, so
  //   there's nothing to guess. Still 3x under it, but 6x faster than keyless,
  //   which is what makes a new token's first backfill take ~20 seconds instead
  //   of ~2 minutes.
  //
  // Note this changes SPEED, not VOLUME. Total monthly calls are set by the
  // refresh cadences below, not by how fast a burst is allowed to drain — so
  // going faster here costs nothing against the 10,000/month cap.
  marketApiMaxCallsPerMinute: Number(
    process.env.MARKET_API_MAX_CALLS_PER_MINUTE ?? (HAS_MARKET_KEY ? 30 : 5)
  ),
  // Rate alone is not enough. An earlier limiter enforced only "N per minute",
  // which permitted the whole allowance back-to-back — and that burst tripped
  // the throttle even when the average was well under the limit.
  marketApiMinSpacingMs: Number(
    process.env.MARKET_API_MIN_SPACING_MS ?? (HAS_MARKET_KEY ? 2_000 : 12_000)
  ),
  // Random extra delay per call, so a regular schedule never lines up with a
  // fixed rate-limit window. Cheap insurance against a systematic collision.
  marketApiJitterMs: Number(process.env.MARKET_API_JITTER_MS ?? 3000),
  // 0 = uncapped (keyless). The Demo tier's 10,000/month is the binding
  // constraint, not the per-minute rate.
  //
  // The original cadences were sized from an estimate of "~8,000/month for two
  // tokens" that undercounted in two ways: it missed that native ETN is a
  // THIRD history series alongside the pools, and that `refreshEtnPrice` runs
  // on its own timer at the same interval as `refreshPrices` — so the price
  // leg costs double what one timer would. Real demand was ~13,900/month, and
  // the allowance ran out on the 18th.
  //
  // Cadences are now sized at ~5,790/month for two tokens; the full arithmetic
  // is in the RANGES comment in marketData.ts, which is where the numbers that
  // drive it actually live. Adding a token costs ~930/month.
  marketApiMonthlyCap: Number(process.env.MARKET_API_MONTHLY_CAP ?? 0),

  geckoTerminalNetwork: process.env.GECKOTERMINAL_NETWORK ?? "electroneum",

  // THE pricing anchor. Every token is priced through its pool against this
  // address and nothing else.
  //
  // Why one fixed anchor instead of "whichever pool is deepest": BOLT's
  // deepest pool is DYNO/BOLT, and DYNO's only real pool is DYNO/BOLT — so
  // "deepest pool" prices BOLT against a token whose own price comes from
  // BOLT. Anchoring guarantees every price chain terminates somewhere we
  // already trust.
  anchorSymbol: process.env.ANCHOR_SYMBOL ?? "WETN",
  anchorTokenAddress: (process.env.ANCHOR_TOKEN_ADDRESS ?? "0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77").toLowerCase(),

  // Minimum pool liquidity (USD) before we will quote a price from it.
  //
  // Not a nicety. This chain has pools with entirely plausible names holding
  // essentially nothing — BOLT alone has `USDT / BOLT`, `eUSDC / BOLT` and
  // `BOLT / WETN 1%` between $1e-5 and $4e-19. A pool with $4e-19 in it
  // still returns a spot price, and that price is arbitrary. Observed data
  // has a clean gap: real pools $7k–$23k, junk $9.81 and below.
  minPoolLiquidityUsd: Number(process.env.MIN_POOL_LIQUIDITY_USD ?? 1000),

  // Re-resolved rather than cached forever: liquidity migrates between V3 fee
  // tiers, and when it does we should follow without an app release. Twelve
  // hours, not one — fee-tier migration is a rare event, and at 1 call per
  // token this was the cheapest thing to slow down.
  poolResolveIntervalMs: Number(process.env.POOL_RESOLVE_INTERVAL_MS ?? 12 * 60 * 60 * 1000),
  // One call covers every token (pools/multi takes 30 addresses), so this is
  // the cadence users actually feel.
  //
  // NOTE this interval drives TWO timers, not one — `refreshPrices` and
  // `refreshEtnPrice` both run on it, so halving it doubles two costs. At 30
  // minutes the pair costs 2,880 credits/month, still the single largest line
  // in the budget. It was 10 minutes, costing 8,640 — most of the plan, spent
  // on refreshing a price nobody could see change on a chain trading a few
  // hundred dollars a day.
  priceRefreshIntervalMs: Number(process.env.PRICE_REFRESH_INTERVAL_MS ?? 30 * 60 * 1000),

  // CoinGecko is used for EXACTLY ONE THING: the price of native ETN, which
  // is a genuine listed market. Every token price comes from on-chain pools
  // via GeckoTerminal. Mixing the two per-token would give us two code paths
  // that eventually disagree about the same token.
  coingeckoEtnId: process.env.COINGECKO_ETN_ID ?? "electroneum",
  // Optional. The keyless public tier is heavily throttled; a free demo key
  // raises the limit and changes nothing else.
  coingeckoApiKey: process.env.COINGECKO_API_KEY ?? "",
  // Low-frequency reconciliation pass — confirms the WS subscriptions aren't
  // silently missing anything. Not the primary delivery path; see above.
  reconcileIntervalMs: Number(required("RECONCILE_INTERVAL_MS", process.env.POLL_INTERVAL_MS ?? "90000")),
  port: Number(required("PORT", "8787")),
  dbPath: required("DB_PATH", "./data/push.db"),
  requireSignature: required("REQUIRE_SIGNATURE", "true") === "true",
};
