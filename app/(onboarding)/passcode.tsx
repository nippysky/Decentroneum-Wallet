// app/(onboarding)/passcode.tsx
import React, { useEffect, useRef, useState } from "react";
import { Animated, View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { OnboardingProgress } from "@/src/components/OnboardingProgress";
import { PreparingWallet } from "@/src/components/PreparingWallet";
import { useTheme } from "@/src/theme/ThemeProvider";
import { initializeVault } from "@/src/lib/crypto/vault";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { toast } from "@/src/state/toast";
import { SPACING } from "@/src/theme/tokens";

function is6Digits(s: string) {
  return /^\d{6}$/.test(s);
}

export default function Passcode() {
  const router = useRouter();
  const { theme } = useTheme();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();

  const [step, setStep] = useState<1 | 2>(1);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  const shakeX = useRef(new Animated.Value(0)).current;

  const value = step === 1 ? pin : confirm;

  const dots = (n: number) => Array.from({ length: 6 }).map((_, i) => i < n);

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
    if (value.length >= 6) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMismatch(false);
    if (step === 1) setPin(value + d);
    else setConfirm(value + d);
  };

  const delDigit = async () => {
    if (busy) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMismatch(false);
    if (step === 1) setPin(value.slice(0, -1));
    else setConfirm(value.slice(0, -1));
  };

  const finishSetup = async (finalPin: string) => {
    if (!mnemonic) return;
    setBusy(true);
    try {
      const { key, accounts, activeAccountId } = await initializeVault(finalPin, { mnemonic, label: "Account 1" });
      useAccounts.getState().setAccounts(accounts, activeAccountId);
      useSession.setState({ isUnlocked: true, vaultKey: key });
      router.replace("/(tabs)/wallet");
    } catch (e: any) {
      // Never leave the user on a frozen progress screen — drop the cover,
      // reset the confirm step, and say what happened.
      setConfirm("");
      setStep(1);
      setPin("");
      toast.error(e?.message ?? "Couldn't finish setting up your wallet. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Classy, modern passcode UX: advance/finish automatically the moment the
  // 6th digit lands — no separate "Continue"/"Finish setup" tap needed.
  useEffect(() => {
    if (busy) return;

    if (step === 1 && is6Digits(pin)) {
      const t = setTimeout(async () => {
        await Haptics.selectionAsync().catch(() => {});
        setStep(2);
      }, 150);
      return () => clearTimeout(t);
    }

    if (step === 2 && is6Digits(confirm)) {
      if (confirm === pin) {
        const t = setTimeout(() => finishSetup(confirm), 150);
        return () => clearTimeout(t);
      }

      // Mismatch — shake, haptic error, then clear so they can retry immediately.
      setMismatch(true);
      shake();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const t = setTimeout(() => setConfirm(""), 420);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pin, confirm, busy]);

  const onBack = () => {
    if (busy) return;
    if (step === 1) {
      router.back();
    } else {
      setStep(1);
      setConfirm("");
      setMismatch(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <OnboardingProgress step={2} total={3} />

        <View style={{ height: SPACING.xxl }} />

        <T weight="bold" style={{ fontSize: 34, lineHeight: 40, letterSpacing: -1 }}>
          {step === 1 ? "Create passcode" : "Confirm passcode"}
        </T>

        <View style={{ height: SPACING.sm }} />

        <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
          Encrypts your wallet on this device — you’ll use it to unlock the app.
        </T>

        <View style={{ height: SPACING.xxl }} />

        {/* Dots — shake on a mismatched confirm */}
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
          {dots(value.length).map((filled, i) => (
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

        <View style={{ height: 12, alignItems: "center", justifyContent: "center" }}>
          {mismatch ? (
            <T variant="caption" color={theme.danger}>
              Passcodes don’t match — try again.
            </T>
          ) : null}
        </View>

        <View style={{ height: SPACING.xl }} />

        {/* Keypad — flat, no borders, quieter than a bordered grid of cards */}
        <View style={{ gap: SPACING.md }}>
          {[
            ["1", "2", "3"],
            ["4", "5", "6"],
            ["7", "8", "9"],
            ["", "0", "del"],
          ].map((row, r) => (
            <View key={r} style={{ flexDirection: "row", gap: SPACING.md }}>
              {row.map((k) => {
                const isDel = k === "del";
                const disabled = k === "";
                return (
                  <Pressable
                    key={k || `empty-${r}`}
                    disabled={disabled || busy}
                    onPress={() => (isDel ? delDigit() : addDigit(k))}
                    style={({ pressed }) => [
                      {
                        flex: 1,
                        height: 60,
                        borderRadius: 18,
                        backgroundColor: pressed && !disabled ? theme.border : theme.surface2,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: disabled ? 0 : 1,
                      },
                    ]}
                  >
                    <T weight="semibold" style={{ fontSize: 20 }}>
                      {isDel ? "⌫" : k}
                    </T>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Auto-advances at 6 digits — no separate Continue/Finish tap needed. */}
        <View style={{ marginTop: "auto", paddingTop: SPACING.xl, alignItems: "center" }}>
          <Pressable onPress={onBack} disabled={busy} style={{ alignSelf: "center", padding: SPACING.md }}>
            <T variant="caption" weight="semibold" color={theme.muted}>
              Back
            </T>
          </Pressable>
        </View>
      </View>

      {/* Vault creation is genuinely slow (scrypt key derivation). Cover the
          screen with real progress instead of letting it look frozen. */}
      <PreparingWallet visible={busy} />
    </Screen>
  );
}
