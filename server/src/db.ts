import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    push_token TEXT NOT NULL,
    platform TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(address, push_token)
  );

  CREATE INDEX IF NOT EXISTS idx_registrations_address ON registrations (address);
  CREATE INDEX IF NOT EXISTS idx_registrations_push_token ON registrations (push_token);

  CREATE TABLE IF NOT EXISTS cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_block INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sent_events (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL DEFAULT -1,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tx_hash, log_index, address)
  );

  -- Last known good token registry.
  --
  -- Replaces the TRACKED_TOKENS env var, which was a hand-maintained duplicate
  -- of decentroneum.com/api/token-list.json and had already drifted out of step
  -- with it (it listed DCNT but not BOLT). A stale duplicate is worse than no
  -- duplicate, because it is consulted ONLY during an outage — exactly when
  -- nobody is in a position to notice it is wrong.
  --
  -- This is written on every successful registry fetch and read only on a cold
  -- start that cannot reach the registry, so the fallback list is always
  -- whatever was correct as of the last successful fetch. Deliberately NOT in
  -- the market-cache block below, which gets dropped on a schema bump.
  CREATE TABLE IF NOT EXISTS registry_cache (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    tokens     TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );

  -- Version marker for the market-data cache tables created further down.
  -- Those are PURE CACHE — every row is re-derivable from the upstream API —
  -- which is why a version bump drops and rebuilds them instead of migrating.
  -- Nothing above this line is cache; it is all user or operational data.
  CREATE TABLE IF NOT EXISTS market_schema (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  );
