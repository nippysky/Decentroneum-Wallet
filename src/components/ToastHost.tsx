// src/components/ToastHost.tsx
//
// Mounted once at the root (app/_layout.tsx) — the single toast for the whole
// app. Renders whatever the global toast store currently holds, above every
// screen. See the note at the return statement for why it is NOT wrapped in
// a native Modal (it froze the app), and what that costs.
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
    // DO NOT wrap this in a <Modal>.
    //
    // It was, briefly, so that one toast could also paint above native
    // sheets. That froze the entire app: on iOS a native Modal creates its
    // own window which captures touches at the native level, and
    // pointerEvents="none" on the JS children does NOT stop that. Every tap
    // went to an invisible window instead of the UI underneath.
    //
    // So this stays a plain root-level overlay. Consequence, accepted
    // deliberately: a toast fired from inside a native <Modal> is occluded
    // by that modal. That's a cosmetic miss on a handful of call sites,
    // which is a far better trade than an unresponsive app.
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
          // Small, tight pill. A toast is an aside, not an announcement —
          // it should register peripherally and get out of the way. Fully
          // rounded + compact padding keeps it feeling like a chip rather
          // than a card.
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.bgElevated,
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
          maxWidth: "86%",
        }}
      >
        {icon ? <Ionicons name={icon} size={13} color={tint} /> : null}
        <T weight="semibold" numberOfLines={1} style={{ flexShrink: 1, fontSize: 12.5, lineHeight: 16 }}>
          {message}
        </T>
      </Animated.View>
    </View>
  );
}
