// src/components/WordMark.tsx
//
// The text lockup: "Decent" in the theme's foreground + a Neon/Onyx accent
// square. The brand is exactly two inverting colours, so the mark is the
// wordmark plus one solid shape — nothing that needs a separate asset, a
// light and dark variant, or a designer to resize.
import React from "react";
import { View, ViewStyle } from "react-native";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";

export function WordMark({ size = 18, style }: { size?: number; style?: ViewStyle }) {
  const { theme } = useTheme();
  const dot = Math.max(5, Math.round(size * 0.32));

  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: size * 0.34 }, style]}>
      <T
        weight="bold"
        style={{ fontSize: size, lineHeight: size * 1.15, letterSpacing: -size * 0.045 }}
      >
        Decent
      </T>
      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot * 0.28,
          backgroundColor: theme.accent,
        }}
      />
    </View>
  );
}
