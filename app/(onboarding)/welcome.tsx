// app/(onboarding)/welcome.tsx
//
// Onboarding, rebuilt.
//
// What changed and why:
//
//  - The old screen stacked five things vertically: illustration, kicker,
//    two-line headline, body paragraph, dot row, two buttons, legal text.
//    Eight elements competing on one screen reads as a brochure. This
//    version shows FOUR: mark, headline, one line of body, actions.
//
//  - Instead of five swipeable cards, the headline itself cycles. The
//    illustration stays put and the words change underneath it — so the
//    screen feels like one calm object being described from different
//    angles, rather than five screens you have to get through. There is
//    still a manual swipe, and the auto-advance stops the moment you touch
//    it, because auto-advancing under someone's finger is infuriating.
//
//  - Progress is a thin hairline that fills, not a row of dots. Dots ask
//    "how many are left?"; a line just quietly says "nearly done".
//
//  - Actions are pinned to the bottom of the screen, always in the same
//    place, never moving as the copy changes length.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { Screen } from "@/src/components/Screen";
import { Button } from "@/src/components/Button";
import { T } from "@/src/components/T";
import { ONBOARDING_ILLUSTRATIONS } from "@/src/components/illustrations/OnboardingIllustrations";
import { openInfoPage } from "@/src/lib/chain/openExplorer";
import { SCREEN_PADDING, SPACING } from "@/src/theme/tokens";

type Slide = {
  key: keyof typeof ONBOARDING_ILLUSTRATIONS;
  title: string;
  body: string;
};

const SLIDE_MS = 4200;

