// src/features/walletconnect/ConnectionsPanel.tsx
//
// Settings → Connections: pair with an external dapp via a WalletConnect URI
// (paste from a desktop site's "Connect Wallet" QR/URI), and manage/revoke
// sessions that are already connected.
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { DragHandle } from "@/src/components/DragHandle";
import { toast } from "@/src/state/toast";
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

  const router = useRouter();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [uri, setUri] = useState("");
  const showToast = (msg: string) => toast.info(msg);

  return (
    <View style={{ gap: SPACING.sm }}>
      {/* Slim by design: one compact line per connected app (name only —
          the URL was noise), and a single quiet action row. Most users
          have zero or one connection, so this should almost disappear. */}
      <View style={{ gap: 2 }}>
        {sessions.map((s) => (
          <View
            key={s.topic}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: SPACING.sm,
              paddingVertical: 10,
            }}
          >
            <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: theme.positive }} />
            <T weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
              {s.peer.metadata.name || s.peer.metadata.url || shortTopic(s.topic)}
            </T>
            <Pressable
              onPress={() => {
                disconnectSession(s.topic);
                showToast("Disconnected");
              }}
              hitSlop={10}
              style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
            >
              <T variant="caption" weight="semibold" color={theme.danger}>
                Disconnect
              </T>
            </Pressable>
          </View>
        ))}

        {/* Scanning is the primary action — this whole feature exists for
            connecting to a dapp open on another screen, and nobody wants to
            type a wc: URI on a phone. Pasting stays available underneath for
            the case where the URI is already on the clipboard. */}
        <Pressable
          onPress={() => router.push("/scan")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="qr-code-outline" size={17} color={theme.accent} />
          <T weight="semibold" color={theme.accent}>
            {sessions.length === 0 ? "Scan to connect an app" : "Scan to connect another"}
          </T>
        </Pressable>

        <Pressable
          onPress={() => setPasteOpen(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingBottom: 10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="clipboard-outline" size={15} color={theme.muted} />
          <T variant="caption" weight="semibold" color={theme.muted}>
            Paste a link instead
          </T>
        </Pressable>
      </View>

      <Modal visible={pasteOpen} transparent animationType="fade" onRequestClose={() => setPasteOpen(false)}>
        <View style={{ flex: 1 }}>
          <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFill} />
          <View style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
            <View
              style={{ backgroundColor: theme.bgElevated, borderRadius: RADIUS.xxl, padding: SPACING.xl, gap: SPACING.md }}
            >
              <DragHandle />
              <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
                Connect via WalletConnect
              </T>
              <T color={theme.muted}>
                On a phone, tapping &quot;Decent Wallet&quot; in a dapp&apos;s wallet list connects you automatically —
                no pasting needed. Use this only when a site shows a QR code instead, e.g. when the dapp is open on
                your computer.
              </T>

              <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.sm }}>
                <TextInput
                  value={uri}
                  onChangeText={setUri}
                  placeholder="wc:a1b2c3...@2?relay-protocol=..."
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ flex: 1, borderRadius: RADIUS.md, backgroundColor: theme.surface2, padding: SPACING.md, color: theme.text }}
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
                onPress={() => {
                  const pending = uri.trim();
                  // Close this sheet *before* awaiting pair() — a
                  // session_proposal event can arrive (opening the global
                  // SessionProposalSheet) before this promise resolves, and
                  // two native Modals visible at once reliably freezes
                  // touch handling. Errors surface via toast instead.
                  setUri("");
                  setPasteOpen(false);
                  pair(pending).catch((e: any) => showToast(e?.message ?? "Failed to connect"));
                }}
              />
              <Button title="Cancel" variant="outline" onPress={() => setPasteOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
