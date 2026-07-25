// app/(onboarding)/unlock.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { SPACING } from "@/src/theme/tokens";

import { useSession } from "@/src/state/session";

function is6Digits(s: string) {
  return /^\d{6}$/.test(s);
}

export default function Unlock() {
  const router = useRouter();
  const { theme } = useTheme();

  const unlock = useSession((s) => s.unlock);
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
  const shakeX = useRef(new Animated.Value(0)).current;

  const dots = useMemo(
    () => Array.from({ length: 6 }).map((_, i) => i < pin.length),
    [pin.length]
  );

  const shake = () => {
    shakeX.setValue(0);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 1, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -1, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 1, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -1, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start();
  };

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
      await unlock(passcode);
      router.replace("/(tabs)/wallet");
    } catch {
      setPin("");
      setError("Incorrect passcode.");
      shake();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const doUnlock = async () => {
    if (!is6Digits(pin)) return;
    await finishUnlock(pin);
  };

  // Classy, modern passcode UX: as soon as the 6th digit lands, log the
  // person straight in — no separate "Unlock" tap needed. A brief pause
  // lets the last dot visibly fill before the screen moves on.
  useEffect(() => {
    if (!is6Digits(pin) || busy) return;
    const t = setTimeout(() => {
      doUnlock();
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

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
      <View style={{ flex: 1 }}>
        <View style={{ height: SPACING.xxl }} />

        <T weight="bold" style={{ fontSize: 34, lineHeight: 40, letterSpacing: -1 }}>
          Unlock
        </T>

        <View style={{ height: SPACING.sm }} />

        <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
          Enter your passcode to access your wallet.
        </T>

        <View style={{ height: SPACING.xxl }} />

        {/* Dots — shake on a wrong passcode */}
        <Animated.View
          style={{
            flexDirection: "row",
            gap: 16,
            justifyContent: "center",
            transform: [
              {
                translateX: shakeX.interpolate({ inputRange: [-1, 0, 1], outputRange: [-8, 0, 8] }),
              },
            ],
          }}
        >
          {dots.map((filled, i) => (
            <View
              key={i}
              style={{
                width: 15,
                height: 15,
                borderRadius: 999,
                backgroundColor: filled ? theme.accent : theme.border,
              }}
            />
          ))}
        </Animated.View>

        <View style={{ height: 32, alignItems: "center", justifyContent: "center" }}>
          {error ? (
            <T variant="caption" color={theme.danger}>
              {error}
            </T>
          ) : busy ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <ActivityIndicator size="small" />
              <T variant="caption" color={theme.muted}>
                Decrypting locally…
              </T>
            </View>
          ) : null}
        </View>

        <View style={{ height: SPACING.xl }} />

        {/* Keypad — flat, no borders */}
        <View style={{ gap: SPACING.md }}>
          {[
            ["1", "2", "3"],
            ["4", "5", "6"],
            ["7", "8", "9"],
            ["bio", "0", "del"],
          ].map((row, r) => (
            <View key={r} style={{ flexDirection: "row", gap: SPACING.md }}>
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
                        height: 60,
                        borderRadius: 18,
                        backgroundColor: pressed && !disabled ? theme.border : theme.surface2,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: !bioReady && isBio ? 0 : busy ? 0.65 : 1,
                      },
                    ]}
                  >
                    {isBio ? (
                      <Ionicons name={bioIcon} size={20} color={theme.text} />
                    ) : (
                      <T weight="semibold" style={{ fontSize: 20 }}>
                        {isDel ? "⌫" : k}
                      </T>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Auto-submits at 6 digits — no separate Unlock button needed. */}
        <View style={{ marginTop: "auto", paddingTop: SPACING.xl, alignItems: "center" }}>
          {bioReady ? (
            <Pressable
              disabled={busy}
              onPress={doBiometricUnlock}
              style={({ pressed }) => ({
                alignSelf: "center",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                padding: SPACING.md,
                opacity: pressed ? 0.6 : busy ? 0.6 : 1,
              })}
            >
              <Ionicons name={bioIcon} size={15} color={theme.muted} />
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
