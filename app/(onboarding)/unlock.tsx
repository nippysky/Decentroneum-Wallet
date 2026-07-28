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
  // Drives the dot pulse while the vault unlocks — see the dots block below.
  const unlockPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!busy) {
      unlockPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(unlockPulse, { toValue: 0, duration: 480, useNativeDriver: true }),
        Animated.timing(unlockPulse, { toValue: 1, duration: 480, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [busy, unlockPulse]);

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

        <T variant="display">
          Unlock
        </T>

        <View style={{ height: SPACING.sm }} />

        <T color={theme.muted} variant="body">
          Enter your passcode to access your wallet.
        </T>

        <View style={{ height: SPACING.xxl }} />

        {/* Dots — shake on a wrong passcode, and gently pulse while the
            vault is being unlocked. The pulse IS the progress indicator:
            all six are already filled at that point, so animating them says
            "working" without needing a word for it. The old copy said
            "Decrypting locally…", which is accurate but reads as jargon to
            anyone who isn't technical — and on a lock screen, unexplained
            technical language reads as something going wrong. */}
        <Animated.View
          style={{
            flexDirection: "row",
            gap: 14,
            justifyContent: "center",
            opacity: busy ? unlockPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) : 1,
            transform: [
              {
                translateX: shakeX.interpolate({ inputRange: [-1, 0, 1], outputRange: [-8, 0, 8] }),
              },
              {
                scale: busy ? unlockPulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.02] }) : 1,
              },
            ],
          }}
        >
          {dots.map((filled, i) => (
            <View
              key={i}
              style={{
                width: 13,
                height: 13,
                borderRadius: 999,
                backgroundColor: filled ? theme.accent : "transparent",
                borderWidth: filled ? 0 : 1.5,
                borderColor: theme.border,
              }}
            />
          ))}
        </Animated.View>

        {/* Reserved height so the keypad never shifts when a message
            appears — layout jump on an error feels like a glitch. */}
        {/* One reserved slot under the dots for BOTH the error message and
            the unlock spinner — same height either way, so the keypad never
            shifts. A small inline spinner is all this needs: the dots above
            are already pulsing, and key derivation is a couple of seconds,
            not a page load. */}
        <View style={{ height: 30, alignItems: "center", justifyContent: "center" }}>
          {busy ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : error ? (
            <T variant="caption" weight="semibold" color={theme.danger}>
              {error}
            </T>
          ) : null}
        </View>

        <View style={{ height: SPACING.xl }} />

        {/* Keypad — circular keys, which is what every native lock screen
            uses. Round reads as "tap target"; the old rounded-squares read
            as cards or tiles. Digits are light-weight and large, so the
            numbers feel like typography rather than buttons with labels. */}
        <View style={{ gap: 18, alignItems: "center" }}>
          {[
            ["1", "2", "3"],
            ["4", "5", "6"],
            ["7", "8", "9"],
            ["bio", "0", "del"],
          ].map((row, r) => (
            <View key={r} style={{ flexDirection: "row", gap: 26 }}>
              {row.map((k) => {
                const isDel = k === "del";
                const isBio = k === "bio";
                const isAction = isDel || isBio;
                // The biometric key holds its slot even when unavailable, so
                // the grid never reflows between devices.
                const hidden = isBio && !bioReady;
                const disabled = hidden || busy;

                return (
                  <Pressable
                    key={k}
                    disabled={disabled}
                    accessibilityRole="button"
                    // Say the real modality ("Unlock with Face ID"), not a
                    // generic "biometrics" — that's what bioLabel is for now
                    // that the duplicate text button is gone.
                    accessibilityLabel={
                      isBio ? `Unlock with ${bioLabel}` : isDel ? "Delete last digit" : k
                    }
                    onPress={() => {
                      if (isDel) delDigit();
                      else if (isBio) doBiometricUnlock();
                      else addDigit(k);
                    }}
                    style={({ pressed }) => [
                      {
                        width: 72,
                        height: 72,
                        borderRadius: 999,
                        alignItems: "center",
                        justifyContent: "center",
                        // Action keys stay bare — only digits get a surface,
                        // so the eye goes to the numbers.
                        backgroundColor: isAction
                          ? pressed && !disabled
                            ? theme.surface2
                            : "transparent"
                          : pressed && !disabled
                          ? theme.border
                          : theme.surface2,
                        opacity: hidden ? 0 : busy ? 0.5 : 1,
                      },
                    ]}
                  >
                    {isBio ? (
                      <Ionicons name={bioIcon} size={26} color={theme.text} />
                    ) : isDel ? (
                      <Ionicons name="backspace-outline" size={24} color={theme.text} />
                    ) : (
                      <T weight="regular" style={{ fontSize: 30, lineHeight: 36 }}>
                        {k}
                      </T>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Auto-submits at 6 digits — no Unlock button needed. The biometric
            key in the keypad is the only affordance; the duplicate
            "Use Face ID" row that used to sit here was the same action
            twice, three inches apart. */}
        <View style={{ marginTop: "auto" }} />
      </View>


    </Screen>
  );
}
