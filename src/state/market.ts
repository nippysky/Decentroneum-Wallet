// src/state/market.ts
//
// Token prices, market stats, and chart history.
//
// Everything here comes from OUR push server, never from an upstream provider
// directly.
//
// The upstream data is GeckoTerminal's (CoinGecko's on-chain product) for token
// prices and history, plus the CoinGecko API for the ETN/USD rate. Both are
// rate-limited PER IP, and CoinGecko scopes its keyless tier to "low-volume,
// client-side testing... non-commercial educational use" with limits that are
// "dynamic and managed to prioritize fair access".
//
// So calling upstream from the app is wrong twice over: it would put a
// commercial wallet on infrastructure documented for prototyping, and every
// install would be its own unpredictable bucket. Instead one origin refreshes
// a cache on a fixed schedule and every install reads the same rows — API usage
// is completely independent of how many users we have.
//
// The pricing rule lives server-side too (server/src/marketData.ts): every
// token is priced through its deepest pool paired with WETN, above a
// liquidity floor, and the same pool supplies both the headline price and
// the chart — so the big number always agrees with the last point on the
// line.
import { create } from "zustand";
import { fetchWithTimeout } from "@/src/lib/net/http";
import { PUSH_SERVER_URL } from "@/src/lib/notifications/register";

/** Chart ranges, in the order they're shown. Must match server RANGES. */
export const CHART_RANGES = ["1D", "1W", "1M", "1Y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export type TokenMarket = {
  address: string;
  /** Null when no WETN pool above the liquidity floor exists — show "—". */
  priceUsd: number | null;
  /** Same price quoted in ETN. Shown alongside USD. */
  priceEtn: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  /** Total on-chain supply x price. NOT market cap — see MarketPanel. */
  fdvUsd: number | null;
  /** e.g. "BOLT / WETN 0.3%" — shown so the price's origin is visible. */
  poolLabel: string | null;
};

export type NativeMarket = {
  priceUsd: number;
  change24h: number | null;
};

export type PricePoint = { t: number; c: number };

type Attribution = { prices: string; pricesUrl: string; native: string };

type MarketState = {
  native: NativeMarket | null;
  /** Keyed by lowercased token address. */
  tokens: Record<string, TokenMarket>;
  attribution: Attribution | null;

  /** Keyed by `${lowercased address}:${range}`. */
  history: Record<string, PricePoint[]>;
  historyLoading: Record<string, boolean>;

  refresh: () => Promise<void>;
  loadHistory: (address: string, range: ChartRange) => Promise<void>;
};

const key = (address: string, range: ChartRange) => `${address.toLowerCase()}:${range}`;

export const useMarket = create<MarketState>((set, get) => ({
  native: null,
  tokens: {},
  attribution: null,
  history: {},
  historyLoading: {},

  refresh: async () => {
    try {
      const res = await fetchWithTimeout(`${PUSH_SERVER_URL}/market`, { method: "GET" });
      if (!res.ok) return;
      const json: any = await res.json();

      const tokens: Record<string, TokenMarket> = {};
      for (const t of Array.isArray(json?.tokens) ? json.tokens : []) {
        if (typeof t?.address !== "string") continue;
        tokens[t.address.toLowerCase()] = {
          address: t.address.toLowerCase(),
          priceUsd: numOrNull(t.priceUsd),
          priceEtn: numOrNull(t.priceEtn),
          change24h: numOrNull(t.change24h),
          liquidityUsd: numOrNull(t.liquidityUsd),
          volume24hUsd: numOrNull(t.volume24hUsd),
          fdvUsd: numOrNull(t.fdvUsd),
          poolLabel: typeof t.poolLabel === "string" ? t.poolLabel : null,
        };
      }

      const nativeUsd = numOrNull(json?.native?.priceUsd);

      set({
        tokens,
        native: nativeUsd === null ? null : { priceUsd: nativeUsd, change24h: numOrNull(json.native.change24h) },
        attribution: json?.attribution ?? null,
      });
    } catch {
      // Swallowed on purpose. A missing price is a cosmetic gap — balances,
      // sending and receiving all work without one — so this must never
      // surface as an error the user has to dismiss, and the previous values
      // stay on screen rather than blanking out.
    }
  },

  loadHistory: async (address, range) => {
    const k = key(address, range);
    if (get().historyLoading[k]) return;

    set((s) => ({ historyLoading: { ...s.historyLoading, [k]: true } }));
    try {
      const url = `${PUSH_SERVER_URL}/market/history?token=${address}&range=${range}`;
      const res = await fetchWithTimeout(url, { method: "GET" });
      if (!res.ok) {
        // 404 is a real answer, not a failure: no pool deep enough to price,
        // so there is nothing to plot.
        set((s) => ({ history: { ...s.history, [k]: [] } }));
        return;
      }
      const json: any = await res.json();
      const points: PricePoint[] = (Array.isArray(json?.points) ? json.points : [])
        .map((p: any) => ({ t: Number(p?.t), c: Number(p?.c) }))
        .filter((p: PricePoint) => Number.isFinite(p.t) && Number.isFinite(p.c));

      set((s) => ({ history: { ...s.history, [k]: points } }));
    } catch {
      set((s) => ({ history: { ...s.history, [k]: [] } }));
    } finally {
      set((s) => ({ historyLoading: { ...s.historyLoading, [k]: false } }));
    }
  },
}));

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

