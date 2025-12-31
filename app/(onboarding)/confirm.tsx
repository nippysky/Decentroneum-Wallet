import { setHasWallet } from "@/src/lib/vault";
import { useTheme } from "@/src/theme/ThemeProvider";
import { Button } from "@/src/ui/Button";
import { Screen } from "@/src/ui/Screen";
import { T } from "@/src/ui/T";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { View } from "react-native";

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
      <View style={{ gap: 14 }}>
        <T variant="h2" weight="bold">Confirm your phrase</T>
        <T color={theme.muted}>Tap the words in the correct order.</T>

        {/* Selected */}
        <View
          style={{
            padding: 14,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: correctSoFar ? theme.border : theme.danger ?? "#EF4444",
            backgroundColor: theme.card,
            minHeight: 84,
          }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {picked.length === 0 ? (
              <T color={theme.muted}>No words selected yet.</T>
            ) : (
              picked.map((x, i) => (
                <View
                  key={x.id}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.bg,
                    flexDirection: "row",
                    gap: 8,
                    alignItems: "center",
                  }}
                  onTouchEnd={() => unpick(x.id)}
                >
                  <T variant="caption" weight="semibold" color={theme.muted}>
                    {i + 1}
                  </T>
                  <T weight="semibold">{x.w}</T>
                </View>
              ))
            )}
          </View>
        </View>

        {/* Pool */}
        <View style={{ marginTop: 4 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {available.map((x) => (
              <View
                key={x.id}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.card,
                }}
                onTouchEnd={() => pick(x.id)}
              >
                <T weight="semibold">{x.w}</T>
              </View>
            ))}
          </View>
        </View>

        <View style={{ marginTop: 14, gap: 12 }}>
          <Button
            title="Finish setup"
            disabled={!complete}
            onPress={async () => {
              // In the next iteration we’ll store encrypted key material.
              await setHasWallet();
         router.replace({ pathname: "/passcode", params: { mnemonic } });

            }}
          />
          <Button
            title="Start over"
            variant="outline"
            onPress={() => router.replace("/(onboarding)/create")}
          />
        </View>
      </View>
    </Screen>
  );
}
