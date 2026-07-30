// app/(tabs)/settings.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/src/state/toast";
import { ActivityIndicator, Modal, Pressable, Switch, View, ScrollView } from "react-native";
import { Redirect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { HoldToConfirm } from "@/src/components/HoldToConfirm";
import { TextButton } from "@/src/components/TextButton";
import { FullSheet } from "@/src/components/FullSheet";
import { PasscodePad, isFullPasscode } from "@/src/components/PasscodePad";
import { useScreenGuard, useScreenshotWarning } from "@/src/lib/security/screenGuard";
import { useTheme, Mode } from "@/src/theme/ThemeProvider";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { unlockVault } from "@/src/lib/crypto/vault";
import { AccountManager } from "@/src/features/accounts/AccountManager";
import { useNotifications } from "@/src/state/notifications";
import { useNotificationFeed } from "@/src/state/notificationsFeed";
import { getExpoPushToken, unregisterPush } from "@/src/lib/notifications/register";
import { fireAndForget } from "@/src/lib/net/http";
import { RADIUS, SPACING } from "@/src/theme/tokens";

function Card({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        borderRadius: RADIUS.xl,
        backgroundColor: theme.surface2,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ padding: SPACING.md, paddingBottom: SPACING.sm }}>
      <T weight="bold">{title}</T>
      <T variant="caption" color={theme.muted}>
        {subtitle}
      </T>
    </View>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onPress,
  right,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
}) {
  const { theme } = useTheme();

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm + 2,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: RADIUS.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.bg,
        }}
      >
        <Ionicons name={icon} size={18} color={danger ? theme.danger : theme.text} />
      </View>

      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <T weight="semibold" color={danger ? theme.danger : undefined}>{title}</T>
        {subtitle ? (
          <T variant="caption" color={theme.muted}>
            {subtitle}
          </T>
        ) : null}
      </View>

      {right ? (
        <View style={{ alignItems: "flex-end", justifyContent: "center" }}>{right}</View>
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable hitSlop={6} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {content}
    </Pressable>
  );
}

