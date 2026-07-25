// app/(onboarding)/welcome.tsx
import React, { useMemo, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  View,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { Screen } from "@/src/components/Screen";
import { Button } from "@/src/components/Button";
import { T } from "@/src/components/T";
import { ONBOARDING_ILLUSTRATIONS } from "@/src/components/illustrations/OnboardingIllustrations";
import { openInApp } from "@/src/lib/chain/openExplorer";
import { SCREEN_PADDING, SPACING } from "@/src/theme/tokens";

type Slide = {
  key: keyof typeof ONBOARDING_ILLUSTRATIONS;
  kicker: string;
  title: string;
  body: string;
};

export default function Welcome() {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const slides: Slide[] = useMemo(
    () => [
      {
        key: "security",
        kicker: "Security-first",
        title: "Your keys stay\non your phone.",
        body: "Non-custodial. No “reset password” that can leak your wallet.",
      },
      {
        key: "electroneum",
        kicker: "Electroneum-only",
        title: "One network,\ndone right.",
        body: "Hold ETN and ERC-20 tokens on Electroneum Smart Chain.",
      },
      {
        key: "accounts",
        kicker: "Multiple accounts",
        title: "More than\none wallet.",
        body: "Create or import accounts, switch instantly, all in one app.",
      },
      {
        key: "browser",
        kicker: "Web3 browser",
        title: "Browse dApps,\nconnect instantly.",
        body: "Built-in browser with WalletConnect support — approve connections per site.",
      },
      {
        key: "notifications",
        kicker: "Stay in the loop",
        title: "Know the moment\nfunds arrive.",
        body: "Get notified instantly when you receive ETN or tokens.",
      },
    ],
    []
  );

  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(Dimensions.get("window").width);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / Math.max(1, width));
    setIndex(Math.min(slides.length - 1, Math.max(0, i)));
  };

  const goTo = (i: number) => {
    const clamped = Math.min(slides.length - 1, Math.max(0, i));
    setIndex(clamped);
    listRef.current?.scrollToOffset({ offset: clamped * width, animated: true });
  };

  const Dot = ({ active }: { active: boolean }) => (
    <View
      style={{
        width: active ? 20 : 6,
        height: 6,
        borderRadius: 999,
        backgroundColor: active ? theme.accent : theme.border,
      }}
    />
  );

  return (
    <Screen
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        paddingTop: 0,
        paddingBottom: 0,
      }}
    >
      {/* No header chrome — the slide itself is the whole screen. */}
      <View style={{ height: insets.top + SPACING.md }} />

      {/* Slides — a normal flex column per slide (illustration: flex:1 centered,
          copy: natural height, pinned above the bottom actions via paddingBottom
          on the slide itself). This is the standard, reliable RN pattern; the
          previous illustration-not-showing bug was NOT a layout issue — it was
          animating the <Svg> root directly (see OnboardingIllustrations.tsx),
          which silently fails to paint on Fabric. That's fixed there now. */}
      <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <FlatList
          ref={listRef}
          data={slides}
          keyExtractor={(s) => s.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onMomentumScrollEnd={onMomentumEnd}
          extraData={index}
          renderItem={({ item, index: i }) => {
            const Illustration = ONBOARDING_ILLUSTRATIONS[item.key];
            return (
              <View
                style={{
                  width,
                  flex: 1,
                  paddingHorizontal: SCREEN_PADDING,
                  paddingBottom: 288, // clears dots + buttons + caption + safe area + the extra breathing room added below
                }}
              >
                {/* Top-anchored, not centered — the leftover space below the
                    copy becomes breathing room above the buttons instead of
                    a dead gap above the icon. */}
                <View style={{ alignItems: "center", paddingTop: SPACING.xl, paddingBottom: SPACING.xxl }}>
                  <Illustration theme={theme} active={i === index} size={188} />
                </View>

                <View>
                  <T variant="caption" weight="semibold" color={theme.accent} style={{ letterSpacing: 0.4 }}>
                    {item.kicker.toUpperCase()}
                  </T>

                  <View style={{ height: SPACING.xs }} />

                  <T weight="bold" style={{ fontSize: 32, lineHeight: 38, letterSpacing: -1.1 }}>
                    {item.title}
                  </T>

                  <View style={{ height: SPACING.sm }} />

                  <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23, maxWidth: 320 }}>
                    {item.body}
                  </T>
                </View>
              </View>
            );
          }}
        />
      </View>

      {/* Bottom actions + dots (layered) — pushed further down via paddingTop
          so the buttons sit closer to the true bottom edge, using space that
          was previously just sitting empty, and opening up more air between
          the slide copy above and the dots. */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingTop: SPACING.xxxl,
          paddingBottom: Math.max(insets.bottom, 14),
        }}
      >
        {/* Subtle fade behind buttons in dark mode (Apple-y) */}
        {theme.bg === "#060807" ? (
          <LinearGradient
            colors={["rgba(6,8,7,0)", "rgba(6,8,7,0.55)", "rgba(6,8,7,0.95)"]}
            locations={[0, 0.35, 1]}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 220,
            }}
          />
        ) : null}

        {/* Dots */}
        <View
          style={{
            alignItems: "center",
            justifyContent: "center",
            paddingBottom: SPACING.lg,
          }}
        >
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            {slides.map((_, i) => (
              <Pressable
                key={slides[i].key}
                onPress={() => goTo(i)}
                hitSlop={12}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Dot active={i === index} />
              </Pressable>
            ))}
          </View>
        </View>

        {/* Buttons */}
        <View style={{ paddingHorizontal: SCREEN_PADDING, gap: SPACING.md }}>
          <Button title="Create a new wallet" onPress={() => router.push("/(onboarding)/create")} />
          <Button title="I already have a wallet" variant="outline" onPress={() => router.push("/(onboarding)/import")} />

          <T
            variant="caption"
            color={theme.muted}
            style={{
              textAlign: "center",
              marginTop: SPACING.sm,
              paddingHorizontal: SPACING.md,
            }}
          >
            Keep your recovery phrase private. Anyone with it can access your funds.
          </T>

          {/* Legal consent shown BEFORE wallet creation, not buried in
              Settings — both app stores expect terms to be reachable at the
              point of sign-up for a financial app. */}
          <T
            variant="caption"
            color={theme.muted}
            style={{ textAlign: "center", paddingHorizontal: SPACING.md }}
          >
            By continuing you agree to our{" "}
            <T
              variant="caption"
              weight="semibold"
              color={theme.accent}
              onPress={() => openInApp("https://decentroneum.com/terms")}
            >
              Terms of Service
            </T>{" "}
            and{" "}
            <T
              variant="caption"
              weight="semibold"
              color={theme.accent}
              onPress={() => openInApp("https://decentroneum.com/privacy")}
            >
              Privacy Policy
            </T>
            .
          </T>
        </View>
      </View>
    </Screen>
  );
}
