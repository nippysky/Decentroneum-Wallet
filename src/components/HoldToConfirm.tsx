// src/ui/HoldToConfirm.tsx
import { hapticSuccess } from "@/src/lib/haptics";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ViewStyle } from "react-native";
import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";

export function HoldToConfirm({
  title = "Hold to confirm",
  holdingTitle = "Keep holding…",
  ms = 900,
  disabled,
  onConfirmed,
  style,
}: {
  title?: string;
  holdingTitle?: string;
  ms?: number;
  disabled?: boolean;
  onConfirmed: () => void;
  style?: ViewStyle;
}) {
  const { theme } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isHolding, setIsHolding] = useState(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const reset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setIsHolding(false);
    progress.stopAnimation();
    progress.setValue(0);
  };

  const start = () => {
    if (disabled) return;

    setIsHolding(true);
    progress.setValue(0);

    Animated.timing(progress, {
      toValue: 1,
      duration: ms,
      useNativeDriver: false,
    }).start();

    timerRef.current = setTimeout(async () => {
      reset();
      hapticSuccess();
      onConfirmed();
    }, ms);
  };

  return (
    <Pressable
      disabled={disabled}
      onPressIn={start}
      onPressOut={reset}
      style={({ pressed }) => ({
        height: 52,
        borderRadius: 14,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.primary,
        opacity: disabled ? 0.55 : pressed ? 0.95 : 1,
        ...style,
      })}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: progress.interpolate({
            inputRange: [0, 1],
            outputRange: ["0%", "100%"],
          }),
          // subtle “fill” overlay
          backgroundColor: theme.accent,
          opacity: 0.22,
        }}
      />
      <T weight="semibold" style={{ color: theme.bg, fontSize: 15 }}>
        {isHolding ? holdingTitle : title}
      </T>
    </Pressable>
  );
}
