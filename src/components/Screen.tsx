// src/ui/Screen.tsx
import { useTheme } from "@/src/theme/ThemeProvider";
import React from "react";
import { View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function Screen({
  children,
  style,
  edges = ["top", "bottom"],
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  edges?: ("top" | "bottom" | "left" | "right")[];
}) {
  const { theme } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[{ flex: 1, padding: 20 }, style]}>{children}</View>
    </SafeAreaView>
  );
}
