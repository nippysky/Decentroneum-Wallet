// src/components/RangePicker.tsx
//
// The 1D / 1W / 1M / 1Y selector under a price chart.
import React from "react";
import { Pressable, View } from "react-native";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { hapticSelect } from "@/src/lib/haptics";
import { CHART_RANGES, type ChartRange } from "@/src/state/market";

export function RangePicker({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (range: ChartRange) => void;
}) {
  const { theme } = useTheme();

  return (
    <View style={{ flexDirection: "row", justifyContent: "center", gap: 4 }}>
      {CHART_RANGES.map((range) => {
        const active = range === value;
        return (
          <Pressable
            key={range}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              hapticSelect();
              onChange(range);
            }}
            hitSlop={8}
            // 40pt tall and 52pt wide — the labels are only three characters,
            // so without an explicit size these would be sub-20pt targets.
            style={({ pressed }) => ({
              minWidth: 52,
              minHeight: 40,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              backgroundColor: active ? theme.surface2 : pressed ? theme.surface2 : "transparent",
            })}
          >
            <T
              weight={active ? "bold" : "medium"}
              color={active ? theme.text : theme.muted}
              style={{ fontSize: 13 }}
            >
              {range}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
