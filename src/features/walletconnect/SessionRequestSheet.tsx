// src/features/walletconnect/SessionRequestSheet.tsx
//
// Handles the three request types that matter for a real wallet:
// eth_sendTransaction, personal_sign, and eth_signTypedData(_v4) — coming in
// over an active WalletConnect session from any external dapp.
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { DragHandle } from "@/src/components/DragHandle";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SPACING } from "@/src/theme/tokens";
import { useAccounts } from "@/src/state/accounts";
import { useSession } from "@/src/state/session";
import { useWalletConnect } from "@/src/state/walletconnect";
import { getDecryptedMnemonic } from "@/src/lib/crypto/vault";
import { ELECTRONEUM } from "@/src/lib/chain/networks";
import { estimateFees, getSigner, normalizeDappTx } from "@/src/lib/chain/wallet";

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function tryDecodeHexToUtf8(hex: unknown): string | null {
  try {
    if (typeof hex !== "string" || !hex.startsWith("0x")) return null;
    return ethers.toUtf8String(ethers.getBytes(hex));
  } catch {
    return null;
  }
}

function sanitizeEip712Types(types: unknown) {
  if (!types || typeof types !== "object") return {};
  const copy: Record<string, unknown> = { ...(types as any) };
  delete copy.EIP712Domain;
  return copy;
}

function findAddressInParams(params: unknown): string | null {
  if (!Array.isArray(params)) return null;
  for (const p of params) {
    if (typeof p === "string" && ethers.isAddress(p)) return p;
    if (p && typeof p === "object" && typeof (p as any).from === "string" && ethers.isAddress((p as any).from)) {
      return (p as any).from;
    }
  }
  return null;
}