function Sheet({
  visible,
  title,
  message,
  primaryText,
  secondaryText,
  onPrimary,
  onSecondary,
}: {
  visible: boolean;
  title: string;
  message: string;
  primaryText: string;
  secondaryText: string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  const { theme } = useTheme();
  return (
    <FullSheet
      visible={visible}
      title={title}
      onClose={onSecondary}
      footer={
        <>
          <Button title={primaryText} onPress={onPrimary} />
          <TextButton title={secondaryText} onPress={onSecondary} />
        </>
      }
    >
      <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
        {message}
      </T>
    </FullSheet>
  );
}

function PasscodeSheet({
  visible,
  title,
  subtitle,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  onCancel: () => void;
  onConfirm: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-submits on the 6th digit, exactly like the Unlock screen — the
  // separate "Confirm" button was a second tap for a decision the user had
  // already made by entering the last digit.
  useEffect(() => {
    if (!visible || busy || !isFullPasscode(pin)) return;
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        await onConfirm(pin);
        if (alive) setPin("");
      } catch {
        if (alive) {
          setPin("");
          setErr("Incorrect passcode.");
        }
      } finally {
        if (alive) setBusy(false);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, visible, busy]);

  // Reset whenever the sheet closes, so reopening never shows a stale error
  // or half-typed passcode.
  useEffect(() => {
    if (visible) return;
    setPin("");
    setErr(null);
  }, [visible]);

  const close = () => {
    if (busy) return;
    setPin("");
    setErr(null);
    onCancel();
  };

  return (
    <FullSheet visible={visible} title={title} subtitle={subtitle} onClose={close}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <PasscodePad
          value={pin}
          onChange={(next) => {
            setErr(null);
            setPin(next);
          }}
          busy={busy}
          error={err}
          compact
        />
      </View>
    </FullSheet>
  );
}

function EraseWalletSheet({
  visible,
  accounts,
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  accounts: { id: string; label: string }[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();

  return (
    <FullSheet
      visible={visible}
      title="Erase all wallets from this device?"
      // No backdrop-dismiss anywhere in this app, and especially not here:
      // the only ways out are Cancel and the hardware back button.
      onClose={busy ? () => {} : onCancel}
      footer={
        <>
          <HoldToConfirm
            title={busy ? "Erasing…" : "Hold to erase everything"}
            holdingTitle="Release to cancel"
            disabled={busy}
            onConfirmed={onConfirm}
          />
          <TextButton title="Cancel" onPress={onCancel} disabled={busy} />
        </>
      }
    >
      <View style={{ gap: SPACING.md }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: RADIUS.lg,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.surface2,
          }}
        >
          <Ionicons name="warning-outline" size={24} color={theme.danger} />
        </View>

        <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
          This permanently deletes every account stored on this device — not just the one you&apos;re
          currently viewing. It cannot be undone. Anything you haven&apos;t backed up with its recovery
          phrase will be gone for good.
        </T>

        <View style={{ borderRadius: RADIUS.lg, backgroundColor: theme.surface2, padding: SPACING.md, gap: 6 }}>
          <T variant="caption" weight="semibold" color={theme.muted}>
            {accounts.length} account{accounts.length === 1 ? "" : "s"} will be removed
          </T>
          {accounts.map((a) => (
            <T key={a.id} weight="semibold" numberOfLines={1}>
              {a.label}
            </T>
          ))}
        </View>
      </View>
    </FullSheet>
  );
}

async function getBiometricLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "Touch ID";
    return "Biometrics";
  } catch {
    return "Biometrics";
  }
}

async function isBiometricsAvailable(): Promise<boolean> {
  const has = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return has && enrolled;
}

export default function Settings() {
  const router = useRouter();
  const { theme, mode, resolvedMode, setMode } = useTheme();

  const isUnlocked = useSession((s) => s.isUnlocked);

  const autoLockEnabled = useSession((s) => s.autoLockEnabled);
  const setAutoLockEnabled = useSession((s) => s.setAutoLockEnabled);

  const biometricEnabled = useSession((s) => s.biometricEnabled);
  const setBiometricEnabled = useSession((s) => s.setBiometricEnabled);

  const setBioPin = useSession((s) => s.setBioPin);
  const clearBioPin = useSession((s) => s.clearBioPin);

  const resetDeviceWallet = useSession((s) => s.resetDeviceWallet);
  const accountsForErase = useAccounts((s) => s.accounts);
  const [eraseBusy, setEraseBusy] = useState(false);


  const [eraseOpen, setEraseOpen] = useState(false);

  const [bioPendingOn, setBioPendingOn] = useState(false);
  const [bioLabel, setBioLabel] = useState<string>("Biometrics");
  const [bioHelpOpen, setBioHelpOpen] = useState(false);

  // Recovery phrase flow
  const [viewPhrasePending, setViewPhrasePending] = useState(false);
  const [phraseOpen, setPhraseOpen] = useState(false);
  const [phraseRevealed, setPhraseRevealed] = useState(false);
  const [phrase, setPhrase] = useState<string>("");

  // Toast

  const autoHideTimerRef = useRef<number | null>(null);

  // One toast, app-wide: src/state/toast.ts + <ToastHost/> at the root.
  // No local message/visible/timer state to keep in sync.
  const showToast = (msg: string) => toast.info(msg);

  useEffect(() => {
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    getBiometricLabel().then(setBioLabel).catch(() => {});
  }, []);

  useEffect(() => {
    // security: auto-hide & wipe phrase from memory after 30s whenever phrase sheet opens
    if (!phraseOpen) return;

    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    autoHideTimerRef.current = setTimeout(() => {
      setPhraseOpen(false);
      setPhraseRevealed(false);
      setPhrase("");
      showToast("Recovery phrase hidden");
    }, 30_000) as unknown as number;

    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    };
  }, [phraseOpen]);

  const themeSubtitle = useMemo(() => {
    if (mode === "system") return `System (${resolvedMode === "dark" ? "Dark" : "Light"})`;
    return mode === "dark" ? "Dark" : "Light";
  }, [mode, resolvedMode]);

  if (!isUnlocked) return <Redirect href="/unlock" />;

  const beginEnableBiometrics = async () => {
    const ok = await isBiometricsAvailable();
    if (!ok) {
      setBioHelpOpen(true);
      setBioPendingOn(false);
      await setBiometricEnabled(false);
      return;
    }
    setBioPendingOn(true);
  };

  const disableBiometrics = async () => {
    setBioPendingOn(false);
    await clearBioPin().catch(() => {});
    await setBiometricEnabled(false);
  };

  // Block screenshots / recording for as long as the phrase sheet is open.
  useScreenGuard(phraseOpen);
  useScreenshotWarning(
    () => toast.error("Screenshot saved to your photos — delete it. Photos sync to the cloud."),
    phraseOpen
  );

  const closePhrase = () => {
    setPhraseOpen(false);
    setPhraseRevealed(false);
    setPhrase("");
  };

  return (
    // edges={["top"]}: the tab bar below this screen is now IN FLOW and
    // carries the bottom safe area itself (see app/(tabs)/_layout.tsx).
    // Reserving it here as well would double-count the inset and leave a
    // visible dead strip above the bar.
    <Screen edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xxxl }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ gap: SPACING.xl }}>
          <T weight="bold" style={{ fontSize: 32, lineHeight: 38, letterSpacing: -1 }}>
            Settings
          </T>

          {/* Accounts */}
          <View style={{ gap: SPACING.sm }}>
            <View style={{ paddingHorizontal: 2 }}>
              <T weight="bold">Accounts</T>
              <T variant="caption" color={theme.muted}>
                Switch between wallets or add another.
              </T>
            </View>
            <AccountManager />
          </View>

          {/* Security */}
          <Card>
            <SectionHeader title="Security" subtitle="Protect this wallet on this device." />

            <Row
              icon="lock-closed-outline"
              title="Auto-lock"
              subtitle="Lock when you leave the app"
              right={
                <Switch
                  value={autoLockEnabled}
                  onValueChange={(v) => setAutoLockEnabled(v)}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={theme.card}
                  ios_backgroundColor={theme.border}
                />
              }
            />


            <Row
              icon="finger-print-outline"
              title="Biometric unlock"
              subtitle={`Use ${bioLabel} if available`}
              right={
                <Switch
                  value={biometricEnabled || bioPendingOn}
                  onValueChange={async (v) => {
                    if (v) await beginEnableBiometrics();
                    else await disableBiometrics();
                  }}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={theme.card}
                  ios_backgroundColor={theme.border}
                />
              }
            />


            <Row icon="key-outline" title="View recovery phrase" subtitle="Requires passcode" onPress={() => setViewPhrasePending(true)} />
          </Card>

          {/* Appearance */}
          <Card>
            <SectionHeader title="Appearance" subtitle="Choose your theme preference." />

            <Row icon="color-palette-outline" title="Theme" subtitle={`Currently: ${themeSubtitle}`} />

            <View style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.md }}>
              <View style={{ flexDirection: "row", gap: SPACING.sm, backgroundColor: theme.bg, borderRadius: RADIUS.lg, padding: 4 }}>
                {(["system", "light", "dark"] as Mode[]).map((m) => {
                  const active = mode === m;
                  const label = m === "system" ? "System" : m === "light" ? "Light" : "Dark";

                  return (
                    <Pressable hitSlop={6}
                      key={m}
                      onPress={() => setMode(m)}
                      style={({ pressed }) => ({
                        flex: 1,
                        height: 40,
                        borderRadius: RADIUS.md,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active ? theme.surface2 : "transparent",
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <T weight={active ? "semibold" : "medium"} style={{ fontSize: 14 }}>{label}</T>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Card>

          {/* About */}
          <Card>
            <SectionHeader title="About" subtitle="Decent Wallet by Decentroneum." />
            <Row
              icon="globe-outline"
              title="decentroneum.com"
              subtitle="Web3 platform for the Electroneum ecosystem"
              onPress={() => router.push({ pathname: "/browser/web" as any, params: { url: "https://decentroneum.com" } })}
            />
            <Row
              icon="logo-twitter"
              title="Follow on X"
              subtitle="@decentroneum"
              onPress={() => router.push({ pathname: "/browser/web" as any, params: { url: "https://x.com/decentroneum" } })}
            />
            <Row
              icon="paper-plane-outline"
              title="Join Telegram"
              subtitle="Community & support"
              onPress={() => router.push({ pathname: "/browser/web" as any, params: { url: "https://t.me/DecentroneumGroupChat" } })}
            />
            <Row icon="information-circle-outline" title="Version" subtitle="1.0.0" />
          </Card>

          {/* Legal */}
          <Card>
            <SectionHeader title="Legal" subtitle="Required reading before you send funds." />
            <Row
              icon="shield-checkmark-outline"
              title="Privacy Policy"
              onPress={() => router.push({ pathname: "/browser/web" as any, params: { url: "https://decentroneum.com/privacy" } })}
            />
            <Row
              icon="document-text-outline"
              title="Terms of Service"
              onPress={() => router.push({ pathname: "/browser/web" as any, params: { url: "https://decentroneum.com/terms" } })}
            />
          </Card>

          {/* Erase — deliberately NOT a card. It's a single quiet red line;
              all the weight (warnings, account count, hold-to-confirm)
              lives in the modal it opens, so this destructive action stops
              dominating the screen. */}
          <Pressable hitSlop={6}
            onPress={() => setEraseOpen(true)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingVertical: SPACING.md,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="trash-outline" size={16} color={theme.danger} />
            <T weight="semibold" color={theme.danger}>
              Erase wallet
            </T>
          </Pressable>
        </View>
      </ScrollView>

      {/* Passcode gate for “View recovery phrase” */}
      <PasscodeSheet
        visible={viewPhrasePending}
        title="View recovery phrase"
        subtitle="Enter your passcode to reveal your recovery phrase. Never share it with anyone."
        onCancel={() => setViewPhrasePending(false)}
        onConfirm={async (pin) => {
          // Step-up auth: re-verify the passcode even though the app is already
          // unlocked, then decrypt just the active account's mnemonic.
          const { key, activeAccountId } = await unlockVault(pin);
          const mnemonic = await useAccounts.getState().revealMnemonic(key, activeAccountId);
          if (!mnemonic) throw new Error("Mnemonic unavailable");

          setPhrase(mnemonic.trim());
          setPhraseRevealed(false);
          setPhraseOpen(true);
          setViewPhrasePending(false);
        }}
      />

      {/* Recovery phrase — full screen, capture-blocked, word grid.
          Identical presentation to the onboarding backup screen, because it
          is the same secret; showing it as a cramped card in one place and a
          full page in another taught two different mental models. */}
      <FullSheet
        visible={phraseOpen}
        title="Recovery phrase"
        onClose={closePhrase}
        footer={
          <>
            <View style={{ flexDirection: "row", gap: SPACING.sm }}>
              <Button
                title={phraseRevealed ? "Hide" : "Reveal"}
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setPhraseRevealed((v) => !v)}
              />
              <Button
                title="Copy"
                style={{ flex: 1 }}
                disabled={!phraseRevealed}
                onPress={async () => {
                  await Clipboard.setStringAsync(phrase);
                  showToast("Recovery phrase copied");
                }}
              />
            </View>
            <TextButton title="Done" onPress={closePhrase} />
          </>
        }
      >
        {/* The old warning paragraph ("Anyone with this phrase can control
            your funds. Keep it offline…") is gone. By this point the user
            has already read it during onboarding, already passed a passcode
            check to get here, and is looking at a screen that literally
            hides the words until they ask. The paragraph was a wall of text
            restating what the interface already enforces. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: SPACING.md, columnGap: "3%" }}>
          {(phraseRevealed ? phrase.split(" ").filter(Boolean) : Array.from({ length: 12 }, () => "")).map(
            (w, i) => (
              <View
                key={i}
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
                  {w || "••••"}
                </T>
              </View>
            )
          )}
        </View>

        <View style={{ height: SPACING.md }} />

        <T variant="caption" color={theme.muted} style={{ textAlign: "center" }}>
          Hides automatically after 30 seconds.
        </T>
      </FullSheet>

      {/* Enable biometrics requires passcode verification + saving BIO pin behind biometrics */}
      <PasscodeSheet
        visible={bioPendingOn && !biometricEnabled}
        title="Enable biometric unlock"
        subtitle="Enter your passcode once. We’ll store it protected by Face ID / Touch ID for faster unlock."
        onCancel={async () => {
          setBioPendingOn(false);
          await setBiometricEnabled(false);
        }}
        onConfirm={async (pin) => {
          await unlockVault(pin); // verifies the passcode; throws if wrong
          await setBioPin(pin);
          await setBiometricEnabled(true);
          setBioPendingOn(false);
        }}
      />

      {/* Help sheet for simulator / device not enrolled */}
      <Sheet
        visible={bioHelpOpen}
        title="Biometrics not available"
        message={"Face ID / Touch ID isn’t set up on this device.\n\nOn iOS Simulator: Features → Face ID → Enrolled, then try again."}
        primaryText="OK"
        secondaryText="Cancel"
        onPrimary={() => setBioHelpOpen(false)}
        onSecondary={() => setBioHelpOpen(false)}
      />

      {/* Erase sheet — the one truly irreversible action in Settings, so it
          gets the same hold-to-confirm gesture as an on-chain broadcast,
          plus an explicit account count instead of vague "your wallet data"
          copy. */}
      <EraseWalletSheet
        visible={eraseOpen}
        accounts={accountsForErase}
        busy={eraseBusy}
        onCancel={() => (eraseBusy ? null : setEraseOpen(false))}
        onConfirm={async () => {
          setEraseBusy(true);
          try {
            // Best-effort server-side push deregistration. Deliberately
            // fire-and-forget: erasing the wallet is a *local* operation
            // and must never be blocked by (or hang on) an unreachable
            // push server. This was previously awaited, which meant a
            // down/unreachable server left the erase spinning forever.
            fireAndForget(
              getExpoPushToken().then((token) => (token ? unregisterPush(token) : null))
            );

            await useNotifications.getState().disable().catch(() => {});
            await useNotificationFeed.getState().clear().catch(() => {});

            // Navigate BEFORE wiping.
            //
            // resetDeviceWallet() sets isUnlocked=false, and this screen has
            // `if (!isUnlocked) return <Redirect href="/unlock" />` at the
            // top. So wiping first meant the guard fired on the very next
            // render and threw the user onto the unlock keypad — for a vault
            // that no longer existed, so every passcode was rejected. Moving
            // off this screen first means the guard never gets the chance.
            setEraseOpen(false);
            router.replace("/(onboarding)/welcome");
            await resetDeviceWallet();
          } catch {
            // Local wipe failed — surface it instead of leaving the user
            // staring at a stuck spinner.
            setEraseOpen(false);
            showToast("Couldn't erase wallet. Please try again.");
          } finally {
            setEraseBusy(false);
          }
        }}
      />

      {/* ✅ Global toast only when phrase modal is NOT open (prevents duplicates) */}
    </Screen>
  );
}
