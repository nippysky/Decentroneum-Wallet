// src/theme/tokens.ts
//
// Brand rule: only two legal treatments of the Decent mark —
//  A) neon green field (#4DEE54) + dark hexagon mark (#060807)
//  B) dark field (#060807) + neon hexagon mark (#4DEE54)
// Every color below is derived from those two anchors plus neutral greys.

export type Theme = {
  /**
   * Which end of the brand this palette is.
   *
   * Exists so nothing has to infer the mode by comparing a colour to a
   * literal — there were six `theme.bg === "#060807"` checks scattered
   * around the app, each of which silently became "always light mode" the
   * moment anyone touched the dark background value by a single digit.
   */
  isDark: boolean;
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
  /**
   * MARKET colours — up and down. Deliberately NOT brand colours.
   *
   * The brand is two inverting colours and nothing else, but a price chart is
   * the one place that rule has to bend: green-up / red-down is a convention
   * users read pre-attentively, and overriding it with a house palette makes
   * people misread their own portfolio. In light mode the brand accent is Onyx
   * (#131418) — a near-black — so a "rising" line drawn in it looked like a
   * plain black scribble with no meaning at all.
   *
   * Also used for genuine success/failure states (a valid address, a complete
   * recovery phrase, an incoming transfer) — same semantics, same reason: a
   * green tick that renders near-black communicates nothing.
   *
   * Everything that is not up/down or pass/fail stays on brand.
   */
  positive: string;
  negative: string;
  success: string;
  danger: string;
  warning: string;
  overlay: string;
  shadow: string;
};

// THE BRAND IS TWO COLORS. Nothing else.
//
//   Neon    #4DEE54  — the dark-mode accent (13.1:1 on the dark field)
//   Onyx    #131418  — the light-mode accent (16.6:1 on the cream field)
//
// They invert: whichever surface you're on, the accent is the other one.
//
// Onyx is a near-black charcoal, not a green. That's deliberate — it reads
// as quiet, expensive restraint, and it lets the neon be the *only* colour
// that ever shouts. This replaced a mid-tone forest green (#1B7A3B) which
// behaved as an unwanted third brand colour: too dark to feel like the neon,
// too saturated to feel like the ink, and slightly grubby on cream.
//
// Neon is never a light-mode accent — at full brightness on a light surface
// it reads loud and plasticky. It only pops against dark, which is why the
// brand mark is only ever neon-on-dark or dark-on-neon.
//
// There is no third accent colour. If you reach for one, use one of these.
const LIGHT_ACCENT = "#131418";

export const light: Theme = {
  isDark: false,
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
  // Green-600 / Red-600. Chosen for contrast on the cream field rather than
  // for brand fit — these are read, not admired.
  positive: "#16A34A",
  negative: "#DC2626",
  // Matches `positive` — success was previously the Onyx accent, which made
  // every confirmation tick render as a black mark that read as decoration
  // rather than approval.
  success: "#16A34A",
  danger: "#DC2626",
  warning: "#D97706",
  overlay: "rgba(11,18,32,0.45)",
  shadow: "rgba(11,18,32,0.10)",
};

export const dark: Theme = {
  isDark: true,
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
  // On the dark field the neon already reads as the conventional "up" green,
  // so brand and convention happen to agree here and there's no reason to
  // introduce a second green.
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

