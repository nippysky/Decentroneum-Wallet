import { ethers } from "ethers";
import WebSocket from "ws";
import { config } from "./config";
import { getLastProcessedBlock, getPushTokensForAddress, markSent, setLastProcessedBlock, wasAlreadySent } from "./db";
import { sendPushNotifications, PushMessage } from "./expoPush";

// ---------------------------------------------------------------------------
// Live path: one persistent WebSocket connection to the RPC node. ethers'
// WebSocketProvider turns provider.on("block", ...) and provider.on(filter,
// ...) into real eth_subscribe calls over that socket — the node pushes new
// blocks/logs to us the instant they happen, instead of us asking on a timer.
//
// Backfill path (HTTP): used only for (a) catching up on startup, (b) filling
// any gap after a reconnect, and (c) a low-frequency reconcile safety net in
// case a subscription message is ever dropped. None of this runs on the
// steady-state happy path.
// ---------------------------------------------------------------------------

/**
 * Ordered HTTP failover: config.rpcUrl (your dedicated/paid endpoint) first,
 * then config.rpcFallbackUrls in order, only touched if the preferred one
 * errors or stalls. `quorum: 1` is the important part — ethers' default
 * FallbackProvider quorum queries multiple providers per call to
 * cross-validate responses, which would multiply our billed request count.
 * Quorum 1 means "first one that succeeds wins," i.e. plain failover, not
 * consensus-checking — normal operation only ever touches one provider.
 *
 * Priority: lower number = tried first. If this ever turns out backwards
 * once deployed (worth a quick smoke test — this sandbox has no network path
 * to actually exercise it against Ankr), it still fails over correctly, it
 * would just prefer a different provider than intended until swapped.
 */
function buildHttpProvider(): ethers.FallbackProvider {
  const network = { chainId: config.chainId, name: "electroneum" };
  const urls = [config.rpcUrl, ...config.rpcFallbackUrls];
  const configs = urls.map((url, i) => ({
    provider: new ethers.JsonRpcProvider(url, network, { staticNetwork: true }),
    priority: i, // 0 = config.rpcUrl (primary), 1.. = fallbacks in listed order
    stallTimeout: i === 0 ? 4000 : 2500, // give the primary a bit longer before trying a fallback
    weight: 1,
  }));
  return new ethers.FallbackProvider(configs, network, { quorum: 1 });
}

const httpProvider = buildHttpProvider();
const transferIface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

/**
 * Ordered raw JsonRpcProviders (not wrapped in FallbackProvider), used only
 * for fetching a block WITH full transaction objects (native-ETN scanning).
 *
 * Found in production: ethers 6.17's FallbackProvider does not correctly
 * preserve Block.prefetchedTransactions when getBlock(n, true) is called on
 * it — every call threw "transactions were not prefetched with block
 * request" (UNSUPPORTED_OPERATION). Plain JsonRpcProvider.getBlock(n, true)
 * doesn't have this problem; it's specifically FallbackProvider's block
 * reconstruction that drops it. Rather than depend on that higher-level
 * abstraction here, this calls eth_getBlockByNumber directly via .send() and
 * parses the raw JSON-RPC response ourselves — with the same ordered
 * try-next-on-failure behavior as buildHttpProvider() above, just hand-rolled
 * since FallbackProvider has no generic passthrough (see sendRaw() in the
 * main app's src/lib/chain/wallet.ts for the identical pattern used there).
 */
const rawRpcProviders: ethers.JsonRpcProvider[] = [config.rpcUrl, ...config.rpcFallbackUrls].map(
  (url) => new ethers.JsonRpcProvider(url, { chainId: config.chainId, name: "electroneum" }, { staticNetwork: true })
);

type RawTx = { hash: string; to: string | null; value: string };
type RawBlockWithTxs = { number: string; transactions: RawTx[] } | null;

