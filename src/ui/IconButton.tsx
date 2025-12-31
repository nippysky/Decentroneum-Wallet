// src/ui/IconButton.tsx
import React from "react";
import { Pressable, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/src/theme/ThemeProvider";

export function IconButton({
  icon,
  onPress,
  variant = "soft",
  disabled,
  style,
  accessibilityLabel,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  variant?: "soft" | "ghost";
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();

  const base: ViewStyle = {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    opacity: disabled ? 0.5 : 1,
  };

  const variants: Record<string, ViewStyle> = {
    soft: { backgroundColor: theme.border, borderWidth: 1, borderColor: theme.border },
    ghost: { backgroundColor: "transparent" },
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        base,
        variants[variant],
        pressed && !disabled ? { transform: [{ scale: 0.98 }], opacity: 0.9 } : null,
        style,
      ]}
    >
      <Ionicons name={icon} size={18} color={theme.text} />
    </Pressable>
  );
}
