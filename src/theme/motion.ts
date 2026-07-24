// src/theme/motion.ts
// Shared motion language: precise and quick for financial actions (no bounce
// on anything money-related), springy only for navigation chrome.
import { Easing } from "react-native";

export const DURATION = {
  instant: 90,
  fast: 150,
  base: 220,
  slow: 320,
  slower: 420,
} as const;

export const EASE = {
  standard: Easing.bezier(0.2, 0.0, 0, 1),
  decel: Easing.out(Easing.cubic),
  accel: Easing.in(Easing.cubic),
} as const;

// Reanimated withSpring configs
export const SPRING = {
  snappy: { stiffness: 320, damping: 28, mass: 0.7 },
  gentle: { stiffness: 220, damping: 26, mass: 0.9 },
  nav: { stiffness: 260, damping: 26, mass: 0.9 },
} as const;
