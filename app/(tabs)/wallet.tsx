// app/(tabs)/wallet.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  Animated,
  Easing,
} from "react-native";

import { Redirect, useFocusEffect } from "expo-router";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { ethers } from "ethers";
import { LinearGradient } from "expo-linear-gradient";

import { Screen } from "@/src/ui/Screen";
import { Button } from "@/src/ui/Button";
import { T } from "@/src/ui/T";
import { IconButton } from "@/src/ui/IconButton";
import { Toast } from "@/src/ui/Toast";
import { TokenLogo } from "@/src/ui/TokenLogo";
import { HoldToConfirm } from "@/src/ui/HoldToConfirm";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useSession } from "@/src/state/session";

import { ELECTRONEUM } from "@/src/lib/networks";
import { ALLOWLIST_TOKENS, ListedToken } from "@/src/lib/tokens";
import { getErc20BalanceRaw } from "@/src/lib/erc20";
import { formatUnits2dp } from "@/src/lib/format";
import { getNativeBalanceWei } from "@/src/lib/rpc";
import { estimateFees, sendErc20, sendNativeETN } from "@/src/lib/wallet";

/* ---------------------------------- helpers ---------------------------------- */

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function formatNative2dpFromWei(wei: bigint) {
  const s = ethers.formatEther(wei);
  const [intPartRaw, fracRaw = ""] = s.split(".");
  const intPart = intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracRaw + "00").slice(0, 2);
  return `${intPart}.${frac}`;
}

function sanitizeAmountInput(s: string) {
  const cleaned = s.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function trimZeros(s: string) {
  if (!s.includes(".")) return s;
  return s.replace(/(\.\d*?[1-9])0+$/g, "$1").replace(/\.0+$/, "");
}

function formatFromWeiWithDp(wei: bigint, dp: number) {
  const s = ethers.formatEther(wei);
  const [intRaw, fracRaw = ""] = s.split(".");
  const intPart = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracRaw + "0".repeat(dp)).slice(0, dp);
  return dp > 0 ? `${intPart}.${frac}` : intPart;
}

const WEI_0_01 = 10n ** 16n; // 0.01 ETN
const WEI_0_0001 = 10n ** 14n; // 0.0001 ETN

function formatFeeWeiAdaptive(wei: bigint) {
  if (wei === 0n) return "0";
  if (wei < WEI_0_0001) return formatFromWeiWithDp(wei, 8);
  if (wei < WEI_0_01) return formatFromWeiWithDp(wei, 6);
  return formatFromWeiWithDp(wei, 2);
}

const ETN_LOGO_URI = "https://s2.coinmarketcap.com/static/img/coins/200x200/2137.png";

/* ----------------------------- Skeleton shimmer ----------------------------- */

function Skeleton({
  width,
  height,
  radius = 12,
  style,
}: {
  width: number | string;
  height: number;
  radius?: number;
  style?: any;
}) {
  const { theme } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 120],
  });

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          overflow: "hidden",
          backgroundColor: theme.bg,
          borderWidth: 1,
          borderColor: theme.border,
        },
        style,
      ]}
    >
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: -160,
          width: 240,
          transform: [{ translateX }],
        }}
      >
        <LinearGradient
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          colors={[theme.bg, theme.card, theme.bg]}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

/* ---------------------------------- types ---------------------------------- */

type Asset = { kind: "native" } | { kind: "token"; token: ListedToken };

function assetLabel(a: Asset) {
  return a.kind === "native" ? ELECTRONEUM.symbol : a.token.symbol;
}

/* ---------------------------------- Receive ---------------------------------- */

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

            <T color={theme.muted}>Share this address to receive {ELECTRONEUM.symbol} or tokens on Electroneum EVM.</T>

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

        <Toast message={toastMsg} visible={toastVisible} bottomOffset={24} />
      </View>
    </Modal>
  );
}

/* ----------------------------------- Send ----------------------------------- */

