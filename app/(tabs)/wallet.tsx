// app/(tabs)/wallet.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { Redirect, useFocusEffect } from "expo-router";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { ethers } from "ethers";

import { Screen } from "@/src/ui/Screen";
import { Button } from "@/src/ui/Button";
import { T } from "@/src/ui/T";
import { IconButton } from "@/src/ui/IconButton";
import { Toast } from "@/src/ui/Toast";
import { TokenLogo } from "@/src/ui/TokenLogo";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useSession } from "@/src/state/session";

import { getNativeBalanceWei } from "@/src/lib/rpc";
import { ELECTRONEUM } from "@/src/lib/networks";
import { ALLOWLIST_TOKENS } from "@/src/lib/tokens";
import { getErc20BalanceRaw } from "@/src/lib/erc20";
import { formatUnits2dp } from "@/src/lib/format";

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

// Native token 2dp, human readable
function formatNative2dpFromWei(wei: bigint) {
  const s = ethers.formatEther(wei);
  const [intPartRaw, fracRaw = ""] = s.split(".");
  const intPart = intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracRaw + "00").slice(0, 2);
  return `${intPart}.${frac}`;
}

function ReceiveModal({
  visible,
  onClose,
  address,
  onCopy,
  toastMsg,
  toastVisible,
}: {
  visible: boolean;
  onClose: () => void;
  address: string;
  onCopy: () => void;
  toastMsg: string;
  toastVisible: boolean;
}) {
  const { theme } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFillObject} />

        <Pressable onPress={onClose} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 18,
              gap: 14,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
                Receive
              </T>

              <Pressable onPress={onClose} style={{ padding: 10 }}>
                <Ionicons name="close" size={20} color={theme.text} />
              </Pressable>
            </View>

            <T color={theme.muted}>
              Share this address to receive {ELECTRONEUM.symbol} or tokens on Electroneum EVM.
            </T>

            <View
              style={{
                alignSelf: "center",
                padding: 14,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
              }}
            >
              <QRCode value={address} size={190} />
            </View>

            <View
              style={{
                padding: 14,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <View style={{ flex: 1 }}>
                <T variant="caption" color={theme.muted}>
                  Your address
                </T>
                <T weight="semibold" numberOfLines={1}>
                  {address}
                </T>
              </View>

              <IconButton
                icon="copy-outline"
                accessibilityLabel="Copy address"
                onPress={async () => {
                  await Clipboard.setStringAsync(address);
                  onCopy();
                }}
              />
            </View>

            <Button title="Done" onPress={onClose} />
          </Pressable>
        </Pressable>

        {/* Toast INSIDE the modal so it appears above the sheet */}
        <Toast message={toastMsg} visible={toastVisible} bottomOffset={24} />
      </View>
    </Modal>
  );
}

