// app/(onboarding)/unlock.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/src/ui/Screen";
import { Button } from "@/src/ui/Button";
import { T } from "@/src/ui/T";
import { useTheme } from "@/src/theme/ThemeProvider";

import { unlockVaultV1 } from "@/src/lib/vault";
import { addressFromMnemonic } from "@/src/lib/derive";
import { useSession } from "@/src/state/session";

function is6Digits(s: string) {
  return /^\d{6}$/.test(s);
}

export default function Unlock() {
  const router = useRouter();
  const { theme } = useTheme();

  const setUnlocked = useSession((s) => s.setUnlocked);
  const biometricEnabled = useSession((s) => s.biometricEnabled);
  const getBioPin = useSession((s) => s.getBioPin);

  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const [bioLabel, setBioLabel] = useState("Biometrics");
  const [bioIcon, setBioIcon] =
    useState<keyof typeof Ionicons.glyphMap>("scan-outline");
  const [error, setError] = useState<string | null>(null);

  const didAutoBio = useRef(false);

  const canUnlock = useMemo(() => is6Digits(pin) && !busy, [pin, busy]);
  const dots = useMemo(
    () => Array.from({ length: 6 }).map((_, i) => i < pin.length),
    [pin.length]
  );

  const addDigit = async (d: string) => {
    if (busy) return;
    if (pin.length >= 6) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPin((p) => p + d);
    setError(null);
  };

  const delDigit = async () => {
    if (busy) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPin((p) => p.slice(0, -1));
    setError(null);
  };

  const finishUnlock = async (passcode: string) => {
    setBusy(true);
    setError(null);

    try {
      const mnemonic = await unlockVaultV1(passcode);
      const address = addressFromMnemonic(mnemonic);
      setUnlocked(mnemonic, address);
      router.replace("/(tabs)/wallet");
    } catch {
      setPin("");
      setError("Incorrect passcode.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const doUnlock = async () => {
    if (!is6Digits(pin)) return;
    await finishUnlock(pin);
  };

  const canUseBiometrics = async () => {
    if (!biometricEnabled) return false;
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return has && enrolled;
  };

  const computeBioMeta = async (): Promise<{
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
  }> => {
    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        return { label: "Face ID", icon: "scan-outline" }; // Ionicons doesn't have "face-id"
      }
      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        return { label: "Touch ID", icon: "finger-print-outline" };
      }
      return { label: "Biometrics", icon: "scan-outline" };
    } catch {
      return { label: "Biometrics", icon: "scan-outline" };
    }
  };

  const doBiometricUnlock = async () => {
    if (busy) return;

    const ok = await canUseBiometrics();
    if (!ok) return;

    setBusy(true);
    setError(null);

    try {
      // Triggers FaceID/TouchID because getBioPin uses SecureStore requireAuthentication
      const storedPin = await getBioPin();
      if (!storedPin) {
        setError("Biometric unlock isn’t set up yet.");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      await finishUnlock(storedPin);
    } finally {
      setBusy(false);
    }
  };

  // Determine if biometrics button should appear + which label/icon to show
  useEffect(() => {
    (async () => {
      const ok = await canUseBiometrics();
      setBioReady(ok);

      const meta = await computeBioMeta();
      setBioLabel(meta.label);
      setBioIcon(meta.icon);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricEnabled]);

  // Optional: auto prompt biometrics once on screen open (only if pin empty)
  useEffect(() => {
    if (!bioReady) return;
    if (didAutoBio.current) return;
    if (pin.length > 0) return;
    didAutoBio.current = true;

    const t = setTimeout(() => {
      doBiometricUnlock().catch(() => {});
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bioReady]);

  return (
    <Screen>
      <View style={{ flex: 1, gap: 14 }}>
        {/* Header */}
        <View style={{ gap: 8, marginTop: 6 }}>
          <T variant="h2" weight="bold" style={{ fontSize: 34, lineHeight: 38 }}>
            Unlock
          </T>
          <T color={theme.muted} style={{ fontSize: 16, lineHeight: 22 }}>
            Enter your passcode to access your wallet.
          </T>
        </View>

        {/* Dots */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          {dots.map((filled, i) => (
            <View
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                backgroundColor: filled ? theme.accent : theme.border,
                transform: [{ scale: filled ? 1.05 : 1 }],
              }}
            />
          ))}
        </View>

        {/* Keypad */}
        <View style={{ gap: 10, marginTop: 14 }}>
          {[
            ["1", "2", "3"],
            ["4", "5", "6"],
            ["7", "8", "9"],
            ["bio", "0", "del"],
          ].map((row, r) => (
            <View key={r} style={{ flexDirection: "row", gap: 10 }}>
              {row.map((k) => {
                const isDel = k === "del";
                const isBio = k === "bio";
                const disabled = (isBio && !bioReady) || busy;

                return (
                  <Pressable
                    key={k}
                    disabled={disabled}
                    onPress={() => {
                      if (isDel) delDigit();
                      else if (isBio) doBiometricUnlock();
                      else addDigit(k);
                    }}
                    style={({ pressed }) => [
                      {
                        flex: 1,
                        height: 56,
                        borderRadius: 18,
                        borderWidth: 1,
                        borderColor: theme.border,
                        backgroundColor: theme.card,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: !bioReady && isBio ? 0.35 : busy ? 0.65 : 1,
                      },
                      pressed && !busy ? { opacity: 0.85 } : null,
                    ]}
                  >
                    {isBio ? (
                      <Ionicons name={bioIcon} size={20} color={theme.text} />
                    ) : (
                      <T weight="semibold" style={{ fontSize: 18 }}>
                        {isDel ? "⌫" : k}
                      </T>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Status / Errors */}
        <View style={{ marginTop: 6, minHeight: 54, justifyContent: "center" }}>
          {error ? (
            <T color={(theme as any).danger ?? "#EF4444"} style={{ textAlign: "center" }}>
              {error}
            </T>
          ) : (
            <T variant="caption" color={theme.muted} style={{ textAlign: "center" }}>
              Unlocking happens locally on your device.
            </T>
          )}

          {busy ? (
            <View style={{ marginTop: 10, flexDirection: "row", gap: 10, justifyContent: "center" }}>
              <ActivityIndicator />
              <T variant="caption" color={theme.muted}>
                Decrypting locally…
              </T>
            </View>
          ) : null}
        </View>

        {/* Primary action */}
        <View style={{ marginTop: "auto", gap: 12 }}>
          <Button title={busy ? "Unlocking…" : "Unlock"} disabled={!canUnlock} onPress={doUnlock} />

          {bioReady ? (
            <Pressable
              disabled={busy}
              onPress={doBiometricUnlock}
              style={({ pressed }) => ({
                alignSelf: "center",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 10,
                paddingHorizontal: 12,
                opacity: pressed ? 0.8 : busy ? 0.6 : 1,
              })}
            >
              <Ionicons name={bioIcon} size={16} color={theme.muted} />
              <T variant="caption" weight="semibold" color={theme.muted}>
                Use {bioLabel}
              </T>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
