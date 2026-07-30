// src/components/PasscodePad.tsx
//
// The one passcode UI in the app.
//
// Before this existed there were three hand-rolled keypads — the unlock
// screen, onboarding "create passcode", and the passcode sheet in Settings —
// each with its own key shape, dot size, spacing and error handling. They
// drifted, so the same action looked like three different products depending
// on where you hit it. This is the single implementation; screens supply
// copy and a submit handler and nothing else.
//
// Design notes:
//  - Circular keys. Every native lock screen on earth is round, and round
//    reads as "tap target"; rounded squares read as tiles or cards.
//  - Digits are large and light-weight, so they feel like typography rather
//    than buttons wearing labels.
//  - Action keys (biometric / delete) are bare — no fill — so the eye lands
//    on the numbers.
//  - The status line under the dots is a FIXED height, shared by the error
//    message and the busy spinner. Reserving it means the keypad never
//    shifts, and a layout jump at the exact moment you're told you're wrong
//    reads as a glitch.
//  - Dots pulse while busy. All six are already filled by then, so animating
//    them says "working" without needing a word for it.
import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Animated, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { hapticTap } from "@/src/lib/haptics";

export const PASSCODE_LENGTH = 6;

export function isFullPasscode(s: string) {
  return new RegExp(`^\\d{${PASSCODE_LENGTH}}$`).test(s);
}

export type PasscodePadProps = {
  value: string;
  onChange: (next: string) => void;
  /** Blocks input and shows the spinner in the status slot. */
  busy?: boolean;
  /** Shown in red in the status slot; also triggers the shake. */
  error?: string | null;
  /** Renders a biometric key in the bottom-left slot. */
  biometric?: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  } | null;
  /** Compact spacing for use inside a sheet with a header above it. */
  compact?: boolean;
};

export function PasscodePad({
  value,
  onChange,
  busy = false,
  error = null,
  biometric = null,
  compact = false,
}: PasscodePadProps) {
  const { theme } = useTheme();

  const shakeX = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  // Shake whenever a NEW error arrives (not on every re-render while the
  // same error is still displayed).
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (!error || error === lastError.current) {
      lastError.current = error;
      return;
    }
    lastError.current = error;
    shakeX.setValue(0);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 1, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -1, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 1, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -1, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start();
  }, [error, shakeX]);

  useEffect(() => {
    if (!busy) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0, duration: 480, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 480, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [busy, pulse]);

  const dots = useMemo(
    () => Array.from({ length: PASSCODE_LENGTH }).map((_, i) => i < value.length),
    [value.length]
  );

  const add = (d: string) => {
    if (busy || value.length >= PASSCODE_LENGTH) return;
    hapticTap();
    onChange(value + d);
  };

  const del = () => {
    if (busy || value.length === 0) return;
    hapticTap();
    onChange(value.slice(0, -1));
  };

  const keySize = compact ? 66 : 72;
  const rowGap = compact ? 14 : 18;
  const colGap = compact ? 22 : 26;

  return (
    <View>
      {/* Dots */}
      <Animated.View
        style={{
          flexDirection: "row",
          gap: 14,
          justifyContent: "center",
          opacity: busy ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) : 1,
          transform: [
            { translateX: shakeX.interpolate({ inputRange: [-1, 0, 1], outputRange: [-8, 0, 8] }) },
            { scale: busy ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.02] }) : 1 },
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

      {/* Fixed-height status slot — spinner OR error, never both, never zero. */}
      <View style={{ height: 30, alignItems: "center", justifyContent: "center" }}>
        {busy ? (
          <ActivityIndicator size="small" color={theme.accent} />
        ) : error ? (
          <T variant="caption" weight="semibold" color={theme.danger}>
            {error}
          </T>
        ) : null}
      </View>

      <View style={{ height: compact ? 12 : 22 }} />

      {/* Keypad */}
      <View style={{ gap: rowGap, alignItems: "center" }}>
        {[
          ["1", "2", "3"],
          ["4", "5", "6"],
          ["7", "8", "9"],
          ["bio", "0", "del"],
        ].map((row, r) => (
          <View key={r} style={{ flexDirection: "row", gap: colGap }}>
            {row.map((k) => {
              const isDel = k === "del";
              const isBio = k === "bio";
              const isAction = isDel || isBio;

              // The biometric slot is always rendered — invisible when
              // unavailable — so the grid never reflows between devices or
              // between the two screens that share this component.
              const hidden = isBio && !biometric;
              const disabled = hidden || busy || (isDel && value.length === 0);

              return (
                <Pressable
                  key={k}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isBio ? `Unlock with ${biometric?.label ?? "biometrics"}` : isDel ? "Delete last digit" : k
                  }
                  onPress={() => {
                    if (isDel) del();
                    else if (isBio) biometric?.onPress();
                    else add(k);
                  }}
                  // The circle is the visual, but the touch target is the
                  // circle PLUS this slop — so a tap that lands a few points
                  // outside the fill still counts. Missing by 3pt and having
                  // nothing happen is what makes a keypad feel broken.
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: keySize,
                    height: keySize,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isAction
                      ? pressed && !disabled
                        ? theme.surface2
                        : "transparent"
                      : pressed && !disabled
                      ? theme.border
                      : theme.surface2,
                    opacity: hidden ? 0 : busy ? 0.5 : isDel && value.length === 0 ? 0.35 : 1,
                  })}
                >
                  {isBio && biometric ? (
                    <Ionicons name={biometric.icon} size={26} color={theme.text} />
                  ) : isDel ? (
                    <Ionicons name="backspace-outline" size={24} color={theme.text} />
                  ) : isBio ? null : (
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
    </View>
  );
}
