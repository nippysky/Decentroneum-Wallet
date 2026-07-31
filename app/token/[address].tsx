// app/token/[address].tsx
//
// Per-asset detail page — tap any token (or the native ETN balance) on Home
// to land here. Shows the balance, Send/Receive for just that asset, the
// asset's own details (name, contract address, decimals), and a real
// transaction history for that asset on the connected address (Blockscout-
// backed, see src/lib/chain/activity.ts).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { ethers } from "ethers";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { TokenLogo } from "@/src/components/TokenLogo";
import { Skeleton } from "@/src/components/Skeleton";
import { ReceiveModal } from "@/src/components/ReceiveModal";
import { CircleAction } from "@/src/components/CircleAction";
import { MarketPanel } from "@/src/features/market/MarketPanel";
import { Tabs } from "@/src/components/Tabs";
import { RADIUS, SPACING } from "@/src/theme/tokens";

import { useTheme } from "@/src/theme/ThemeProvider";
import { FONT } from "@/src/theme/typography";
import { useAccounts } from "@/src/state/accounts";
import { useTokens } from "@/src/state/tokens";

import { ELECTRONEUM } from "@/src/lib/chain/networks";
import { NATIVE_ASSET } from "@/src/lib/tokens/native";
import { getNativeBalanceWei } from "@/src/lib/chain/rpc";
import { getErc20BalanceRaw } from "@/src/lib/chain/erc20";
import { readErc20Metadata } from "@/src/lib/tokens/registry";
import { fetchNativeActivity, fetchTokenActivity, type ActivityItem } from "@/src/lib/chain/activity";
import { openExplorerAddress, openExplorerToken, openExplorerTx } from "@/src/lib/chain/openExplorer";
import { formatNative2dpFromWei, formatUnits2dp, shortAddr } from "@/src/lib/format";
import { toast } from "@/src/state/toast";


function timeAgo(ts: number) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 20) return "Just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatAmount(raw: string, decimals: number) {
  try {
    const s = ethers.formatUnits(raw, decimals);
    const n = Number(s);
    if (!Number.isFinite(n)) return s;
    return n.toFixed(n < 1 ? 4 : 2).replace(/\.?0+$/, "") || "0";
  } catch {
    return raw;
  }
}

