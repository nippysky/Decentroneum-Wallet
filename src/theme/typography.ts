// src/theme/typography.ts
export const FONT = {
  regular: "Lexend_400Regular",
  medium: "Lexend_500Medium",
  semibold: "Lexend_600SemiBold",
  bold: "Lexend_700Bold",
} as const;

export const TEXT = {
  h1: { fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  h2: { fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 12, lineHeight: 16 },
} as const;
