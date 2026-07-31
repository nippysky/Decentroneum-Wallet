// src/components/TokenLogo.tsx
//
// An asset's mark.
//
// ─── When there IS a logo, there is no container ────────────────────────────
//
// A token logo is already a finished piece of artwork: it has its own shape,
// its own background, its own padding. Wrapping it in a bordered, filled,
// clipped tile does three bad things at once — the border competes with the
// mark's own edge, the fill fights any transparency the artist intended, and
// `overflow: hidden` on a rounded box shaves the corners off any logo that
// isn't already a circle. That last one is why ETN's mark looked cropped.
//
// So: a real logo renders alone, at full size, with `contain` so nothing is
// ever cut off. The tile appears ONLY as the fallback, where there is no
// artwork and the initials need something to sit on.
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "@/src/theme/ThemeProvider";
import { T } from "@/src/components/T";

/**
 * Native ETN's mark, bundled rather than fetched.
 *
 * Every other logo comes from the token registry over the network, but the
 * chain's own currency appears on the first row of the first screen — it must
 * paint on the first frame, offline included, and it must never be able to
 * 404 into a grey "ET" box.
 */
const NATIVE_LOGO = require("@/assets/images/etn-logo.png");

export function TokenLogo({
  symbol,
  uri,
  /** Renders the bundled ETN mark; `uri` is ignored. */
  native,
  size = 36,
}: {
  symbol: string;
  uri?: string;
  native?: boolean;
  size?: number;
}) {
  const { theme } = useTheme();
  const [failed, setFailed] = useState(false);

  const initials = useMemo(() => (symbol || "?").slice(0, 2).toUpperCase(), [symbol]);

  // ── No artwork: the only case that gets a container ──────────────────────
  if (!native && (!uri || failed)) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.35),
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <T weight="bold" style={{ fontSize: Math.max(10, Math.round(size * 0.33)) }}>
          {initials}
        </T>
      </View>
    );
  }

  // ── Artwork: let it breathe ──────────────────────────────────────────────
  // `contain`, not `cover`: cover crops to fill, which trims the edges of any
  // logo whose aspect ratio isn't exactly square.
  return (
    <Image
      source={native ? NATIVE_LOGO : { uri }}
      style={{ width: size, height: size }}
      contentFit="contain"
      transition={140}
      onError={() => setFailed(true)}
    />
  );
}
