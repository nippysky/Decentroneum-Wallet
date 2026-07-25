// app/scan.tsx
//
// WalletConnect QR scanner.
//
// This exists for one specific situation: a dapp open on a *computer* shows
// a QR code, and the wallet is on a phone. There's no deep link possible —
// the two devices aren't connected — so the pairing URI has to cross the
// gap somehow. Scanning is the natural way; pasting was the fallback we had
// before this screen existed.
//
// Design notes:
//  • Camera is only ever active while this screen is mounted, and the
//    permission copy says plainly that nothing is recorded. For a wallet,
//    being explicit about that matters more than brevity.
//  • Scans are single-shot (a `handled` ref) — barcode callbacks fire
//    repeatedly per frame, and pairing twice off one code would open two
//    session proposals.
//  • Anything that isn't a WalletConnect URI is rejected with a readable
//    reason rather than silently ignored, so a user pointing at the wrong
//    QR code understands why nothing happened.
import React, { useCallback, useRef, useState } from "react";
import { Pressable, View, AppState } from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { useTheme } from "@/src/theme/ThemeProvider";
import { SPACING } from "@/src/theme/tokens";
import { extractWcUri } from "@/src/lib/walletconnect/deepLink";
import { useWalletConnect } from "@/src/state/walletconnect";
import { toast } from "@/src/state/toast";

export default function ScanScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [permission, requestPermission] = useCameraPermissions();
  const pair = useWalletConnect((s) => s.pair);

  const [torch, setTorch] = useState(false);
  // Barcode callbacks fire on every frame that contains a code. Without this
  // guard one QR would trigger pair() many times.
  const handledRef = useRef(false);

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      if (handledRef.current) return;

      const uri = extractWcUri(data);
      if (!uri) {
        // Not a pairing code — tell them, but stay open so they can retry
        // without navigating back and forth.
        toast.error("That's not a WalletConnect code. Look for the QR on the app's connect screen.");
        return;
      }

      handledRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      // Leave the camera before pairing: the session-proposal sheet is
      // presented globally, and stacking it over a live camera view is both
      // ugly and a needless battery drain.
      router.back();
      pair(uri).catch((e: any) => toast.error(e?.message ?? "Couldn't connect. Please try again."));
    },
    [pair, router]
  );

  // Re-arm if the user backgrounds and returns without a successful scan.
  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") handledRef.current = false;
    });
    return () => sub.remove();
  }, []);

  const Header = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <T weight="bold" style={{ fontSize: 24, lineHeight: 29 }}>
        Scan to connect
      </T>
      <Pressable
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
  );

  // --- Permission states -------------------------------------------------
  if (!permission) {
    // Still resolving — render nothing rather than flashing a prompt.
    return (
      <Screen>
        <View style={{ flex: 1 }}>{Header}</View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ flex: 1 }}>
          {Header}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.surface2,
              }}
            >
              <Ionicons name="qr-code-outline" size={30} color={theme.text} />
            </View>

            <T weight="bold" style={{ fontSize: 20, textAlign: "center" }}>
              Camera access needed
            </T>
            <T color={theme.muted} style={{ textAlign: "center" }}>
              We use the camera only to read WalletConnect QR codes. Nothing is recorded, stored, or
              uploaded.
            </T>

            <View style={{ height: SPACING.sm }} />

            {permission.canAskAgain ? (
              <Button title="Allow camera" onPress={() => requestPermission()} />
            ) : (
              <T variant="caption" color={theme.muted} style={{ textAlign: "center" }}>
                Camera access was declined. You can enable it in your device Settings, or paste a
                connection link instead.
              </T>
            )}
            <Button title="Paste a link instead" variant="outline" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  // --- Scanner -----------------------------------------------------------
  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {Header}

        <View style={{ height: SPACING.md }} />

        <T color={theme.muted}>
          Point your camera at the QR code on the app&apos;s connect screen.
        </T>

        <View style={{ height: SPACING.lg }} />

        <View
          style={{
            flex: 1,
            borderRadius: 28,
            overflow: "hidden",
            backgroundColor: "#000",
            position: "relative",
          }}
        >
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torch}
            // Only ask the OS for the one symbology we care about — faster,
            // and avoids reacting to unrelated barcodes.
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScanned}
          />

          {/* Reticle — purely a framing aid, so it must not eat touches. */}
          <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
            <View
              style={{
                width: "72%",
                aspectRatio: 1,
                borderRadius: 24,
                borderWidth: 3,
                borderColor: theme.primary,
                opacity: 0.9,
              }}
            />
          </View>

          <Pressable
            onPress={() => setTorch((t) => !t)}
            style={({ pressed }) => ({
              position: "absolute",
              bottom: 16,
              alignSelf: "center",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: "rgba(0,0,0,0.55)",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name={torch ? "flashlight" : "flashlight-outline"} size={16} color="#fff" />
            <T weight="semibold" style={{ color: "#fff", fontSize: 13 }}>
              {torch ? "Torch on" : "Torch"}
            </T>
          </Pressable>
        </View>

        <View style={{ paddingTop: SPACING.md, paddingBottom: Math.max(insets.bottom, SPACING.md) }}>
          <Button title="Paste a link instead" variant="outline" onPress={() => router.back()} />
        </View>
      </View>
    </Screen>
  );
}
