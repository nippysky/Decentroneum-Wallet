// server/src/verifyMarket.ts
//
// Run:  npm run verify:market
//
// Exercises the real market-data code path once and prints what it found, so
// the GeckoTerminal response shapes can be confirmed against live data before
// this is trusted in production.
//
// Worth having as a permanent script rather than a one-off: the GeckoTerminal
// API is explicitly in Beta ("subject to changes"), so field names and
// response shapes can move under us. When prices go blank or wrong months from
// now, this is the fastest way to see whether the upstream shape changed —
// it prints the parsed values next to the checks that should hold.
//
// Exits non-zero if any check fails, so it can also be used as a smoke test
// after a deploy.
import { execSync } from "node:child_process";
import { config } from "./config";
import { listTokenPools } from "./db";
import { budgetStatus } from "./apiBudget";
import { getTrackedTokens, startTokenRegistry, stopTokenRegistry } from "./tokenRegistry";
import {
  priceSeries,
  marketSnapshot,
  RANGE_KEYS,
  RANGES,
  refreshPriceHistory,
  refreshEtnPrice,
  refreshPrices,
  resetUpstreamFailureCount,
  resolveAllPools,
  upstreamFailureCount,
} from "./marketData";

let failures = 0;

function check(label: string, ok: boolean, detail: string = "") {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Reported but not counted as a failure.
 *
 * Used for the rate-limit indicator specifically. A 429 that the throttle
 * absorbed while every range still populated is the system WORKING, not a
 * broken build — so it must not fail the exit code. It does need to be visible,
 * because a persistent penalty is the signal to move to a keyed tier.
 */
function warn(label: string, ok: boolean, detail: string = "") {
  console.log(`  [${ok ? "PASS" : "WARN"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function fmt(n: number | null | undefined, digits = 8): string {
  if (n === null || n === undefined) return "null";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * The pm2 service runs its own refresh scheduler against the same IP. The
 * SQLite-backed budget means the two can no longer collectively exceed the
 * rate limit — but they DO now queue behind each other, so running this while
 * the service is live makes it slow and the results harder to read. Warn, and
 * let it be skipped with FORCE=1.
 */
function warnIfServiceRunning() {
  try {
    const out = execSync("pm2 jlist 2>/dev/null", { encoding: "utf8" });
    const running = JSON.parse(out).some(
      (p: any) => p?.name === "decentroneum-push" && p?.pm2_env?.status === "online"
    );
    if (!running) return;

    console.log(
      "NOTE: the decentroneum-push service is online and shares this droplet's\n" +
        "      API budget. Both processes now draw from one SQLite-backed allowance,\n" +
        "      so nothing will exceed the rate limit — but this run will be slower\n" +
        "      because it queues behind the service's own refreshes.\n" +
        "      For the fastest clean run: pm2 stop decentroneum-push\n"
    );
  } catch {
    // pm2 absent or not readable — nothing useful to say, so say nothing.
  }
}

async function main() {
  console.log("\n═══ Decentroneum — market data verification ═══\n");
  console.log(`network : ${config.geckoTerminalNetwork}`);
  console.log(`anchor  : ${config.anchorSymbol} ${config.anchorTokenAddress}`);
  console.log(`floor   : $${config.minPoolLiquidityUsd}`);
  console.log(`api     : ${config.marketApiKey ? "keyed (Demo)" : "keyless"} — max ${config.marketApiMaxCallsPerMinute}/min, ${config.marketApiMinSpacingMs}ms spacing\n`);

  warnIfServiceRunning();

  // Reset before any calls, so the count below reflects THIS run only.
  //
  // This exists because of a false green: an earlier run reported "all checks
  // passed" while every single upstream request returned 401. Every assertion
  // was reading rows SQLite had cached from a previous successful run, so the
  // checks were true statements about the cache and told us nothing about the
  // API. A verification script that passes when the network is entirely broken
  // is worse than no script.
  resetUpstreamFailureCount();

  console.log("1. Loading published token registry…");
  await startTokenRegistry();
  const tokens = getTrackedTokens();
  check("registry returned at least one token", tokens.length > 0, `${tokens.length} token(s)`);
  for (const t of tokens) console.log(`     ${t}`);

  console.log("\n2. Resolving canonical pools (anchor-constrained, above floor)…");
  await resolveAllPools();
  const pools = listTokenPools();
  check("every registry token resolved to a pool", pools.length === tokens.length, `${pools.length}/${tokens.length}`);

  for (const p of pools) {
    console.log(`     ${p.token}`);
    console.log(`       pool      ${p.pool}`);
    console.log(`       label     ${p.label || "(none)"}`);
    console.log(`       dex       ${p.dex || "(none)"}`);
    console.log(`       our side  ${p.side}`);
    console.log(`       liquidity $${fmt(p.liquidityUsd, 2)}`);
    // The label is "BASE / QUOTE", so the anchor must appear on the side our
    // token is NOT on. Catches a base/quote mix-up, which would otherwise show
    // up only as a reciprocal price that still looks like a number.
    const label = p.label.toUpperCase();
    const anchorInLabel = label.includes(config.anchorSymbol.toUpperCase());
    check(`  ${p.token.slice(0, 10)}… pool is paired with ${config.anchorSymbol}`, anchorInLabel, p.label);
    check(`  ${p.token.slice(0, 10)}… liquidity above floor`, p.liquidityUsd >= config.minPoolLiquidityUsd);
  }

  console.log("\n3. Fetching prices (pools/multi, one call per 30 pools)…");
  await refreshPrices();
  await refreshEtnPrice();
  const snap = marketSnapshot();

  check("native ETN price loaded from CoinGecko", snap.native !== null, snap.native ? `$${fmt(snap.native.priceUsd, 6)}` : "");

  for (const t of snap.tokens) {
    console.log(`     ${t.address}`);
    console.log(`       priceUsd     ${fmt(t.priceUsd)}`);
    console.log(`       priceEtn     ${fmt(t.priceEtn)}`);
    console.log(`       change24h    ${fmt(t.change24h, 2)}%`);
    console.log(`       liquidityUsd $${fmt(t.liquidityUsd, 2)}`);
    console.log(`       volume24h    $${fmt(t.volume24hUsd, 2)}`);
    console.log(`       fdvUsd       $${fmt(t.fdvUsd, 2)}`);

    check(`  ${t.address.slice(0, 10)}… has a USD price`, t.priceUsd !== null && t.priceUsd > 0);
    check(`  ${t.address.slice(0, 10)}… has an ETN price`, t.priceEtn !== null && t.priceEtn > 0);
    // fdv is documented as always returned, being onchain supply × price.
    check(`  ${t.address.slice(0, 10)}… has FDV`, t.fdvUsd !== null && t.fdvUsd > 0);

    // Cross-check the two independent price paths agree. priceEtn comes from
    // the pool's native-currency field, priceUsd from its USD field, and the
    // ETN/USD rate comes from CoinGecko — three separate sources. If
    // priceEtn × etnUsd is far from priceUsd, something is wrong: wrong side
    // read, a decimals issue upstream, or a stale ETN rate.
    if (t.priceEtn !== null && t.priceUsd !== null && snap.native) {
      const derived = t.priceEtn * snap.native.priceUsd;
      const drift = Math.abs(derived - t.priceUsd) / t.priceUsd;
      console.log(`       cross-check  priceEtn × ETN/USD = ${fmt(derived)} vs priceUsd ${fmt(t.priceUsd)} (${(drift * 100).toFixed(2)}% drift)`);
      check(`  ${t.address.slice(0, 10)}… USD and ETN prices agree within 5%`, drift < 0.05, `${(drift * 100).toFixed(2)}%`);
    }
  }

  console.log("\n4. Backfilling the price line for every range…");
  await refreshPriceHistory(true);

  // Native ETN is checked alongside the tokens: different upstream
  // (CoinGecko, not GeckoTerminal), different timestamp unit on the wire
  // (milliseconds, not seconds), so it needs the same assertions.
  const subjects = [
    ...pools.map((p) => ({ token: p.token, label: p.token.slice(0, 10) + "…" })),
    { token: "native", label: "native ETN" },
  ];

  for (const p of subjects) {
    for (const range of RANGE_KEYS) {
      const series = priceSeries(p.token, range);
      const n = series?.points.length ?? 0;
      const first = series?.points[0];
      const last = series?.points[n - 1];
      console.log(
        `     ${p.label.padEnd(12)} ${range.padEnd(3)} ${String(n).padStart(4)} points` +
          (first && last
            ? `  ${new Date(first.t * 1000).toISOString().slice(0, 16)} → ${new Date(last.t * 1000).toISOString().slice(0, 16)}  close ${fmt(last.c)}`
            : "")
      );
      // NOT a hard failure. An empty series is a real, correct answer on this
      // chain — DCNT genuinely traded $0 in the last 24 hours, so its 1D
      // window contains nothing. Failing the build on that would be demanding
      // the data lie.
      warn(`  ${p.label} ${range} has points`, n > 0, n === 0 ? "no trades in this window" : `${n}`);

      if (first) {
        // Timestamps must be epoch SECONDS, not milliseconds. If a future API
        // change flips this, dates land in the year 56000 and the chart's
        // x-axis silently collapses to a single pixel.
        const year = new Date(first.t * 1000).getUTCFullYear();
        check(`  ${p.label} ${range} timestamps are epoch seconds`, year > 2015 && year < 2100, `parsed year ${year}`);

        // THE check this whole fix exists for. Every point must fall inside
        // the window its label claims. Before the fix, "1D" for BOLT spanned
        // ten days because the upstream endpoint returns the last N candles
        // that EXIST, not the last N time buckets — and on a token trading six
        // times a day those are wildly different things.
        const spec = RANGES[range];
        const oldestAllowedSec = Math.floor((Date.now() - spec.windowMs) / 1000);
        const spanHours = last ? (last.t - first.t) / 3600 : 0;
        const windowHours = spec.windowMs / 3_600_000;

        check(
          `  ${p.label} ${range} data is inside its ${range} window`,
          first.t >= oldestAllowedSec,
          `oldest point is ${spanHours.toFixed(1)}h back, window is ${windowHours.toFixed(0)}h`
        );
      }

      // The last point should match the live price — proves the headline
      // number and the line come from the same pool, which is the whole
      // reason for resolving one canonical pool per token.
      if (last && range === "1D") {
        const live =
          p.token === "native"
            ? snap.native?.priceUsd ?? null
            : snap.tokens.find((t) => t.address === p.token)?.priceUsd ?? null;
        if (live !== null && live > 0) {
          const drift = Math.abs(last.c - live) / live;
          check(
            `  ${p.label} 1D last point matches live price within 10%`,
            drift < 0.1,
            `point ${fmt(last.c)} vs live ${fmt(live)} (${(drift * 100).toFixed(2)}%)`
          );
        }
      }
    }
  }

  // The check that would have caught the 401s. Data can be present and
  // correct while the API is completely unreachable — those are different
  // facts and both need asserting.
  const failures0 = upstreamFailureCount();
  console.log("\n5. Upstream health");
  console.log(`     failed upstream calls this run  ${failures0}`);
  check(
    "every upstream call succeeded (data above is FRESH, not cached)",
    failures0 === 0,
    failures0 > 0 ? `${failures0} call(s) failed — values above may be stale cache` : ""
  );

  const budget = budgetStatus("geckoterminal");
  console.log("\n6. API budget");
  console.log(`     calls this month   ${budget.monthlyUsed}${budget.monthlyCap ? ` / ${budget.monthlyCap}` : " (uncapped)"}`);
  console.log(`     calls last minute  ${budget.callsInLastMinute} / ${budget.maxCallsPerMinute}`);
  console.log(`     spacing penalty    ${budget.spacingPenalty}x${budget.spacingPenalty > 1 ? "  ← throttled by a 429" : ""}`);
  console.log(`     429s recorded      ${budget.total429}`);
  // A penalty above 1x means we were told to slow down at some point and are
  // deliberately still running slower. That is the system working, but it is
  // also the signal to move to a keyed tier.
  warn("no rate limiting during this run", budget.spacingPenalty === 1, `penalty ${budget.spacingPenalty}x`);
  if (budget.spacingPenalty > 1 && !config.marketApiKey) {
    console.log(
      "\n     The keyless tier's limit is dynamic and CoinGecko scopes it to\n" +
        "     non-commercial testing, so no client-side pacing can guarantee zero\n" +
        "     429s. All data above still populated — the throttle absorbed it.\n" +
        "     For production, set MARKET_API_KEY to a free CoinGecko Demo key\n" +
        "     (stable 100/min): https://www.coingecko.com/en/api/pricing"
    );
  }

  console.log("\n═══ " + (failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`) + " ═══\n");

  stopTokenRegistry();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nverification crashed:", err);
  process.exit(1);
});
