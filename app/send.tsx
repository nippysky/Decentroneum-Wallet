// app/send.tsx
//
// Send — a dedicated full-screen modal route (see app/_layout.tsx's Stack
// registration: presentation: "modal") instead of a bottom-sheet card. Reads
// the active account straight from state, exactly like every other screen,
// so no sensitive data (vault key, mnemonic) ever has to travel through
// router params. An optional `?asset=` param (native | a token address)
// preselects an asset — used by the per-token detail screen's Send button.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "@/src/components/Screen";
import { Button } from "@/src/components/Button";
import { T } from "@/src/components/T";
import { TokenLogo } from "@/src/components/TokenLogo";
import { HoldToConfirm } from "@/src/components/HoldToConfirm";
import { RADIUS, SPACING } from "@/src/theme/tokens";

import { useTheme } from "@/src/theme/ThemeProvider";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { useTokens } from "@/src/state/tokens";
import { getAccountSecret } from "@/src/lib/crypto/vault";

import { ELECTRONEUM } from "@/src/lib/chain/networks";
import type { ListedToken } from "@/src/lib/tokens/registry";
import { getErc20BalanceRaw } from "@/src/lib/chain/erc20";
import { getNativeBalanceWei } from "@/src/lib/chain/rpc";
import { estimateFees, sendErc20, sendNativeETN } from "@/src/lib/chain/wallet";
import { openExplorerTx } from "@/src/lib/chain/openExplorer";
import {
  formatAmountDisplay,
  formatFeeWeiAdaptive,
  formatFromWeiWithDp,
  formatNative2dpFromWei,
  formatUnits2dp,
  sanitizeAmountInput,
  trimZeros,
} from "@/src/lib/format";
import { notifyLocal } from "@/src/lib/notifications/local";

const ETN_LOGO_URI = "https://s2.coinmarketcap.com/static/img/coins/200x200/2137.png";
const WEI_0_01 = 10n ** 16n;

type Asset = { kind: "native" } | { kind: "token"; token: ListedToken };

function assetLabel(a: Asset) {
  return a.kind === "native" ? ELECTRONEUM.symbol : a.token.symbol;
}

