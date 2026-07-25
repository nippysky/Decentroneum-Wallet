// src/components/PreparingWallet.tsx
//
// Full-screen cover shown while the vault is being created.
//
// Setting up a wallet does real work — deriving an encryption key from the
// passcode with scrypt (deliberately slow, that's the security property),
// encrypting the mnemonic, writing to the Keychain/Keystore. That takes a
// few seconds on a mid-range phone, and before this existed the UI simply
// froze on the passcode screen: no spinner, no copy, nothing. It read as a
// crash right at the most trust-sensitive moment in the whole product.
//
// So instead of hiding the work, this narrates it — the steps are real,
// and saying "encrypting on this device" is also a quiet reassurance about
// what a non-custodial wallet actually does.
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { SPACING } from "@/src/theme/tokens";

const STEPS = [
  { icon: "key-outline" as const, label: "Generating your keys" },
  { icon: "lock-closed-outline" as const, label: "Encrypting on this device" },
  { icon: "shield-checkmark-outline" as const, label: "Securing your wallet" },
];

/** Steps advance on a timer — they mirror the real phases of setup, which
 *  are not individually observable from JS (scrypt runs as one native call). */
const STEP_MS = 1100;

export function PreparingWallet({ visible, title = "Setting up your wallet" }: { visible: boolean; title?: string }) {
  const { theme } = useTheme();
  const [stepIndex, setStepIndex] = useState(0);

  const fade = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, fade]);

  useEffect(() => {
    if (!visible) {
      setStepIndex(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    pulseLoop.start();

    // Hold on the final step rather than looping back — cycling would imply
    // it's stuck in a retry loop.
    const timer = setInterval(() => {
      setStepIndex((i) => (i < STEPS.length - 1 ? i + 1 : i));
    }, STEP_MS);

    return () => {
      loop.stop();
      pulseLoop.stop();
      clearInterval(timer);
    };
  }, [visible, spin, pulse]);

  if (!visible) return null;

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: fade,
        backgroundColor: theme.bg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: SPACING.xl,
        gap: SPACING.xl,
      }}
    >
      {/* Ring + brand mark */}
      <View style={{ alignItems: "center", justifyContent: "center", width: 128, height: 128 }}>
        <Animated.View
          style={{
            position: "absolute",
            width: 128,
            height: 128,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: theme.border,
            borderTopColor: theme.primary,
            transform: [
              { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
            ],
          }}
        />
        <Animated.View
          style={{
            width: 76,
            height: 76,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.primary,
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }) }],
          }}
        >
          <Ionicons name="wallet" size={34} color={theme.bg} />
        </Animated.View>
      </View>

      <View style={{ alignItems: "center", gap: 6 }}>
        <T weight="bold" style={{ fontSize: 24, lineHeight: 29, textAlign: "center" }}>
          {title}
        </T>
        <T color={theme.muted} style={{ textAlign: "center" }}>
          This only takes a moment. Please keep the app open.
        </T>
      </View>

      {/* Step checklist */}
      <View style={{ gap: SPACING.sm, alignSelf: "stretch" }}>
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          const tint = done ? theme.positive : current ? theme.text : theme.muted;

          return (
            <View
              key={s.label}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.md,
                paddingVertical: 12,
                paddingHorizontal: SPACING.md,
                borderRadius: 16,
                backgroundColor: current ? theme.surface2 : "transparent",
                opacity: done || current ? 1 : 0.45,
              }}
            >
              <Ionicons name={done ? "checkmark-circle" : s.icon} size={19} color={tint} />
              <T weight={current ? "semibold" : "medium"} color={tint} style={{ flex: 1 }}>
                {s.label}
              </T>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}
