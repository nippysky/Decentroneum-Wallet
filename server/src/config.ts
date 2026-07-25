import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

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
  // public (unkeyed) one.
  rpcFallbackUrls: (process.env.RPC_FALLBACK_URLS ?? "https://rpc.electroneum.com,https://rpc.ankr.com/electroneum")
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
  // FALLBACK ONLY. The authoritative token list is now fetched from the
  // published registry at decentroneum.com/api/token-list.json — see
  // tokenRegistry.ts. This is used only if that fetch has never succeeded
  // (e.g. a restart during an outage), so the watcher degrades to a known
  // list instead of going dark. Keep it populated, but you no longer need
  // to update it when listing a token.
  trackedTokens: required("TRACKED_TOKENS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Low-frequency reconciliation pass — confirms the WS subscriptions aren't
  // silently missing anything. Not the primary delivery path; see above.
  reconcileIntervalMs: Number(required("RECONCILE_INTERVAL_MS", process.env.POLL_INTERVAL_MS ?? "90000")),
  port: Number(required("PORT", "8787")),
  dbPath: required("DB_PATH", "./data/push.db"),
  requireSignature: required("REQUIRE_SIGNATURE", "true") === "true",
};
