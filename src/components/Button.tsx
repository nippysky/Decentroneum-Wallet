// src/ui/Button.tsx
import { useTheme } from "@/src/theme/ThemeProvider";
import { FONT } from "@/src/theme/typography";
import { hapticTap } from "@/src/lib/haptics";
import React from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextStyle, ViewStyle } from "react-native";

type Variant = "primary" | "outline" | "ghost";

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Shows a small spinner in place of the label instead of re-labeling the
   * button (e.g. "Encrypting…") — keeps the button's meaning stable and
   * reads as faster/cleaner than swapping text mid-action. */
  loading?: boolean;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();

  const base: ViewStyle = {
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    opacity: disabled ? 0.55 : 1,
    flexDirection: "row",
    gap: 10,
  };

  const variants: Record<Variant, ViewStyle> = {
    primary: {
      backgroundColor: theme.primary,
      ...(Platform.OS === "ios"
        ? {
            shadowOpacity: 0.08,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
          }
        : {}),
    },
    outline: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: theme.border,
    },
    ghost: {
      backgroundColor: "transparent",
    },
  };

  const textStyles: Record<Variant, TextStyle> = {
    primary: {
      color: theme.bg,
      fontSize: 16,
      lineHeight: 20,
      fontFamily: FONT.semibold,
      letterSpacing: 0.1,
    },
    outline: {
      color: theme.text,
      fontSize: 16,
      lineHeight: 20,
      fontFamily: FONT.semibold,
      letterSpacing: 0.1,
    },
    ghost: {
      color: theme.muted,
      fontSize: 16,
      lineHeight: 20,
      fontFamily: FONT.medium,
      letterSpacing: 0.1,
    },
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      // Haptics is fire-and-forget on purpose. It used to be awaited before
      // calling onPress — but impactAsync REJECTS on devices/simulators
      // without a Taptic Engine, and the rejection meant onPress never ran.
      // That was the "I have to press this button five times" bug: the tap
      // registered, the handler just silently died before doing anything.
      onPress={() => {
        hapticTap();
        onPress();
      }}
      // A 54pt-tall pill already exceeds the 44pt minimum, but hitSlop makes
      // the near-miss taps at the very edge count too.
      hitSlop={8}
      android_ripple={{ color: theme.border }}
      style={({ pressed }) => [
        base,
        variants[variant],
        pressed && !disabled && !loading ? { transform: [{ scale: 0.99 }], opacity: 0.92 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textStyles[variant].color as string} />
      ) : (
        <Text style={textStyles[variant]}>{title}</Text>
      )}
    </Pressable>
  );
}
