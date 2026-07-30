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
import { useMarket } from "@/src/state/market";
import { getErc20BalanceRaw } from "@/src/lib/chain/erc20";
import { formatNative2dpFromWei, formatUnits2dp, shortAddr } from "@/src/lib/format";
import { useAutoRefresh } from "@/src/hooks/useAutoRefresh";
import { AccountSwitcher } from "@/src/components/AccountSwitcher";
import { seedColor } from "@/src/features/accounts/seedVisuals";
import { getNativeBalanceWei } from "@/src/lib/chain/rpc";

/* ---------------------------------- Wallet ---------------------------------- */

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

  const nativeBalanceText = useMemo(() => formatNative2dpFromWei(balanceWei), [balanceWei]);

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
   * A token row's holdings value, or null when we have no price for it.
   *
   * Returns null rather than "$0" for an unpriced token: the row falls back to
   * showing the symbol, which is honest, where "$0.00" would claim we know the
   * balance is worthless when in fact we know nothing.
   */
  const tokenFiat = (addr: string, raw: bigint, decimals: number): string | null => {
    const price = tokenPrices[addr.toLowerCase()]?.priceUsd ?? null;
    if (price === null) return null;
    try {
      const amount = Number(ethers.formatUnits(raw, decimals));
      if (!Number.isFinite(amount) || amount === 0) return null;
      return formatFiat(amount * price);
    } catch {
      return null;
    }
  };

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

          {/* Balance hero — quiet, no card chrome, the number does the talking.
              Tappable straight into the native ETN detail page, same as any
              token row below.
              
              The chevron and the pressed background are the whole point: this
              was already tappable, but nothing on screen said so, so nobody
              tapped it. An affordance that only the developer knows about is
              not a feature. */}
          <Pressable
            hitSlop={6}
            onPress={() => router.push("/token/native")}
            accessibilityRole="button"
            accessibilityLabel="View ETN details"
            style={({ pressed }) => ({
              marginHorizontal: -SPACING.sm,
              paddingHorizontal: SPACING.sm,
              paddingVertical: SPACING.xs,
              borderRadius: RADIUS.lg,
              backgroundColor: pressed ? theme.surface2 : "transparent",
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T variant="caption" color={theme.muted}>
                Balance
              </T>
              <Ionicons name="chevron-forward" size={13} color={theme.muted} />
            </View>

            <View style={{ height: SPACING.xs }} />

            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
              {showBalanceSkeleton ? (
                <Animated.View exiting={FadeOut.duration(180)}>
                  <Skeleton width={190} height={46} radius={14} />
                </Animated.View>
              ) : (
                <Animated.View entering={FadeIn.duration(260)}>
                  <T weight="bold" style={{ fontSize: 44, lineHeight: 50, letterSpacing: -1.2 }}>
                    {nativeBalanceText}
                  </T>
                </Animated.View>
              )}

              {showBalanceSkeleton ? (
                <Animated.View exiting={FadeOut.duration(180)}>
                  <Skeleton width={38} height={16} radius={10} style={{ marginBottom: 8 }} />
                </Animated.View>
              ) : (
                <Animated.View entering={FadeIn.duration(260)}>
                  <T weight="semibold" color={theme.muted} style={{ fontSize: 16 }}>
                    {ELECTRONEUM.symbol}
                  </T>
                </Animated.View>
              )}
            </View>

            {/* What the balance is actually worth, plus which way ETN moved
                today. Two small lines that turn a raw token count into
                something a person can act on. Market colours, not brand ones
                — green up / red down is read faster than it is thought
                about. */}
            {etnPriceUsd !== null ? (
              <>
                <View style={{ height: SPACING.xs }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <T weight="semibold" color={theme.muted} style={{ fontSize: 15 }}>
                    {formatFiat(nativeBalanceNumber * etnPriceUsd)}
                  </T>
                  <ChangeIndicator change={etnChange24h} size={13} />
                </View>
              </>
            ) : null}

            {err ? (
              <>
                <View style={{ height: SPACING.xs }} />
                <T variant="caption" color={theme.danger}>
                  {err}
                </T>
              </>
            ) : null}

            {/* Tap-to-copy address — quiet, no box, replaces the old boxed
                "Account" row entirely. */}
            <View style={{ height: SPACING.sm }} />
            <Pressable
              onPress={async () => {
                if (!address) return;
                await Clipboard.setStringAsync(address);
                showToast("Address copied");
              }}
              hitSlop={8}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1, alignSelf: "flex-start" })}
            >
              <T variant="caption" color={theme.muted}>
                {address ? shortAddr(address) : "—"}
              </T>
              <Ionicons name="copy-outline" size={13} color={theme.muted} />
            </Pressable>
          </Pressable>

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

          {/* Tokens */}
          <View>
            <T weight="bold" style={{ fontSize: 18 }}>Tokens</T>

            {/* One line, said once. The chevrons imply it, but "tappable" is
                worth stating outright for the screen that hides the price
                chart behind it — an undiscovered feature is no feature. */}
            <T variant="caption" color={theme.muted}>
              Tap any asset for its price and history.
            </T>

            <View style={{ height: SPACING.sm }} />

            {tokens.length === 0 ? (
              <T color={theme.muted}>Vetted Electroneum tokens will appear here automatically as they&apos;re approved.</T>
            ) : (
              <View style={{ gap: 2 }}>
                {tokens.map((t) => {
                  const raw = tokenBalances[t.address.toLowerCase()] ?? 0n;
                  const balText = formatUnits2dp(raw, t.decimals);

                  return (
                    <Pressable hitSlop={6}
                      key={t.address}
                      onPress={() => router.push(`/token/${t.address}`)}
                      style={({ pressed }) => ({
                        paddingVertical: SPACING.sm,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                        <TokenLogo symbol={t.symbol} uri={t.logoURI} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <T weight="semibold">{t.symbol}</T>
                          <T variant="caption" color={theme.muted} numberOfLines={1}>
                            {t.name}
                          </T>
                        </View>
                      </View>

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ alignItems: "flex-end" }}>
                          {showTokenSkeleton ? (
                            <Animated.View exiting={FadeOut.duration(180)}>
                              <Skeleton width={84} height={16} radius={10} />
                            </Animated.View>
                          ) : (
                            <Animated.View entering={FadeIn.duration(260)}>
                              <T weight="semibold">{balText}</T>
                            </Animated.View>
                          )}
                          {showTokenSkeleton ? (
                            <Animated.View exiting={FadeOut.duration(180)}>
                              <Skeleton width={34} height={12} radius={8} style={{ marginTop: 6 }} />
                            </Animated.View>
                          ) : (
                            <Animated.View entering={FadeIn.duration(260)}>
                              <T variant="caption" color={theme.muted}>
                                {tokenFiat(t.address, raw, t.decimals) ?? t.symbol}
                              </T>
                            </Animated.View>
                          )}
                        </View>

                        {/* Says "there is more behind this row". Without it the
                            rows read as a static list, and the detail screen
                            with the chart on it goes undiscovered. */}
                        <Ionicons name="chevron-forward" size={15} color={theme.muted} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <ReceiveModal visible={receiveOpen} onClose={() => setReceiveOpen(false)} address={address ?? ""} />
    </Screen>
  );
}
