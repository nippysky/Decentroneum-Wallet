// src/theme/tokens.ts
//
// Brand rule: only two legal treatments of the Decent mark —
//  A) neon green field (#4DEE54) + dark hexagon mark (#060807)
//  B) dark field (#060807) + neon hexagon mark (#4DEE54)
// Every color below is derived from those two anchors plus neutral greys.

export type Theme = {
  bg: string;
  bgElevated: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  border: string;
  card: string;
  primary: string;
  accent: string;
  positive: string;
  negative: string;
  success: string;
  danger: string;
  warning: string;
  overlay: string;
  shadow: string;
};

export const light: Theme = {
  bg: "#FAF7F2",
  bgElevated: "#FFFFFF",
  surface: "#FFFFFF",
  surface2: "#F1ECE4",
  text: "#0B1220",
  muted: "#6B7280",
  border: "#E6DED5",
  card: "#FFFFFF",
  primary: "#0B1220",
  accent: "#4DEE54",
  positive: "#4DEE54",
  negative: "#DC2626",
  success: "#4DEE54",
  danger: "#DC2626",
  warning: "#D97706",
  overlay: "rgba(11,18,32,0.45)",
  shadow: "rgba(11,18,32,0.10)",
};

export const dark: Theme = {
  bg: "#060807",
  bgElevated: "#0E1210",
  surface: "#0B0F0C",
  surface2: "#12160F",
  text: "#EAFBEA",
  muted: "#9AA49A",
  border: "#1B1F1C",
  card: "#0B0F0C",
  primary: "#4DEE54",
  accent: "#4DEE54",
  positive: "#4DEE54",
  negative: "#F87171",
  success: "#4DEE54",
  danger: "#F87171",
  warning: "#FBBF24",
  overlay: "rgba(0,0,0,0.55)",
  shadow: "rgba(0,0,0,0.45)",
};

// Fixed brand anchors (do not swap with theme — used where the raw mark colors are required
// regardless of light/dark mode, e.g. the app icon preview or brand lockups).
export const BRAND = {
  neon: "#4DEE54",
  ink: "#060807",
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const RADIUS = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 28,
  pill: 999,
} as const;

export function gradientHero(theme: Theme): [string, string] {
  return theme.bg === dark.bg ? ["#0B1F0D", "#060807"] : ["#EAF9EC", "#FAF7F2"];
}