export default function TokenDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ address: string }>();
  const routeAddress = params.address ?? "native";
  const isNative = routeAddress === "native";

  const activeAccount = useAccounts((s) => s.activeAccount());
  const owner = activeAccount?.address ?? null;
  const tokens = useTokens((s) => s.tokens);

  const listedToken = useMemo(
    () => (isNative ? undefined : tokens.find((t) => t.address.toLowerCase() === routeAddress.toLowerCase())),
    [tokens, routeAddress, isNative]
  );

  const [meta, setMeta] = useState<{ symbol: string; name: string; decimals: number; logoURI?: string } | null>(
    isNative ? { ...NATIVE_ASSET } : listedToken ?? null
  );
  const [metaLoading, setMetaLoading] = useState(!isNative && !listedToken);

  const [balanceRaw, setBalanceRaw] = useState<bigint>(0n);
  const [balanceLoading, setBalanceLoading] = useState(true);

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const [receiveOpen, setReceiveOpen] = useState(false);

  // Details and Activity are tabbed rather than stacked. Stacked, reaching the
  // transaction list meant scrolling past the price, the chart, the range
  // picker, the holdings value and six stat rows — so the part people most
  // often come here for was the hardest to reach.
  const [tab, setTab] = useState<"Activity" | "Details">("Activity");

  // Defensive fallback: read on-chain metadata directly if this address ever
  // isn't in the curated registry (shouldn't normally happen — Home only
  // links to listed tokens — but a stale deep link shouldn't dead-end).
  useEffect(() => {
    if (isNative || listedToken) return;
    let alive = true;
    setMetaLoading(true);
    readErc20Metadata(routeAddress)
      .then((m) => {
        if (alive) setMeta(m);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setMetaLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isNative, listedToken, routeAddress]);

  useEffect(() => {
    if (listedToken) setMeta(listedToken);
  }, [listedToken]);

  const loadBalance = useCallback(async () => {
    if (!owner) return;
    setBalanceLoading(true);
    try {
      const wei = isNative ? await getNativeBalanceWei(owner) : await getErc20BalanceRaw(routeAddress, owner);
      setBalanceRaw(wei);
    } catch {
      // keep last-known value
    } finally {
      setBalanceLoading(false);
    }
  }, [owner, routeAddress, isNative]);

  const loadActivity = useCallback(async () => {
    if (!owner) return;
    setActivityLoading(true);
    try {
      const items = isNative ? await fetchNativeActivity(owner) : await fetchTokenActivity(routeAddress, owner);
      setActivity(items);
    } finally {
      setActivityLoading(false);
    }
  }, [owner, routeAddress, isNative]);

  useFocusEffect(
    useCallback(() => {
      loadBalance();
      loadActivity();
    }, [loadBalance, loadActivity])
  );

  const decimals = meta?.decimals ?? 18;
  const symbol = meta?.symbol ?? "—";
  const name = meta?.name ?? "—";
  const logoURI = meta?.logoURI;

  const balanceText = isNative ? formatNative2dpFromWei(balanceRaw) : formatUnits2dp(balanceRaw, decimals);

  // The display strings above carry thousands separators, so they parse as
  // NaN. Derive the numeric balance from the raw value instead — this is what
  // gets multiplied by the price for the holdings figure.
  const balanceAsNumber = useMemo(() => {
    try {
      const n = Number(ethers.formatUnits(balanceRaw, isNative ? ELECTRONEUM.decimals : decimals));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }, [balanceRaw, decimals, isNative]);
  const showBalanceSkeleton = balanceLoading && balanceRaw === 0n;

  const sendHref = isNative ? "/send" : ({ pathname: "/send", params: { asset: routeAddress } } as const);

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable hitSlop={6}
            onPress={() => router.back()}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.surface2,
              opacity: pressed ? 0.85 : 1,
            })}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={20} color={theme.text} />
          </Pressable>

          <View style={{ flex: 1, minWidth: 0 }}>
            <T weight="bold" style={{ fontSize: 18 }} numberOfLines={1}>
              {name !== "—" ? name : symbol !== "—" ? symbol : "Token"}
            </T>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
          <View style={{ alignItems: "center", paddingTop: SPACING.lg, gap: SPACING.sm }}>
            {/* Bigger now that nothing boxes it in — on a page about one
                asset, its mark should carry the top of the screen. */}
            {metaLoading ? (
              <Skeleton width={64} height={64} radius={999} />
            ) : (
              <TokenLogo symbol={symbol} uri={logoURI} native={isNative} size={64} />
            )}

            {showBalanceSkeleton ? (
              <Skeleton width={160} height={38} radius={12} style={{ marginTop: SPACING.sm }} />
            ) : (
              <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)}>
                {/* The EXACT balance, with commas — this is the screen people
                    open when they want the real number, so it is not
                    abbreviated the way the home-screen row is.
                    
                    adjustsFontSizeToFit shrinks a very large figure to fit on
                    one line instead of clipping it. A truncated balance reads
                    as a different quantity, which is the one failure mode a
                    balance must never have. */}
                <T
                  weight="bold"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}
                  style={{ fontSize: 34, lineHeight: 40, letterSpacing: -1, textAlign: "center" }}
                >
                  {balanceText} {symbol !== "—" ? symbol : ""}
                </T>
              </Animated.View>
            )}
          </View>

          <View style={{ height: SPACING.xl }} />

          {/* Actions */}
          <View style={{ flexDirection: "row", justifyContent: "center", gap: SPACING.xl }}>
            <CircleAction
              icon="arrow-up"
              label="Send"
              primary
              disabled={!owner}
              onPress={() => {
                if (!owner) return;
                router.push(sendHref as any);
              }}
            />
            <CircleAction icon="qr-code-outline" label="Receive" onPress={() => setReceiveOpen(true)} />
          </View>

          <View style={{ height: SPACING.xxl }} />

          {/* Market — price, line chart, holdings value, market stats.
              Everything here is read from our own push server's cache, not
              from GeckoTerminal directly; see src/state/market.ts for why
              that distinction matters at scale. */}
          <MarketPanel
            address={routeAddress}
            symbol={symbol !== "—" ? symbol : ""}
            balance={balanceAsNumber}
            isNative={isNative}
          />

          <View style={{ height: SPACING.xxl }} />

          <Tabs tabs={["Activity", "Details"] as const} value={tab} onChange={setTab} />

          <View style={{ height: SPACING.lg }} />

          {/* ── Details ─────────────────────────────────────────────────────── */}
          <View style={{ gap: SPACING.sm, display: tab === "Details" ? "flex" : "none" }}>
            <View style={{ borderRadius: RADIUS.xl, backgroundColor: theme.surface2, overflow: "hidden" }}>
              <View style={{ padding: SPACING.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <T color={theme.muted}>Name</T>
                {metaLoading ? <Skeleton width={90} height={16} radius={8} /> : <T weight="semibold">{name}</T>}
              </View>

              <View style={{ height: 1, backgroundColor: theme.bg }} />

              {isNative ? (
                <View style={{ padding: SPACING.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <T color={theme.muted}>Network</T>
                  <T weight="semibold">{ELECTRONEUM.name}</T>
                </View>
              ) : (
                <View
                  style={{
                    padding: SPACING.md,
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: SPACING.sm,
                  }}
                >
                  <T color={theme.muted}>Contract</T>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    {/* Tapping the address itself opens the contract's page
                        on the explorer (in-app), which is what people
                        actually want to do with a contract address. */}
                    <Pressable
                      onPress={() => openExplorerToken(routeAddress)}
                      hitSlop={6}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <T weight="semibold" color={theme.accent} style={{ fontFamily: FONT.mono }}>
                        {shortAddr(routeAddress)}
                      </T>
                      <Ionicons name="open-outline" size={13} color={theme.accent} />
                    </Pressable>

                    <Pressable
                      onPress={async () => {
                        await Clipboard.setStringAsync(routeAddress);
                        toast.success("Contract address copied");
                      }}
                      hitSlop={8}
                      style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Ionicons name="copy-outline" size={14} color={theme.muted} />
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={{ height: 1, backgroundColor: theme.bg }} />

              <View style={{ padding: SPACING.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <T color={theme.muted}>Decimals</T>
                {metaLoading ? <Skeleton width={30} height={16} radius={8} /> : <T weight="semibold">{decimals}</T>}
              </View>

              <View style={{ height: 1, backgroundColor: theme.bg }} />

              <Pressable hitSlop={6}
                onPress={() => (isNative ? openExplorerAddress(owner ?? "") : openExplorerToken(routeAddress))}
                style={({ pressed }) => ({
                  padding: SPACING.md,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <T color={theme.muted}>View on explorer</T>
                <Ionicons name="open-outline" size={16} color={theme.muted} />
              </Pressable>
            </View>
          </View>

          {/* ── Activity ────────────────────────────────────────────────────
              `display: none` rather than unmounting: switching tabs must not
              re-trigger the activity fetch or lose scroll position, and the
              list is small enough that keeping it mounted costs nothing. */}
          <View style={{ gap: SPACING.sm, display: tab === "Activity" ? "flex" : "none" }}>
            {activityLoading ? (
              <View style={{ gap: SPACING.md }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Skeleton width={36} height={36} radius={18} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Skeleton width={120} height={14} radius={7} />
                      <Skeleton width={70} height={11} radius={6} />
                    </View>
                    <Skeleton width={60} height={14} radius={7} />
                  </View>
                ))}
              </View>
            ) : activity.length === 0 ? (
              <T color={theme.muted}>No activity yet for this asset.</T>
            ) : (
              <View style={{ gap: 2 }}>
                {activity.map((item) => {
                  const isOut = item.direction === "out";
                  const counterparty = isOut ? item.to : item.from;
                  const amountText = formatAmount(item.valueRaw, decimals);

                  return (
                    <Pressable hitSlop={6}
                      key={item.hash}
                      onPress={() => openExplorerTx(item.hash)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: SPACING.sm,
                        opacity: pressed ? 0.65 : 1,
                      })}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: theme.surface2,
                        }}
                      >
                        <Ionicons
                          name={item.failed ? "close" : isOut ? "arrow-up" : "arrow-down"}
                          size={16}
                          color={item.failed ? theme.danger : theme.text}
                        />
                      </View>

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T weight="semibold">
                          {item.failed ? "Failed" : isOut ? "Sent" : item.direction === "self" ? "Self transfer" : "Received"}
                        </T>
                        <T variant="caption" color={theme.muted} numberOfLines={1}>
                          {shortAddr(counterparty)} · {timeAgo(item.timestamp)}
                        </T>
                      </View>

                      <T weight="semibold" color={item.failed ? theme.muted : isOut ? theme.text : theme.positive}>
                        {isOut ? "-" : "+"}
                        {amountText}
                      </T>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </View>

      <ReceiveModal visible={receiveOpen} onClose={() => setReceiveOpen(false)} address={owner ?? ""} assetLabel={symbol !== "—" ? symbol : undefined} />
    </Screen>
  );
}
