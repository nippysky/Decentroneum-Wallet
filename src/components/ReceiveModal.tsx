// src/components/ReceiveModal.tsx
//
// Shared Receive sheet — used from the Home screen and from any per-token
// detail page. Self-contained (manages its own copy toast) so callers don't
// need to wire that up themselves.
//
// Full-screen, like every other sheet in the app. Receiving is the one moment
// someone holds their phone up for another person to scan, so the QR gets the
// whole display instead of a 190pt square inside a floating card.
import React from "react";
import { Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";

import { toast } from "@/src/state/toast";
import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { IconButton } from "@/src/components/IconButton";
import { FullSheet } from "@/src/components/FullSheet";
import { useTheme } from "@/src/theme/ThemeProvider";
import { FONT } from "@/src/theme/typography";
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

  return (
    <FullSheet
      visible={visible}
      title="Receive"
      subtitle={`Share this address to receive ${assetLabel ?? "ETN or tokens"} on Electroneum.`}
      onClose={onClose}
      footer={<Button title="Done" onPress={onClose} />}
    >
      <View style={{ flex: 1, justifyContent: "center", gap: SPACING.xl }}>
        <View
          style={{
            alignSelf: "center",
            padding: SPACING.lg,
            borderRadius: RADIUS.xl,
            backgroundColor: theme.surface2,
          }}
        >
          {/* Bigger than it was. A QR that another phone has to focus on
              across a table is not the place to save 40 points of space. */}
          <QRCode value={address} size={232} color={theme.text} backgroundColor={theme.surface2} />
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
            {/* JetBrains Mono, not a hardcoded "Menlo" — Menlo doesn't exist
                on Android, so that string silently fell back to the system
                font and the address lost its fixed-width alignment there. */}
            <T weight="semibold" numberOfLines={1} style={{ fontFamily: FONT.mono, fontSize: 13 }}>
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
                toast.info("Address copied");
              }}
            />
          </View>
        </View>
      </View>
    </FullSheet>
  );
}
