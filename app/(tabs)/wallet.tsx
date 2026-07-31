// app/(tabs)/wallet.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/src/state/toast";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import { Redirect, useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { TokenLogo } from "@/src/components/TokenLogo";
import { ChangeIndicator } from "@/src/components/ChangeIndicator";
import { ReceiveModal } from "@/src/components/ReceiveModal";
import { CircleAction } from "@/src/components/CircleAction";
import { Skeleton } from "@/src/components/Skeleton";
import { RADIUS, SPACING } from "@/src/theme/tokens";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { useNotificationFeed } from "@/src/state/notificationsFeed";

import { ethers } from "ethers";
import { ELECTRONEUM } from "@/src/lib/chain/networks";
import { useTokens } from "@/src/state/tokens";
import { NATIVE_ASSET } from "@/src/lib/tokens/native";
import { useMarket } from "@/src/state/market";
import { getErc20BalanceRaw } from "@/src/lib/chain/erc20";
import { formatTokenAmountCompact, shortAddr } from "@/src/lib/format";
import { useAutoRefresh } from "@/src/hooks/useAutoRefresh";
import { AccountSwitcher } from "@/src/components/AccountSwitcher";
import { seedColor } from "@/src/features/accounts/seedVisuals";
import { getNativeBalanceWei } from "@/src/lib/chain/rpc";

/* ---------------------------------- Wallet ---------------------------------- */

/**
 * A unit PRICE, as opposed to a holding's value.
 *
 * Prices on this chain run from ~$0.00005 to ~$4000, so a fixed 2dp would
 * render most tokens as "$0.00" — which reads as worthless rather than cheap.
 * Significant digits instead, trailing zeros trimmed.
 */
