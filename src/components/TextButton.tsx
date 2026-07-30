// src/components/TextButton.tsx
//
// The app's secondary/tertiary action — "Back", "Start over", "Skip".
//
// Two problems this fixes, both reported as "the button doesn't work":
//
//  1. Invisible affordance. These used to be muted-grey text with no weight
//     and no boundary, which reads as a caption, not a control. People
//     didn't press them because they didn't look pressable.
//  2. Tiny hit area. A 12pt line of text is a 12pt-tall target. Apple's
//     minimum is 44pt and Android's is 48dp. Here the Pressable itself is
//     44pt tall and adds hitSlop on top, so the whole region around the
//     label is live — not just the glyphs.
import React from "react";
import { Pressable, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { hapticTap } from "@/src/lib/haptics";

type Tone = "default" | "accent" | "danger";

export function TextButton({
  title,
  onPress,
  icon,
  tone = "default",
  disabled,
  align = "center",
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** "accent" for the one action you actually want taken; "danger" for destructive. */
  tone?: Tone;
  disabled?: boolean;
  align?: "center" | "left";
  style?: ViewStyle;
}) {
  const { theme } = useTheme();

  const color = tone === "accent" ? theme.accent : tone === "danger" ? theme.danger : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={() => {
        hapticTap();
        onPress();
      }}
      hitSlop={10}
      style={({ pressed }) => [
        {
          minHeight: 44,
          alignSelf: align === "center" ? "center" : "flex-start",
          justifyContent: "center",
          paddingHorizontal: 18,
          borderRadius: 999,
          opacity: disabled ? 0.4 : pressed ? 0.55 : 1,
          backgroundColor: pressed && !disabled ? theme.surface2 : "transparent",
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Ionicons name={icon} size={15} color={color} /> : null}
        {/* semibold + full-contrast text, not muted — this is a control. */}
        <T weight="semibold" color={color} style={{ fontSize: 15, lineHeight: 20 }}>
          {title}
        </T>
      </View>
    </Pressable>
  );
}
