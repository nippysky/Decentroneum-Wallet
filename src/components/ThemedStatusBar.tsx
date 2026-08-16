// src/components/ThemedStatusBar.tsx
//
// The clock, battery and signal icons, coloured to match OUR theme.
//
// ─── Why this exists ────────────────────────────────────────────────────────
//
// Nothing in the app was setting the status bar style, so it followed the
// SYSTEM appearance. That is only correct while the two agree. Settings lets
// someone pin the app to Light or Dark independently, so a phone in Dark mode
// with the app set to Light rendered white status text on our cream
// background — invisible. The reverse (dark glyphs on the near-black
// background) is just as bad.
//
// The rule: the status bar follows `resolvedMode`, which is the theme the app
// is ACTUALLY painting — not the OS preference, and not the raw `mode` (which
// can be "system" and says nothing about which way that resolved).
//
// ─── Why React Native's StatusBar and not expo-status-bar ───────────────────
//
// expo-status-bar is a thin wrapper over this same API. It would be one more
// dependency for a component we can write in ten lines, and this app has a
// standing preference against carrying weight it doesn't need.
//
// Only `barStyle` is set. Android background colour and translucency are
// deliberately left to the platform: this app is edge-to-edge, and forcing a
// status bar background there both fights that and warns on modern RN.
import React from "react";
import { StatusBar } from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";

export function ThemedStatusBar() {
  const { resolvedMode } = useTheme();

  return (
    <StatusBar
      // Dark theme → light glyphs, and vice versa. Named for what is DRAWN,
      // which is the opposite of the background it sits on — the classic way
      // to get this backwards.
      barStyle={resolvedMode === "dark" ? "light-content" : "dark-content"}
      // Cross-fades when the theme changes rather than snapping, so switching
      // in Settings doesn't flash.
      animated
    />
  );
}
