// app/(onboarding)/welcome.tsx
import React, { useMemo, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  View,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Image } from "expo-image";
import { useTheme } from "@/src/theme/ThemeProvider";
import { Screen } from "@/src/components/Screen";
import { Button } from "@/src/components/Button";
import { T } from "@/src/components/T";
import { ONBOARDING_ILLUSTRATIONS } from "@/src/components/illustrations/OnboardingIllustrations";

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
        title: "Your keys stay on\nyour phone.",
        body: "Decent Wallet is non-custodial. No accounts, no custody, no “reset password” that can leak your wallet.",
      },
      {
        key: "electroneum",
        kicker: "Electroneum-only",
        title: "Built for the\nElectroneum ecosystem.",
        body: "One network. Less confusion. Cleaner UX. You can hold ETN and ERC-20 tokens on Electroneum Smart Chain.",
      },
      {
        key: "accounts",
        kicker: "Multiple accounts",
        title: "Manage more than\none wallet.",
        body: "Create or import multiple accounts and switch between them instantly — all inside one app.",
      },
      {
        key: "browser",
        kicker: "Built-in browser & explorer",
        title: "Explore dApps,\ntrack every transaction.",
        body: "Approve dApp connections per-site, and follow your on-chain activity with a real block explorer built in.",
      },
      {
        key: "notifications",
        kicker: "Stay in the loop",
        title: "Know the moment\nfunds arrive.",
        body: "Turn on notifications and Decent Wallet will let you know as soon as you receive ETN or tokens.",
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
        width: active ? 18 : 8,
        height: 8,
        borderRadius: 999,
        backgroundColor: active ? theme.accent : theme.border,
        opacity: active ? 1 : 0.7,
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
      {/* Top brand header */}
      <View
        style={{
          paddingTop: insets.top + 14,
          paddingHorizontal: 20,
          paddingBottom: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Image source={require("@/assets/images/icon.png")} style={{ width: 42, height: 42 }} contentFit="cover" />
          </View>

          <View style={{ flex: 1 }}>
            <T
              weight="bold"
              numberOfLines={1}
              style={{
                fontSize: 28,
                lineHeight: 34, // ✅ prevents Lexend top clipping
                letterSpacing: -0.6,
                paddingTop: 2,
                ...(Platform.OS === "android"
                  ? ({ includeFontPadding: false } as any)
                  : null),
              }}
            >
              Decent Wallet
            </T>

            <T variant="caption" color={theme.muted} style={{ marginTop: 2 }}>
              Security-first • Electroneum-only
            </T>
          </View>
        </View>
      </View>

      {/* Slides */}
      <View
        style={{ flex: 1 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
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
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: 160, // space for bottom actions
              }}
            >
              <View style={{ gap: 12, flex: 1 }}>
                <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 4 }}>
                  <Illustration theme={theme} active={i === index} size={128} />
                </View>

                <View style={{ gap: 10 }}>
                  <T
                    variant="caption"
                    weight="semibold"
                    color={theme.muted}
                    style={{ letterSpacing: 0.3 }}
                  >
                    {item.kicker}
                  </T>

                  <T
                    weight="bold"
                    style={{
                      fontSize: 32,
                      lineHeight: 40,
                      letterSpacing: -1,
                    }}
                  >
                    {item.title}
                  </T>

                  <T
                    color={theme.muted}
                    style={{
                      fontSize: 17,
                      lineHeight: 24,
                      maxWidth: 340,
                    }}
                  >
                    {item.body}
                  </T>
                </View>
              </View>
            </View>
            );
          }}
        />
      </View>

      {/* Bottom actions + dots (layered) */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
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
            paddingTop: 10,
            paddingBottom: 12,
          }}
        >
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            {slides.map((_, i) => (
              <Pressable
                key={slides[i].key}
                onPress={() => goTo(i)}
                hitSlop={12}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                <Dot active={i === index} />
              </Pressable>
            ))}
          </View>
        </View>

        {/* Buttons */}
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <Button
            title="Create a new wallet"
            onPress={() => router.push("/(onboarding)/create")}
          />
          <Button
            title="I already have a wallet"
            variant="outline"
            onPress={() => router.push("/(onboarding)/import")}
          />

          <T
            variant="caption"
            color={theme.muted}
            style={{
              textAlign: "center",
              marginTop: 6,
              paddingHorizontal: 14,
            }}
          >
            Keep your recovery phrase private. Anyone with it can access your funds.
          </T>
        </View>
      </View>
    </Screen>
  );
}
