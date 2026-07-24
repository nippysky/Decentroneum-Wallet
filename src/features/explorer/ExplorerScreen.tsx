// src/features/explorer/ExplorerScreen.tsx
//
// A real, wallet-native block explorer — not a link-out. Shows live network
// status, the active account's on-chain activity, a universal address/tx
// search, and a tx detail sheet with a one-tap escape hatch to the official
// Electroneum explorer for anyone who wants the full picture.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import * as Clipboard from "expo-clipboard";

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SPACING } from "@/src/theme/tokens";
import { useAccounts } from "@/src/state/accounts";
import { ELECTRONEUM } from "@/src/lib/chain/networks";
import { getBlockNumber, getGasPriceWei } from "@/src/lib/chain/rpc";
import { ExplorerTx, explorerTxUrl, fetchAccountTxList, fetchTxByHash } from "@/src/lib/chain/explorer";

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function timeAgo(unixSeconds: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatEth(weiStr: string) {
  try {
    const n = Number(ethers.formatEther(weiStr));
    return n.toFixed(n < 1 ? 4 : 2).replace(/\.?0+$/, "") || "0";
  } catch {
    return "0";
  }
}

export function ExplorerScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const activeAccount = useAccounts((s) => s.activeAccount());
  const myAddress = activeAccount?.address ?? "";

  const [viewedAddress, setViewedAddress] = useState(myAddress);
  const [query, setQuery] = useState("");
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const [txs, setTxs] = useState<ExplorerTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [gasGwei, setGasGwei] = useState<string | null>(null);

  const [detail, setDetail] = useState<ExplorerTx | null>(null);

  useEffect(() => {
    setViewedAddress(myAddress);
  }, [myAddress]);

  const loadTxs = useCallback(async (addr: string) => {
    if (!addr) return;
    setLoading(true);
    try {
      const list = await fetchAccountTxList(addr, 30);
      setTxs(list);
    } catch {
      setTxs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNetwork = useCallback(async () => {
    try {
      const [bn, gp] = await Promise.all([getBlockNumber(), getGasPriceWei()]);
      setBlockNumber(bn);
      setGasGwei(Number(ethers.formatUnits(gp, "gwei")).toFixed(2));
    } catch {
      // keep last-known values
    }
  }, []);

  useEffect(() => {
    if (viewedAddress) loadTxs(viewedAddress);
    loadNetwork();
  }, [viewedAddress, loadTxs, loadNetwork]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadTxs(viewedAddress), loadNetwork()]);
    } finally {
      setRefreshing(false);
    }
  }, [viewedAddress, loadTxs, loadNetwork]);

  const isViewingSelf = useMemo(
    () => viewedAddress.toLowerCase() === myAddress.toLowerCase(),
    [viewedAddress, myAddress]
  );

  const onSearch = useCallback(async () => {
    const q = query.trim();
    setSearchErr(null);
    if (!q) return;

    if (ethers.isAddress(q)) {
      setViewedAddress(q);
      setQuery("");
      return;
    }

    if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
      setLoading(true);
      try {
        const tx = await fetchTxByHash(q);
        if (!tx) {
          setSearchErr("Transaction not found.");
        } else {
          setDetail(tx);
          setQuery("");
        }
      } catch {
        setSearchErr("Couldn't reach the explorer. Try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    setSearchErr("Enter a valid address or transaction hash.");
  }, [query]);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 28, gap: SPACING.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: SPACING.lg }}>
        <T variant="h2" weight="bold">
          Explorer
        </T>

        {/* Search */}
        <View
          style={{
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.card,
            paddingHorizontal: SPACING.md,
            paddingVertical: SPACING.sm + 2,
            flexDirection: "row",
            alignItems: "center",
            gap: SPACING.sm,
          }}
        >
          <Ionicons name="search-outline" size={18} color={theme.muted} />
          <TextInput
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              setSearchErr(null);
            }}
            placeholder="Search address or transaction hash"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: theme.text, fontSize: 15, paddingVertical: 6 }}
            onSubmitEditing={onSearch}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={onSearch} hitSlop={8}>
              <Ionicons name="arrow-forward-circle" size={22} color={theme.accent} />
            </Pressable>
          ) : null}
        </View>
        {searchErr ? (
          <T variant="caption" color={theme.danger}>
            {searchErr}
          </T>
        ) : null}

        {/* Network snapshot */}
        <View
          style={{
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.card,
            padding: SPACING.lg,
            flexDirection: "row",
            gap: SPACING.lg,
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <T variant="caption" color={theme.muted}>
              Electroneum Smart Chain
            </T>
            <T weight="bold" style={{ fontSize: 15 }}>
              {ELECTRONEUM.name}
            </T>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <T variant="caption" color={theme.muted}>
              Block height
            </T>
            <T weight="semibold" style={{ fontVariant: ["tabular-nums"] }}>
              {blockNumber != null ? blockNumber.toLocaleString() : "—"}
            </T>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <T variant="caption" color={theme.muted}>
              Gas
            </T>
            <T weight="semibold">{gasGwei != null ? `${gasGwei} gwei` : "—"}</T>
          </View>
        </View>

        {/* Viewing whom */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T weight="bold">{isViewingSelf ? "Your activity" : "Activity"}</T>
            {!isViewingSelf ? (
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                <T variant="caption" color={theme.muted}>
                  {shortAddr(viewedAddress)}
                </T>
              </View>
            ) : null}
          </View>
          {!isViewingSelf ? (
            <Pressable onPress={() => setViewedAddress(myAddress)} style={{ padding: 6 }}>
              <T variant="caption" weight="semibold" color={theme.accent}>
                Back to mine
              </T>
            </Pressable>
          ) : null}
        </View>

        {/* Tx list */}
        <View style={{ borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, overflow: "hidden" }}>
          {loading && txs.length === 0 ? (
            <View style={{ padding: SPACING.xl, alignItems: "center", gap: 10 }}>
              <ActivityIndicator />
              <T variant="caption" color={theme.muted}>
                Loading activity…
              </T>
            </View>
          ) : txs.length === 0 ? (
            <View style={{ padding: SPACING.xl, alignItems: "center", gap: 6 }}>
              <Ionicons name="receipt-outline" size={22} color={theme.muted} />
              <T color={theme.muted} style={{ textAlign: "center" }}>
                No transactions yet.
              </T>
            </View>
          ) : (
            txs.map((tx, idx) => {
              const incoming = tx.to?.toLowerCase() === viewedAddress.toLowerCase();
              const failed = tx.isError === "1";
              const counterparty = incoming ? tx.from : tx.to;
              const isContract = (!tx.to || tx.to === "") && tx.input && tx.input !== "0x";

              return (
                <Pressable
                  key={tx.hash + idx}
                  onPress={() => setDetail(tx)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.md,
                    paddingHorizontal: SPACING.lg,
                    paddingVertical: SPACING.md,
                    borderTopWidth: idx === 0 ? 0 : 1,
                    borderTopColor: theme.border,
                    opacity: pressed ? 0.9 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: RADIUS.md,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme.bg,
                      borderWidth: 1,
                      borderColor: failed ? theme.danger : theme.border,
                    }}
                  >
                    <Ionicons
                      name={failed ? "close" : incoming ? "arrow-down" : "arrow-up"}
                      size={16}
                      color={failed ? theme.danger : incoming ? theme.positive : theme.text}
                    />
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T weight="semibold">
                      {failed ? "Failed" : isContract ? "Contract interaction" : incoming ? "Received" : "Sent"}
                    </T>
                    <T variant="caption" color={theme.muted} numberOfLines={1}>
                      {counterparty ? shortAddr(counterparty) : "Contract creation"} · {timeAgo(Number(tx.timeStamp))}
                    </T>
                  </View>

                  <T weight="bold" style={{ color: failed ? theme.muted : incoming ? theme.positive : theme.text }}>
                    {incoming ? "+" : "−"}
                    {formatEth(tx.value)} {ELECTRONEUM.symbol}
                  </T>
                </Pressable>
              );
            })
          )}
        </View>
      </View>

      {/* Tx detail sheet */}
      <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <View style={{ flex: 1 }}>
          <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFillObject} />
          <Pressable onPress={() => setDetail(null)} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
            <Pressable onPress={() => {}} style={{ backgroundColor: theme.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border, padding: SPACING.lg, gap: SPACING.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
                  Transaction
                </T>
                <Pressable onPress={() => setDetail(null)} style={{ padding: 8 }}>
                  <Ionicons name="close" size={18} color={theme.text} />
                </Pressable>
              </View>

              {detail ? (
                <View style={{ gap: SPACING.sm }}>
                  <DetailRow label="Status" value={detail.isError === "1" ? "Failed" : "Success"} valueColor={detail.isError === "1" ? theme.danger : theme.positive} />
                  <DetailRow label="Hash" value={shortAddr(detail.hash)} onCopy={() => Clipboard.setStringAsync(detail.hash)} />
                  <DetailRow label="From" value={shortAddr(detail.from)} onCopy={() => Clipboard.setStringAsync(detail.from)} />
                  <DetailRow label="To" value={detail.to ? shortAddr(detail.to) : "Contract creation"} onCopy={detail.to ? () => Clipboard.setStringAsync(detail.to) : undefined} />
                  <DetailRow label="Value" value={`${formatEth(detail.value)} ${ELECTRONEUM.symbol}`} />
                  <DetailRow label="Block" value={detail.blockNumber} />
                  <DetailRow label="Time" value={new Date(Number(detail.timeStamp) * 1000).toLocaleString()} />
                </View>
              ) : null}

              <Button
                title="View on Electroneum Explorer"
                variant="outline"
                onPress={() => {
                  if (!detail) return;
                  const url = explorerTxUrl(detail.hash);
                  setDetail(null);
                  router.push({ pathname: "/browser/web" as any, params: { url } });
                }}
              />
              <Button title="Close" onPress={() => setDetail(null)} />
            </Pressable>
          </Pressable>
        </View>
      </Modal>
    </ScrollView>
  );
}

function DetailRow({
  label,
  value,
  valueColor,
  onCopy,
}: {
  label: string;
  value: string;
  valueColor?: string;
  onCopy?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.md }}>
      <T color={theme.muted}>{label}</T>
      <Pressable onPress={onCopy} disabled={!onCopy} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <T weight="semibold" style={{ color: valueColor ?? theme.text }} numberOfLines={1}>
          {value}
        </T>
        {onCopy ? <Ionicons name="copy-outline" size={14} color={theme.muted} /> : null}
      </Pressable>
    </View>
  );
}