export default function Wallet() {
  const { theme } = useTheme();

  // Hooks must always run
  const isUnlocked = useSession((s) => s.isUnlocked);
  const address = useSession((s) => s.address);

  // UI state
  const [receiveOpen, setReceiveOpen] = useState(false);

  // Native balance
  const [loading, setLoading] = useState(false);
  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);

  // Token balances
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenBalances, setTokenBalances] = useState<Record<string, bigint>>({});

  // Toast
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1300);
  }, []);

  const nativeBalanceText = useMemo(() => formatNative2dpFromWei(balanceWei), [balanceWei]);

  const refreshNative = useCallback(async () => {
    if (!address) return;

    setLoading(true);
    setErr(null);

    try {
      const wei = await getNativeBalanceWei(address);
      setBalanceWei(wei);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load balance");
    } finally {
      setLoading(false);
    }
  }, [address]);

  const refreshTokens = useCallback(async () => {
    if (!address) return;
    if (ALLOWLIST_TOKENS.length === 0) return;

    setTokenLoading(true);

    try {
      // Concurrency limit so we stay fast + reliable
      const limit = 4;
      const results: [string, bigint][] = [];

      let i = 0;
      async function worker() {
        while (i < ALLOWLIST_TOKENS.length) {
          const idx = i++;
          const t = ALLOWLIST_TOKENS[idx];
          const bal = await getErc20BalanceRaw(t.address, address!);
          results.push([t.address.toLowerCase(), bal]);
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(limit, ALLOWLIST_TOKENS.length) }, worker)
      );

      const map: Record<string, bigint> = {};
      for (const [k, v] of results) map[k] = v;
      setTokenBalances(map);
    } finally {
      setTokenLoading(false);
    }
  }, [address]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshNative(), refreshTokens()]);
  }, [refreshNative, refreshTokens]);

  useFocusEffect(
    useCallback(() => {
      if (!address) return;
      refreshAll();
    }, [address, refreshAll])
  );

  // Redirect AFTER hooks
  if (!isUnlocked) return <Redirect href="/unlock" />;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshAll} />}
      >
        <View style={{ gap: 14 }}>
          <T variant="h2" weight="bold">
            Wallet
          </T>

          {/* Balance hero */}
          <View
            style={{
              padding: 18,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.card,
              gap: 10,
            }}
          >
            <T variant="caption" color={theme.muted}>
              Balance
            </T>

            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
              <T weight="bold" style={{ fontSize: 34, lineHeight: 38 }}>
                {nativeBalanceText}
              </T>
              <T weight="semibold" color={theme.muted}>
                {ELECTRONEUM.symbol}
              </T>
            </View>

            {err ? <T color={(theme as any).danger ?? "#EF4444"}>{err}</T> : null}
          </View>

          {/* Account + actions */}
          <View
            style={{
              padding: 18,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.card,
              gap: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <T variant="caption" color={theme.muted}>
                  Account
                </T>
                <T weight="bold" style={{ marginTop: 4 }}>
                  {address ? shortAddr(address) : "—"}
                </T>
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <IconButton
                  icon="copy-outline"
                  accessibilityLabel="Copy address"
                  onPress={async () => {
                    if (!address) return;
                    await Clipboard.setStringAsync(address);
                    showToast("Address copied");
                  }}
                />
                <IconButton
                  icon="qr-code-outline"
                  accessibilityLabel="Show receive QR"
                  onPress={() => setReceiveOpen(true)}
                />
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <Button title="Receive" onPress={() => setReceiveOpen(true)} style={{ flex: 1 }} />
              <Button title="Send" variant="outline" disabled style={{ flex: 1 }} onPress={() => {}} />
            </View>
          </View>

          {/* Tokens */}
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T weight="bold">Tokens</T>
              <T variant="caption" color={theme.muted}>
                {ALLOWLIST_TOKENS.length > 0 ? "" : "Coming online"}
              </T>
            </View>

            <View
              style={{
                borderRadius: 22,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.card,
                overflow: "hidden",
              }}
            >
              {ALLOWLIST_TOKENS.length === 0 ? (
                <View style={{ padding: 16 }}>
                  <T color={theme.muted}>
                    Add vetted Electroneum ERC-20 tokens to{" "}
                    <T weight="semibold">ALLOWLIST_TOKENS</T> to show them here.
                  </T>
                </View>
              ) : (
                ALLOWLIST_TOKENS.map((t, idx) => {
                  const raw = tokenBalances[t.address.toLowerCase()] ?? 0n;
                  const balText = formatUnits2dp(raw, t.decimals);

                  return (
                    <View
                      key={t.address}
                      style={{
                        padding: 16,
                        borderTopWidth: idx === 0 ? 0 : 1,
                        borderTopColor: theme.border,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                        <TokenLogo symbol={t.symbol} uri={t.logoURI} />
                        <View style={{ flex: 1 }}>
                          <T weight="semibold">{t.symbol}</T>
                          <T variant="caption" color={theme.muted} numberOfLines={1}>
                            {t.name}
                          </T>
                        </View>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        <T weight="semibold">{tokenLoading ? "…" : balText}</T>
                        <T variant="caption" color={theme.muted}>
                          {t.symbol}
                        </T>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </View>
      </ScrollView>

      <ReceiveModal
        visible={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        address={address ?? ""}
        onCopy={() => showToast("Address copied")}
        toastMsg={toastMsg}
        toastVisible={toastVisible}
      />

      {/* Toast for normal screen actions (copy icon on account card) */}
      <Toast message={toastMsg} visible={toastVisible} />
    </Screen>
  );
}
