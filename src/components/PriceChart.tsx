// src/components/PriceChart.tsx
//
// A price line. Nothing else.
//
// No candles, no volume bars, no axes, no gridlines, no crosshair, no
// indicators. This is a portfolio app — the question it answers is "roughly
// which way has this gone?", not "where should I enter?". Every element a
// trading chart has that this one doesn't was left out on purpose.
//
// Built on react-native-svg, which is already a dependency (the onboarding
// illustrations use it), so this adds no new package.
//
// One important honesty constraint: with a single data point, or with every
// point identical — which is the normal case for a token that hasn't traded
// today — there is no line to draw. Interpolating one anyway would invent a
// trend out of nothing, so those cases render a flat baseline and say so.
import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop, Circle } from "react-native-svg";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";

export type PriceChartProps = {
  points: { t: number; c: number }[];
  width: number;
  height?: number;
  loading?: boolean;
};

export function PriceChart({ points, width, height = 168, loading = false }: PriceChartProps) {
  const { theme } = useTheme();

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map((p) => p.c);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;

    // A completely flat series is real data, not an error — plot it down the
    // middle rather than dividing by zero and producing NaN paths.
    const flat = span === 0;

    // Inset so the stroke and the end dot aren't clipped at the edges.
    const padY = 10;
    const padX = 2;
    const usableW = Math.max(1, width - padX * 2);
    const usableH = Math.max(1, height - padY * 2);

    const x = (i: number) => padX + (i / (points.length - 1)) * usableW;
    const y = (v: number) => (flat ? padY + usableH / 2 : padY + (1 - (v - min) / span) * usableH);

    // Straight segments, not a spline. A smoothed curve through sparse points
    // draws price movements that never happened — on a market with a handful
    // of trades a day, that's not a cosmetic choice.
    let line = `M ${x(0)} ${y(values[0])}`;
    for (let i = 1; i < points.length; i++) line += ` L ${x(i)} ${y(values[i])}`;

    const area = `${line} L ${x(points.length - 1)} ${height} L ${x(0)} ${height} Z`;

    return {
      line,
      area,
      flat,
      lastX: x(points.length - 1),
      lastY: y(values[values.length - 1]),
      rising: values[values.length - 1] >= values[0],
    };
  }, [points, width, height]);

  if (loading) {
    return (
      <View style={{ width, height, justifyContent: "center" }}>
        {/* A hairline placeholder, not a spinner — the chart is decoration
            around the number above it, and a spinner here would imply the
            screen isn't usable yet when it entirely is. */}
        <View style={{ height: 2, backgroundColor: theme.border, borderRadius: 999 }} />
      </View>
    );
  }

  if (!geometry) {
    return (
      <View style={{ width, height, alignItems: "center", justifyContent: "center", gap: 10 }}>
        <View style={{ width: "100%", height: 2, backgroundColor: theme.border, borderRadius: 999 }} />
        <T variant="caption" color={theme.muted}>
          {points.length === 0 ? "No price history yet" : "No trades in this period"}
        </T>
      </View>
    );
  }

  // MARKET colours, not brand ones — green up, red down, by convention.
  // A flat line has no direction, so it stays neutral rather than claiming a
  // rise that didn't happen.
  const stroke = geometry.flat ? theme.muted : geometry.rising ? theme.positive : theme.negative;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.18} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* Fill first so the line sits on top of it. */}
        <Path d={geometry.area} fill="url(#priceFill)" />

        <Path
          d={geometry.line}
          stroke={stroke}
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Marks the latest value, which is the one the headline price shows. */}
        <Circle cx={geometry.lastX} cy={geometry.lastY} r={3.5} fill={stroke} />
      </Svg>
    </View>
  );
}
