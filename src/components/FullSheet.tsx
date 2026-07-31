// src/components/FullSheet.tsx
//
// The one sheet in the app. Full-screen, edge to edge, safe-area aware.
//
// Replaces the previous pattern of a translucent backdrop with a rounded card
// floating inside 18pt of padding — that left dead margin down both sides,
// showed a blurred slice of the screen behind it, and made every sheet look
// like a different size depending on how much content it had. A wallet is a
// serious app; a modal that only half-commits reads as a web page.
//
// Behaviour notes:
//  - `presentationStyle="overFullScreen"` + an opaque background: no visible
//    seam, no peek-through, no rounded-corner mismatch on tall Androids.
//  - Backdrop taps do NOT dismiss. There is no backdrop. Dismissal is the
//    explicit close control (and the Android hardware back button), because
//    every sheet here either spends money or reveals a secret.
//  - Content is wrapped in the safe area on both ends, so the header never
//    slides under the notch and the footer never sits under the home
//    indicator or a physical nav bar.
import React from "react";
import { Modal, Pressable, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { T } from "@/src/components/T";
import { ToastHost } from "@/src/components/ToastHost";
import { useTheme } from "@/src/theme/ThemeProvider";
import { SCREEN_PADDING, SPACING } from "@/src/theme/tokens";
import { hapticTap } from "@/src/lib/haptics";

export function FullSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  contentStyle,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned above the bottom safe area — put primary actions here. */
  footer?: React.ReactNode;
  contentStyle?: ViewStyle;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="overFullScreen"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* Header */}
        <View
          style={{
            paddingTop: insets.top + SPACING.sm,
            paddingHorizontal: SCREEN_PADDING,
            paddingBottom: title ? SPACING.md : SPACING.sm,
            flexDirection: "row",
            alignItems: "flex-start",
            gap: SPACING.md,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            {title ? (
              <T weight="bold" style={{ fontSize: 28, lineHeight: 34, letterSpacing: -0.8 }}>
                {title}
              </T>
            ) : null}
            {subtitle ? (
              <T color={theme.muted} style={{ fontSize: 15, lineHeight: 21 }}>
                {subtitle}
              </T>
            ) : null}
          </View>

          {/* 44pt circular close target — not a bare 18pt glyph. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => {
              hapticTap();
              onClose();
            }}
            hitSlop={10}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? theme.border : theme.surface2,
            })}
          >
            <Ionicons name="close" size={19} color={theme.text} />
          </Pressable>
        </View>

        {/* Body */}
        <View style={{ flex: 1, paddingHorizontal: SCREEN_PADDING, ...(contentStyle ?? {}) }}>
          {children}
        </View>

        {/* Footer — always clear of the home indicator / nav bar. */}
        {footer ? (
          <View
            style={{
              paddingHorizontal: SCREEN_PADDING,
              paddingTop: SPACING.md,
              paddingBottom: Math.max(insets.bottom, SPACING.md),
              gap: SPACING.sm,
            }}
          >
            {footer}
          </View>
        ) : (
          <View style={{ height: Math.max(insets.bottom, SPACING.md) }} />
        )}

        {/* A toast host INSIDE the sheet.
            
            A native Modal is its own window on both platforms — nothing in the
            React tree below it can paint above it, no matter what zIndex says.
            The root ToastHost therefore renders *behind* any open sheet, which
            is why "Recovery phrase copied" appeared to do nothing.
            
            Both hosts read the same store, so whichever is on top shows the
            same message; the one underneath is simply hidden by the sheet.
            That keeps the toast API unchanged — callers still just call
            toast.success() and never think about layering. */}
        <ToastHost />
      </View>
    </Modal>
  );
}