export default function Welcome() {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const slides: Slide[] = useMemo(
    () => [
      {
        key: "security",
        title: "Only you\nhold the keys.",
        // The old line was "Your keys stay on your phone", which reads to a
        // newcomer like "so if I lose my phone, I lose everything" — the
        // exact fear you must not leave hanging on slide one. This says the
        // same thing but leads with the guarantee and names the safety net.
        body: "Encrypted on your device, backed up by your recovery phrase.",
      },
      {
        key: "electroneum",
        title: "Built only for\nElectroneum.",
        body: "ETN and every ERC-20 token on the Smart Chain.",
      },
      {
        key: "accounts",
        title: "Keep your wallets\nseparate.",
        body: "Add accounts for savings, spending or work. Switch instantly.",
      },
      {
        key: "browser",
        title: "Use apps without\nleaving the wallet.",
        body: "A built-in browser. You approve every connection.",
      },
      {
        key: "notifications",
        title: "Know the moment\nfunds arrive.",
        body: "Instant alerts when you receive ETN or tokens.",
      },
    ],
    []
  );

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Crossfade the copy rather than sliding a carousel — no horizontal scroll
  // container means no rubber-banding, no paging math, and no chance of the
  // list and the dots disagreeing about which slide is showing.
  const fade = useRef(new Animated.Value(1)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  const goTo = useCallback(
    (next: number) => {
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(rise, { toValue: -8, duration: 160, useNativeDriver: true }),
      ]).start(() => {
        setIndex(((next % slides.length) + slides.length) % slides.length);
        rise.setValue(8);
        Animated.parallel([
          Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true }),
          Animated.timing(rise, {
            toValue: 0,
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
      });
    },
    [fade, rise, slides.length]
  );

  useEffect(() => {
    if (paused) return;
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: SLIDE_MS,
      easing: Easing.linear,
      useNativeDriver: false, // animating width
    });
    anim.start();
    const t = setTimeout(() => goTo(index + 1), SLIDE_MS);
    return () => {
      anim.stop();
      clearTimeout(t);
    };
  }, [index, paused, goTo, progress]);

  const slide = slides[index];
  const Illustration = ONBOARDING_ILLUSTRATIONS[slide.key];

  // Swipe left/right to move by hand. Touching anywhere stops the auto-play
  // for good — once someone is driving, taking the wheel back is rude.
  const startX = useRef(0);
  const takeOver = () => setPaused(true);

  const { width: screenW } = Dimensions.get("window");
  const trackW = screenW - SCREEN_PADDING * 2;

  return (
    // padded={false}: this screen manages its own horizontal rhythm on the
    // inner container. Leaving Screen's padding on as well double-applied
    // SCREEN_PADDING (24 + 24 = 48pt of side gutter), which is why the copy
    // used to sit in a narrow column in the middle of the screen.
    <Screen padded={false} edges={[]} style={{ flex: 1, backgroundColor: theme.bg }}>
      <View
        style={{ flex: 1, paddingHorizontal: SCREEN_PADDING }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => {
          startX.current = e.nativeEvent.pageX;
          takeOver();
        }}
        onResponderRelease={(e) => {
          const dx = e.nativeEvent.pageX - startX.current;
          if (Math.abs(dx) > 40) goTo(index + (dx < 0 ? 1 : -1));
        }}
      >
        <View style={{ height: insets.top + SPACING.lg }} />

        {/* Illustration holds the middle of the screen and does not move
            between slides; only its content swaps. */}
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ opacity: fade }}>
            <Illustration theme={theme} active size={200} />
          </Animated.View>
        </View>

        {/* Copy — two elements, no kicker. The kicker was a label for a
            headline that already said the same thing. */}
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>
          <T weight="bold" style={{ fontSize: 34, lineHeight: 39, letterSpacing: -1.3 }}>
            {slide.title}
          </T>
          <View style={{ height: SPACING.sm }} />
          <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23, maxWidth: 330 }}>
            {slide.body}
          </T>
        </Animated.View>

        <View style={{ height: SPACING.xl }} />

        {/* Progress hairline. Segments, so position is still legible, but
            weightless compared to a row of dots. */}
        <View style={{ flexDirection: "row", gap: 4 }}>
          {slides.map((s, i) => (
            <Pressable
              key={s.key}
              onPress={() => {
                takeOver();
                goTo(i);
              }}
              hitSlop={{ top: 14, bottom: 14, left: 2, right: 2 }}
              style={{ flex: 1 }}
            >
              <View style={{ height: 2, borderRadius: 999, backgroundColor: theme.border, overflow: "hidden" }}>
                {i < index ? (
                  <View style={{ flex: 1, backgroundColor: theme.accent }} />
                ) : i === index ? (
                  <Animated.View
                    style={{
                      height: 2,
                      backgroundColor: theme.accent,
                      width: paused
                        ? "100%"
                        : progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, Math.max(1, trackW / slides.length - 4)],
                          }),
                    }}
                  />
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>

        <View style={{ height: SPACING.xl }} />

        {/* Actions — pinned to the bottom, fixed position on every slide. */}
        <View style={{ gap: SPACING.sm, paddingBottom: Math.max(insets.bottom, SPACING.md) }}>
          <Button title="Create a new wallet" onPress={() => router.push("/(onboarding)/create")} />
          <Button
            title="I already have a wallet"
            variant="ghost"
            onPress={() => router.push("/(onboarding)/import")}
          />

          {/* Legal consent at the point of sign-up, as both stores expect for
              a financial app. openInfoPage (not openInApp) because the full
              dApp browser bounces to /unlock, and there is no passcode yet. */}
          <T
            variant="caption"
            color={theme.muted}
            style={{ textAlign: "center", fontSize: 11.5, lineHeight: 16 }}
          >
            By continuing you agree to our{" "}
            <T
              variant="caption"
              weight="semibold"
              color={theme.text}
              style={{ fontSize: 11.5, textDecorationLine: "underline" }}
              onPress={() => openInfoPage("https://decentroneum.com/terms")}
            >
              Terms
            </T>{" "}
            and{" "}
            <T
              variant="caption"
              weight="semibold"
              color={theme.text}
              style={{ fontSize: 11.5, textDecorationLine: "underline" }}
              onPress={() => openInfoPage("https://decentroneum.com/privacy")}
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
