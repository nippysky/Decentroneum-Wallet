// app/(onboarding)/passcode.tsx
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { hapticError, hapticSelect } from "@/src/lib/haptics";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { TextButton } from "@/src/components/TextButton";
import { OnboardingProgress } from "@/src/components/OnboardingProgress";
import { PreparingWallet } from "@/src/components/PreparingWallet";
import { PasscodePad, isFullPasscode } from "@/src/components/PasscodePad";
import { useTheme } from "@/src/theme/ThemeProvider";
import { initializeVault } from "@/src/lib/crypto/vault";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { toast } from "@/src/state/toast";
import { SPACING } from "@/src/theme/tokens";

export default function Passcode() {
  const router = useRouter();
  const { theme } = useTheme();
  const { mnemonic } = useLocalSearchParams<{ mnemonic: string }>();

  const [step, setStep] = useState<1 | 2>(1);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  const value = step === 1 ? pin : confirm;
  const setValue = step === 1 ? setPin : setConfirm;

  const finishSetup = async (finalPin: string) => {
    if (!mnemonic) return;
    setBusy(true);
    try {
      const { key, accounts, seeds, activeAccountId } = await initializeVault(finalPin, {
        mnemonic,
        label: "Account 1",
      });
      useAccounts.getState().setAccounts(accounts, seeds, activeAccountId);
      useSession.setState({ isUnlocked: true, vaultKey: key });
      router.replace("/(tabs)/wallet");
    } catch (e: any) {
      // Never leave the user on a frozen progress screen — drop the cover,
      // reset to step 1, and say what happened.
      setConfirm("");
      setStep(1);
      setPin("");
      toast.error(e?.message ?? "Couldn't finish setting up your wallet. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Advance / finish automatically the moment the 6th digit lands.
  useEffect(() => {
    if (busy) return;

    if (step === 1 && isFullPasscode(pin)) {
      const t = setTimeout(() => {
        hapticSelect();
        setStep(2);
      }, 150);
      return () => clearTimeout(t);
    }

    if (step === 2 && isFullPasscode(confirm)) {
      if (confirm === pin) {
        const t = setTimeout(() => finishSetup(confirm), 150);
        return () => clearTimeout(t);
      }
      setMismatch(true);
      hapticError();
      const t = setTimeout(() => setConfirm(""), 420);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pin, confirm, busy]);

  const onBack = () => {
    if (busy) return;
    if (step === 1) {
      router.back();
    } else {
      setStep(1);
      setConfirm("");
      setMismatch(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <OnboardingProgress step={2} total={3} />

        <View style={{ height: SPACING.xxl }} />

        <T weight="bold" style={{ fontSize: 34, lineHeight: 40, letterSpacing: -1 }}>
          {step === 1 ? "Create passcode" : "Confirm passcode"}
        </T>

        <View style={{ height: SPACING.sm }} />

        <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
          {step === 1
            ? "Six digits. This encrypts your wallet on this device."
            : "Enter the same six digits again."}
        </T>

        <View style={{ height: SPACING.xxl }} />

        {/* Same component as the Unlock screen — identical keys, identical
            dots, identical error slot. Setting a passcode and entering one
            should not look like two different products. */}
        <PasscodePad
          value={value}
          onChange={(next) => {
            setMismatch(false);
            setValue(next);
          }}
          busy={busy}
          error={mismatch ? "Passcodes don’t match — try again." : null}
        />

        <View style={{ marginTop: "auto", paddingTop: SPACING.xl, alignItems: "center" }}>
          <TextButton title={step === 1 ? "Back" : "Start over"} onPress={onBack} disabled={busy} />
        </View>
      </View>

      {/* Vault creation is genuinely slow (scrypt key derivation). Cover the
          screen with real progress instead of letting it look frozen. */}
      <PreparingWallet visible={busy} />
    </Screen>
  );
}
