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
      <View style={{ gap: SPACING.lg }}>
        <OnboardingProgress step={0} total={3} />

        <View style={{ gap: 6 }}>
          <T variant="h2" weight="bold">Your recovery phrase</T>
          <T color={theme.muted}>
            Write these 12 words down and keep them somewhere safe. Anyone with this phrase can control your wallet.
          </T>
        </View>

        {/* Anti-screenshot notice */}
        <View
          style={{
            flexDirection: "row",
            gap: SPACING.md,
            padding: SPACING.md,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: theme.warning,
            backgroundColor: theme.card,
          }}
        >
          <Ionicons name="eye-off-outline" size={18} color={theme.warning} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <T weight="semibold">Do not screenshot</T>
            <T variant="caption" color={theme.muted} style={{ marginTop: 4 }}>
              Screenshots can be backed up to the cloud. Use paper or a password manager instead.
            </T>
          </View>
        </View>

        {/* Phrase card */}
        <View
          style={{
            padding: SPACING.lg,
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.card,
            gap: SPACING.md,
          }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {words.length === 0 ? (
              <T color={theme.muted}>Generating…</T>
            ) : (
              words.map((w, i) => (
                <View
                  key={`${w}-${i}`}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.bg,
                    flexDirection: "row",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <T variant="caption" weight="semibold" color={theme.muted}>
                    {i + 1}
                  </T>
                  <T weight="semibold">{w}</T>
                </View>
              ))
            )}
          </View>

          {words.length === 12 ? (
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(mnemonic);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 10,
                borderRadius: RADIUS.md,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={15} color={theme.muted} />
              <T variant="caption" weight="semibold" color={theme.muted}>
                {copied ? "Copied" : "Copy to clipboard"}
              </T>
            </Pressable>
          ) : null}
        </View>

        <View style={{ marginTop: 4, gap: 12 }}>
          <Button
            title="I wrote it down"
            disabled={words.length !== 12}
            onPress={() => router.push({ pathname: "/(onboarding)/confirm", params: { mnemonic } })}
          />

          <Pressable onPress={() => router.back()} style={{ alignSelf: "center", padding: 10 }}>
            <T variant="caption" weight="semibold" color={theme.muted}>
              Back
            </T>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
