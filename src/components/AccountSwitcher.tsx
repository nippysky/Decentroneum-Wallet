// src/components/AccountSwitcher.tsx
//
// Horizontal account switcher, Apple-Mail-style.
//
// Only the ACTIVE account is expanded and carries its label; the rest
// collapse to a compact index chip:
//
//     [● Account 1]  2  3  4  5
//
// Tapping a collapsed chip expands it while the previous one collapses, both
// animating together. That gives the row one focal point no matter how many
// accounts exist, and makes switching feel like a movement rather than a
// colour swap.
//
// IMPLEMENTATION NOTE — why React Native's core Animated and not Reanimated
// layout transitions:
// the first version used Reanimated's LinearTransition. Layout animations
// mutate the native view hierarchy, and under Fabric that is the single most
// fragile part of Reanimated — it can leave views in a state where touches
// stop landing, i.e. the app appears frozen. Core Animated only ever touches
// style values on views it owns, never the tree, so it cannot do that. The
// rest of this app (Toast, unlock pulse, HoldToConfirm) already animates this
// way without trouble, so this also keeps one animation approach throughout.
//
// The width is driven explicitly rather than measured, which is why each
// account gets a fixed expanded width based on its label length. Slightly
// less elegant than auto-layout, but entirely predictable — and it lets the
// label cross-fade cleanly instead of reflowing mid-flight.
import React, { useCallback, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, ScrollView, View } from "react-native";
import { hapticSelect } from "@/src/lib/haptics";

import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";

export type SwitchableAccount = {
  id: string;
  label: string;
  /**
   * Colour of the recovery phrase this account belongs to, when the wallet
   * holds more than one. Undefined for a single-phrase wallet, where there is
   * nothing to distinguish and a colour would just be decoration.
   */
  seedColor?: string;
};

const CHIP = 34; // collapsed diameter
const EXPAND_MS = 320;

/** Rough advance width per character at 13pt Inter semibold, plus dot + padding. */
function expandedWidthFor(label: string) {
  return Math.min(200, 46 + label.length * 7.2);
}

function AccountChip({
  account,
  index,
  active,
  onPress,
}: {
  account: SwitchableAccount;
  index: number;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();

  // 0 = collapsed, 1 = expanded. Initialised to the current state so the
  // first render doesn't animate in from nothing.
  const t = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(t, {
      toValue: active ? 1 : 0,
      duration: EXPAND_MS,
      // Gentle deceleration — an ease-out reads as settling rather than
      // stopping dead, which is what made the earlier version feel rigid.
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      // Width can't be driven natively, so this runs on the JS thread. It's
      // one small view, only on tap — not a per-frame cost anywhere hot.
      useNativeDriver: false,
    }).start();
  }, [active, t]);

  const expandedWidth = expandedWidthFor(account.label);

  return (
    <Pressable hitSlop={6}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? `${account.label}, selected` : `Switch to ${account.label}`}
    >
      <Animated.View
        style={{
          height: CHIP,
          width: t.interpolate({ inputRange: [0, 1], outputRange: [CHIP, expandedWidth] }),
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? theme.primary : theme.border,
          // theme.primary is the single app-wide emphasis colour: Onyx in
          // light mode, Neon in dark — same treatment as the Send button.
          backgroundColor: active ? theme.primary : "transparent",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {/* Expanded content and the collapsed index are cross-faded in the
            same box, so neither reflows the other while the width moves. */}
        <Animated.View
          style={{
            position: "absolute",
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            opacity: t,
          }}
        >
          {/* Carries the phrase's colour so the same account reads the same
              way here as in the grouped accounts list. Falls back to the
              chip's own foreground when there is only one phrase. */}
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: account.seedColor ?? theme.bg,
            }}
          />
          <T weight="semibold" numberOfLines={1} style={{ color: theme.bg, fontSize: 13 }}>
            {account.label}
          </T>
        </Animated.View>

        <Animated.View
          style={{
            position: "absolute",
            opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          }}
        >
          <T
            weight="semibold"
            style={{ color: account.seedColor ?? theme.muted, fontSize: 13 }}
          >
            {index + 1}
          </T>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export function AccountSwitcher({
  accounts,
  activeId,
  onSwitch,
}: {
  accounts: SwitchableAccount[];
  activeId: string | null;
  onSwitch: (account: SwitchableAccount) => void;
}) {
  const handlePress = useCallback(
    (a: SwitchableAccount, active: boolean) => {
      if (active) return;
      hapticSelect();
      onSwitch(a);
    },
    [onSwitch]
  );

  // One account has nothing to switch between — a switcher would be chrome.
  if (accounts.length <= 1) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 4, alignItems: "center" }}
    >
      {accounts.map((a, index) => {
        const active = a.id === activeId;
        return (
          <AccountChip
            key={a.id}
            account={a}
            index={index}
            active={active}
            onPress={() => handlePress(a, active)}
          />
        );
      })}
    </ScrollView>
  );
}
