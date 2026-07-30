// server/src/apiBudget.ts
//
// Cross-process rate limiting and call accounting for the market-data API.
//
// ─── Why this is in SQLite and not a variable ────────────────────────────────
//
// The upstream limit is enforced PER IP ADDRESS. An in-memory limiter is
// per PROCESS. Those are not the same thing, and the difference is what kept
// producing 429s: the pm2 service runs its own refresh scheduler, and
// `npm run verify:market` starts a second process on the same droplet. Each
// believed it owned the whole budget, so the real rate against the API was
// double what either one intended.
//
// Every process on this box shares one SQLite file, so putting the call log
// there makes the budget genuinely shared. Any number of processes — the
// service, the verify script, a one-off debug script — now draw from the same
// allowance and cannot collectively exceed it.
//
// ─── Why there is also adaptive throttling ───────────────────────────────────
//
// CoinGecko documents the keyless limit as "dynamic and managed to prioritize
// fair access". A moving ceiling cannot be respected by any fixed rate, no
// matter how conservative — the only correct response to a limit you cannot
// read is feedback control. So a 429 doesn't just get retried, it makes us
// permanently slower for a while: spacing doubles, and recovers gradually only
// after a sustained clean run.
//
// ─── Why calls are counted per month ────────────────────────────────────────
//
// The free Demo tier (a real API key, still $0) has a stable 100 calls/min but
// a hard cap of 10,000 calls/month. That monthly cap, not the per-minute rate,
// is the binding constraint for us — so the budget has to be tracked over a
// month, not just a minute, and the refresh cadences have to be chosen to fit
// inside it. See config.ts for the arithmetic.
import { db } from "./db";
import { config } from "./config";

db.exec(`
  -- One row per upstream call. Pruned continuously; only ever holds the
  -- current minute plus the current month's counter rows.
  CREATE TABLE IF NOT EXISTS api_calls (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    provider  TEXT NOT NULL,
    called_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_api_calls_provider_time ON api_calls (provider, called_at);

  -- Monthly totals, kept separately so the per-call log can be pruned
  -- aggressively without losing the figure that matters for the cap.
  CREATE TABLE IF NOT EXISTS api_usage (
    provider TEXT NOT NULL,
    month    TEXT NOT NULL,
    calls    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, month)
  );

  -- Adaptive throttle state, shared across processes so a 429 seen by one
  -- slows all of them down.
  CREATE TABLE IF NOT EXISTS api_throttle (
    provider      TEXT PRIMARY KEY,
    penalty       REAL NOT NULL DEFAULT 1,
    until_ms      INTEGER NOT NULL DEFAULT 0,
    last_429_ms   INTEGER NOT NULL DEFAULT 0,
    total_429     INTEGER NOT NULL DEFAULT 0
  );
`);

const WINDOW_MS = 60_000;

let warnedAboutKeylessTier = false;

/** Doubling per 429, capped — 8x of a 6s base is 48s between calls. */
const MAX_PENALTY = 8;
/** After this long with no 429, step the penalty back down. */
const PENALTY_DECAY_AFTER_MS = 10 * 60_000;

