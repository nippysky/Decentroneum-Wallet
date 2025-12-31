import { createWallet } from "@/src/lib/wallet";
import { useTheme } from "@/src/theme/ThemeProvider";
import { Button } from "@/src/ui/Button";
import { Screen } from "@/src/ui/Screen";
import { T } from "@/src/ui/T";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

export default function Create() {
  const router = useRouter();
  const { theme } = useTheme();
  const [mnemonic, setMnemonic] = useState<string>("");

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
      <View style={{ gap: 14 }}>
        <T variant="h2" weight="bold">Your recovery phrase</T>
        <T color={theme.muted}>
          Write these 12 words down and keep them somewhere safe. Anyone with this phrase can control your wallet.
        </T>

        {/* Anti-screenshot “vibe” notice (we’ll add actual secure-screen hardening later) */}
        <View
          style={{
            marginTop: 6,
            padding: 12,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.card,
          }}
        >
          <T weight="semibold">Do not screenshot</T>
          <T color={theme.muted} style={{ marginTop: 6 }}>
            Screenshots can be backed up to the cloud. Use paper or a password manager.
          </T>
        </View>

        {/* Phrase card */}
        <View
          style={{
            marginTop: 8,
            padding: 14,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.card,
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
                    borderRadius: 14,
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
        </View>

        <View style={{ marginTop: 12, gap: 12 }}>
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
