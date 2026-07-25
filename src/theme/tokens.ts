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

// Light mode does NOT use the neon mark color (#4DEE54) as a UI accent —
// full-brightness neon reads loud/plasticky against a light background (it
// only "pops" correctly against dark ink, which is why the brand mark itself
// is neon-on-dark or dark-on-neon, never neon-on-white). For light-mode UI
// accents (buttons, progress indicators, focus states, positive amounts),
// use a deep shade of the same brand hue instead — same family, same
// identity, just tuned for the surface it sits on. Neon is reserved for dark
// mode and the literal brand mark (BRAND.neon below), never used as a light
// mode accent color.
const LIGHT_ACCENT = "#1B7A3B";

export const light: Theme = {
  bg: "#FAF7F2",
  bgElevated: "#FFFFFF",
  surface: "#FFFFFF",
  surface2: "#F1ECE4",
  text: "#0B1220",
  muted: "#6B7280",
  border: "#E6DED5",
  card: "#FFFFFF",
  primary: "#060807",
  accent: LIGHT_ACCENT,
  positive: LIGHT_ACCENT,
  negative: "#DC2626",
  success: LIGHT_ACCENT,
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

// Bumped up for a more spacious, premium feel — the old scale packed too
// tightly (this is a deliberate, considered increase, not a random bump).
export const SPACING = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  xxl: 36,
  xxxl: 52,
} as const;

// Standard horizontal screen-edge padding — use this instead of hardcoding
// 20/24 per screen, so every screen gets the same breathing room.
export const SCREEN_PADDING = 24;

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
