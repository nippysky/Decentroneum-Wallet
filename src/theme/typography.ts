// src/theme/typography.ts
//
// INTER for UI, JETBRAINS MONO for anything hex.
//
// Inter is purpose-built for screen UI: tall x-height, and — the reason it
// matters here — unambiguous 1/l/I and 0/O plus real tabular figures, so
// balance columns line up instead of shimmying as digits change. It's
// deliberately neutral: it recedes and lets the neon do the branding, which
// is the opposite of Lexend (designed for reading proficiency, so friendly
// and rounded rather than financial).
//
// JetBrains Mono handles addresses, tx hashes and recovery phrases. In a
// wallet this is a correctness feature, not decoration: someone verifying
// an address before sending money needs 0 vs O and 1 vs l to be instantly
// distinguishable, and monospace makes the characters align so a
// transposition is visible. Previously this fell back to Menlo on iOS and
// whatever Android supplied, so the same address rendered differently on
// each platform.
export const FONT = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  mono: "JetBrainsMono_400Regular",
} as const;

// Scale tightened one step down across the board.
//
// The previous sizes were sized like a marketing page, not an app: 16pt body
// and 34pt headings meant every screen felt shouty and fit less. These are
// closer to native iOS metrics (17pt body is Apple's, but a wallet reads
// better slightly tighter) while staying comfortably above the ~11pt floor
// where legibility starts to suffer on small phones.
//
// Negative letter-spacing on the larger sizes is what keeps them feeling
// deliberate rather than merely small — big type set at default tracking
// looks loose and amateurish.
export const TEXT = {
  display: { fontSize: 34, lineHeight: 40, letterSpacing: -1 },
  h1: { fontSize: 27, lineHeight: 33, letterSpacing: -0.7 },
  h2: { fontSize: 19, lineHeight: 25, letterSpacing: -0.3 },
  title: { fontSize: 16, lineHeight: 21, letterSpacing: -0.15 },
  body: { fontSize: 14.5, lineHeight: 20 },
  label: { fontSize: 13, lineHeight: 17 },
  caption: { fontSize: 11.5, lineHeight: 15 },
  mono: { fontSize: 13, lineHeight: 19, letterSpacing: 0.1 },
} as const;

/**
 * Default weight per size — so headings are never accidentally thin.
 *
 * This exists because Inter renders visually lighter than Lexend did at the
 * same nominal weight: a heading that looked substantial before now reads as
 * spindly. Rather than hunting down every screen and adding weight="bold" by
 * hand (and inevitably missing some, and having new screens get it wrong),
 * the scale carries its own weight. Big type defaults to bold, small type to
 * regular, and any call site can still override explicitly.
 *
 * Large text needs MORE weight than small text to read as equally solid —
 * stroke thickness doesn't scale with point size, so a 34pt regular looks
 * thinner than a 14pt regular even though the font weight is identical.
 */
export const VARIANT_WEIGHT = {
  display: "bold",
  h1: "bold",
  h2: "bold",
  title: "semibold",
  body: "regular",
  label: "medium",
  caption: "medium",
  mono: "regular",
} as const satisfies Record<keyof typeof TEXT, keyof typeof FONT>;
