// src/theme/typography.ts
import { Platform } from "react-native";

export const FONT = {
  regular: "Lexend_400Regular",
  medium: "Lexend_500Medium",
  semibold: "Lexend_600SemiBold",
  bold: "Lexend_700Bold",
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as string,
} as const;

export const TEXT = {
  display: { fontSize: 40, lineHeight: 46, letterSpacing: -1 },
  h1: { fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  h2: { fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  title: { fontSize: 18, lineHeight: 24, letterSpacing: -0.1 },
  body: { fontSize: 16, lineHeight: 22 },
  label: { fontSize: 14, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  mono: { fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
} as const;