function monthKey(at = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

type ThrottleRow = { penalty: number; until_ms: number; last_429_ms: number; total_429: number };

function readThrottle(provider: string): ThrottleRow {
  const row = db
    .prepare("SELECT penalty, until_ms, last_429_ms, total_429 FROM api_throttle WHERE provider = ?")
    .get(provider) as ThrottleRow | undefined;
  return row ?? { penalty: 1, until_ms: 0, last_429_ms: 0, total_429: 0 };
}

function writeThrottle(provider: string, next: ThrottleRow): void {
  db.prepare(
    `INSERT INTO api_throttle (provider, penalty, until_ms, last_429_ms, total_429)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       penalty = excluded.penalty,
       until_ms = excluded.until_ms,
       last_429_ms = excluded.last_429_ms,
       total_429 = excluded.total_429`
  ).run(provider, next.penalty, next.until_ms, next.last_429_ms, next.total_429);
}

/**
 * Atomically decide whether a call may proceed right now.
 *
 * Returns 0 to go ahead (and records the call), or a number of milliseconds to
 * wait before asking again. BEGIN IMMEDIATE makes the read-decide-write
 * sequence atomic across processes — without it, two processes could both read
 * "4 calls used" and both proceed, which is exactly the race this file exists
 * to eliminate.
 */
const tryReserve = db.transaction((provider: string, maxPerMinute: number, minSpacingMs: number): number => {
  const now = Date.now();

  const throttle = readThrottle(provider);

  // Still inside a 429 cooldown.
  if (throttle.until_ms > now) return throttle.until_ms - now;

  // Decay the penalty after a sustained clean period, so one bad afternoon
  // doesn't leave us crawling forever.
  if (throttle.penalty > 1 && throttle.last_429_ms > 0 && now - throttle.last_429_ms > PENALTY_DECAY_AFTER_MS) {
    const relaxed = Math.max(1, throttle.penalty / 2);
    writeThrottle(provider, { ...throttle, penalty: relaxed });
    throttle.penalty = relaxed;
  }

  db.prepare("DELETE FROM api_calls WHERE called_at < ?").run(now - WINDOW_MS);

  const spacing = Math.ceil(minSpacingMs * throttle.penalty);

  const last = db
    .prepare("SELECT called_at FROM api_calls WHERE provider = ? ORDER BY called_at DESC LIMIT 1")
    .get(provider) as { called_at: number } | undefined;

  if (last && now - last.called_at < spacing) return spacing - (now - last.called_at);

  const used = db
    .prepare("SELECT COUNT(*) AS n FROM api_calls WHERE provider = ? AND called_at >= ?")
    .get(provider, now - WINDOW_MS) as { n: number };

  const effectiveMax = Math.max(1, Math.floor(maxPerMinute / throttle.penalty));
  if (used.n >= effectiveMax) {
    const oldest = db
      .prepare("SELECT called_at FROM api_calls WHERE provider = ? ORDER BY called_at ASC LIMIT 1")
      .get(provider) as { called_at: number } | undefined;
    return oldest ? Math.max(100, WINDOW_MS - (now - oldest.called_at) + 50) : 1_000;
  }

  db.prepare("INSERT INTO api_calls (provider, called_at) VALUES (?, ?)").run(provider, now);
  db.prepare(
    `INSERT INTO api_usage (provider, month, calls) VALUES (?, ?, 1)
     ON CONFLICT(provider, month) DO UPDATE SET calls = calls + 1`
  ).run(provider, monthKey());

  return 0;
});

/**
 * Blocks until a call is permitted. Returns false if the monthly cap is
 * exhausted, in which case the caller should skip the request entirely rather
 * than queue behind a limit that won't lift until next month.
 */
export async function acquireCall(provider: string): Promise<boolean> {
  if (monthlyRemaining(provider) <= 0) {
    return false;
  }

  for (;;) {
    const waitMs = tryReserve(provider, config.marketApiMaxCallsPerMinute, config.marketApiMinSpacingMs);
    if (waitMs === 0) {
      // Jitter AFTER reserving, so a fixed schedule never lands on the same
      // millisecond offset every cycle and align with a rate-limit window.
      if (config.marketApiJitterMs > 0) {
        await new Promise((r) => setTimeout(r, Math.random() * config.marketApiJitterMs));
      }
      return true;
    }
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 60_000)));
  }
}

/**
 * Record a 429 and slow every process down.
 *
 * Doubling rather than a fixed step: we don't know the real ceiling (it's
 * dynamic), so the only safe assumption after being told "too fast" is that
 * we're materially too fast, not marginally.
 */
export function recordRateLimited(provider: string, retryAfterMs: number): void {
  const now = Date.now();
  const t = readThrottle(provider);
  const penalty = Math.min(MAX_PENALTY, t.penalty * 2);
  // Cool off for at least the retry-after, and at least one full window —
  // whichever is longer.
  const cooldown = Math.max(retryAfterMs, WINDOW_MS);
  writeThrottle(provider, {
    penalty,
    until_ms: now + cooldown,
    last_429_ms: now,
    total_429: t.total_429 + 1,
  });
  console.warn(
    `[budget] 429 from ${provider} — spacing penalty now ${penalty}x, pausing ${Math.round(cooldown / 1000)}s ` +
      `(${t.total_429 + 1} total)`
  );

  // Said once per process, not once per 429. The keyless tier's limit is
  // dynamic and CoinGecko scopes it to non-commercial prototyping, so no
  // client-side pacing can eliminate this — a free Demo key can, because its
  // 100/min ceiling is a fixed number rather than a moving one.
  if (!config.marketApiKey && !warnedAboutKeylessTier) {
    warnedAboutKeylessTier = true;
    console.warn(
      "[budget] running on the KEYLESS tier, whose rate limit is dynamic and " +
        "intended for non-commercial testing. For production set MARKET_API_KEY " +
        "to a free CoinGecko Demo key (stable 100/min): https://www.coingecko.com/en/api/pricing"
    );
  }
}

export function monthlyUsed(provider: string): number {
  const row = db
    .prepare("SELECT calls FROM api_usage WHERE provider = ? AND month = ?")
    .get(provider, monthKey()) as { calls: number } | undefined;
  return row?.calls ?? 0;
}

export function monthlyRemaining(provider: string): number {
  if (config.marketApiMonthlyCap <= 0) return Number.POSITIVE_INFINITY;
  return config.marketApiMonthlyCap - monthlyUsed(provider);
}

export function budgetStatus(provider: string) {
  const t = readThrottle(provider);
  const now = Date.now();
  const used = db
    .prepare("SELECT COUNT(*) AS n FROM api_calls WHERE provider = ? AND called_at >= ?")
    .get(provider, now - WINDOW_MS) as { n: number };

  return {
    provider,
    month: monthKey(),
    monthlyUsed: monthlyUsed(provider),
    monthlyCap: config.marketApiMonthlyCap > 0 ? config.marketApiMonthlyCap : null,
    callsInLastMinute: used.n,
    maxCallsPerMinute: config.marketApiMaxCallsPerMinute,
    minSpacingMs: config.marketApiMinSpacingMs,
    // > 1 means we've been throttled and are deliberately running slower.
    spacingPenalty: t.penalty,
    throttledForMs: Math.max(0, t.until_ms - now),
    total429: t.total_429,
  };
}
