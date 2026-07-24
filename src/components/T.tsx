// src/ui/T.tsx
import { useTheme } from "@/src/theme/ThemeProvider";
import { FONT, TEXT } from "@/src/theme/typography";
import React from "react";
import { Text, TextProps, TextStyle } from "react-native";

type Variant = keyof typeof TEXT;
type Weight = keyof typeof FONT;

export function T({
  variant = "body",
  weight = "regular",
  color,
  style,
  ...props
}: TextProps & {
  variant?: Variant;
  weight?: Weight;
  color?: string;
}) {
  const { theme } = useTheme();
  const s: TextStyle = {
    color: color ?? theme.text,
    fontFamily: FONT[weight],
    ...TEXT[variant],
  };

  return <Text {...props} style={[s, style]} />;
}
