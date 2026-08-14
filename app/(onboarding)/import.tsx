// app/(onboarding)/import.tsx
import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import { hapticTap } from "@/src/lib/haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { Screen } from "@/src/components/Screen";
import { Button } from "@/src/components/Button";
import { T } from "@/src/components/T";
import { OnboardingProgress } from "@/src/components/OnboardingProgress";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useScreenGuard } from "@/src/lib/security/screenGuard";
import { SPACING } from "@/src/theme/tokens";

function normalizePhrase(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[\n\r,]+/g, " ")
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

  // A phrase being typed in is just as sensitive as one being displayed —
  // same guard as the create/confirm/view screens.
  useScreenGuard(true);

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
      hapticTap();
      ethers.HDNodeWallet.fromPhrase(cleaned);
      router.push({ pathname: "/(onboarding)/passcode", params: { mnemonic: cleaned } });
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
        <View style={{ flex: 1 }}>
          {/* Top row — single way back, no duplicate button at the bottom */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                marginLeft: -10,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? theme.surface2 : "transparent",
              })}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={24} color={theme.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <OnboardingProgress step={0} total={2} />
            </View>
          </View>

          <View style={{ height: SPACING.xxl }} />

          <T weight="bold" style={{ fontSize: 34, lineHeight: 40, letterSpacing: -1 }}>
            Import wallet
          </T>

          <View style={{ height: SPACING.sm }} />

          <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
            Paste your 12 or 24-word recovery phrase.
          </T>

          <View style={{ height: SPACING.xxl }} />

          {/* Input — quiet chrome, the content does the talking */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <T variant="caption" weight="semibold" color={theme.muted} style={{ letterSpacing: 0.3 }}>
              RECOVERY PHRASE
            </T>
            <Pressable
              onPress={async () => {
                const s = await Clipboard.getStringAsync();
                if (s.trim()) {
                  setPhrase(s.trim());
                  setError(null);
                }
              }}
              disabled={busy}
              hitSlop={10}
              style={({ pressed }) => ({
                minHeight: 36,
                paddingHorizontal: 14,
                borderRadius: 999,
                justifyContent: "center",
                backgroundColor: pressed ? theme.border : theme.surface2,
              })}
            >
              <T variant="caption" weight="semibold" color={theme.text}>
                Paste
              </T>
            </Pressable>
          </View>

          <View style={{ height: SPACING.sm }} />

          <View
            style={{
              borderRadius: 20,
              borderWidth: 1.5,
              borderColor: looksLikeMnemonic ? theme.accent : theme.border,
              backgroundColor: theme.card,
              padding: SPACING.lg,
            }}
          >
            <TextInput
              value={phrase}
              onChangeText={(t) => {
                setPhrase(t);
                setError(null);
              }}
              placeholder="word one, word two, word three…"
              placeholderTextColor={theme.muted}
              style={{
                color: theme.text,
                fontSize: 17,
                lineHeight: 26,
                minHeight: 128,
                textAlignVertical: "top",
              }}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardAppearance={theme.isDark ? "dark" : "default"}
              selectionColor={theme.accent}
              editable={!busy}
            />
          </View>

          <View style={{ height: SPACING.sm }} />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 18 }}>
            {words > 0 ? (
              <>
                <Ionicons
                  name={looksLikeMnemonic ? "checkmark-circle" : "ellipse-outline"}
                  size={13}
                  color={looksLikeMnemonic ? theme.accent : theme.muted}
                />
                <T variant="caption" color={looksLikeMnemonic ? theme.accent : theme.muted}>
                  {words} {words === 1 ? "word" : "words"}
                </T>
              </>
            ) : null}
          </View>

          {error ? (
            <>
              <View style={{ height: SPACING.sm }} />
              <T variant="caption" color={theme.danger}>
                {error}
              </T>
            </>
          ) : null}

          {/* Private-by-design note — one quiet line, no card, no icon box */}
          <View style={{ marginTop: "auto", paddingTop: SPACING.xl }}>
            <T variant="caption" color={theme.muted} style={{ textAlign: "center", marginBottom: SPACING.lg }}>
              Never shared, never uploaded — stays on this device.
            </T>
            <Button title="Continue" loading={busy} disabled={!canContinue} onPress={onContinue} />
          </View>

          <View style={{ height: insets.bottom + SPACING.md }} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
