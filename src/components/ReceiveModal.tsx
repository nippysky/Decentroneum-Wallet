// src/components/ReceiveModal.tsx
//
// Shared Receive sheet — used from the Home screen and from any per-token
// detail page. Self-contained (manages its own copy toast) so callers don't
// need to wire that up themselves.
import React, { useRef, useState } from "react";
import { Modal, Pressable, Share, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { IconButton } from "@/src/components/IconButton";
import { DragHandle } from "@/src/components/DragHandle";
import { Toast } from "@/src/components/Toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SPACING } from "@/src/theme/tokens";

export function ReceiveModal({
  visible,
  onClose,
  address,
  assetLabel,
}: {
  visible: boolean;
  onClose: () => void;
  address: string;
  /** e.g. "ETN or tokens" (default) or a specific symbol like "DCNT". */
  assetLabel?: string;
}) {
  const { theme } = useTheme();

  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1300) as unknown as number;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFill} />

        <Pressable style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.bgElevated,
              borderRadius: RADIUS.xxl,
              borderWidth: 1,
              borderColor: theme.border,
              padding: SPACING.xl,
              gap: SPACING.md,
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: -6 },
              elevation: 12,
            }}
          >
            <DragHandle />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
                Receive
              </T>

              <Pressable onPress={onClose} style={{ padding: 10 }}>
                <Ionicons name="close" size={20} color={theme.text} />
              </Pressable>
            </View>

            <T color={theme.muted}>Share this address to receive {assetLabel ?? "ETN or tokens"} on Electroneum EVM.</T>

            <View
              style={{
                alignSelf: "center",
                padding: SPACING.lg,
                borderRadius: RADIUS.xl,
                backgroundColor: theme.surface2,
              }}
            >
              <QRCode value={address} size={190} color={theme.text} backgroundColor={theme.surface2} />
            </View>

            <View
              style={{
                padding: SPACING.md,
                borderRadius: RADIUS.lg,
                backgroundColor: theme.surface2,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="caption" color={theme.muted}>
                  Your address
                </T>
                <T weight="semibold" numberOfLines={1} style={{ fontFamily: "Menlo" }}>
                  {address}
                </T>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <IconButton
                  icon="share-outline"
                  accessibilityLabel="Share address"
                  onPress={() => {
                    Share.share({ message: address }).catch(() => {});
                  }}
                />
                <IconButton
                  icon="copy-outline"
                  accessibilityLabel="Copy address"
                  onPress={async () => {
                    await Clipboard.setStringAsync(address);
                    showToast("Address copied");
                  }}
                />
              </View>
            </View>

            <Button title="Done" onPress={onClose} />
          </Pressable>
        </Pressable>

        <Toast message={toastMsg} visible={toastVisible} bottomOffset={24} />
      </View>
    </Modal>
  );
}
