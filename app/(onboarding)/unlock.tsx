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
import { FullSheet } from "@/src/components/FullSheet";
import { TextButton } from "@/src/components/TextButton";
import { HoldToConfirm } from "@/src/components/HoldToConfirm";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SPACING } from "@/src/theme/tokens";

import { deviceHasWallet, useSession } from "@/src/state/session";

export default function Unlock() {
  const router = useRouter();
  const { theme } = useTheme();

  const unlock = useSession((s) => s.unlock);
  const biometricEnabled = useSession((s) => s.biometricEnabled);
  const getBioPin = useSession((s) => s.getBioPin);
  const resetDeviceWallet = useSession((s) => s.resetDeviceWallet);

  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
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

        {/* The only way off this screen without the passcode.
            *
            * Without it a forgotten passcode is permanent: SecureStore writes to
            * the iOS Keychain, and Keychain items SURVIVE deleting the app — so
            * reinstalling lands the user right back here. They would be staring
            * at a keypad they can't satisfy, guarding coins they can still see
            * on a block explorer, with their recovery phrase in a drawer and no
            * screen in the app willing to accept it.
            *
            * Deliberately understated, and deliberately behind a confirmation
            * sheet plus a hold gesture: this is the single most destructive
            * action in the app, and the one place where a mis-tap costs money
            * if the phrase was never written down. */}
        <TextButton
          title="Forgot passcode?"
          onPress={() => setResetOpen(true)}
          style={{ marginBottom: SPACING.md }}
        />
      </View>

      <FullSheet
        visible={resetOpen}
        title="Forgot passcode?"
        subtitle="Your passcode can't be recovered — but your wallet can."
        onClose={() => setResetOpen(false)}
        footer={
          <HoldToConfirm
            title="Hold to erase this wallet"
            holdingTitle="Keep holding to erase…"
            ms={1500}
            disabled={resetting}
            onConfirmed={async () => {
              if (resetting) return;
              setResetting(true);
              try {
                await resetDeviceWallet();
                setResetOpen(false);
                router.replace("/(onboarding)/welcome");
              } finally {
                setResetting(false);
              }
            }}
          />
        }
      >
        <View style={{ gap: SPACING.md }}>
          <T color={theme.muted} variant="body">
            The passcode never leaves this device and is not stored anywhere, so
            there is nothing to reset or email. What you can do is remove this
            wallet from the device and restore it with your recovery phrase.
          </T>

          <View
            style={{
              backgroundColor: theme.surface2,
              borderRadius: RADIUS.md,
              padding: SPACING.md,
              gap: SPACING.sm,
            }}
          >
            <T weight="semibold">Only continue if you have your recovery phrase</T>
            <T color={theme.muted} variant="body">
              Your accounts live on the blockchain, not in this app, so erasing
              here does not touch your funds. But the phrase is the only way
              back to them. Without it, removing this wallet is permanent.
            </T>
          </View>
        </View>
      </FullSheet>
    </Screen>
  );
}
