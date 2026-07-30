// app/(onboarding)/create.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { createWallet } from "@/src/lib/chain/wallet";
import { useTheme } from "@/src/theme/ThemeProvider";
import { Button } from "@/src/components/Button";
import { TextButton } from "@/src/components/TextButton";
import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { OnboardingProgress } from "@/src/components/OnboardingProgress";
import { useScreenGuard, useScreenshotWarning } from "@/src/lib/security/screenGuard";
import { toast } from "@/src/state/toast";
import { RADIUS, SPACING } from "@/src/theme/tokens";

export default function Create() {
  const router = useRouter();
  const { theme } = useTheme();
  const [mnemonic, setMnemonic] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Screenshots and screen recording are blocked for the whole life of this
  // screen — see screenGuard.ts for what each platform can actually promise.
  useScreenGuard(true);
  useScreenshotWarning(() => {
    // iOS can't stop the screenshot, only tell us it happened. Say so plainly
    // and tell them the one thing that fixes it.
    toast.error("Screenshot saved to your photos — delete it. Photos sync to the cloud.");
  });

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
  const ready = words.length === 12;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <OnboardingProgress step={0} total={3} />

        <View style={{ height: SPACING.xl }} />

        <T weight="bold" style={{ fontSize: 34, lineHeight: 40, letterSpacing: -1 }}>
          Your recovery phrase
        </T>

        <View style={{ height: SPACING.sm }} />

        <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
          Write these 12 words down, in order, somewhere safe.
        </T>

        <View style={{ height: SPACING.xl }} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.md }}>
          {/* Phrase — clean 3-column grid, no heavy card chrome. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: SPACING.md, columnGap: "3%" }}>
            {!ready
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

          {ready ? (
            <>
              <View style={{ height: SPACING.lg }} />
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(mnemonic);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                // 44pt target, not a 14pt line of text.
                hitSlop={12}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  alignSelf: "center",
                  minHeight: 44,
                  paddingHorizontal: 16,
                  borderRadius: 999,
                  backgroundColor: pressed ? theme.surface2 : "transparent",
                })}
              >
                <Ionicons name={copied ? "checkmark" : "copy-outline"} size={15} color={theme.text} />
                <T weight="semibold" style={{ fontSize: 14 }}>
                  {copied ? "Copied" : "Copy to clipboard"}
                </T>
              </Pressable>
            </>
          ) : null}
        </ScrollView>

        {/* Actions, pinned to the bottom. The old "Don't screenshot" caption
            is gone — screenshots are now blocked outright on Android and
            flagged on iOS, so a line of copy asking nicely was just taking
            up space. */}
        <View style={{ paddingTop: SPACING.md, gap: SPACING.xs }}>
          <Button
            title="I wrote it down"
            // Loading until the wallet has actually been generated — the tap
            // used to do nothing at all for a beat, which reads as a dead
            // button rather than as work in progress.
            loading={!ready}
            disabled={!ready}
            onPress={() => router.push({ pathname: "/(onboarding)/confirm", params: { mnemonic } })}
          />
          <TextButton title="Back" onPress={() => router.back()} />
        </View>
      </View>
    </Screen>
  );
}
