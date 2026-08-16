// src/components/SiteIcon.tsx
//
// A website's icon, with somewhere to fall back to.
//
// The browser previously used exactly one source — Google's s2 favicon
// service — and drew nothing when it came up empty. That is why ElectroSwap
// showed a blank circle: s2 has no icon for that domain, so the <Image> loaded
// a transparent placeholder and the row looked broken rather than unknown.
//
// Sources, tried in order, then a letter:
//
//   1. The site's OWN /favicon.ico. Privacy-first: this contacts only a host
//      the user is already looking at in the list, so browsing a site tells
//      no third party anything. Most sites serve it, so most rows never leave
//      first-party territory.
//   2. DuckDuckGo's icon service — good coverage for smaller domains, and it
//      is already the browser's search provider, so no new third party.
//   3. Google s2 — a different crawl, catches what DDG misses.
//   4. The domain's first letter on a tinted tile — always renders, always
//      distinguishes one row from the next.
//
// Steps 2-3 DO disclose the browsed domain to a third party. That is a real
// privacy cost, disclosed in the store listings, and the reason step 1 exists
// and goes first. If store review or policy ever makes even the fallback
// unacceptable, deleting lines from `sourcesFor` is the whole change.
//
// Nothing is bundled: these are remote icons for arbitrary sites, so there is
// nothing sensible to ship in the binary.
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS } from "@/src/theme/tokens";

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourcesFor(host: string): string[] {
  if (!host) return [];
  return [
    `https://${host}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  ];
}

export function SiteIcon({ url, size = 36 }: { url: string; size?: number }) {
  const { theme } = useTheme();
  const host = useMemo(() => hostOf(url), [url]);
  const sources = useMemo(() => sourcesFor(host), [host]);

  // Which source we're currently trying. Advancing past the end means every
  // remote option failed and the letter tile takes over.
  //
  // Keyed by url so a changed url resets the chain without an effect — an
  // effect that calls setState on mount would cascade a second render for
  // every icon in the list.
  const [state, setState] = useState({ url, attempt: 0 });
  const attempt = state.url === url ? state.attempt : 0;

  const uri = sources[attempt];
  const letter = (host[0] ?? "?").toUpperCase();

  const box = {
    width: size,
    height: size,
    borderRadius: RADIUS.md,
    backgroundColor: theme.surface2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };

  if (!uri) {
    return (
      <View style={box}>
        <T weight="bold" color={theme.muted} style={{ fontSize: size * 0.4 }}>
          {letter}
        </T>
      </View>
    );
  }

  return (
    <View style={box}>
      <Image
        // Re-mounting per attempt is what makes onError retry the NEXT source
        // rather than sit on the failed one.
        key={uri}
        source={{ uri }}
        style={{ width: size * 0.55, height: size * 0.55 }}
        contentFit="contain"
        transition={120}
        onError={() => setState({ url, attempt: attempt + 1 })}
      />
    </View>
  );
}
