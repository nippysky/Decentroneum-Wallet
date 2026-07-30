// src/components/ChangeIndicator.tsx
//
// The "▲ 1.73% today" figure. One implementation so the rule can't drift
// between the home screen and the token screen.
//
// The rule that matters: ZERO IS NOT UP.
//
// A naive `change >= 0 ? green : red` paints an unchanged price green with a
// rising arrow, which is a small lie told confidently — DCNT hasn't traded in
// days and was being reported as gaining. Flat gets a neutral colour and a
// dash, the same treatment PriceChart gives a flat line.
//
// "Zero" here means zero AS DISPLAYED, not zero as stored. A change of
// 0.004% renders as "0.00%", so colouring it green would show a green arrow
// next to a number that reads as no change at all. The threshold is tied to
// the rounding, so what you see and how it's coloured can never disagree.
import React from "react";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";

/** Below this, the figure rounds to 0.00% and is treated as flat. */
const FLAT_THRESHOLD = 0.005;

export function ChangeIndicator({
  /** Percent change, e.g. 1.73 for +1.73%. Null renders nothing. */
  change,
  /** Appended after the percentage, e.g. "today". */
  suffix,
  size = 14,
}: {
  change: number | null | undefined;
  suffix?: string;
  size?: number;
}) {
  const { theme } = useTheme();

  if (change === null || change === undefined || !Number.isFinite(change)) return null;

  const flat = Math.abs(change) < FLAT_THRESHOLD;
  const up = change > 0;

  const color = flat ? theme.muted : up ? theme.positive : theme.negative;
  const arrow = flat ? "–" : up ? "▲" : "▼";

  return (
    <T weight="semibold" color={color} style={{ fontSize: size }}>
      {arrow} {Math.abs(change).toFixed(2)}%{suffix ? ` ${suffix}` : ""}
    </T>
  );
}
