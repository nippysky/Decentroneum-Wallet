// src/components/DragHandle.tsx
import React from "react";
import { View } from "react-native";
import { useTheme } from "@/src/theme/ThemeProvider";

/** The small pill at the top of a bottom sheet — signals "this is draggable/dismissible". */
export function DragHandle() {
  const { theme } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingBottom: 4 }}>
      <View style={{ width: 36, height: 4, borderRadius: 999, backgroundColor: theme.border }} />
    </View>
  );
}
