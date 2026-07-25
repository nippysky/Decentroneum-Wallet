// src/components/CircleAction.tsx
//
// Big, deliberate, unboxed circular action buttons — used for Send/Receive
// on both the Home screen and per-token detail pages. Replaces the old
// two-stretched-pills-in-a-card pattern.
import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";

export function CircleAction({
  icon,
  label,
  onPress,
  primary,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({ alignItems: "center", gap: 8, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: primary ? theme.primary : theme.surface2,
        }}
      >
        <Ionicons name={icon} size={24} color={primary ? theme.bg : theme.text} />
      </View>
      <T variant="caption" weight="semibold">
        {label}
      </T>
    </Pressable>
  );
}
