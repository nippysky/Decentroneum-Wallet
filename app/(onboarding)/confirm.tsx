import { useTheme } from "@/src/theme/ThemeProvider";
import { Button } from "@/src/components/Button";
import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { OnboardingProgress } from "@/src/components/OnboardingProgress";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { RADIUS, SPACING } from "@/src/theme/tokens";

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Confirm() {
  const router = useRouter();
  const { theme } = useTheme();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();

  const words = useMemo(() => (mnemonic ?? "").split(" ").filter(Boolean), [mnemonic]);
  const pool = useMemo(() => shuffle(words.map((w, idx) => ({ id: `${w}-${idx}`, w }))), [words]);

  const [picked, setPicked] = useState<{ id: string; w: string }[]>([]);
  const [available, setAvailable] = useState(pool);

  const correctSoFar = picked.every((p, i) => p.w === words[i]);
  const complete = picked.length === words.length && correctSoFar;
  const hasMistake = picked.length > 0 && !correctSoFar;

  const pick = async (id: string) => {
    const item = available.find((x) => x.id === id);
    if (!item) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPicked((p) => [...p, item]);
    setAvailable((a) => a.filter((x) => x.id !== id));
  };

  const unpick = async (id: string) => {
    const item = picked.find((x) => x.id === id);
    if (!item) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPicked((p) => p.filter((x) => x.id !== id));
    setAvailable((a) => [...a, item]);
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <OnboardingProgress step={1} total={3} />

        <View style={{ height: SPACING.xxl }} />

        <T weight="bold" style={{ fontSize: 34, lineHeight: 40, letterSpacing: -1 }}>
          Confirm your phrase
        </T>

        <View style={{ height: SPACING.sm }} />

        <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
          Tap the words in the correct order.
        </T>

        <View style={{ height: SPACING.xl }} />

        {/* Selected — quiet underline area, not a bordered card */}
        <View
          style={{
            minHeight: 72,
            paddingBottom: SPACING.md,
            borderBottomWidth: 1.5,
            borderBottomColor: hasMistake ? theme.danger : theme.border,
          }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {picked.length === 0 ? (
              <T color={theme.muted}>No words selected yet.</T>
            ) : (
              picked.map((x, i) => (
                <Pressable
                  key={x.id}
                  onPress={() => unpick(x.id)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    borderRadius: RADIUS.md,
                    backgroundColor: theme.surface2,
                    flexDirection: "row",
                    gap: 7,
                    alignItems: "center",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <T variant="caption" weight="semibold" color={theme.muted}>
                    {i + 1}
                  </T>
                  <T weight="semibold">{x.w}</T>
                </Pressable>
              ))
            )}
          </View>
        </View>

        {hasMistake ? (
          <>
            <View style={{ height: SPACING.sm }} />
            <T variant="caption" color={theme.danger}>
              That’s not quite right — tap a word above to remove it.
            </T>
          </>
        ) : null}

        <View style={{ height: SPACING.xl }} />

        {/* Pool */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {available.map((x) => (
            <Pressable
              key={x.id}
              onPress={() => pick(x.id)}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 11,
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <T weight="semibold">{x.w}</T>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: "auto", paddingTop: SPACING.xl, gap: SPACING.md }}>
          <Button
            title="Continue"
            disabled={!complete}
            onPress={() => {
              // The vault (and setHasWallet()) is only written once the user
              // sets a passcode on the next screen — never mark a wallet as
              // "present" before it's actually encrypted and saved.
              router.push({ pathname: "/(onboarding)/passcode", params: { mnemonic } });
            }}
          />
          <Pressable
            onPress={() => router.replace("/(onboarding)/create")}
            style={{ alignSelf: "center", padding: SPACING.md }}
          >
            <T variant="caption" weight="semibold" color={theme.muted}>
              Start over
            </T>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
