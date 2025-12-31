// app/(onboarding)/passcode.tsx
import React, { useMemo, useState } from "react";
import { View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/src/ui/Screen";
import { Button } from "@/src/ui/Button";
import { T } from "@/src/ui/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { saveVaultV1, setHasWallet } from "@/src/lib/vault";
import { useSession } from "@/src/state/session";
import { addressFromMnemonic } from "@/src/lib/derive";

function is6Digits(s: string) {
  return /^\d{6}$/.test(s);
}

export default function Passcode() {
  const router = useRouter();
  const { theme } = useTheme();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();

  const setUnlocked = useSession((s) => s.setUnlocked);

  const [step, setStep] = useState<1 | 2>(1);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const value = step === 1 ? pin : confirm;

  const canContinue = useMemo(() => {
    if (step === 1) return is6Digits(pin);
    return is6Digits(confirm) && confirm === pin;
  }, [step, pin, confirm]);

  const dots = (n: number) => Array.from({ length: 6 }).map((_, i) => i < n);

  const addDigit = (d: string) => {
    if (busy) return;
    if (value.length >= 6) return;

    if (step === 1) {
      setPin(value + d);
    } else {
      setConfirm(value + d);
    }
  };

  const delDigit = () => {
    if (busy) return;

    if (step === 1) {
      setPin(value.slice(0, -1));
    } else {
      setConfirm(value.slice(0, -1));
    }
  };

  const onNext = async () => {
    if (!mnemonic) return;

    if (step === 1) {
      setStep(2);
      return;
    }

    setBusy(true);
    try {
      await saveVaultV1(mnemonic, pin);
      await setHasWallet();

      // Mark in-memory session unlocked so we don't immediately ask for passcode again
      setUnlocked(mnemonic, addressFromMnemonic(mnemonic));

      router.replace("/(tabs)/wallet");
    } finally {
      setBusy(false);
    }
  };

  const onBack = () => {
    if (busy) return;

    if (step === 1) {
      router.back();
    } else {
      setStep(1);
      setConfirm("");
    }
  };

  return (
    <Screen>
      <View style={{ gap: 14, flex: 1 }}>
        <T variant="h2" weight="bold">
          {step === 1 ? "Create passcode" : "Confirm passcode"}
        </T>

        <T color={theme.muted}>
          This encrypts your wallet on this device. You’ll need it to unlock Decent Wallet.
        </T>

        {/* Dots */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10, marginBottom: 8 }}>
          {dots(value.length).map((filled, i) => (
            <View
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                backgroundColor: filled ? theme.accent : theme.border,
              }}
            />
          ))}
        </View>

        {/* Keypad */}
        <View style={{ gap: 10, marginTop: 8 }}>
          {[
            ["1", "2", "3"],
            ["4", "5", "6"],
            ["7", "8", "9"],
            ["", "0", "del"],
          ].map((row, r) => (
            <View key={r} style={{ flexDirection: "row", gap: 10 }}>
              {row.map((k) => {
                const isDel = k === "del";
                const disabled = k === "";

                return (
                  <Pressable
                    key={k || `empty-${r}`}
                    disabled={disabled || busy}
                    onPress={() => {
                      if (isDel) delDigit();
                      else addDigit(k);
                    }}
                    style={({ pressed }) => [
                      {
                        flex: 1,
                        height: 56,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: theme.border,
                        backgroundColor: theme.card,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: disabled ? 0 : 1,
                      },
                      pressed ? { opacity: 0.85 } : null,
                    ]}
                  >
                    <T weight="semibold" style={{ fontSize: 18 }}>
                      {isDel ? "⌫" : k}
                    </T>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Error */}
        {step === 2 && confirm.length === 6 && confirm !== pin ? (
          <T color={(theme as any).danger ?? "#EF4444"}>Passcodes don’t match.</T>
        ) : null}

        {/* Actions */}
        <View style={{ marginTop: "auto", gap: 12 }}>
          <Button
            title={busy ? "Encrypting…" : step === 1 ? "Continue" : "Finish setup"}
            disabled={!canContinue || busy}
            onPress={onNext}
          />

          <Button title="Back" variant="outline" disabled={busy} onPress={onBack} />
        </View>
      </View>
    </Screen>
  );
}