async function getBlockWithTxsRaw(blockNumber: number): Promise<RawBlockWithTxs> {
  const hexBlock = "0x" + blockNumber.toString(16);
  let lastErr: unknown;
  for (const provider of rawRpcProviders) {
    try {
      return (await provider.send("eth_getBlockByNumber", [hexBlock, true])) as RawBlockWithTxs;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

const MAX_BLOCK_RANGE = 50; // cap per backfill pass (startup / reconnect gap / reconcile)
const DEGRADED_POLL_INTERVAL_MS = 6000; // ~1 block time — reconcile speeds up to this while the WS is down
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
// Electroneum produces a block roughly every 5s; if we haven't seen a "block"
// push in 4x that, the socket is very likely stalled silently (some proxies
// hold a dead TCP connection open without ever firing "close"). Force a
// reconnect rather than waiting on a close event that may never come.
const STALE_CONNECTION_MS = 20_000;
const WATCHDOG_INTERVAL_MS = 10_000;

function prettyAmount(raw: bigint, decimals: number): string {
  const s = ethers.formatUnits(raw, decimals);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toFixed(n < 1 ? 4 : 2).replace(/\.?0+$/, "");
}

function hasAnyRegistration(address: string): boolean {
  return getPushTokensForAddress(address).length > 0;
}

function handleNativeTransfer(txHash: string, to: string, value: bigint, outbox: PushMessage[]): void {
  if (!hasAnyRegistration(to)) return;
  if (wasAlreadySent(txHash, to)) return;
  const amount = prettyAmount(value, 18);
  for (const pushToken of getPushTokensForAddress(to)) {
    outbox.push({
      to: pushToken,
      title: "ETN received",
      body: `+${amount} ETN`,
      data: { txHash, kind: "native", address: to },
    });
  }
  markSent(txHash, to);
}

function handleTokenLog(log: ethers.Log, outbox: PushMessage[]): void {
  let parsed;
  try {
    parsed = transferIface.parseLog(log);
  } catch {
    return;
  }
  if (!parsed) return;

  const to: string = parsed.args.to;
  const value: bigint = parsed.args.value;
  if (value === 0n) return;
  if (!hasAnyRegistration(to)) return;
  if (wasAlreadySent(log.transactionHash, to, log.index)) return;

  // NOTE: decimals/symbol hardcoded to DCNT's known values here for
  // simplicity. For a multi-token registry, fetch decimals/symbol per
  // `log.address` from https://decentroneum.com/api/token-list.json
  // (cached) instead of hardcoding.
  const amount = prettyAmount(value, 18);
  for (const pushToken of getPushTokensForAddress(to)) {
    outbox.push({
      to: pushToken,
      title: "Token received",
      body: `+${amount} tokens`,
      data: { txHash: log.transactionHash, kind: "token", token: log.address, address: to },
    });
  }
  markSent(log.transactionHash, to, log.index);
}

/** Scans a closed block range over HTTP JSON-RPC. Only used for backfill — never on the live path. */
async function scanBlockRange(fromBlock: number, toBlock: number): Promise<void> {
  const outbox: PushMessage[] = [];

  for (let bn = fromBlock; bn <= toBlock; bn++) {
    let block: RawBlockWithTxs;
    try {
      block = await getBlockWithTxsRaw(bn);
    } catch (err) {
      console.error(`[watcher] backfill: failed to fetch block ${bn}:`, err);
      continue;
    }
    if (!block) continue;
    for (const tx of block.transactions) {
      const value = BigInt(tx.value);
      if (!tx.to || value === 0n) continue;
      handleNativeTransfer(tx.hash, tx.to, value, outbox);
    }
  }

  if (config.trackedTokens.length > 0) {
    for (const tokenAddress of config.trackedTokens) {
      try {
        const logs = await httpProvider.getLogs({ address: tokenAddress, topics: [TRANSFER_TOPIC], fromBlock, toBlock });
        for (const log of logs) handleTokenLog(log, outbox);
      } catch (err) {
        console.error(`[watcher] backfill: failed to fetch logs for ${tokenAddress}:`, err);
      }
    }
  }

  if (outbox.length > 0) {
    console.log(`[watcher] backfill: sending ${outbox.length} notification(s) for blocks ${fromBlock}-${toBlock}`);
    await sendPushNotifications(outbox);
  }
  setLastProcessedBlock(toBlock);
}

async function backfillFromCursor(): Promise<void> {
  const latest = await httpProvider.getBlockNumber();
  const lastProcessed = getLastProcessedBlock(latest - 1);
  if (lastProcessed >= latest) return;

  const fromBlock = lastProcessed + 1;
  const toBlock = Math.min(latest, fromBlock + MAX_BLOCK_RANGE - 1);
  await scanBlockRange(fromBlock, toBlock);
}

// --- WebSocket live subscriptions -------------------------------------------------

let wsProvider: ethers.WebSocketProvider | null = null;
let activeSocket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let stopped = false;
let lastLiveBlockAt = Date.now();

async function onNewBlock(blockNumber: number): Promise<void> {
  lastLiveBlockAt = Date.now(); // receiving the push at all proves the socket is alive
  try {
    // The "block" subscription event only carries the number — one HTTP call
    // per new block (unavoidable: native ETN transfers emit no log) fetches
    // the full transaction list. This fires once per block, exactly when a
    // block actually lands, instead of on a fixed timer.
    const block = await getBlockWithTxsRaw(blockNumber);
    if (!block) return;
    const outbox: PushMessage[] = [];
    for (const tx of block.transactions) {
      const value = BigInt(tx.value);
      if (!tx.to || value === 0n) continue;
      handleNativeTransfer(tx.hash, tx.to, value, outbox);
    }
    if (outbox.length > 0) await sendPushNotifications(outbox);
    setLastProcessedBlock(blockNumber);
  } catch (err) {
    console.error(`[watcher] live: failed handling block ${blockNumber}:`, err);
  }
}

async function onTokenLog(log: ethers.Log): Promise<void> {
  try {
    const outbox: PushMessage[] = [];
    handleTokenLog(log, outbox);
    if (outbox.length > 0) await sendPushNotifications(outbox);
  } catch (err) {
    console.error("[watcher] live: failed handling token log:", err);
  }
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY_MS);
  reconnectAttempt++;
  console.warn(`[watcher] WebSocket down — reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err) => {
      console.error("[watcher] reconnect failed:", err);
      scheduleReconnect();
    });
  }, delay);
}

async function connect(): Promise<void> {
  if (stopped) return;

  const socket = new WebSocket(config.rpcWsUrl);
  // `ws`'s WebSocket structurally satisfies ethers' WebSocketLike interface
  // (onopen/onmessage/onerror/readyState/send/close) — passing an instance
  // directly (rather than a URL string) is what lets us also attach our own
  // open/close/error listeners below for reconnect bookkeeping.
  const provider = new ethers.WebSocketProvider(socket as any, { chainId: config.chainId, name: "electroneum" });
  wsProvider = provider;
  activeSocket = socket;

  socket.on("open", async () => {
    reconnectAttempt = 0;
    lastLiveBlockAt = Date.now();
    console.log(`[watcher] WebSocket connected — ${config.rpcWsUrl}`);

    // Fill in anything missed while disconnected (or since process start),
    // then switch to pure event-driven mode for as long as the socket lives.
    try {
      await backfillFromCursor();
    } catch (err) {
      console.error("[watcher] startup/reconnect catch-up failed:", err);
    }

    provider.on("block", (blockNumber: number) => {
      onNewBlock(blockNumber).catch((err) => console.error("[watcher] onNewBlock error:", err));
    });

    for (const tokenAddress of config.trackedTokens) {
      provider.on({ address: tokenAddress, topics: [TRANSFER_TOPIC] }, (log: ethers.Log) => {
        onTokenLog(log).catch((err) => console.error("[watcher] onTokenLog error:", err));
      });
    }
  });

  socket.on("close", () => {
    console.warn("[watcher] WebSocket closed");
    if (wsProvider === provider) wsProvider = null;
    if (activeSocket === socket) activeSocket = null;
    scheduleReconnect();
  });

  socket.on("error", (err) => {
    console.error("[watcher] WebSocket error:", err);
  });
}

/**
 * Guards against a connection that stalls without ever firing "close" —
 * observed in the wild with some load balancers/proxies that silently drop a
 * TCP connection. If no block notification has arrived in STALE_CONNECTION_MS
 * (~4 block times), we assume the subscription is dead, forcibly terminate
 * the socket, and let the normal reconnect path take over. The reconcile
 * timer covers us for any blocks missed in the meantime.
 */
function startWatchdogTimer(): void {
  watchdogTimer = setInterval(() => {
    if (stopped || !activeSocket) return;
    const idleFor = Date.now() - lastLiveBlockAt;
    if (idleFor > STALE_CONNECTION_MS) {
      console.warn(`[watcher] no block notification in ${idleFor}ms — connection looks stalled, forcing reconnect`);
      const socket = activeSocket;
      activeSocket = null;
      try {
        socket.terminate();
      } catch (err) {
        console.error("[watcher] error terminating stale socket:", err);
      }
      // socket.terminate() should fire "close", which triggers scheduleReconnect().
      // Fall back to scheduling directly in case the event doesn't arrive.
      scheduleReconnect();
    }
  }, WATCHDOG_INTERVAL_MS);
}

/**
 * Low-frequency safety net (default: every 90s, RECONCILE_INTERVAL_MS) while
 * the WebSocket is connected — not the delivery path, just confirms the
 * cursor is caught up and backfills over HTTP if a subscription message was
 * ever dropped.
 *
 * Graceful degradation: while the WebSocket is disconnected (activeSocket is
 * null — mid-reconnect-backoff, or WS is down entirely), this speeds itself
 * up to DEGRADED_POLL_INTERVAL_MS (~1 block time) automatically, so the
 * service degrades from "instant push" to "still finds new transfers within
 * a few seconds via HTTP polling" instead of going fully dark. It reverts to
 * the slow interval the moment the socket reconnects — this is a self-
 * rescheduling setTimeout loop rather than a fixed setInterval specifically
 * so the delay can change between ticks based on current connection state.
 */
function nextReconcileDelayMs(): number {
  return activeSocket ? config.reconcileIntervalMs : DEGRADED_POLL_INTERVAL_MS;
}

function startReconcileTimer(): void {
  const tick = async () => {
    if (stopped) return;
    try {
      await backfillFromCursor();
    } catch (err) {
      console.error("[watcher] reconcile tick failed:", err);
    }
    if (stopped) return;
    reconcileTimer = setTimeout(tick, nextReconcileDelayMs());
  };
  reconcileTimer = setTimeout(tick, nextReconcileDelayMs());
}

export function startChainWatcher(): () => void {
  stopped = false;
  lastLiveBlockAt = Date.now();
  connect().catch((err) => {
    console.error("[watcher] initial connect failed:", err);
    scheduleReconnect();
  });
  startReconcileTimer();
  startWatchdogTimer();

  console.log(
    `[watcher] started — live WebSocket watch on ${config.rpcWsUrl} (HTTP fallback chain: ${[config.rpcUrl, ...config.rpcFallbackUrls].length} endpoints), reconciling every ${config.reconcileIntervalMs}ms when connected (degrades to ${DEGRADED_POLL_INTERVAL_MS}ms polling if the WS is down), watchdog every ${WATCHDOG_INTERVAL_MS}ms`
  );

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (reconcileTimer) clearTimeout(reconcileTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (wsProvider) {
      wsProvider.removeAllListeners();
      wsProvider.destroy();
      wsProvider = null;
    }
    activeSocket = null;
  };
}
