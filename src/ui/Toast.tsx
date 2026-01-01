// src/ui/Toast.tsx
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/theme/ThemeProvider";
import { T } from "@/src/ui/T";

export function Toast({
  message,
  visible,
  bottomOffset = 84, // sits above floating tab bar nicely
}: {
  message: string;
  visible: boolean;
  bottomOffset?: number;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 150,
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const translateY = useMemo(
    () =>
      anim.interpolate({
        inputRange: [0, 1],
        outputRange: [10, 0],
      }),
    [anim]
  );

  if (!message) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: Math.max(insets.bottom, 10) + bottomOffset,
        alignItems: "center",
      }}
    >
      <Animated.View
        style={{
          opacity: anim,
          transform: [{ translateY }],
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.card,
          shadowOpacity: 0.08,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          maxWidth: "92%",
        }}
      >
        <T weight="semibold">{message}</T>
      </Animated.View>
    </View>
  );
}
