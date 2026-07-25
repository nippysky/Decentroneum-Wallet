import { createWallet } from "@/src/lib/chain/wallet";
import { useTheme } from "@/src/theme/ThemeProvider";
import { Button } from "@/src/components/Button";
import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { OnboardingProgress } from "@/src/components/OnboardingProgress";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { RADIUS, SPACING } from "@/src/theme/tokens";

export default function Create() {
  const router = useRouter();
  const { theme } = useTheme();
  const [mnemonic, setMnemonic] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const w = await createWallet();
      if (mounted) setMnemonic(w.mnemonic);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const words = useMemo(() => mnemonic.split(" ").filter(Boolean), [mnemonic]);

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <OnboardingProgress step={0} total={3} />

        <View style={{ height: SPACING.xxl }} />

        <T weight="bold" style={{ fontSize: 34, lineHeight: 40, letterSpacing: -1 }}>
          Your recovery phrase
        </T>

        <View style={{ height: SPACING.sm }} />

        <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
          Write these 12 words down, in order, somewhere safe.
        </T>

        <View style={{ height: SPACING.xl }} />

        {/* Phrase — clean 3-column grid, generous spacing, no heavy card chrome */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: SPACING.md, columnGap: "3%" }}>
          {words.length === 0
            ? [...Array(12)].map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: "31.33%",
                    height: 46,
                    borderRadius: RADIUS.md,
                    backgroundColor: theme.border,
                    opacity: 0.4,
                  }}
                />
              ))
            : words.map((w, i) => (
                <View
                  key={`${w}-${i}`}
                  style={{
                    width: "31.33%",
                    paddingVertical: 11,
                    paddingHorizontal: 10,
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: theme.border,
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 6,
                  }}
                >
                  <T variant="caption" color={theme.muted} style={{ fontSize: 11 }}>
                    {i + 1}
                  </T>
                  <T weight="semibold" numberOfLines={1} style={{ fontSize: 15 }}>
                    {w}
                  </T>
                </View>
              ))}
        </View>

        {words.length === 12 ? (
          <>
            <View style={{ height: SPACING.lg }} />
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(mnemonic);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                alignSelf: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={14} color={theme.muted} />
              <T variant="caption" weight="semibold" color={theme.muted}>
                {copied ? "Copied" : "Copy to clipboard"}
              </T>
            </Pressable>
          </>
        ) : null}

        {/* Safety note — one quiet line, not a boxed warning card */}
        <View style={{ marginTop: "auto", paddingTop: SPACING.xl }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: SPACING.lg }}>
            <Ionicons name="eye-off-outline" size={13} color={theme.muted} />
            <T variant="caption" color={theme.muted}>
              Don’t screenshot — screenshots can sync to the cloud.
            </T>
          </View>

          <Button
            title="I wrote it down"
            disabled={words.length !== 12}
            onPress={() => router.push({ pathname: "/(onboarding)/confirm", params: { mnemonic } })}
          />

          <Pressable onPress={() => router.back()} style={{ alignSelf: "center", padding: SPACING.md }}>
            <T variant="caption" weight="semibold" color={theme.muted}>
              Back
            </T>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
