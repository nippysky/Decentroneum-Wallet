// src/components/Skeleton.tsx
//
// Shared shimmer loading placeholder. Use anywhere content is being fetched
// (balances, token lists, tx history) instead of a spinner — a skeleton that
// roughly matches the shape of the real content reads as faster and feels
// more considered than a generic loading indicator.
import React, { useEffect } from "react";
import { View, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, Easing } from "react-native-reanimated";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS } from "@/src/theme/tokens";

export function Skeleton({
  width,
  height = 14,
  radius = RADIUS.sm,
  style,
}: {
  width: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 750, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 750, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.value * 0.28,
  }));

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius: radius, backgroundColor: theme.border },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** A row-shaped skeleton — icon circle + two lines — matching the app's common list-row layout. */
function SkeletonRow({ style }: { style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 }, style]}>
      <Skeleton width={40} height={40} radius={20} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="55%" height={14} />
        <Skeleton width="35%" height={11} />
      </View>
      <Skeleton width={56} height={14} />
    </View>
  );
}

