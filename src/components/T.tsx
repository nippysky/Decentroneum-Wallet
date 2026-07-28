// src/ui/T.tsx
import { useTheme } from "@/src/theme/ThemeProvider";
import { FONT, TEXT, VARIANT_WEIGHT } from "@/src/theme/typography";
import React from "react";
import { Text, TextProps, TextStyle } from "react-native";

type Variant = keyof typeof TEXT;
type Weight = keyof typeof FONT;

export function T({
  variant = "body",
  weight,
  color,
  style,
  ...props
}: TextProps & {
  variant?: Variant;
  /** Omit to inherit the variant's default weight (see VARIANT_WEIGHT). */
  weight?: Weight;
  color?: string;
}) {
  const { theme } = useTheme();

  // Weight now falls back to the VARIANT's default rather than always
  // "regular". Previously a `<T variant="h1">` with no explicit weight
  // rendered thin — fine with Lexend, spindly with Inter, and the kind of
  // thing that silently degrades every heading nobody remembered to mark up.
  const resolvedWeight: Weight = weight ?? VARIANT_WEIGHT[variant];

  const s: TextStyle = {
    color: color ?? theme.text,
    fontFamily: FONT[resolvedWeight],
    ...TEXT[variant],
  };

  return <Text {...props} style={[s, style]} />;
}
