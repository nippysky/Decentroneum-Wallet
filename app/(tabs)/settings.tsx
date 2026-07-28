// app/(tabs)/settings.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/src/state/toast";
import { ActivityIndicator, Modal, Pressable, Switch, View, ScrollView } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { HoldToConfirm } from "@/src/components/HoldToConfirm";
import { useTheme, Mode } from "@/src/theme/ThemeProvider";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { unlockVault } from "@/src/lib/crypto/vault";
import { AccountManager } from "@/src/features/accounts/AccountManager";
import { ConnectionsPanel } from "@/src/features/walletconnect/ConnectionsPanel";
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
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSecondary}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={{ position: "absolute", inset: 0 }} />
        <Pressable onPress={onSecondary} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.bgElevated,
              borderRadius: RADIUS.xxl,
              padding: SPACING.lg,
              gap: SPACING.sm,
            }}
          >
            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
              {title}
            </T>
            <T color={theme.muted}>{message}</T>
            <View style={{ height: SPACING.xs }} />
            <Button title={primaryText} onPress={onPrimary} />
            <Button title={secondaryText} variant="outline" onPress={onSecondary} />
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

function PasscodeSheet({
  visible,
  title,
  subtitle,
  confirmText,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  confirmText: string;
  onCancel: () => void;
  onConfirm: (pin: string) => Promise<void>;
}) {
  const { theme } = useTheme();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dots = (n: number) => Array.from({ length: 6 }).map((_, i) => i < n);

  const add = (d: string) => {
    if (busy) return;
    if (pin.length >= 6) return;
    setPin((p) => p + d);
    setErr(null);
  };

  const del = () => {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
    setErr(null);
  };

  const submit = async () => {
    if (pin.length !== 6) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(pin);
      setPin("");
    } catch {
      setPin("");
      setErr("Incorrect passcode.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setPin("");
    setErr(null);
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={{ position: "absolute", inset: 0 }} />
        <Pressable style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.bgElevated,
              borderRadius: RADIUS.xxl,
              padding: SPACING.lg,
              gap: SPACING.sm,
            }}
          >
            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
              {title}
            </T>
            <T color={theme.muted}>{subtitle}</T>

            <View style={{ flexDirection: "row", gap: 14, justifyContent: "center", marginTop: SPACING.sm }}>
              {dots(pin.length).map((filled, i) => (
                <View
                  key={i}
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 999,
                    backgroundColor: filled ? theme.accent : theme.border,
                  }}
                />
              ))}
            </View>

            <View style={{ gap: SPACING.sm, marginTop: SPACING.sm }}>
              {[
                ["1", "2", "3"],
                ["4", "5", "6"],
                ["7", "8", "9"],
                ["", "0", "del"],
              ].map((row, r) => (
                <View key={r} style={{ flexDirection: "row", gap: SPACING.sm }}>
                  {row.map((k) => {
                    const isDel = k === "del";
                    const disabled = k === "";
                    return (
                      <Pressable
                        key={k || `empty-${r}`}
                        disabled={disabled || busy}
                        onPress={() => {
                          if (disabled) return;
                          if (isDel) del();
                          else add(k);
                        }}
                        style={({ pressed }) => [
                          {
                            flex: 1,
                            height: 54,
                            borderRadius: 16,
                            backgroundColor: pressed && !disabled ? theme.border : theme.surface2,
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: disabled ? 0 : busy ? 0.6 : 1,
                          },
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

            {err ? (
              <T color={theme.danger} style={{ textAlign: "center" }}>
                {err}
              </T>
            ) : null}

            {busy ? (
              <View style={{ flexDirection: "row", gap: 10, justifyContent: "center" }}>
                <ActivityIndicator />
                <T variant="caption" color={theme.muted}>
                  Verifying locally…
                </T>
              </View>
            ) : null}

            <View style={{ height: SPACING.xs }} />
            <Button title={confirmText} loading={busy} disabled={pin.length !== 6} onPress={submit} />
            <Button title="Cancel" variant="outline" onPress={close} />
          </Pressable>
        </Pressable>
      </View>
    </Modal>
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => {} : onCancel}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={{ position: "absolute", inset: 0 }} />
        {/* No backdrop-dismiss: this sheet is destructive, so it only
            closes via an explicit Cancel. */}
        <View style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <View
            style={{
              backgroundColor: theme.bgElevated,
              borderRadius: RADIUS.xxl,
              padding: SPACING.lg,
              gap: SPACING.md,
            }}
          >
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

            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
              Erase all wallets from this device?
            </T>

            <T color={theme.muted}>
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

            <View style={{ height: SPACING.xs }} />

            <HoldToConfirm
              title={busy ? "Erasing…" : "Hold to erase everything"}
              holdingTitle="Release to cancel"
              disabled={busy}
              onConfirmed={onConfirm}
            />
            <Button title="Cancel" variant="outline" onPress={onCancel} disabled={busy} />
          </View>
        </View>
      </View>
    </Modal>
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

  const closePhrase = () => {
    setPhraseOpen(false);
    setPhraseRevealed(false);
    setPhrase("");
  };

  // ✅ If a modal is open, render the toast INSIDE it (native Modal is always above the app tree)
  const toastInsidePhraseModal = phraseOpen;

  return (
    <Screen>
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

          {/* Connections */}
          <View style={{ gap: SPACING.sm }}>
            <View style={{ paddingHorizontal: 2 }}>
              <T weight="bold">Connections</T>
              <T variant="caption" color={theme.muted}>
                Apps connected via WalletConnect.
              </T>
            </View>
            <ConnectionsPanel />
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
                    <Pressable
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
          <Pressable
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
        confirmText="Continue"
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

      {/* Recovery phrase modal */}
      <Modal visible={phraseOpen} transparent animationType="fade" onRequestClose={closePhrase}>
        <View style={{ flex: 1 }}>
          <BlurView intensity={30} tint="default" style={{ position: "absolute", inset: 0 }} />
          <Pressable style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: theme.bgElevated,
                borderRadius: RADIUS.xxl,
                padding: SPACING.lg,
                gap: SPACING.sm,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
                  Recovery phrase
                </T>
                <Pressable onPress={closePhrase} style={{ padding: 8 }}>
                  <Ionicons name="close" size={18} color={theme.text} />
                </Pressable>
              </View>

              <T color={theme.muted}>
                Anyone with this phrase can control your funds. Keep it offline. This screen auto-hides in 30 seconds.
              </T>

              <View
                style={{
                  padding: SPACING.md,
                  borderRadius: RADIUS.lg,
                  backgroundColor: theme.surface2,
                  minHeight: 84,
                  justifyContent: "center",
                }}
              >
                <T weight="semibold" style={{ lineHeight: 22 }}>
                  {phraseRevealed ? phrase : "•••• •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• ••••"}
                </T>
              </View>

              <View style={{ flexDirection: "row", gap: 12 }}>
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

              <Button title="Done" variant="outline" onPress={closePhrase} />
            </Pressable>
          </Pressable>

          {/* ✅ Toast inside Modal so it shows ABOVE the modal content */}
        </View>
      </Modal>

      {/* Enable biometrics requires passcode verification + saving BIO pin behind biometrics */}
      <PasscodeSheet
        visible={bioPendingOn && !biometricEnabled}
        title="Enable biometric unlock"
        subtitle="Enter your passcode once. We’ll store it protected by Face ID / Touch ID for faster unlock."
        confirmText="Enable"
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
            await resetDeviceWallet();
            setEraseOpen(false);
            router.replace("/(onboarding)/welcome");
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
