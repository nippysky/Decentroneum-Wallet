// src/features/walletconnect/ConnectionsPanel.tsx
//
// Settings → Connections: pair with an external dapp via a WalletConnect URI
// (paste from a desktop site's "Connect Wallet" QR/URI), and manage/revoke
// sessions that are already connected.
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { DragHandle } from "@/src/components/DragHandle";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SPACING } from "@/src/theme/tokens";
import { useWalletConnect } from "@/src/state/walletconnect";

function shortTopic(t: string) {
  return `${t.slice(0, 8)}…`;
}

export function ConnectionsPanel() {
  const { theme } = useTheme();
  const sessions = useWalletConnect((s) => s.sessions);
  const connecting = useWalletConnect((s) => s.connecting);
  const lastError = useWalletConnect((s) => s.lastError);
  const pair = useWalletConnect((s) => s.pair);
  const disconnectSession = useWalletConnect((s) => s.disconnectSession);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [uri, setUri] = useState("");

  return (
    <View style={{ gap: SPACING.sm }}>
      <View style={{ borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, overflow: "hidden" }}>
        {sessions.length === 0 ? (
          <View style={{ padding: SPACING.lg }}>
            <T color={theme.muted}>No apps connected via WalletConnect yet.</T>
          </View>
        ) : (
          sessions.map((s, idx) => (
            <View
              key={s.topic}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.md,
                paddingHorizontal: SPACING.lg,
                paddingVertical: SPACING.md,
                borderTopWidth: idx === 0 ? 0 : 1,
                borderTopColor: theme.border,
              }}
            >
              <View style={{ width: 36, height: 36, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }}>
                <Ionicons name="link-outline" size={16} color={theme.text} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T weight="semibold" numberOfLines={1}>
                  {s.peer.metadata.name || s.peer.metadata.url || shortTopic(s.topic)}
                </T>
                <T variant="caption" color={theme.muted} numberOfLines={1}>
                  {s.peer.metadata.url || "Connected app"}
                </T>
              </View>
              <Pressable onPress={() => disconnectSession(s.topic)} hitSlop={8} style={{ padding: 6 }}>
                <Ionicons name="close-circle-outline" size={20} color={theme.danger} />
              </Pressable>
            </View>
          ))
        )}

        <Pressable
          onPress={() => setPasteOpen(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: SPACING.md,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.md,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View style={{ width: 36, height: 36, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border, borderStyle: "dashed" }}>
            <Ionicons name="qr-code-outline" size={16} color={theme.text} />
          </View>
          <T weight="semibold" color={theme.accent}>Connect via WalletConnect</T>
        </Pressable>
      </View>

      <Modal visible={pasteOpen} transparent animationType="fade" onRequestClose={() => setPasteOpen(false)}>
        <View style={{ flex: 1 }}>
          <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFillObject} />
          <Pressable onPress={() => setPasteOpen(false)} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
            <Pressable
              onPress={() => {}}
              style={{ backgroundColor: theme.bgElevated, borderRadius: RADIUS.xxl, borderWidth: 1, borderColor: theme.border, padding: SPACING.xl, gap: SPACING.md }}
            >
              <DragHandle />
              <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
                Connect via WalletConnect
              </T>
              <T color={theme.muted}>
                On the dapp's site, choose "WalletConnect" and copy the connection link, then paste it below.
              </T>

              <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.sm }}>
                <TextInput
                  value={uri}
                  onChangeText={setUri}
                  placeholder="wc:a1b2c3...@2?relay-protocol=..."
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ flex: 1, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, padding: SPACING.md, color: theme.text }}
                />
                <Pressable
                  onPress={async () => {
                    const s = await Clipboard.getStringAsync();
                    if (s.trim()) setUri(s.trim());
                  }}
                  style={({ pressed }) => ({ padding: SPACING.md, opacity: pressed ? 0.8 : 1 })}
                >
                  <Ionicons name="clipboard-outline" size={18} color={theme.muted} />
                </Pressable>
              </View>

              {lastError ? <T color={theme.danger}>{lastError}</T> : null}

              <Button
                title={connecting ? "Connecting…" : "Connect"}
                disabled={connecting || !uri.trim().startsWith("wc:")}
                onPress={async () => {
                  await pair(uri.trim());
                  setUri("");
                  setPasteOpen(false);
                }}
              />
              <Button title="Cancel" variant="outline" onPress={() => setPasteOpen(false)} />
            </Pressable>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
