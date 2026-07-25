// src/ui/Screen.tsx
import { useTheme } from "@/src/theme/ThemeProvider";
import { SCREEN_PADDING } from "@/src/theme/tokens";
import React from "react";
import { View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function Screen({
  children,
  style,
  edges = ["top", "bottom"],
  padded = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  edges?: ("top" | "bottom" | "left" | "right")[];
  /** Set false when a screen wants to manage its own horizontal rhythm (e.g. full-bleed sections). */
  padded?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[{ flex: 1, padding: padded ? SCREEN_PADDING : 0 }, style]}>{children}</View>
    </SafeAreaView>
  );
}
