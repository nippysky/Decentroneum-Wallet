// src/ui/Button.tsx
import { useTheme } from "@/src/theme/ThemeProvider";
import { FONT } from "@/src/theme/typography";
import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, Text, TextStyle, ViewStyle } from "react-native";

type Variant = "primary" | "outline" | "ghost";

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();

  const base: ViewStyle = {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
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
      disabled={disabled}
      onPress={async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      android_ripple={{ color: theme.border }}
      style={({ pressed }) => [
        base,
        variants[variant],
        pressed && !disabled ? { transform: [{ scale: 0.99 }], opacity: 0.92 } : null,
        style,
      ]}
    >
      <Text style={textStyles[variant]}>{title}</Text>
    </Pressable>
  );
}
