// src/features/walletconnect/SessionProposalSheet.tsx
import React, { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { DragHandle } from "@/src/components/DragHandle";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SPACING } from "@/src/theme/tokens";
import { useAccounts } from "@/src/state/accounts";
import { useWalletConnect } from "@/src/state/walletconnect";
import { ELECTRONEUM } from "@/src/lib/chain/networks";

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function SessionProposalSheet() {
  const { theme } = useTheme();
  const proposal = useWalletConnect((s) => s.pendingProposal);
  const approve = useWalletConnect((s) => s.approveProposal);
  const reject = useWalletConnect((s) => s.rejectProposal);

  const accounts = useAccounts((s) => s.accounts);
  const activeAccount = useAccounts((s) => s.activeAccount());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosenAccount = accounts.find((a) => a.id === selectedId) ?? activeAccount;

  return (
    <Modal visible={!!proposal} transparent animationType="fade" onRequestClose={reject}>
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

            <View style={{ alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.sm }}>
              {proposal?.icon ? (
                <Image source={{ uri: proposal.icon }} style={{ width: 56, height: 56, borderRadius: RADIUS.lg }} />
              ) : (
                <View style={{ width: 56, height: 56, borderRadius: RADIUS.lg, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="globe-outline" size={26} color={theme.muted} />
                </View>
              )}
              <T weight="bold" style={{ fontSize: 17 }}>
                {proposal?.name ?? "Unknown dapp"}
              </T>
              <T variant="caption" color={theme.muted}>
                {proposal?.url ?? ""}
              </T>
            </View>

            <T color={theme.muted} style={{ textAlign: "center" }}>
              wants to connect to your wallet on {ELECTRONEUM.name}.
            </T>

            {proposal && !proposal.supported ? (
              <View style={{ padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.danger }}>
                <T color={theme.danger} style={{ textAlign: "center" }}>
                  This app requires a network Decent Wallet doesn't support.
                </T>
              </View>
            ) : (
              <View style={{ gap: SPACING.sm }}>
                <T variant="caption" color={theme.muted}>
                  Connect with
                </T>
                {accounts.map((a) => {
                  const selected = a.id === (chosenAccount?.id ?? activeAccount?.id);
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => setSelectedId(a.id)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: SPACING.md,
                        borderRadius: RADIUS.md,
                        borderWidth: 1,
                        borderColor: selected ? theme.accent : theme.border,
                        backgroundColor: theme.bg,
                        opacity: pressed ? 0.9 : 1,
                      })}
                    >
                      <View>
                        <T weight="semibold">{a.label}</T>
                        <T variant="caption" color={theme.muted}>
                          {shortAddr(a.address)}
                        </T>
                      </View>
                      {selected ? <Ionicons name="checkmark-circle" size={18} color={theme.accent} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Button
              title={busy ? "Connecting…" : "Connect"}
              disabled={busy || !proposal?.supported || !chosenAccount}
              onPress={async () => {
                if (!chosenAccount) return;
                setBusy(true);
                try {
                  await approve(chosenAccount.address);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button title="Cancel" variant="outline" disabled={busy} onPress={reject} />
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}