export default function SendScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ asset?: string }>();

  const isUnlocked = useSession((s) => s.isUnlocked);
  const vaultKey = useSession((s) => s.vaultKey);
  const activeAccount = useAccounts((s) => s.activeAccount());
  const tokens = useTokens((s) => s.tokens);

  const address = activeAccount?.address ?? null;
  const accountId = activeAccount?.id ?? null;

  const initialAsset = useMemo<Asset>(() => {
    if (params.asset && params.asset !== "native") {
      const t = tokens.find((x) => x.address.toLowerCase() === params.asset!.toLowerCase());
      if (t) return { kind: "token", token: t };
    }
    return { kind: "native" };
  }, [params.asset, tokens]);

  const [asset, setAsset] = useState<Asset>(initialAsset);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);

  // Your other accounts, as send targets. The active one is excluded — a
  // transfer to yourself just burns gas, and offering it invites the mistake.
  const allAccounts = useAccounts((s) => s.accounts);
  const otherAccounts = useMemo(
    () => allAccounts.filter((a) => a.id !== accountId),
    [allAccounts, accountId]
  );
  const [assetQuery, setAssetQuery] = useState("");

  const assetList = useMemo<Asset[]>(() => [{ kind: "native" }, ...tokens.map((t) => ({ kind: "token", token: t } as Asset))], [tokens]);

  const filteredAssetList = useMemo(() => {
    const q = assetQuery.trim().toLowerCase();
    if (!q) return assetList;
    return assetList.filter((a) => {
      if (a.kind === "native") {
        return ELECTRONEUM.symbol.toLowerCase().includes(q) || "electroneum".includes(q) || "native".includes(q);
      }
      return a.token.symbol.toLowerCase().includes(q) || a.token.name.toLowerCase().includes(q);
    });
  }, [assetList, assetQuery]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setAssetQuery("");
  }, []);

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  const [nativeBalanceWei, setNativeBalanceWei] = useState<bigint>(0n);
  const [tokenBalanceRaw, setTokenBalanceRaw] = useState<bigint>(0n);
  const [balanceLoading, setBalanceLoading] = useState(true);

  const [feeWei, setFeeWei] = useState<bigint>(0n);
  const [feeMode, setFeeMode] = useState<"eip1559" | "legacy" | "unknown">("unknown");
  const [estimating, setEstimating] = useState(false);

  const [step, setStep] = useState<"form" | "review" | "success">("form");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentHash, setSentHash] = useState<string | null>(null);

  const amountInputRef = useRef<TextInput>(null);

  // Load this asset's balance independently — Send is its own route now, no
  // props handed down from Home.
  useEffect(() => {
    let alive = true;
    if (!address) return;

    setBalanceLoading(true);
    (async () => {
      try {
        if (asset.kind === "native") {
          const wei = await getNativeBalanceWei(address);
          if (alive) setNativeBalanceWei(wei);
        } else {
          const [nativeWei, raw] = await Promise.all([
            getNativeBalanceWei(address), // still needed — fees are always paid in ETN
            getErc20BalanceRaw(asset.token.address, address),
          ]);
          if (!alive) return;
          setNativeBalanceWei(nativeWei);
          setTokenBalanceRaw(raw);
        }
      } catch {
        // keep last-known values
      } finally {
        if (alive) setBalanceLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [address, asset]);

  const selectedAvailableText = useMemo(() => {
    if (asset.kind === "native") return `${formatNative2dpFromWei(nativeBalanceWei)} ${ELECTRONEUM.symbol}`;
    return `${formatUnits2dp(tokenBalanceRaw, asset.token.decimals)} ${asset.token.symbol}`;
  }, [asset, nativeBalanceWei, tokenBalanceRaw]);

  const validTo = useMemo(() => ethers.isAddress(to.trim()), [to]);
  const isSelf = useMemo(() => {
    if (!validTo || !address) return false;
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
    return tokenBalanceRaw > 0n;
  }, [asset, nativeBalanceWei, tokenBalanceRaw, validTo]);

  const feeLabel = useMemo(() => (feeMode === "eip1559" ? "Network fee • EIP-1559" : "Network fee"), [feeMode]);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!address) return;
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
          const tx: ethers.TransactionRequest = { to: to.trim(), value: valueWei, chainId: ELECTRONEUM.chainId };
          const fee = await estimateFees({ from: address, tx });
          if (!alive) return;
          setFeeWei(fee.feeWei);
          setFeeMode(fee.mode);
          return;
        }

        const amtRaw = parsedAmount ?? 0n;
        const iface = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
        const data = iface.encodeFunctionData("transfer", [to.trim(), amtRaw]);
        const tx: ethers.TransactionRequest = { to: asset.token.address, data, value: 0n, chainId: ELECTRONEUM.chainId };
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
  }, [address, validTo, asset, to, parsedAmount]);

  const amountTooHigh = useMemo(() => {
    if (!parsedAmount) return false;
    if (asset.kind === "native") return parsedAmount + feeWei > nativeBalanceWei;
    return parsedAmount > tokenBalanceRaw;
  }, [asset, parsedAmount, feeWei, nativeBalanceWei, tokenBalanceRaw]);

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
    const s = trimZeros(ethers.formatUnits(tokenBalanceRaw, asset.token.decimals));
    setAmount(s === "0" ? "" : s);
  }, [asset, canMax, feeWei, nativeBalanceWei, tokenBalanceRaw]);

  const onPasteTo = useCallback(async () => {
    try {
      const s = await Clipboard.getStringAsync();
      const trimmed = s.trim();
      if (trimmed) setTo(trimmed);
    } catch {}
  }, []);

  const canProceed = useMemo(() => {
    if (!validTo) return false;
    if (!parsedAmount || parsedAmount <= 0n) return false;
    if (amountTooHigh) return false;
    if (insufficientFeeForToken) return false;
    if (sending) return false;
    if (estimating) return false;
    return true;
  }, [validTo, parsedAmount, amountTooHigh, insufficientFeeForToken, sending, estimating]);

  const broadcastTx = useCallback(async () => {
    if (!vaultKey || !accountId || !address) return;

    setSending(true);
    setErr(null);

    try {
      const { mnemonic, path } = await getAccountSecret(vaultKey, accountId);

      if (asset.kind === "native") {
        const res = await sendNativeETN({ mnemonic, path, to: to.trim(), amountEth: amount });
        setSentHash(res.hash);
        setStep("success");
        notifyLocal({
          title: `${ELECTRONEUM.symbol} sent`,
          body: `${trimZeros(amount)} ${ELECTRONEUM.symbol} sent successfully`,
          data: { accountId, route: "/(tabs)/wallet", kind: "sent", symbol: ELECTRONEUM.symbol },
          logoURI: ETN_LOGO_URI,
        }).catch(() => {});
        return;
      }

      const res = await sendErc20({
        mnemonic,
        path,
        tokenAddress: asset.token.address,
        to: to.trim(),
        amount,
        decimals: asset.token.decimals,
      });
      setSentHash(res.hash);
      setStep("success");
      notifyLocal({
        title: `${asset.token.symbol} sent`,
        body: `${trimZeros(amount)} ${asset.token.symbol} sent successfully`,
        data: { accountId, route: "/(tabs)/wallet", kind: "sent", symbol: asset.token.symbol },
        logoURI: asset.token.logoURI,
      }).catch(() => {});
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send");
      setStep("form");
    } finally {
      setSending(false);
    }
  }, [asset, amount, vaultKey, accountId, address, to]);

  if (!isUnlocked || !address || !vaultKey || !accountId) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T weight="bold" style={{ fontSize: 24, lineHeight: 29 }}>
            {step === "review" ? "Review" : step === "success" ? "Sent" : "Send"}
          </T>
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
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={18} color={theme.text} />
          </Pressable>
        </View>

        <View style={{ height: SPACING.lg }} />

        {step === "form" ? (
          <Animated.View entering={FadeIn.duration(180)} style={{ flex: 1 }}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* asset */}
              <View style={{ gap: 8 }}>
                <T variant="caption" color={theme.muted}>
                  Asset
                </T>
                <Pressable hitSlop={6}
                  onPress={() => setPickerOpen(true)}
                  style={({ pressed }) => ({
                    padding: 14,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.surface2,
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

              <View style={{ height: SPACING.md }} />

              {/* available */}
              <View
                style={{
                  padding: 14,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surface2,
                  gap: 6,
                }}
              >
                <T variant="caption" color={theme.muted}>
                  Available
                </T>
                <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  {balanceLoading ? (
                    <ActivityIndicator />
                  ) : (
                    <T weight="bold" style={{ fontSize: 20 }}>
                      {selectedAvailableText}
                    </T>
                  )}
                </View>
              </View>

              <View style={{ height: SPACING.md }} />

              {/* to */}
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <T variant="caption" color={theme.muted}>
                    To
                  </T>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    {/* Send between your own accounts, MetaMask-style. Only
                        offered when there's somewhere to send to — with a
                        single account this would be a button that can only
                        ever produce a self-transfer. */}
                    {otherAccounts.length > 0 ? (
                      <Pressable hitSlop={6}
                        onPress={() => setAccountPickerOpen(true)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Ionicons name="people-outline" size={14} color={theme.accent} />
                        <T variant="caption" weight="semibold" color={theme.accent}>
                          My accounts
                        </T>
                      </Pressable>
                    ) : null}

                    <Pressable hitSlop={6} onPress={onPasteTo} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, padding: 6 })}>
                      <T variant="caption" weight="semibold" color={theme.muted}>
                        Paste
                      </T>
                    </Pressable>
                  </View>
                </View>

                <View
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.surface2,
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
                      backgroundColor: validTo ? theme.positive : "transparent",
                      borderWidth: 1,
                      borderColor: validTo ? theme.positive : theme.border,
                    }}
                  />
                  <TextInput
                    value={to}
                    onChangeText={setTo}
                    placeholder="0x…"
                    placeholderTextColor={theme.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ flex: 1, color: theme.text, fontSize: 16, padding: 0 }}
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

              <View style={{ height: SPACING.md }} />

              {/* amount */}
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <T variant="caption" color={theme.muted}>
                    Amount
                  </T>
                  <Pressable hitSlop={6}
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
                    backgroundColor: theme.surface2,
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
                    style={{ flex: 1, color: theme.text, fontSize: 18, padding: 0 }}
                  />
                  <T weight="semibold" color={theme.muted}>
                    {assetLabel(asset)}
                  </T>
                </View>

                {amountTooHigh ? (
                  <T variant="caption" color={theme.danger}>
                    Amount exceeds available balance.
                  </T>
                ) : null}
                {insufficientFeeForToken ? (
                  <T variant="caption" color={theme.danger}>
                    Not enough {ELECTRONEUM.symbol} to cover network fees for this token transfer.
                  </T>
                ) : null}
              </View>

              <View style={{ height: SPACING.md }} />

              {/* fee + total */}
              <View
                style={{
                  padding: 14,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surface2,
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
                <>
                  <View style={{ height: SPACING.sm }} />
                  <T variant="caption" color={theme.danger}>
                    {err}
                  </T>
                </>
              ) : null}

              <View style={{ height: SPACING.xxl }} />
            </ScrollView>

            <View style={{ paddingTop: SPACING.md, paddingBottom: Math.max(insets.bottom, SPACING.md), gap: SPACING.sm }}>
              <Button title="Review" disabled={!canProceed} onPress={() => setStep("review")} />
            </View>
          </Animated.View>
        ) : null}

        {step === "review" ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={{ flex: 1 }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View
                style={{
                  alignItems: "center",
                  paddingVertical: SPACING.xl,
                  gap: SPACING.sm,
                }}
              >
                {asset.kind === "native" ? (
                  <TokenLogo symbol={ELECTRONEUM.symbol} uri={ETN_LOGO_URI} size={56} />
                ) : (
                  <TokenLogo symbol={asset.token.symbol} uri={asset.token.logoURI} size={56} />
                )}
                <T weight="bold" style={{ fontSize: 28, lineHeight: 33 }}>
                  {formatAmountDisplay(amount || "0")} {assetLabel(asset)}
                </T>
              </View>

              <View style={{ borderRadius: RADIUS.xl, backgroundColor: theme.surface2, padding: SPACING.lg, gap: SPACING.md }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <T color={theme.muted}>To</T>
                  <T weight="semibold" numberOfLines={1} style={{ maxWidth: "70%" }}>
                    {to.trim()}
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

              {err ? (
                <>
                  <View style={{ height: SPACING.sm }} />
                  <T variant="caption" color={theme.danger}>
                    {err}
                  </T>
                </>
              ) : null}
            </ScrollView>

            <View style={{ paddingTop: SPACING.md, paddingBottom: Math.max(insets.bottom, SPACING.md), gap: SPACING.sm }}>
              {/* The one hold-gesture in this whole flow — right where it
                  matters: the moment this actually broadcasts on-chain. */}
              <HoldToConfirm
                title={sending ? "Sending…" : "Hold to send"}
                holdingTitle="Release to cancel"
                disabled={sending}
                onConfirmed={broadcastTx}
              />
              <Button title="Back" variant="outline" onPress={() => setStep("form")} disabled={sending} />
            </View>
          </Animated.View>
        ) : null}

        {step === "success" ? (
          <Animated.View entering={FadeIn.duration(220)} style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.md }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.primary,
              }}
            >
              <Ionicons name="checkmark" size={36} color={theme.bg} />
            </View>
            <T weight="bold" style={{ fontSize: 24 }}>
              {formatAmountDisplay(amount)} {assetLabel(asset)} sent
            </T>
            <T color={theme.muted} style={{ textAlign: "center" }}>
              We&apos;ll notify you once it&apos;s confirmed. You can track it any time from your activity.
            </T>

            {sentHash ? (
              <Pressable hitSlop={6}
                onPress={() => openExplorerTx(sentHash)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.7 : 1 })}
              >
                <T weight="semibold" color={theme.primary}>
                  View transaction
                </T>
                <Ionicons name="open-outline" size={15} color={theme.primary} />
              </Pressable>
            ) : null}

            <View style={{ height: SPACING.md }} />

            <Button title="Done" onPress={() => router.back()} />
          </Animated.View>
        ) : null}

        {/* Own-accounts picker. Rendered as an in-screen overlay rather than
            a native Modal — Send is already presented as a modal route, and
            stacking a second native modal on top is what froze touch
            handling elsewhere in this app. */}
        {accountPickerOpen ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg, paddingTop: insets.top }]}
          >
            <View style={{ paddingHorizontal: SPACING.lg }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T variant="h1">Send to my account</T>
                <Pressable hitSlop={6}
                  onPress={() => setAccountPickerOpen(false)}
                  style={({ pressed }) => ({
                    width: 38,
                    height: 38,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.surface2,
                    opacity: pressed ? 0.85 : 1,
                  })}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={18} color={theme.text} />
                </Pressable>
              </View>

              <View style={{ height: SPACING.sm }} />
              <T variant="caption" color={theme.muted}>
                Transfers between your own accounts still pay a network fee.
              </T>
              <View style={{ height: SPACING.md }} />
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: Math.max(insets.bottom, SPACING.lg) }}
            >
              <View style={{ gap: SPACING.sm }}>
                {otherAccounts.map((a) => (
                  <Pressable hitSlop={6}
                    key={a.id}
                    onPress={() => {
                      setTo(a.address);
                      setAccountPickerOpen(false);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: SPACING.md,
                      padding: SPACING.md,
                      borderRadius: RADIUS.xl,
                      backgroundColor: theme.surface2,
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: RADIUS.md,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: theme.bg,
                      }}
                    >
                      <Ionicons name="wallet-outline" size={18} color={theme.text} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T weight="semibold" numberOfLines={1}>
                        {a.label}
                      </T>
                      <T variant="caption" color={theme.muted} numberOfLines={1}>
                        {a.address}
                      </T>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.muted} />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </Animated.View>
        ) : null}

        {/* Asset picker — full-screen takeover with search, built to stay
            usable as the token list grows (virtualized FlatList, not a
            cramped bottom sheet). */}
        {pickerOpen ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg, paddingTop: insets.top }]}
          >
            <View style={{ paddingHorizontal: SPACING.lg }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
                  Choose asset
                </T>
                <Pressable hitSlop={6}
                  onPress={closePicker}
                  style={({ pressed }) => ({
                    width: 38,
                    height: 38,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.surface2,
                    opacity: pressed ? 0.85 : 1,
                  })}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={18} color={theme.text} />
                </Pressable>
              </View>

              <View style={{ height: SPACING.md }} />

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surface2,
                }}
              >
                <Ionicons name="search" size={17} color={theme.muted} />
                <TextInput
                  value={assetQuery}
                  onChangeText={setAssetQuery}
                  placeholder="Search assets"
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ flex: 1, color: theme.text, fontSize: 16, padding: 0 }}
                  returnKeyType="search"
                />
                {assetQuery ? (
                  <Pressable onPress={() => setAssetQuery("")} hitSlop={8}>
                    <Ionicons name="close-circle" size={17} color={theme.muted} />
                  </Pressable>
                ) : null}
              </View>

              <View style={{ height: SPACING.sm }} />
            </View>

            <FlatList
              data={filteredAssetList}
              keyExtractor={(a) => (a.kind === "native" ? "native" : a.token.address.toLowerCase())}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={16}
              windowSize={7}
              maxToRenderPerBatch={24}
              removeClippedSubviews
              contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: Math.max(insets.bottom, SPACING.lg) }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border }} />}
              ListEmptyComponent={
                <View style={{ paddingVertical: SPACING.xxl, alignItems: "center", gap: 6 }}>
                  <Ionicons name="search-outline" size={22} color={theme.muted} />
                  <T color={theme.muted}>No assets match &quot;{assetQuery}&quot;</T>
                </View>
              }
              renderItem={({ item }) => {
                const selected = item.kind === "native" ? asset.kind === "native" : asset.kind === "token" && asset.token.address.toLowerCase() === item.token.address.toLowerCase();
                return (
                  <Pressable hitSlop={6}
                    onPress={() => {
                      setAsset(item);
                      closePicker();
                    }}
                    style={({ pressed }) => ({
                      paddingVertical: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      opacity: pressed ? 0.92 : 1,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      {item.kind === "native" ? (
                        <TokenLogo symbol={ELECTRONEUM.symbol} uri={ETN_LOGO_URI} size={38} />
                      ) : (
                        <TokenLogo symbol={item.token.symbol} uri={item.token.logoURI} size={38} />
                      )}
                      <View>
                        <T weight="bold">{item.kind === "native" ? ELECTRONEUM.symbol : item.token.symbol}</T>
                        <T variant="caption" color={theme.muted}>
                          {item.kind === "native" ? "Native" : item.token.name}
                        </T>
                      </View>
                    </View>
                    {selected ? <Ionicons name="checkmark" size={18} color={theme.text} /> : null}
                  </Pressable>
                );
              }}
            />
          </Animated.View>
        ) : null}
      </View>
    </Screen>
  );
}
