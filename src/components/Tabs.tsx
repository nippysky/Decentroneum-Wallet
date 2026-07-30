// src/components/Tabs.tsx
//
// A small segmented control for splitting one screen's content in two.
//
// Exists because the token detail screen had four stacked sections — price,
// chart, details, activity — and reading the last one meant scrolling past
// everything else. Tabs turn "scroll a long way" into "make a choice", which
// is cheaper for the user and keeps the screen a fixed, calm height.
import React from "react";
import { Pressable, View } from "react-native";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { hapticSelect } from "@/src/lib/haptics";
import { RADIUS, SPACING } from "@/src/theme/tokens";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: theme.surface2,
        borderRadius: RADIUS.lg,
        padding: 3,
        gap: 3,
      }}
    >
      {tabs.map((tab) => {
        const active = tab === value;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              hapticSelect();
              onChange(tab);
            }}
            // Each tab is half the control, full height — the whole area is
            // the target, not just the word.
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 40,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: RADIUS.md,
              backgroundColor: active ? theme.bg : pressed ? theme.border : "transparent",
            })}
          >
            <T weight={active ? "bold" : "medium"} color={active ? theme.text : theme.muted} style={{ fontSize: 14 }}>
              {tab}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
