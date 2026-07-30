// app/(onboarding)/unlock.tsx
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { hapticError, hapticWarning } from "@/src/lib/haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { PasscodePad, isFullPasscode } from "@/src/components/PasscodePad";
import { useTheme } from "@/src/theme/ThemeProvider";
import { SPACING } from "@/src/theme/tokens";

import { deviceHasWallet, useSession } from "@/src/state/session";

export default function Unlock() {
  const router = useRouter();
  const { theme } = useTheme();

  const unlock = useSession((s) => s.unlock);
  const biometricEnabled = useSession((s) => s.biometricEnabled);
  const getBioPin = useSession((s) => s.getBioPin);

  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const [bioLabel, setBioLabel] = useState("Biometrics");
  const [bioIcon, setBioIcon] = useState<keyof typeof Ionicons.glyphMap>("scan-outline");
  const [error, setError] = useState<string | null>(null);

  // Is there actually a vault to unlock?
  //
  // null = still checking. This guard exists because it is possible to land
  // here with NO wallet on the device — most obviously right after "Erase
  // wallet": erasing flips isUnlocked to false, which trips the `!isUnlocked`
  // redirect on the tab screens and lands the user here before the erase flow
  // can route them to onboarding. Without this check the screen asks for a
  // passcode against a vault that no longer exists, so every attempt returns
  // "Incorrect passcode" forever and the only escape is force-quitting.
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    deviceHasWallet()
      .then((exists) => alive && setHasWallet(exists))
      .catch(() => alive && setHasWallet(true)); // fail open: show the keypad
    return () => {
      alive = false;
    };
  }, []);

  const didAutoBio = useRef(false);

  const finishUnlock = async (passcode: string) => {
    setBusy(true);
    setError(null);
    try {
      await unlock(passcode);
      router.replace("/(tabs)/wallet");
    } catch {
      setPin("");
      setError("Incorrect passcode.");
      hapticError();
    } finally {
      setBusy(false);
    }
  };

  // As soon as the 6th digit lands, log the person straight in — no separate
  // "Unlock" tap. The brief pause lets the last dot visibly fill first.
  useEffect(() => {
    if (!isFullPasscode(pin) || busy) return;
    const t = setTimeout(() => finishUnlock(pin), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const canUseBiometrics = async () => {
    if (!biometricEnabled) return false;
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return has && enrolled;
  };

  const computeBioMeta = async (): Promise<{
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
  }> => {
    try {
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        return { label: "Face ID", icon: "scan-outline" }; // Ionicons has no "face-id"
      }
      if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        return { label: "Touch ID", icon: "finger-print-outline" };
      }
      return { label: "Biometrics", icon: "scan-outline" };
    } catch {
      return { label: "Biometrics", icon: "scan-outline" };
    }
  };

  const doBiometricUnlock = async () => {
    if (busy) return;
    const ok = await canUseBiometrics();
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      // Triggers Face ID / Touch ID — getBioPin reads from SecureStore with
      // requireAuthentication set.
      const storedPin = await getBioPin();
      if (!storedPin) {
        setError("Biometric unlock isn’t set up yet.");
        hapticWarning();
        return;
      }
      await finishUnlock(storedPin);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      setBioReady(await canUseBiometrics());
      const meta = await computeBioMeta();
      setBioLabel(meta.label);
      setBioIcon(meta.icon);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricEnabled]);

  // Prompt biometrics once on open, but only if they haven't started typing.
  useEffect(() => {
    if (!bioReady || didAutoBio.current || pin.length > 0) return;
    didAutoBio.current = true;
    const t = setTimeout(() => {
      doBiometricUnlock().catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bioReady]);

  // No vault on this device (e.g. straight after an erase) — there is nothing
  // to unlock, so send them to onboarding rather than a keypad that can only
  // ever reject them.
  if (hasWallet === false) return <Redirect href="/(onboarding)/welcome" />;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <View style={{ height: SPACING.xxl }} />

        <T variant="display">Unlock</T>

        <View style={{ height: SPACING.sm }} />

        <T color={theme.muted} variant="body">
          Enter your passcode to access your wallet.
        </T>

        <View style={{ height: SPACING.xxl }} />

        <PasscodePad
          value={pin}
          onChange={(next) => {
            setPin(next);
            setError(null);
          }}
          busy={busy}
          error={error}
          biometric={
            bioReady ? { label: bioLabel, icon: bioIcon, onPress: () => void doBiometricUnlock() } : null
          }
        />

        <View style={{ marginTop: "auto" }} />
      </View>
    </Screen>
  );
}