`);

// ─────────────────────────────────────────────────────────────────────────────
// Market cache schema version.
//
// Bumped whenever the shape of the three market tables changes. On a bump the
// tables are dropped and recreated rather than migrated, because every row is
// re-derivable from the upstream API within one refresh cycle — a migration
// path would be code carrying risk for no benefit. User data lives in
// registrations/cursor/sent_events and is never touched by this.
// ─────────────────────────────────────────────────────────────────────────────
const MARKET_SCHEMA_VERSION = 2;

{
  const row = db.prepare("SELECT version FROM market_schema WHERE id = 1").get() as
    | { version: number }
    | undefined;

  if (row?.version !== MARKET_SCHEMA_VERSION) {
    db.exec(`
      DROP TABLE IF EXISTS candles;
      DROP TABLE IF EXISTS price_history;
      DROP TABLE IF EXISTS token_price;
      DROP TABLE IF EXISTS token_pool;
    `);
    if (row) console.log(`[db] market cache schema ${row.version} -> ${MARKET_SCHEMA_VERSION}; rebuilt`);
  }

  db.exec(`
  -- Each token's canonical pool: the deepest pool pairing it with WETN, above
  -- the liquidity floor. side records whether our token is the pool's base or
  -- quote, because that decides which price field to read — reading the wrong
  -- one yields the reciprocal, which looks plausible enough to ship.
  CREATE TABLE IF NOT EXISTS token_pool (
    token         TEXT PRIMARY KEY,
    pool          TEXT NOT NULL,
    side          TEXT NOT NULL CHECK (side IN ('base','quote')),
    label         TEXT,
    dex           TEXT,
    liquidity_usd REAL NOT NULL,
    resolved_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Latest price + market stats. Refreshed every 60s; served to the app from
  -- here, never proxied live, so user count never touches the API rate limit.
  --
  -- No market-cap column on purpose. Market cap needs circulating supply,
  -- which is a human judgment about which addresses don't count and is not
  -- readable on-chain. Upstream reports it as null for DCNT and as literal 0
  -- for BOLT, so there is no honest value to store. Fully diluted value
  -- (total on-chain supply x price) is a real number and is stored instead,
  -- under its own name.
  CREATE TABLE IF NOT EXISTS token_price (
    token           TEXT PRIMARY KEY,
    pool            TEXT NOT NULL,
    price_usd       REAL,
    price_etn       REAL,
    change_24h      REAL,
    liquidity_usd   REAL,
    volume_24h_usd  REAL,
    fdv_usd         REAL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Points for the price line. Close price only.
  --
  -- Named price_history, NOT candles: the upstream endpoint is called ohlcv
  -- and returns open/high/low/close/volume, but we keep only the close and
  -- draw a plain line. Storing the other four would mean carrying data no
  -- part of this product reads, and calling the table "candles" implied a
  -- candlestick chart that does not exist anywhere in the app.
  --
  -- Keyed by pool (not token) so moving a token to a deeper pool cleanly
  -- invalidates the old series instead of splicing two different markets.
  CREATE TABLE IF NOT EXISTS price_history (
    pool      TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    ts        INTEGER NOT NULL,
    close_usd REAL NOT NULL,
    PRIMARY KEY (pool, timeframe, ts)
  );

  CREATE INDEX IF NOT EXISTS idx_price_history_lookup ON price_history (pool, timeframe, ts);
`);

  db.prepare(
    `INSERT INTO market_schema (id, version) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version`
  ).run(MARKET_SCHEMA_VERSION);
}


export function getLastProcessedBlock(defaultBlock: number): number {
  const row = db.prepare("SELECT last_block FROM cursor WHERE id = 1").get() as { last_block: number } | undefined;
  return row?.last_block ?? defaultBlock;
}

export function setLastProcessedBlock(blockNumber: number): void {
  db.prepare(
    `INSERT INTO cursor (id, last_block) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET last_block = excluded.last_block`
  ).run(blockNumber);
}

export function addRegistration(address: string, pushToken: string, platform?: string): void {
  db.prepare(
    `INSERT INTO registrations (address, push_token, platform) VALUES (?, ?, ?)
     ON CONFLICT(address, push_token) DO NOTHING`
  ).run(address.toLowerCase(), pushToken, platform ?? null);
}

export function removeRegistration(pushToken: string, address?: string): void {
  if (address) {
    db.prepare("DELETE FROM registrations WHERE push_token = ? AND address = ?").run(pushToken, address.toLowerCase());
  } else {
    db.prepare("DELETE FROM registrations WHERE push_token = ?").run(pushToken);
  }
}

export function getPushTokensForAddress(address: string): string[] {
  const rows = db.prepare("SELECT push_token FROM registrations WHERE address = ?").all(address.toLowerCase()) as {
    push_token: string;
  }[];
  return rows.map((r) => r.push_token);
}

export function wasAlreadySent(txHash: string, address: string, logIndex = -1): boolean {
  const row = db
    .prepare("SELECT 1 FROM sent_events WHERE tx_hash = ? AND log_index = ? AND address = ?")
    .get(txHash, logIndex, address.toLowerCase());
  return !!row;
}

export function markSent(txHash: string, address: string, logIndex = -1): void {
  db.prepare(
    `INSERT INTO sent_events (tx_hash, log_index, address) VALUES (?, ?, ?)
     ON CONFLICT(tx_hash, log_index, address) DO NOTHING`
  ).run(txHash, logIndex, address.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Market data accessors (see marketData.ts for the pricing rules)
// ─────────────────────────────────────────────────────────────────────────────

export type TokenPoolRow = {
  token: string;
  pool: string;
  side: "base" | "quote";
  label: string;
  dex: string;
  liquidityUsd: number;
};

export function upsertTokenPool(row: TokenPoolRow): void {
  db.prepare(
    `INSERT INTO token_pool (token, pool, side, label, dex, liquidity_usd, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(token) DO UPDATE SET
       pool = excluded.pool,
       side = excluded.side,
       label = excluded.label,
       dex = excluded.dex,
       liquidity_usd = excluded.liquidity_usd,
       resolved_at = excluded.resolved_at`
  ).run(row.token, row.pool, row.side, row.label, row.dex, row.liquidityUsd);
}

export function getTokenPool(token: string): TokenPoolRow | null {
  const r = db
    .prepare("SELECT token, pool, side, label, dex, liquidity_usd FROM token_pool WHERE token = ?")
    .get(token.toLowerCase()) as any;
  if (!r) return null;
  return {
    token: r.token,
    pool: r.pool,
    side: r.side,
    label: r.label ?? "",
    dex: r.dex ?? "",
    liquidityUsd: r.liquidity_usd,
  };
}

export function listTokenPools(): TokenPoolRow[] {
  const rows = db
    .prepare("SELECT token, pool, side, label, dex, liquidity_usd FROM token_pool ORDER BY liquidity_usd DESC")
    .all() as any[];
  return rows.map((r) => ({
    token: r.token,
    pool: r.pool,
    side: r.side,
    label: r.label ?? "",
    dex: r.dex ?? "",
    liquidityUsd: r.liquidity_usd,
  }));
}

/**
 * Drops the mapping for any token that is no longer in the published
 * registry, so an unlisted token stops being priced instead of lingering
 * forever with a stale number.
 */
export function pruneTokenPools(keepTokens: string[]): void {
  if (keepTokens.length === 0) return;
  const placeholders = keepTokens.map(() => "?").join(",");
  db.prepare(`DELETE FROM token_pool WHERE token NOT IN (${placeholders})`).run(...keepTokens);
  db.prepare(`DELETE FROM token_price WHERE token NOT IN (${placeholders})`).run(...keepTokens);
}

export type TokenPriceRow = {
  token: string;
  pool: string;
  priceUsd: number | null;
  priceEtn: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fdvUsd: number | null;
};

export function upsertTokenPrice(row: TokenPriceRow): void {
  db.prepare(
    `INSERT INTO token_price
       (token, pool, price_usd, price_etn, change_24h, liquidity_usd, volume_24h_usd, fdv_usd, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(token) DO UPDATE SET
       pool = excluded.pool,
       price_usd = excluded.price_usd,
       price_etn = excluded.price_etn,
       change_24h = excluded.change_24h,
       liquidity_usd = excluded.liquidity_usd,
       volume_24h_usd = excluded.volume_24h_usd,
       fdv_usd = excluded.fdv_usd,
       updated_at = excluded.updated_at`
  ).run(
    row.token,
    row.pool,
    row.priceUsd,
    row.priceEtn,
    row.change24h,
    row.liquidityUsd,
    row.volume24hUsd,
    row.fdvUsd
  );
}

export function getStoredPrices(): (TokenPriceRow & { updatedAt: string })[] {
  const rows = db
    .prepare(
      `SELECT token, pool, price_usd, price_etn, change_24h, liquidity_usd,
              volume_24h_usd, fdv_usd, updated_at
       FROM token_price`
    )
    .all() as any[];
  return rows.map((r) => ({
    token: r.token,
    pool: r.pool,
    priceUsd: r.price_usd,
    priceEtn: r.price_etn,
    change24h: r.change_24h,
    liquidityUsd: r.liquidity_usd,
    volume24hUsd: r.volume_24h_usd,
    fdvUsd: r.fdv_usd,
    updatedAt: r.updated_at,
  }));
}

/**
 * Replaces a pool's price line for one timeframe atomically.
 *
 * Replace rather than merge: the upstream API revises its most recent bucket as
 * more trades land in it, and merging would keep the first (wrong) value
 * forever.
 *
 * Deduplicated by timestamp before insert. Live data showed the upstream
 * ohlcv_list can contain two entries for the same timestamp, which blew up the
 * (pool, timeframe, ts) primary key mid-transaction and aborted the whole
 * refresh. Last value for a given timestamp wins, matching the "later data
 * supersedes earlier" rule above.
 */
export function replacePriceHistory(pool: string, timeframe: string, points: { t: number; c: number }[]): void {
  const byTs = new Map<number, number>();
  for (const p of points) byTs.set(p.t, p.c);

  const del = db.prepare("DELETE FROM price_history WHERE pool = ? AND timeframe = ?");
  const ins = db.prepare("INSERT INTO price_history (pool, timeframe, ts, close_usd) VALUES (?, ?, ?, ?)");
  const tx = db.transaction(() => {
    del.run(pool, timeframe);
    for (const [ts, close] of byTs) ins.run(pool, timeframe, ts, close);
  });
  tx();
}

export function getPriceHistory(pool: string, timeframe: string): { t: number; c: number }[] {
  const rows = db
    .prepare("SELECT ts, close_usd FROM price_history WHERE pool = ? AND timeframe = ? ORDER BY ts ASC")
    .all(pool, timeframe) as any[];
  return rows.map((r) => ({ t: r.ts, c: r.close_usd }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Token registry cache — the cold-start fallback for tokenRegistry.ts
// ─────────────────────────────────────────────────────────────────────────────

export function saveRegistryCache(tokens: unknown[]): void {
  db.prepare(
    `INSERT INTO registry_cache (id, tokens, fetched_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET tokens = excluded.tokens, fetched_at = excluded.fetched_at`
  ).run(JSON.stringify(tokens));
}

export function loadRegistryCache(): { tokens: unknown[]; fetchedAt: string } | null {
  const row = db.prepare("SELECT tokens, fetched_at FROM registry_cache WHERE id = 1").get() as
    | { tokens: string; fetched_at: string }
    | undefined;
  if (!row) return null;
  try {
    const tokens = JSON.parse(row.tokens);
    if (!Array.isArray(tokens) || tokens.length === 0) return null;
    // Shape isn't validated here — normalize() in tokenRegistry.ts is the one
    // place that decides what a valid entry looks like, and it tolerates both
    // the old bare-address form and the current object form.
    return { tokens, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}