function SendSheet({
  visible,
  onClose,
  address,
  mnemonic,
  nativeBalanceWei,
  tokenBalances,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  address: string;
  mnemonic: string;
  nativeBalanceWei: bigint;
  tokenBalances: Record<string, bigint>;
  onSent: (hash: string) => void;
}) {
  const { theme } = useTheme();

  const [asset, setAsset] = useState<Asset>({ kind: "native" });
  const [pickerOpen, setPickerOpen] = useState(false);

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  const [feeWei, setFeeWei] = useState<bigint>(0n);
  const [feeMode, setFeeMode] = useState<"eip1559" | "legacy" | "unknown">("unknown");
  const [estimating, setEstimating] = useState(false);

  const [reviewOpen, setReviewOpen] = useState(false);

  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amountInputRef = useRef<TextInput>(null);

  const selectedAvailableText = useMemo(() => {
    if (asset.kind === "native") return `${formatNative2dpFromWei(nativeBalanceWei)} ${ELECTRONEUM.symbol}`;
    const raw = tokenBalances[asset.token.address.toLowerCase()] ?? 0n;
    return `${formatUnits2dp(raw, asset.token.decimals)} ${asset.token.symbol}`;
  }, [asset, nativeBalanceWei, tokenBalances]);

  const validTo = useMemo(() => ethers.isAddress(to.trim()), [to]);
  const isSelf = useMemo(() => {
    if (!validTo) return false;
    return to.trim().toLowerCase() === address.toLowerCase();
  }, [validTo, to, address]);

  const parsedAmount = useMemo(() => {
    try {
      if (!amount || Number(amount) <= 0) return null;
      if (asset.kind === "native") return ethers.parseEther(amount);
      return ethers.parseUnits(amount, asset.token.decimals);
    } catch {
      return null;
    }
  }, [amount, asset]);

  const canMax = useMemo(() => {
    if (!validTo) return false;
    if (asset.kind === "native") return nativeBalanceWei > 0n;
    const raw = asset.kind === "token" ? tokenBalances[asset.token.address.toLowerCase()] ?? 0n : 0n;
    return raw > 0n;
  }, [asset, nativeBalanceWei, tokenBalances, validTo]);

  const feeLabel = useMemo(() => {
    if (feeMode === "eip1559") return "Network fee • EIP-1559";
    return "Network fee";
  }, [feeMode]);

  useEffect(() => {
    if (!visible) return;
    setErr(null);
    setPickerOpen(false);
    setReviewOpen(false);
    setAsset({ kind: "native" });
    setTo("");
    setAmount("");
    setFeeWei(0n);
    setFeeMode("unknown");
    setEstimating(false);
    setSending(false);
  }, [visible]);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!visible) return;
      setErr(null);

      if (!validTo) {
        setFeeWei(0n);
        setFeeMode("unknown");
        return;
      }

      try {
        setEstimating(true);

        if (asset.kind === "native") {
          const valueWei = parsedAmount ?? 0n;

          const tx: ethers.TransactionRequest = {
            to: to.trim(),
            value: valueWei,
            chainId: ELECTRONEUM.chainId,
          };

          const fee = await estimateFees({ from: address, tx });

          if (!alive) return;
          setFeeWei(fee.feeWei);
          setFeeMode(fee.mode);
          return;
        }

        const amtRaw = parsedAmount ?? 0n;
        const iface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
        const data = iface.encodeFunctionData("transfer", [to.trim(), amtRaw]);

        const tx: ethers.TransactionRequest = {
          to: asset.token.address,
          data,
          value: 0n,
          chainId: ELECTRONEUM.chainId,
        };

        const fee = await estimateFees({ from: address, tx });

        if (!alive) return;
        setFeeWei(fee.feeWei);
        setFeeMode(fee.mode);
      } catch (e: any) {
        if (!alive) return;
        setFeeWei(0n);
        setFeeMode("unknown");
        setErr(e?.message ?? "Failed to estimate fee");
      } finally {
        if (alive) setEstimating(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [visible, validTo, asset, to, parsedAmount, address]);

  const amountTooHigh = useMemo(() => {
    if (!parsedAmount) return false;

    if (asset.kind === "native") {
      return parsedAmount + feeWei > nativeBalanceWei;
    }

    const raw = tokenBalances[asset.token.address.toLowerCase()] ?? 0n;
    return parsedAmount > raw;
  }, [asset, parsedAmount, feeWei, nativeBalanceWei, tokenBalances]);

  const insufficientFeeForToken = useMemo(() => {
    if (asset.kind !== "token") return false;
    if (!validTo) return false;
    return feeWei > nativeBalanceWei;
  }, [asset, feeWei, nativeBalanceWei, validTo]);

  const totalText = useMemo(() => {
    if (asset.kind !== "native") return null;

    const valueWei = parsedAmount ?? 0n;
    const totalWei = valueWei + feeWei;

    const dp = feeWei !== 0n && feeWei < WEI_0_01 ? 6 : 2;
    return `${formatFromWeiWithDp(totalWei, dp)} ${ELECTRONEUM.symbol}`;
  }, [asset, parsedAmount, feeWei]);

  const feeText = useMemo(() => `${formatFeeWeiAdaptive(feeWei)} ${ELECTRONEUM.symbol}`, [feeWei]);

  const onPressMax = useCallback(() => {
    if (!canMax) return;

    if (asset.kind === "native") {
      const maxWei = nativeBalanceWei > feeWei ? nativeBalanceWei - feeWei : 0n;
      const s = trimZeros(ethers.formatEther(maxWei));
      setAmount(s === "0" ? "" : s);
      return;
    }

    const raw = tokenBalances[asset.token.address.toLowerCase()] ?? 0n;
    const s = trimZeros(ethers.formatUnits(raw, asset.token.decimals));
    setAmount(s === "0" ? "" : s);
  }, [asset, canMax, feeWei, nativeBalanceWei, tokenBalances]);

  const onPasteTo = useCallback(async () => {
    try {
      const s = await Clipboard.getStringAsync();
      const trimmed = s.trim();
      if (trimmed) setTo(trimmed);
    } catch {}
  }, []);

  const canProceed = useMemo(() => {
    if (!visible) return false;
    if (!validTo) return false;
    if (!parsedAmount || parsedAmount <= 0n) return false;
    if (amountTooHigh) return false;
    if (insufficientFeeForToken) return false;
    if (sending) return false;
    if (estimating) return false;
    return true;
  }, [visible, validTo, parsedAmount, amountTooHigh, insufficientFeeForToken, sending, estimating]);

  const broadcastTx = useCallback(async () => {
    setSending(true);
    setErr(null);

    try {
      if (asset.kind === "native") {
        const res = await sendNativeETN({ mnemonic, to: to.trim(), amountEth: amount });
        onSent(res.hash);
        setReviewOpen(false);
        onClose();
        return;
      }

      const res = await sendErc20({
        mnemonic,
        tokenAddress: asset.token.address,
        to: to.trim(),
        amount,
        decimals: asset.token.decimals,
      });

      onSent(res.hash);
      setReviewOpen(false);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send");
      setReviewOpen(false);
    } finally {
      setSending(false);
    }
  }, [asset, amount, mnemonic, onClose, onSent, to]);

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
              overflow: "hidden",
            }}
          >
            {/* header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T variant="h2" weight="bold" style={{ fontSize: 22, lineHeight: 26 }}>
                Send
              </T>

              <Pressable
                onPress={onClose}
                style={({ pressed }) => ({
                  width: 38,
                  height: 38,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.bg,
                  borderWidth: 1,
                  borderColor: theme.border,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Ionicons name="close" size={18} color={theme.text} />
              </Pressable>
            </View>

            {/* asset */}
            <View style={{ gap: 8 }}>
              <T variant="caption" color={theme.muted}>
                Asset
              </T>
              <Pressable
                onPress={() => setPickerOpen(true)}
                style={({ pressed }) => ({
                  padding: 14,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.bg,
                  opacity: pressed ? 0.92 : 1,
                })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                    {asset.kind === "native" ? (
                      <TokenLogo symbol={ELECTRONEUM.symbol} uri={ETN_LOGO_URI} size={38} />
                    ) : (
                      <TokenLogo symbol={asset.token.symbol} uri={asset.token.logoURI} size={38} />
                    )}

                    <View style={{ flex: 1 }}>
                      <T weight="bold" style={{ fontSize: 16 }}>
                        {asset.kind === "native" ? ELECTRONEUM.symbol : asset.token.symbol}
                      </T>
                      <T variant="caption" color={theme.muted}>
                        {asset.kind === "native" ? "Native" : asset.token.name}
                      </T>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <T weight="semibold" color={theme.muted}>
                      Change
                    </T>
                    <Ionicons name="chevron-forward" size={16} color={theme.muted} />
                  </View>
                </View>
              </Pressable>
            </View>

            {/* available */}
            <View
              style={{
                padding: 14,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
                gap: 6,
              }}
            >
              <T variant="caption" color={theme.muted}>
                Available
              </T>

              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <T weight="bold" style={{ fontSize: 20 }}>
                  {selectedAvailableText}
                </T>
                {estimating ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator />
                  </View>
                ) : null}
              </View>
            </View>

            {/* to */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T variant="caption" color={theme.muted}>
                  To
                </T>

                <Pressable onPress={onPasteTo} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, padding: 6 })}>
                  <T weight="semibold" color={theme.muted}>
                    Paste
                  </T>
                </Pressable>
              </View>

              <View
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.bg,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 10,
                    backgroundColor: validTo ? "#22C55E" : "transparent",
                    borderWidth: 1,
                    borderColor: validTo ? "#22C55E" : theme.border,
                  }}
                />
                <TextInput
                  value={to}
                  onChangeText={setTo}
                  placeholder="0x…"
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    flex: 1,
                    color: theme.text,
                    fontSize: 16,
                    padding: 0,
                  }}
                  returnKeyType="next"
                  onSubmitEditing={() => amountInputRef.current?.focus()}
                />
              </View>

              {isSelf ? (
                <T variant="caption" color={theme.muted}>
                  This is your own address. Funds will return (minus network fees).
                </T>
              ) : null}
            </View>

            {/* amount */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T variant="caption" color={theme.muted}>
                  Amount
                </T>

                <Pressable
                  onPress={onPressMax}
                  disabled={!canMax}
                  style={({ pressed }) => ({ opacity: !canMax ? 0.45 : pressed ? 0.9 : 1, padding: 6 })}
                >
                  <T weight="semibold" color={theme.muted}>
                    Max
                  </T>
                </Pressable>
              </View>

              <View
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.bg,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <TextInput
                  ref={amountInputRef}
                  value={amount}
                  onChangeText={(s) => setAmount(sanitizeAmountInput(s))}
                  placeholder="0.00"
                  placeholderTextColor={theme.muted}
                  keyboardType="decimal-pad"
                  style={{
                    flex: 1,
                    color: theme.text,
                    fontSize: 18,
                    padding: 0,
                  }}
                />
                <T weight="semibold" color={theme.muted}>
                  {assetLabel(asset)}
                </T>
              </View>

              {amountTooHigh ? (
                <T variant="caption" color={(theme as any).danger ?? "#EF4444"}>
                  Amount exceeds available balance.
                </T>
              ) : null}

              {insufficientFeeForToken ? (
                <T variant="caption" color={(theme as any).danger ?? "#EF4444"}>
                  Not enough {ELECTRONEUM.symbol} to cover network fees for this token transfer.
                </T>
              ) : null}
            </View>

            {/* fee + total */}
            <View
              style={{
                padding: 14,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
                gap: 10,
              }}
            >
              <T variant="caption" color={theme.muted}>
                {feeLabel}
              </T>

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <T color={theme.muted}>Fee</T>
                <T weight="bold">{estimating ? "…" : feeText}</T>
              </View>

              {asset.kind === "native" ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <T color={theme.muted}>Total</T>
                  <T weight="bold">{estimating ? "…" : totalText ?? "—"}</T>
                </View>
              ) : (
                <T variant="caption" color={theme.muted}>
                  Fees are paid in {ELECTRONEUM.symbol}.
                </T>
              )}
            </View>

            {err ? (
              <T variant="caption" color={(theme as any).danger ?? "#EF4444"}>
                {err}
              </T>
            ) : null}

            {/* actions */}
            <HoldToConfirm
              title={sending ? "Sending…" : "Hold to review"}
              holdingTitle="Release to cancel"
              disabled={!canProceed}
              onConfirmed={() => setReviewOpen(true)}
              style={{ backgroundColor: theme.primary }}
            />
            <Button title="Cancel" variant="outline" onPress={onClose} />

            {/* Review step */}
            {reviewOpen ? (
              <View style={StyleSheet.absoluteFillObject}>
                <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFillObject} />
                <Pressable onPress={() => setReviewOpen(false)} style={{ flex: 1, justifyContent: "flex-end", padding: 18 }}>
                  <Pressable
                    onPress={() => {}}
                    style={{
                      backgroundColor: theme.card,
                      borderRadius: 24,
                      borderWidth: 1,
                      borderColor: theme.border,
                      padding: 16,
                      gap: 12,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <T weight="bold" style={{ fontSize: 18 }}>
                        Review
                      </T>
                      <Pressable onPress={() => setReviewOpen(false)} style={{ padding: 8 }}>
                        <Ionicons name="close" size={18} color={theme.text} />
                      </Pressable>
                    </View>

                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                        <T color={theme.muted}>To</T>
                        <T weight="semibold" numberOfLines={1} style={{ maxWidth: "70%" }}>
                          {to.trim()}
                        </T>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                        <T color={theme.muted}>Amount</T>
                        <T weight="bold">
                          {amount || "—"} {assetLabel(asset)}
                        </T>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                        <T color={theme.muted}>Fee</T>
                        <T weight="bold">{feeText}</T>
                      </View>
                      {asset.kind === "native" ? (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                          <T color={theme.muted}>Total</T>
                          <T weight="bold">{totalText ?? "—"}</T>
                        </View>
                      ) : null}
                    </View>

                    <Button title={sending ? "Sending…" : "Confirm send"} onPress={broadcastTx} disabled={sending} />
                    <Button title="Back" variant="outline" onPress={() => setReviewOpen(false)} disabled={sending} />
                  </Pressable>
                </Pressable>
              </View>
            ) : null}

            {/* Picker overlay */}
            {pickerOpen ? (
              <View style={StyleSheet.absoluteFillObject}>
                <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFillObject} />
                <Pressable onPress={() => setPickerOpen(false)} style={{ flex: 1, justifyContent: "flex-end", padding: 18 }}>
                  <Pressable
                    onPress={() => {}}
                    style={{
                      backgroundColor: theme.card,
                      borderRadius: 24,
                      borderWidth: 1,
                      borderColor: theme.border,
                      overflow: "hidden",
                    }}
                  >
                    <View style={{ padding: 16, gap: 6 }}>
                      <T weight="bold" style={{ fontSize: 18 }}>
                        Choose asset
                      </T>
                      <T variant="caption" color={theme.muted}>
                        Send native ETN or a vetted token.
                      </T>
                    </View>

                    <View style={{ height: 1, backgroundColor: theme.border }} />

                    <Pressable
                      onPress={() => {
                        setAsset({ kind: "native" });
                        setPickerOpen(false);
                      }}
                      style={({ pressed }) => ({
                        padding: 16,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        opacity: pressed ? 0.92 : 1,
                      })}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <TokenLogo symbol={ELECTRONEUM.symbol} uri={ETN_LOGO_URI} size={38} />
                        <View>
                          <T weight="bold">{ELECTRONEUM.symbol}</T>
                          <T variant="caption" color={theme.muted}>
                            Native
                          </T>
                        </View>
                      </View>

                      {asset.kind === "native" ? <Ionicons name="checkmark" size={18} color={theme.text} /> : null}
                    </Pressable>

                    {ALLOWLIST_TOKENS.map((t) => {
                      const selected = asset.kind === "token" && asset.token.address.toLowerCase() === t.address.toLowerCase();
                      return (
                        <Pressable
                          key={t.address}
                          onPress={() => {
                            setAsset({ kind: "token", token: t });
                            setPickerOpen(false);
                          }}
                          style={({ pressed }) => ({
                            padding: 16,
                            borderTopWidth: 1,
                            borderTopColor: theme.border,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            opacity: pressed ? 0.92 : 1,
                          })}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <TokenLogo symbol={t.symbol} uri={t.logoURI} size={38} />
                            <View>
                              <T weight="bold">{t.symbol}</T>
                              <T variant="caption" color={theme.muted}>
                                {t.name}
                              </T>
                            </View>
                          </View>

                          {selected ? <Ionicons name="checkmark" size={18} color={theme.text} /> : null}
                        </Pressable>
                      );
                    })}

                    <View style={{ padding: 16 }}>
                      <Button title="Close" variant="outline" onPress={() => setPickerOpen(false)} />
                    </View>
                  </Pressable>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

/* ---------------------------------- Wallet ---------------------------------- */

export default function Wallet() {
  const { theme } = useTheme();

  const isUnlocked = useSession((s) => s.isUnlocked);
  const address = useSession((s) => s.address);
  const mnemonic = useSession((s) => s.mnemonic);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  // Data loading (for skeletons / content only)
  const [loading, setLoading] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);

  // ✅ Pull-to-refresh UI state (ONLY for RefreshControl)
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);

  const [tokenBalances, setTokenBalances] = useState<Record<string, bigint>>({});

  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  const postTxTimersRef = useRef<number[]>([]);
  const toastTimerRef = useRef<number | null>(null);

  // Prevent overlapping refreshes (helps tab switching + focus refresh)
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    return () => {
      for (const id of postTxTimersRef.current) clearTimeout(id);
      postTxTimersRef.current = [];
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      refreshInFlightRef.current = null;
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1300) as unknown as number;
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

      await Promise.all(Array.from({ length: Math.min(limit, ALLOWLIST_TOKENS.length) }, worker));

      const map: Record<string, bigint> = {};
      for (const [k, v] of results) map[k] = v;
      setTokenBalances(map);
    } finally {
      setTokenLoading(false);
    }
  }, [address]);

  const refreshAll = useCallback(async () => {
    if (!address) return;

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const p = (async () => {
      await Promise.all([refreshNative(), refreshTokens()]);
    })();

    refreshInFlightRef.current = p;

    try {
      await p;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, [address, refreshNative, refreshTokens]);

  const schedulePostTxRefresh = useCallback(() => {
    refreshAll().catch(() => {});

    const t1 = setTimeout(() => refreshAll().catch(() => {}), 6000) as unknown as number;
    const t2 = setTimeout(() => refreshAll().catch(() => {}), 15000) as unknown as number;

    postTxTimersRef.current.push(t1, t2);
  }, [refreshAll]);

  // ✅ Pull-to-refresh handler (only this sets pullRefreshing)
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setPullRefreshing(false);
    }
  }, [refreshAll]);

  // ✅ Focus refresh WITHOUT triggering RefreshControl UI
  useFocusEffect(
    useCallback(() => {
      if (!address) return;

      refreshAll().catch(() => {});

      // If user left mid-pull-refresh, ensure UI resets when they come back
      return () => {
        setPullRefreshing(false);
      };
    }, [address, refreshAll])
  );

  if (!isUnlocked) return <Redirect href="/unlock" />;

  const canOpenSend = !!(address && mnemonic);

  const showBalanceSkeleton = loading && balanceWei === 0n;
  const showTokenSkeleton = tokenLoading && Object.keys(tokenBalances).length === 0;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        // ✅ RefreshControl driven ONLY by pullRefreshing
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <T variant="h2" weight="bold">
              Wallet
            </T>

            {/* Manual refresh button (does not “pull down” the ScrollView) */}
            <Pressable
              onPress={() => refreshAll().catch(() => {})}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.card,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.9 : 1,
              })}
              accessibilityLabel="Refresh balances"
            >
              <Ionicons name="refresh" size={18} color={theme.text} />
            </Pressable>
          </View>

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
              {showBalanceSkeleton ? (
                <Skeleton width={170} height={38} radius={14} />
              ) : (
                <T weight="bold" style={{ fontSize: 34, lineHeight: 38 }}>
                  {nativeBalanceText}
                </T>
              )}

              {showBalanceSkeleton ? (
                <Skeleton width={38} height={16} radius={10} style={{ marginBottom: 6 }} />
              ) : (
                <T weight="semibold" color={theme.muted}>
                  {ELECTRONEUM.symbol}
                </T>
              )}
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
              <Button
                title="Send"
                onPress={() => {
                  if (!canOpenSend) return;
                  setSendOpen(true);
                }}
                style={{ flex: 1 }}
                disabled={!canOpenSend}
              />
              <Button title="Receive" variant="outline" style={{ flex: 1 }} onPress={() => setReceiveOpen(true)} />
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
                    Add vetted Electroneum ERC-20 tokens to <T weight="semibold">ALLOWLIST_TOKENS</T> to show them here.
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
                        {showTokenSkeleton ? (
                          <Skeleton width={84} height={16} radius={10} />
                        ) : (
                          <T weight="semibold">{tokenLoading ? "…" : balText}</T>
                        )}
                        {showTokenSkeleton ? (
                          <Skeleton width={34} height={12} radius={8} style={{ marginTop: 6 }} />
                        ) : (
                          <T variant="caption" color={theme.muted}>
                            {t.symbol}
                          </T>
                        )}
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

      {address && mnemonic ? (
        <SendSheet
          visible={sendOpen}
          onClose={() => setSendOpen(false)}
          address={address}
          mnemonic={mnemonic}
          nativeBalanceWei={balanceWei}
          tokenBalances={tokenBalances}
          onSent={() => {
            showToast("Sent");
            schedulePostTxRefresh();
          }}
        />
      ) : null}

      <Toast message={toastMsg} visible={toastVisible} />
    </Screen>
  );
}