export function SessionRequestSheet() {
  const { theme } = useTheme();
  const request = useWalletConnect((s) => s.pendingRequest);
  const respondResult = useWalletConnect((s) => s.respondRequestResult);
  const respondError = useWalletConnect((s) => s.respondRequestError);

  const accounts = useAccounts((s) => s.accounts);
  const activeAccount = useAccounts((s) => s.activeAccount());
  const vaultKey = useSession((s) => s.vaultKey);

  const [busy, setBusy] = useState(false);
  const [feeText, setFeeText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const signerAccount = useMemo(() => {
    if (!request) return activeAccount;
    const addr = findAddressInParams(request.params);
    if (!addr) return activeAccount;
    return accounts.find((a) => a.address.toLowerCase() === addr.toLowerCase()) ?? activeAccount;
  }, [request, accounts, activeAccount]);

  const isTx = request?.method === "eth_sendTransaction" || request?.method === "eth_signTransaction";
  const isPersonalSign = request?.method === "personal_sign" || request?.method === "eth_sign";
  const isTypedData = request?.method === "eth_signTypedData" || request?.method === "eth_signTypedData_v4";

  const txPreview = useMemo(() => {
    if (!isTx || !request) return null;
    const raw = Array.isArray(request.params) ? request.params[0] : null;
    if (!raw) return null;
    return normalizeDappTx(raw);
  }, [isTx, request]);

  const messagePreview = useMemo(() => {
    if (!isPersonalSign || !request || !Array.isArray(request.params)) return null;
    const [a, b] = request.params;
    const hex = typeof a === "string" && a.startsWith("0x") ? a : typeof b === "string" && b.startsWith("0x") ? b : null;
    return hex ? tryDecodeHexToUtf8(hex) ?? hex : null;
  }, [isPersonalSign, request]);

  useEffect(() => {
    setErr(null);
    setFeeText(null);
    if (!isTx || !txPreview || !signerAccount) return;

    let alive = true;
    (async () => {
      try {
        const fee = await estimateFees({ from: signerAccount.address, tx: { ...txPreview, from: signerAccount.address } });
        if (!alive) return;
        setFeeText(`${Number(ethers.formatEther(fee.feeWei)).toFixed(6)} ${ELECTRONEUM.symbol}`);
      } catch {
        if (alive) setFeeText("—");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTx, txPreview?.to, txPreview?.value, txPreview?.data, signerAccount?.id]);

  if (!request) return null;

  const reject = () => respondError("User rejected", 4001);

  const approve = async () => {
    if (!vaultKey || !signerAccount) {
      await respondError("Wallet locked");
      return;
    }

    setBusy(true);
    setErr(null);

    try {
      const mnemonic = await getDecryptedMnemonic(vaultKey, signerAccount.id);
      const signer = getSigner(mnemonic);

      if (isTx && txPreview) {
        const tx: ethers.TransactionRequest = { ...txPreview, from: signerAccount.address, chainId: ELECTRONEUM.chainId };
        const resp = await signer.sendTransaction(tx);
        await respondResult(resp.hash);
        return;
      }

      if (isPersonalSign && Array.isArray(request.params)) {
        const [a, b] = request.params;
        const hex = typeof a === "string" && a.startsWith("0x") ? a : b;
        const sig = await signer.signMessage(ethers.getBytes(hex as string));
        await respondResult(sig);
        return;
      }

      if (isTypedData && Array.isArray(request.params)) {
        const raw = request.params.find((p) => typeof p === "string" && p.trim().startsWith("{"));
        const parsed = typeof raw === "string" ? JSON.parse(raw) : null;
        if (!parsed) throw new Error("Malformed typed data payload");
        const sig = await (signer as any).signTypedData(parsed.domain, sanitizeEip712Types(parsed.types), parsed.message);
        await respondResult(sig);
        return;
      }

      await respondError(`Unsupported method: ${request.method}`, 4200);
    } catch (e: any) {
      setErr(e?.message ?? "Request failed");
      await respondError(e?.message ?? "Request failed", -32000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={reject}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFillObject} />
        <Pressable onPress={reject} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.bgElevated,
              borderRadius: RADIUS.xxl,
              borderWidth: 1,
              borderColor: theme.border,
              padding: SPACING.xl,
              gap: SPACING.md,
            }}
          >
            <DragHandle />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
                {isTx ? "Confirm transaction" : "Signature request"}
              </T>
              <Pressable onPress={reject} style={{ padding: 8 }}>
                <Ionicons name="close" size={18} color={theme.text} />
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="globe-outline" size={14} color={theme.muted} />
              <T variant="caption" color={theme.muted} numberOfLines={1}>
                {request.dappName ?? request.dappUrl ?? "Connected app"}
              </T>
            </View>

            {signerAccount ? (
              <View style={{ padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                <T variant="caption" color={theme.muted}>Signing with</T>
                <T weight="semibold">{signerAccount.label} · {shortAddr(signerAccount.address)}</T>
              </View>
            ) : null}

            {isTx && txPreview ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <T color={theme.muted}>To</T>
                  <T weight="semibold">{shortAddr(String(txPreview.to ?? ""))}</T>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <T color={theme.muted}>Value</T>
                  <T weight="semibold">
                    {txPreview.value ? ethers.formatEther(txPreview.value as any) : "0"} {ELECTRONEUM.symbol}
                  </T>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <T color={theme.muted}>Network fee</T>
                  <T weight="semibold">{feeText ?? "Estimating…"}</T>
                </View>
              </View>
            ) : null}

            {(isPersonalSign || isTypedData) ? (
              <View style={{ padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, maxHeight: 160 }}>
                <T variant="caption" color={theme.muted}>Message</T>
                <T weight="semibold" numberOfLines={6} style={{ marginTop: 4 }}>
                  {isTypedData ? "Structured data (EIP-712)" : messagePreview ?? "(binary data)"}
                </T>
              </View>
            ) : null}

            {err ? <T color={theme.danger}>{err}</T> : null}

            <Button title={busy ? "Confirming…" : "Approve"} disabled={busy || !signerAccount} onPress={approve} />
            <Button title="Reject" variant="outline" disabled={busy} onPress={reject} />
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}
