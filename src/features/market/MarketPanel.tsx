// src/features/market/MarketPanel.tsx
//
// Price, price line, and the value of what the user holds. Nothing else.
//
// Three editorial rules, all the same principle — a number on a wallet screen
// is an implicit claim, and on a chain this thin some of those claims would be
// false:
//
//  • No price rather than a wrong one. The server only publishes a price for
//    a token that has a WETN pool above the liquidity floor, so a null price
//    means "no real market" and renders an em dash with a plain explanation.
//
//  • No market cap. Anywhere. Market cap needs circulating supply, which is
//    a human judgment about which addresses don't count and is not readable
//    on-chain. Upstream reports it as null for DCNT and literal 0 for BOLT.
//    There is no honest value to show, so there is no row.
//
//  • Liquidity and 24h volume sit with the price, not buried. "$0.000049" on
//    its own implies a market. "$0.000049 · $7,216 liquidity · $0 traded
//    today" tells the truth about what that price is worth.
import React, { useEffect, useState } from "react";
import { Dimensions, View } from "react-native";

import { T } from "@/src/components/T";
import { PriceChart } from "@/src/components/PriceChart";
import { RangePicker } from "@/src/components/RangePicker";
import { TextButton } from "@/src/components/TextButton";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useMarket, type ChartRange, type TokenMarket } from "@/src/state/market";
import { openInApp } from "@/src/lib/chain/openExplorer";
import { RADIUS, SCREEN_PADDING, SPACING } from "@/src/theme/tokens";

/** Prices here span ~$0.00005 to ~$4000, so significant digits beat fixed dp. */
function formatUsdPrice(v: number): string {
  if (v === 0) return "$0.00";
  if (v >= 1) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  // Below a cent, enough digits to tell two tokens apart.
  return `$${v.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatUsdCompact(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatEtn(v: number): string {
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return v.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function StatRow({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        padding: SPACING.md,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: SPACING.md,
      }}
    >
      <T color={theme.muted}>{label}</T>
      <T weight="semibold" numberOfLines={1}>
        {value}
      </T>
    </View>
  );
}

export function MarketPanel({
  address,
  symbol,
  /** Human-readable balance, used for the holdings value. */
  balance,
  /** Native ETN has no pool of its own — it IS the pricing anchor. */
  isNative,
}: {
  address: string;
  symbol: string;
  balance: number;
  isNative: boolean;
}) {
  const { theme } = useTheme();
  const [range, setRange] = useState<ChartRange>("1D");

  const native = useMarket((s) => s.native);
  const token = useMarket((s) => (isNative ? null : s.tokens[address.toLowerCase()] ?? null));
  const attribution = useMarket((s) => s.attribution);
  const history = useMarket((s) => s.history);
  const historyLoading = useMarket((s) => s.historyLoading);
  const loadHistory = useMarket((s) => s.loadHistory);
  const refresh = useMarket((s) => s.refresh);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // Native ETN has no pool, so there is no per-pool line to draw for it. Its
  // price comes from CoinGecko, which is the one thing CoinGecko is used for.
  useEffect(() => {
    if (isNative) return;
    loadHistory(address, range).catch(() => {});
  }, [address, range, isNative, loadHistory]);

  const priceUsd = isNative ? native?.priceUsd ?? null : token?.priceUsd ?? null;
  const change24h = isNative ? native?.change24h ?? null : token?.change24h ?? null;

  const chartKey = `${address.toLowerCase()}:${range}`;
  const points = history[chartKey] ?? [];
  const isLoading = !!historyLoading[chartKey];

  const chartWidth = Dimensions.get("window").width - SCREEN_PADDING * 2;
  const holdingsUsd = priceUsd !== null ? priceUsd * balance : null;

  return (
    <View style={{ gap: SPACING.lg }}>
      {/* ── Price ──────────────────────────────────────────────────────────── */}
      <View style={{ gap: 4 }}>
        {priceUsd !== null ? (
          <>
            <T weight="bold" style={{ fontSize: 28, lineHeight: 34, letterSpacing: -0.8 }}>
              {formatUsdPrice(priceUsd)}
            </T>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {change24h !== null ? (
                <T
                  weight="semibold"
                  color={change24h >= 0 ? theme.accent : theme.danger}
                  style={{ fontSize: 14 }}
                >
                  {change24h >= 0 ? "▲" : "▼"} {Math.abs(change24h).toFixed(2)}% today
                </T>
              ) : null}

              {/* The token/ETN pairing — this is the price that actually lives
                  on-chain; the USD figure above is it multiplied by ETN/USD. */}
              {!isNative && token?.priceEtn !== null && token?.priceEtn !== undefined ? (
                <T variant="caption" color={theme.muted}>
                  {formatEtn(token.priceEtn)} ETN
                </T>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <T weight="bold" color={theme.muted} style={{ fontSize: 28, lineHeight: 34 }}>
              —
            </T>
            {/* Says why, so a dash doesn't read as a bug. */}
            <T variant="caption" color={theme.muted}>
              No market price yet — no pool with enough liquidity to quote from.
            </T>
          </>
        )}
      </View>

      {/* ── Price line ─────────────────────────────────────────────────────── */}
      {!isNative && priceUsd !== null ? (
        <View style={{ gap: SPACING.sm }}>
          <PriceChart points={points} width={chartWidth} loading={isLoading} />
          <RangePicker value={range} onChange={setRange} />
        </View>
      ) : null}

      {/* ── Value of the user's holdings ───────────────────────────────────── */}
      {holdingsUsd !== null && balance > 0 ? (
        <View style={{ gap: 2 }}>
          <T variant="caption" color={theme.muted}>
            Value of your {symbol}
          </T>
          <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
            {formatUsdCompact(holdingsUsd)}
          </T>
        </View>
      ) : null}

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <Stats token={token} />

      {/* ── Attribution — requested by GeckoTerminal for the free tier ─────── */}
      {!isNative && priceUsd !== null && attribution ? (
        <View style={{ alignItems: "center" }}>
          <TextButton
            title={`Price data by ${attribution.prices}`}
            onPress={() => openInApp(attribution.pricesUrl)}
          />
        </View>
      ) : null}
    </View>
  );
}

function Stats({ token }: { token: TokenMarket | null }) {
  const { theme } = useTheme();
  if (!token) return null;

  const rows: { label: string; value: string }[] = [];

  // Total on-chain supply x price. A real, checkable number — and NOT market
  // cap, so it carries its own name.
  if (token.fdvUsd !== null) {
    rows.push({ label: "Fully diluted value", value: formatUsdCompact(token.fdvUsd) });
  }
  if (token.liquidityUsd !== null) {
    rows.push({ label: "Liquidity", value: formatUsdCompact(token.liquidityUsd) });
  }
  // 0 is a real reading here, not missing data — DCNT genuinely traded $0
  // today, and that is worth knowing.
  if (token.volume24hUsd !== null) {
    rows.push({ label: "Volume (24h)", value: formatUsdCompact(token.volume24hUsd) });
  }
  // Where the price came from. Visible provenance beats a bare number.
  if (token.poolLabel) {
    rows.push({ label: "Priced from", value: token.poolLabel });
  }

  if (rows.length === 0) return null;

  return (
    <View style={{ borderRadius: RADIUS.xl, backgroundColor: theme.surface2, overflow: "hidden" }}>
      {rows.map((row, i) => (
        <React.Fragment key={row.label}>
          {i > 0 ? <View style={{ height: 1, backgroundColor: theme.bg }} /> : null}
          <StatRow label={row.label} value={row.value} />
        </React.Fragment>
      ))}
    </View>
  );
}
