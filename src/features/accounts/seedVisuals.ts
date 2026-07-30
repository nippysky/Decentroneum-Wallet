// src/features/accounts/seedVisuals.ts
//
// One colour per recovery phrase, used everywhere a phrase or one of its
// accounts appears.
//
// A wallet holding two phrases has two independent backups, and mixing them
// up has real consequences: writing down phrase 1 and assuming phrase 2's
// accounts are safe is exactly how people lose money. Text alone ("Recovery
// phrase 2") is easy to skim past, so each phrase also carries a colour that
// stays with it across the accounts list, the switcher and the backup screen.
//
// The colour is assigned by POSITION, not by hashing the id — position is
// stable, human-orderable ("the green one is my second phrase"), and cannot
// collide. Hashing would occasionally hand two phrases near-identical hues,
// which is worse than useless for something whose only job is to distinguish.

/**
 * Deliberately not the brand green. These are identity markers, not status,
 * and must not be read as "good/bad" the way the market red/green is.
 */
const SEED_COLORS = [
  "#5B8DEF", // blue
  "#C77DFF", // violet
  "#F2994A", // amber
  "#2FBF71", // green
  "#EB5757", // red
] as const;

/** Colour for the Nth phrase in the wallet (0 = the onboarding phrase). */
export function seedColor(index: number): string {
  if (!Number.isInteger(index) || index < 0) return SEED_COLORS[0];
  return SEED_COLORS[index % SEED_COLORS.length];
}

/**
 * Short label for a phrase, e.g. "P1".
 *
 * Used where there is no room for "Recovery phrase 1" but the account still
 * has to be attributable — a colour alone fails for colour-blind users, so
 * the two always travel together.
 */
export function seedTag(index: number): string {
  return `P${index + 1}`;
}
