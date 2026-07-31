// src/lib/notifications/watcher.ts
//
// In-app incoming-funds watcher (v1, no backend required).
//
// Polls every account's native + registry-listed token balances while the
// app is foregrounded, diffs against the last-seen snapshot, and fires a
// local notification when a balance goes up. This alone satisfies "notify me
// when I receive funds" without new server infrastructure.
//
// It intentionally can't notify while the app is fully killed/backgrounded
// for a long time — that needs real server-side push (see PLAN.md §6): a
// small service watching Electroneum blocks per registered address and
// calling the Expo Push API. This watcher is the client half of that design
// and will keep working unchanged once that backend exists.
import { ethers } from "ethers";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNativeBalanceWei } from "@/src/lib/chain/rpc";
import { getErc20BalanceRaw } from "@/src/lib/chain/erc20";
import { ELECTRONEUM } from "@/src/lib/chain/networks";
import { NATIVE_ASSET } from "@/src/lib/tokens/native";

/** Same asset the home screen and token detail use for native ETN. */
import { notifyLocal } from "./local";
import type { Account } from "@/src/lib/crypto/vault";
import type { ListedToken } from "@/src/lib/tokens/registry";

const SNAPSHOT_KEY = "dw_balance_snapshot_v1";
const DEFAULT_INTERVAL_MS = 25_000;

type Snapshot = Record<string, string>;

async function loadSnapshot(): Promise<Snapshot> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as Snapshot) : {};
  } catch {
    return {};
  }
}

async function saveSnapshot(s: Snapshot): Promise<void> {
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s)).catch(() => {});
}

function prettyAmount(raw: bigint, decimals: number): string {
  const s = ethers.formatUnits(raw, decimals);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toFixed(n < 1 ? 4 : 2).replace(/\.?0+$/, "");
}

export function startTxWatcher(opts: {
  getAccounts: () => Account[];
  getTokens: () => ListedToken[];
  intervalMs?: number;
}): () => void {
  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return;
    running = true;

    try {
      const accounts = opts.getAccounts();
      const tokens = opts.getTokens();
      const prev = await loadSnapshot();
      const next: Snapshot = { ...prev };
      const isFirstRun = Object.keys(prev).length === 0;

      for (const acc of accounts) {
        const nativeKey = `${acc.address.toLowerCase()}:native`;
        try {
          const bal = await getNativeBalanceWei(acc.address);
          const balStr = bal.toString();
          const prevStr = prev[nativeKey];

          if (!isFirstRun && prevStr !== undefined) {
            const delta = bal - BigInt(prevStr);
            if (delta > 0n) {
              await notifyLocal({
                title: `${ELECTRONEUM.symbol} received`,
                body: `${acc.label}: +${prettyAmount(delta, ELECTRONEUM.decimals)} ${ELECTRONEUM.symbol}`,
                // No logoURI for native: `kind: "native"` is the signal, and
                // the renderer draws the bundled mark. A URL here would be a
                // second source of truth for the same picture.
                data: { accountId: acc.id, kind: "native", route: "/(tabs)/wallet", symbol: NATIVE_ASSET.symbol },
              });
            }
          }
          next[nativeKey] = balStr;
        } catch {
          // offline / RPC hiccup — keep last-known value, try again next tick
        }

        for (const t of tokens) {
          const key = `${acc.address.toLowerCase()}:${t.address.toLowerCase()}`;
          try {
            const bal = await getErc20BalanceRaw(t.address, acc.address);
            const balStr = bal.toString();
            const prevStr = prev[key];

            if (!isFirstRun && prevStr !== undefined) {
              const delta = bal - BigInt(prevStr);
              if (delta > 0n) {
                await notifyLocal({
                  title: `${t.symbol} received`,
                  body: `${acc.label}: +${prettyAmount(delta, t.decimals)} ${t.symbol}`,
                  data: {
                    accountId: acc.id,
                    kind: "token",
                    token: t.address,
                    route: "/(tabs)/wallet",
                    symbol: t.symbol,
                  },
                  logoURI: t.logoURI,
                });
              }
            }
            next[key] = balStr;
          } catch {
            // ignore this token this round
          }
        }
      }

      await saveSnapshot(next);
    } finally {
      running = false;
    }
  }

  tick();
  const timer = setInterval(tick, opts.intervalMs ?? DEFAULT_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
