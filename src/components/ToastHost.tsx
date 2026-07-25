// src/components/ToastHost.tsx
//
// Mounted once at the root (app/_layout.tsx). Renders whatever the global
// toast store currently holds, above every screen AND above native Modals
// — which is why it lives at the very top of the tree rather than inside
// individual screens.
import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useToast, type ToastKind } from "@/src/state/toast";

function iconFor(kind: ToastKind): keyof typeof Ionicons.glyphMap | null {
  if (kind === "success") return "checkmark-circle";
  if (kind === "error") return "alert-circle";
  return null;
}

export function ToastHost({ bottomOffset = 84 }: { bottomOffset?: number }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const message = useToast((s) => s.message);
  const kind = useToast((s) => s.kind);
  const visible = useToast((s) => s.visible);
  const nonce = useToast((s) => s.nonce);

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.6,
    }).start();
  }, [visible, nonce, anim]);

  if (!message) return null;

  const icon = iconFor(kind);
  const tint = kind === "error" ? theme.danger : kind === "success" ? theme.positive : theme.text;

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
          transform: [
            {
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
            },
            {
              scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }),
            },
          ],
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 11,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.bgElevated,
          shadowOpacity: 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 8,
          maxWidth: "92%",
        }}
      >
        {icon ? <Ionicons name={icon} size={17} color={tint} /> : null}
        <T weight="semibold" numberOfLines={2} style={{ flexShrink: 1 }}>
          {message}
        </T>
      </Animated.View>
    </View>
  );
}