function formatPrice(v: number): string {
  if (v >= 1) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** Compact fiat, with a floor so a real holding never renders as "$0". */
function formatFiat(v: number): string {
  if (v > 0 && v < 0.01) return "< $0.01";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Wallet() {
  const { theme } = useTheme();
  const router = useRouter();

  const isUnlocked = useSession((s) => s.isUnlocked);
  const vaultKey = useSession((s) => s.vaultKey);
  const accounts = useAccounts((s) => s.accounts);
  const seeds = useAccounts((s) => s.seeds);
  const activeAccount = useAccounts((s) => s.activeAccount());

  // Hidden accounts are excluded here as everywhere: the switcher must show
  // exactly what the accounts list shows, or switching lands somewhere the
  // user can't find again.
  //
  // Tinting only kicks in past one recovery phrase — with a single phrase
  // every chip would be the same colour, which is decoration, not information.
  const switchableAccounts = useMemo(
    () =>
      accounts
        .filter((a) => !a.hidden)
        .map((a) => ({
          id: a.id,
          label: a.label,
          seedColor:
            seeds.length > 1
              ? seedColor(Math.max(0, seeds.findIndex((s) => s.id === a.seedId)))
              : undefined,
        })),
    [accounts, seeds]
  );
  const tokens = useTokens((s) => s.tokens);
  const address = activeAccount?.address ?? null;
  const accountId = activeAccount?.id ?? null;

  const [receiveOpen, setReceiveOpen] = useState(false);

  const unreadNotifications = useNotificationFeed((s) => s.unread);
  const refreshNotificationFeed = useNotificationFeed((s) => s.refresh);

  // Data loading (for skeletons / content only) — default true so the
  // skeleton is what paints on first frame, not a "0.00" that then gets
  // replaced a moment later (that flash reads as janky, not fast).
  const [loading, setLoading] = useState(true);
  const [tokenLoading, setTokenLoading] = useState(true);

  // ✅ Pull-to-refresh UI state (ONLY for RefreshControl)
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);

  const [tokenBalances, setTokenBalances] = useState<Record<string, bigint>>({});


  const postTxTimersRef = useRef<number[]>([]);

  // Prevent overlapping refreshes (helps tab switching + focus refresh)
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    return () => {
      for (const id of postTxTimersRef.current) clearTimeout(id);
      postTxTimersRef.current = [];
      refreshInFlightRef.current = null;
    };
  }, []);

  // One toast, app-wide: src/state/toast.ts + <ToastHost/> at the root.
  // No local message/visible/timer state to keep in sync.
  const showToast = (msg: string) => toast.info(msg);

  // Numeric balance for the fiat line. The display string above carries
  // thousands separators, so it parses as NaN — derive from the raw wei.
  const nativeBalanceNumber = useMemo(() => {
    try {
      const n = Number(ethers.formatUnits(balanceWei, ELECTRONEUM.decimals));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }, [balanceWei]);

  const etnPriceUsd = useMarket((m) => m.native?.priceUsd ?? null);
  const etnChange24h = useMarket((m) => m.native?.change24h ?? null);
  const tokenPrices = useMarket((m) => m.tokens);

  /**
   * Everything the user holds, as ONE list.
   *
   * Native ETN is an asset like any other from the user's point of view — it
   * has a balance, a price and a chart — so it sits in the same list instead
   * of in a separate hero block. It is pinned first because it pays the fees
   * for everything else, and DCNT second because it is this wallet's own
   * token; after that, ordering is by what the holding is worth, so the
   * biggest position is always at the top where it is looked for.
   */
  const assets = useMemo(() => {
    type Row = {
      key: string;
      route: string;
      symbol: string;
      name: string;
      logoURI?: string;
      isNative: boolean;
      /** Display string, already sized to fit a row. */
      balanceText: string;
      /** The asset's unit price. Null when no market exists for it. */
      priceUsd: number | null;
      /** Null when we have no price — never guessed. */
      valueUsd: number | null;
      change24h: number | null;
    };

    const rows: Row[] = [
      {
        key: "native",
        route: "/token/native",
        symbol: NATIVE_ASSET.symbol,
        name: NATIVE_ASSET.name,
        isNative: true,
        balanceText: formatTokenAmountCompact(nativeBalanceNumber),
        priceUsd: etnPriceUsd,
        valueUsd: etnPriceUsd === null ? null : nativeBalanceNumber * etnPriceUsd,
        change24h: etnChange24h,
      },
    ];

    for (const t of tokens) {
      const raw = tokenBalances[t.address.toLowerCase()] ?? 0n;
      const market = tokenPrices[t.address.toLowerCase()] ?? null;

      let amount = 0;
      try {
        const n = Number(ethers.formatUnits(raw, t.decimals));
        amount = Number.isFinite(n) ? n : 0;
      } catch {
        amount = 0;
      }

      rows.push({
        key: t.address,
        route: `/token/${t.address}`,
        symbol: t.symbol,
        name: t.name,
        logoURI: t.logoURI,
        isNative: false,
        balanceText: formatTokenAmountCompact(amount),
        priceUsd: market?.priceUsd ?? null,
        valueUsd: market?.priceUsd == null ? null : amount * market.priceUsd,
        change24h: market?.change24h ?? null,
      });
    }

    const rank = (r: Row) => (r.isNative ? 0 : r.symbol === "DCNT" ? 1 : 2);
    return rows.sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return (b.valueUsd ?? 0) - (a.valueUsd ?? 0);
    });
  }, [tokens, tokenBalances, tokenPrices, nativeBalanceNumber, etnPriceUsd, etnChange24h]);

  /**
   * What everything is worth, and how that moved today.
   *
   * Only assets with a real price contribute. An unpriced token is left out of
   * BOTH sides rather than counted as zero — counting it as zero would state
   * that we know it is worthless, when what we actually know is nothing. The
   * change is value-weighted, so a 40% move on a $2 holding doesn't swing a
   * portfolio that is mostly ETN.
   */
  const portfolio = useMemo(() => {
    let total = 0;
    let weighted = 0;
    let changeBase = 0;
    let anyPriced = false;

    for (const a of assets) {
      if (a.priceUsd !== null) anyPriced = true;
      if (a.valueUsd === null) continue;
      total += a.valueUsd;
      if (a.change24h !== null) {
        weighted += a.valueUsd * a.change24h;
        changeBase += a.valueUsd;
      }
    }

    return {
      total,
      change24h: changeBase > 0 ? weighted / changeBase : null,
      /**
       * Whether we can state a figure at all.
       *
       * Keyed on having PRICES, not on the total being above zero. An empty
       * wallet with a live price feed is worth exactly $0.00 and should say
       * so — a dash there reads as "loading" or "broken" when the honest
       * answer is a confident zero. The dash is reserved for the one case
       * where we genuinely don't know: no price data at all.
       */
      priced: anyPriced,
    };
  }, [assets]);

  // `silent` = a background auto-refresh. It must not toggle the skeleton
  // flags, or the UI would flash placeholders every polling tick even
  // though we already have perfectly good data on screen.
  const refreshNative = useCallback(async (silent = false) => {
    if (!address) return;

    if (!silent) setLoading(true);
    setErr(null);

    try {
      const wei = await getNativeBalanceWei(address);
      setBalanceWei(wei);
    } catch (e: any) {
      // Only surface the error for user-initiated loads — a failed
      // background poll should leave the last-known balance alone.
      if (!silent) setErr(e?.message ?? "Failed to load balance");
    } finally {
      // ALWAYS clear, even on a silent refresh.
      //
      // This was `if (!silent)`, which stranded the skeleton: switching
      // accounts sets loading=true (to drop the previous account's figures),
      // but the refresh that follows a switch is silent — so nothing ever
      // set it back to false. It only *looked* fine on funded accounts,
      // because the skeleton also requires balance === 0. Any account with a
      // zero balance sat under a skeleton until a manual pull-to-refresh.
      //
      // Setting the flag stays gated on !silent (so background polls don't
      // flash placeholders); clearing it must not be.
      setLoading(false);
    }
  }, [address]);

  const refreshTokens = useCallback(async (silent = false) => {
    if (!address) return;
    if (tokens.length === 0) {
      setTokenLoading(false);
      return;
    }

    if (!silent) setTokenLoading(true);

    try {
      const limit = 4;
      const results: [string, bigint][] = [];

      let i = 0;
      async function worker() {
        while (i < tokens.length) {
          const idx = i++;
          const t = tokens[idx];
          const bal = await getErc20BalanceRaw(t.address, address!);
          results.push([t.address.toLowerCase(), bal]);
        }
      }

      await Promise.all(Array.from({ length: Math.min(limit, tokens.length) }, worker));

      const map: Record<string, bigint> = {};
      for (const [k, v] of results) map[k] = v;
      setTokenBalances(map);
    } finally {
      // Always clear — same stranded-skeleton reasoning as refreshNative.
      setTokenLoading(false);
    }
  }, [address, tokens]);

  const refreshAll = useCallback(async (silent = false) => {
    if (!address) return;

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const p = (async () => {
      await Promise.all([refreshNative(silent), refreshTokens(silent)]);
    })();

    refreshInFlightRef.current = p;

    try {
      await p;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, [address, refreshNative, refreshTokens]);

  // Pull-to-refresh handler — the only path that shows the RefreshControl
  // spinner, and the only one that surfaces load errors.
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refreshAll(false);
    } finally {
      setPullRefreshing(false);
    }
  }, [refreshAll]);

  // Live data: polls while this screen is focused and the app is in the
  // foreground, refreshes instantly on focus/foreground return, and fires
  // catch-up refreshes to cover indexer lag right after a transaction.
  // Pull-to-refresh is now a backup, not a requirement.
  const silentRefresh = useCallback(() => refreshAll(true), [refreshAll]);
  // refreshKey: address — switching accounts refreshes immediately rather
  // than waiting for the next poll tick.
  useAutoRefresh(silentRefresh, { enabled: !!address, refreshKey: address });

  // Drop the previous account's numbers the instant the address changes.
  // Without this, a switch briefly shows the OLD account's balance under the
  // NEW account's name — worse than showing a skeleton, because it reads as
  // real data. Skeletons appear immediately, then the refresh above fills in.
  const lastAddressRef = useRef<string | null>(address);
  useEffect(() => {
    if (lastAddressRef.current === address) return;
    lastAddressRef.current = address;
    setBalanceWei(0n);
    setTokenBalances({});
    setErr(null);
    setLoading(true);
    setTokenLoading(true);
  }, [address]);

  useFocusEffect(
    useCallback(() => {
      refreshNotificationFeed().catch(() => {});
      return () => setPullRefreshing(false);
    }, [refreshNotificationFeed])
  );

  if (!isUnlocked) return <Redirect href="/unlock" />;

  const canOpenSend = !!(address && vaultKey && accountId);

  const showBalanceSkeleton = loading && balanceWei === 0n;
  const showTokenSkeleton = tokenLoading && Object.keys(tokenBalances).length === 0;

  return (
    // edges={["top"]}: the tab bar below this screen is now IN FLOW and
    // carries the bottom safe area itself (see app/(tabs)/_layout.tsx).
    // Reserving it here as well would double-count the inset and leave a
    // visible dead strip above the bar.
    <Screen edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: SPACING.xxl }}
        // ✅ RefreshControl driven ONLY by pullRefreshing
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <T weight="bold" style={{ fontSize: 32, lineHeight: 38, letterSpacing: -1 }}>
              Wallet
            </T>

            {/* Manual refresh is pull-to-refresh now (see RefreshControl
                above) — this spot is the notifications bell instead. */}
            <Pressable hitSlop={6}
              onPress={() => router.push("/notifications")}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.surface2,
                opacity: pressed ? 0.7 : 1,
              })}
              accessibilityLabel="Notifications"
            >
              <Ionicons name="notifications-outline" size={18} color={theme.text} />
              {unreadNotifications > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.danger,
                    borderWidth: 1.5,
                    borderColor: theme.surface2,
                  }}
                />
              ) : null}
            </Pressable>
          </View>

          {/* Account switcher — only shown once there's more than one account */}
          {accounts.length > 1 ? (
            <>
              <View style={{ height: SPACING.lg }} />
              <AccountSwitcher
                accounts={switchableAccounts}
                activeId={accountId}
                onSwitch={async (a) => {
                  await useAccounts.getState().switchAccount(a.id);
                  showToast(`Switched to ${a.label}`);
                }}
              />
            </>
          ) : null}

          <View style={{ height: SPACING.xl }} />

          {/* ── Portfolio hero ────────────────────────────────────────────────
              One number: what everything in this account is worth. The old
              hero showed the ETN balance, which answered a narrower question
              and left the user to add up the rest themselves.

              ETN hasn't lost its place — it's the first card in Assets below,
              where it can show its balance, price move and chart like every
              other holding. */}
          <View>
            <T variant="caption" color={theme.muted}>
              Portfolio balance
            </T>

            <View style={{ height: SPACING.xs }} />

            {showBalanceSkeleton ? (
              <Animated.View exiting={FadeOut.duration(180)}>
                <Skeleton width={220} height={48} radius={14} />
              </Animated.View>
            ) : (
              <Animated.View entering={FadeIn.duration(260)}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <T weight="bold" style={{ fontSize: 44, lineHeight: 50, letterSpacing: -1.2 }}>
                    {/* A dash, not "$0.00". Zero is a claim about value; with
                        no price feed we simply don't know yet. */}
                    {portfolio.priced ? formatFiat(portfolio.total) : "—"}
                  </T>
                  {portfolio.change24h !== null ? (
                    <ChangeIndicator change={portfolio.change24h} suffix="today" size={14} />
                  ) : null}
                </View>
              </Animated.View>
            )}

            {err ? (
              <>
                <View style={{ height: SPACING.xs }} />
                <T variant="caption" color={theme.danger}>
                  {err}
                </T>
              </>
            ) : null}

            {/* Tap-to-copy address — quiet, no box. */}
            <View style={{ height: SPACING.sm }} />
            <Pressable
              onPress={async () => {
                if (!address) return;
                await Clipboard.setStringAsync(address);
                showToast("Address copied");
              }}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                opacity: pressed ? 0.6 : 1,
                alignSelf: "flex-start",
              })}
            >
              <T variant="caption" color={theme.muted}>
                {address ? shortAddr(address) : "—"}
              </T>
              <Ionicons name="copy-outline" size={13} color={theme.muted} />
            </Pressable>
          </View>

          <View style={{ height: SPACING.xxl }} />

          {/* Actions — circular and unboxed, not two stretched pill buttons
              inside a card. Fewer, bigger, more deliberate touch targets;
              tighter gap so the pair reads as one deliberate group rather
              than two buttons floating apart. */}
          <View style={{ flexDirection: "row", gap: SPACING.xl }}>
            <CircleAction
              icon="arrow-up"
              label="Send"
              primary
              disabled={!canOpenSend}
              onPress={() => {
                if (!canOpenSend) return;
                router.push("/send");
              }}
            />
            <CircleAction icon="qr-code-outline" label="Receive" onPress={() => setReceiveOpen(true)} />
          </View>

          <View style={{ height: SPACING.xxl }} />

          {/* ── Assets ───────────────────────────────────────────────────────
              Cards, not rows. Each holding gets its own surface with a
              consistent three-column rhythm — logo, identity, value — so the
              eye can scan straight down the right edge to compare positions
              instead of re-reading each line. */}
          <View>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <T weight="bold" style={{ fontSize: 20, letterSpacing: -0.3 }}>
                Assets
              </T>
              {/* Names the timeframe ONCE for the whole column, instead of
                  repeating "24h" on every card or — worse — leaving a bare
                  percentage whose period the reader has to guess. 24h is the
                  convention every major wallet uses, so it is also what a
                  crypto user assumes when nothing says otherwise; saying it
                  out loud just removes the doubt. */}
              <T variant="caption" color={theme.muted}>
                24h
              </T>
            </View>

            <View style={{ height: SPACING.md }} />

            <View style={{ gap: SPACING.sm }}>
              {assets.map((a) => {
                // The native row and the token rows finish loading on
                // different clocks, so each waits on its own skeleton flag
                // rather than one shared "is anything loading" state.
                const pending = a.isNative ? showBalanceSkeleton : showTokenSkeleton;

                return (
                  <Pressable
                    key={a.key}
                    hitSlop={4}
                    onPress={() => router.push(a.route as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`${a.symbol} details`}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: SPACING.md,
                      padding: SPACING.md,
                      borderRadius: RADIUS.xl,
                      backgroundColor: theme.surface2,
                      // Pressed state on the card itself, so the whole target
                      // responds — not just the text inside it.
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <TokenLogo symbol={a.symbol} uri={a.logoURI} native={a.isNative} size={40} />

                    {/* Left column: what the asset IS and how the market is
                        treating it. Right column: what YOU hold. Splitting
                        market data from personal data means neither has to be
                        read twice to work out which is which. */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T weight="semibold" numberOfLines={1}>
                        {a.symbol}
                      </T>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <T variant="caption" color={theme.muted} numberOfLines={1}>
                          {a.priceUsd !== null ? formatPrice(a.priceUsd) : a.name}
                        </T>
                        {a.change24h !== null ? <ChangeIndicator change={a.change24h} size={11} /> : null}
                      </View>
                    </View>

                    {/* flexShrink: 0 — the value column states a fact and must
                        never be squeezed into an ellipsis. The left column
                        carries flex: 1, so a long token NAME gives way instead,
                        which is the right thing to lose. formatTokenAmountCompact
                        bounds this column's width regardless. */}
                    <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
                      {pending ? (
                        <>
                          <Animated.View exiting={FadeOut.duration(180)}>
                            <Skeleton width={72} height={16} radius={10} />
                          </Animated.View>
                          <Animated.View exiting={FadeOut.duration(180)}>
                            <Skeleton width={52} height={12} radius={8} style={{ marginTop: 6 }} />
                          </Animated.View>
                        </>
                      ) : (
                        <Animated.View entering={FadeIn.duration(260)} style={{ alignItems: "flex-end" }}>
                          {/* Value leads. On a portfolio screen the question is
                              "what is this worth", and the token count is the
                              supporting detail — not the other way round. */}
                          <T weight="semibold" numberOfLines={1}>
                            {a.valueUsd !== null ? formatFiat(a.valueUsd) : "—"}
                          </T>
                          <T variant="caption" color={theme.muted} numberOfLines={1}>
                            {a.balanceText} {a.symbol}
                          </T>
                        </Animated.View>
                      )}
                    </View>

                    <Ionicons name="chevron-forward" size={15} color={theme.muted} />
                  </Pressable>
                );
              })}
            </View>

            {tokens.length === 0 ? (
              <>
                <View style={{ height: SPACING.md }} />
                <T variant="caption" color={theme.muted}>
                  Vetted Electroneum tokens appear here automatically as they&apos;re approved.
                </T>
              </>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <ReceiveModal visible={receiveOpen} onClose={() => setReceiveOpen(false)} address={address ?? ""} />
    </Screen>
  );
}
