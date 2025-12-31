// app/(onboarding)/import.tsx
import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Screen } from "@/src/ui/Screen";
import { Button } from "@/src/ui/Button";
import { T } from "@/src/ui/T";
import { useTheme } from "@/src/theme/ThemeProvider";

function normalizePhrase(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[\n\r,]+/g, " ") // allow paste with newlines/commas, but treat as spaces
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(raw: string) {
  const clean = normalizePhrase(raw);
  if (!clean) return 0;
  return clean.split(" ").filter(Boolean).length;
}

export default function ImportWallet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = useMemo(() => countWords(phrase), [phrase]);
  const looksLikeMnemonic = words === 12 || words === 24;

  const canContinue = looksLikeMnemonic && !busy;

  const onContinue = async () => {
    if (busy) return;

    const cleaned = normalizePhrase(phrase);
    setError(null);

    if (!cleaned) {
      setError("Paste your recovery phrase.");
      return;
    }

    const wc = countWords(cleaned);
    if (wc !== 12 && wc !== 24) {
      setError("Recovery phrases are usually 12 or 24 words.");
      return;
    }

    try {
      setBusy(true);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Validates mnemonic format (throws if invalid)
      ethers.HDNodeWallet.fromPhrase(cleaned);

      router.push({
        pathname: "/(onboarding)/passcode",
        params: { mnemonic: cleaned },
      });
    } catch {
      setError("That recovery phrase doesn’t look valid. Check spelling and word order.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
      >
        <View style={{ flex: 1, gap: 14 }}>
          {/* Top row */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.card,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.85 : 1,
              })}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={20} color={theme.text} />
            </Pressable>
          </View>

          {/* Title */}
          <View style={{ gap: 6 }}>
            <T variant="h2" weight="bold" style={{ fontSize: 34, letterSpacing: -0.6 }}>
              Import wallet
            </T>
            <T color={theme.muted} style={{ fontSize: 16, lineHeight: 22 }}>
              Paste your recovery phrase. Separate words with{" "}
              <T weight="bold" style={{ color: theme.text }}>
                spaces
              </T>
              .
            </T>
          </View>

          {/* Info card */}
          <View
            style={{
              borderRadius: 22,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.card,
              padding: 16,
              flexDirection: "row",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.bg,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color={theme.text} />
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <T weight="semibold">Keep it private</T>
              <T variant="caption" color={theme.muted} style={{ lineHeight: 18 }}>
                Decent Wallet never uploads your phrase. Anyone with it can access your funds.
              </T>
            </View>
          </View>

          {/* Input */}
          <View style={{ gap: 10 }}>
            <T weight="semibold">Recovery phrase</T>

            <View
              style={{
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.card,
                padding: 14,
              }}
            >
              <TextInput
                value={phrase}
                onChangeText={(t) => {
                  setPhrase(t);
                  setError(null);
                }}
                placeholder="twelve words separated by spaces"
                placeholderTextColor={theme.muted}
                style={{
                  color: theme.text,
                  fontSize: 16,
                  lineHeight: 22,
                  minHeight: 120,
                  textAlignVertical: "top",
                }}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardAppearance={(theme as any).bg === "#060807" ? "dark" : "default"}
                selectionColor={theme.accent}
                editable={!busy}
              />

              <View style={{ height: 12 }} />

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <T variant="caption" color={theme.muted}>
                  Word count
                </T>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      backgroundColor: looksLikeMnemonic ? theme.success : theme.border,
                    }}
                  />
                  <T variant="caption" color={theme.muted}>
                    {words}
                  </T>
                </View>
              </View>
            </View>

            {error ? (
              <T color={(theme as any).danger ?? "#EF4444"} style={{ marginTop: 2 }}>
                {error}
              </T>
            ) : null}
          </View>

          {/* Bottom actions */}
          <View style={{ marginTop: "auto", gap: 12, paddingBottom: Math.max(insets.bottom, 14) }}>
            <Button
              title={busy ? "Checking…" : "Continue"}
              disabled={!canContinue}
              onPress={onContinue}
            />

            <Button title="Back" variant="outline" disabled={busy} onPress={() => router.back()} />

            <T
              variant="caption"
              color={theme.muted}
              style={{ textAlign: "center", lineHeight: 18 }}
            >
              Next: create a 6-digit passcode to encrypt your wallet on this device.
            </T>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
