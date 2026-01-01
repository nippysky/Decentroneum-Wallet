// app/(tabs)/settings.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Switch, View, ScrollView } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/src/ui/Screen";
import { T } from "@/src/ui/T";
import { Button } from "@/src/ui/Button";
import { Toast } from "@/src/ui/Toast";
import { useTheme, Mode } from "@/src/theme/ThemeProvider";
import { useSession } from "@/src/state/session";
import { unlockVaultV1 } from "@/src/lib/vault";

function Card({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        borderRadius: 22,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.card,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function Divider() {
  const { theme } = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.border }} />;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ padding: 16, paddingBottom: 10 }}>
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const { theme } = useTheme();

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.bg,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Ionicons name={icon} size={18} color={theme.text} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <T weight="semibold">{title}</T>
        {subtitle ? (
          <T variant="caption" color={theme.muted}>
            {subtitle}
          </T>
        ) : null}
      </View>

      {right ? (
        <View style={{ alignItems: "flex-end", justifyContent: "center" }}>{right}</View>
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={18} color={theme.muted} />
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
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
              backgroundColor: theme.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 18,
              gap: 12,
            }}
          >
            <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
              {title}
            </T>
            <T color={theme.muted}>{message}</T>
            <View style={{ height: 6 }} />
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
        <Pressable onPress={close} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 18,
              gap: 12,
            }}
          >
            <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
              {title}
            </T>
            <T color={theme.muted}>{subtitle}</T>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              {dots(pin.length).map((filled, i) => (
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

            <View style={{ gap: 10, marginTop: 10 }}>
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
                          if (disabled) return;
                          if (isDel) del();
                          else add(k);
                        }}
                        style={({ pressed }) => [
                          {
                            flex: 1,
                            height: 52,
                            borderRadius: 16,
                            borderWidth: 1,
                            borderColor: theme.border,
                            backgroundColor: theme.bg,
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: disabled ? 0 : busy ? 0.6 : 1,
                          },
                          pressed && !busy ? { opacity: 0.85 } : null,
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
              <T color={(theme as any).danger ?? "#EF4444"} style={{ textAlign: "center" }}>
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

            <View style={{ height: 6 }} />
            <Button title={busy ? "Please wait…" : confirmText} disabled={pin.length !== 6 || busy} onPress={submit} />
            <Button title="Cancel" variant="outline" onPress={close} />
          </Pressable>
        </Pressable>
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
  const lock = useSession((s) => s.lock);

  const autoLockEnabled = useSession((s) => s.autoLockEnabled);
  const setAutoLockEnabled = useSession((s) => s.setAutoLockEnabled);

  const biometricEnabled = useSession((s) => s.biometricEnabled);
  const setBiometricEnabled = useSession((s) => s.setBiometricEnabled);

  const setBioPin = useSession((s) => s.setBioPin);
  const clearBioPin = useSession((s) => s.clearBioPin);

  const resetDeviceWallet = useSession((s) => s.resetDeviceWallet);

  // (optional) mnemonic may exist in session memory while unlocked
  const sessionMnemonic = useSession((s) => (s as any).mnemonic) as string | null;

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
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  const autoHideTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1300) as unknown as number;
  };

  useEffect(() => {
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 14 }}>
          <T variant="h2" weight="bold">
            Settings
          </T>

          {/* Security */}
          <Card>
            <SectionHeader title="Security" subtitle="Protect this wallet on this device." />
            <Divider />

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

            <Divider />

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

            <Divider />

            <Row icon="key-outline" title="View recovery phrase" subtitle="Requires passcode" onPress={() => setViewPhrasePending(true)} />

            <Divider />

            <Row
              icon="shield-outline"
              title="Lock now"
              subtitle="Return to unlock screen"
              onPress={() => {
                lock();
                router.replace("/unlock");
              }}
            />
          </Card>

          {/* Appearance */}
          <Card>
            <SectionHeader title="Appearance" subtitle="Choose your theme preference." />
            <Divider />

            <Row icon="color-palette-outline" title="Theme" subtitle={`Currently: ${themeSubtitle}`} />

            <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {(["system", "light", "dark"] as Mode[]).map((m) => {
                  const active = mode === m;
                  const label = m === "system" ? "System" : m === "light" ? "Light" : "Dark";

                  return (
                    <Pressable
                      key={m}
                      onPress={() => setMode(m)}
                      style={({ pressed }) => ({
                        flex: 1,
                        height: 44,
                        borderRadius: 14,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active ? theme.bg : theme.card,
                        borderWidth: 1,
                        borderColor: theme.border,
                        opacity: pressed ? 0.9 : 1,
                      })}
                    >
                      <T weight={active ? "semibold" : "medium"}>{label}</T>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Card>

          {/* Device */}
          <Card>
            <SectionHeader title="Device" subtitle="This affects only this phone." />
            <Divider />
            <Row
              icon="trash-outline"
              title="Erase wallet from this device"
              subtitle="Removes your encrypted vault and logs you out"
              onPress={() => setEraseOpen(true)}
            />
          </Card>
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
          const maybeVault = (await unlockVaultV1(pin)) as any;

          const mnemonic =
            (sessionMnemonic && typeof sessionMnemonic === "string" ? sessionMnemonic : null) ??
            (typeof maybeVault?.mnemonic === "string" ? maybeVault.mnemonic : null) ??
            (typeof maybeVault?.wallet?.mnemonic === "string" ? maybeVault.wallet.mnemonic : null);

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
          <Pressable onPress={closePhrase} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: theme.card,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 18,
                gap: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
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
                  padding: 14,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.bg,
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
          <Toast message={toastMsg} visible={toastVisible} bottomOffset={24} />
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
          await unlockVaultV1(pin);
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

      {/* Erase sheet */}
      <Sheet
        visible={eraseOpen}
        title="Erase wallet?"
        message="This removes your wallet data from this device. You can restore later using your recovery phrase. This cannot be undone."
        primaryText="Erase from device"
        secondaryText="Cancel"
        onPrimary={async () => {
          setEraseOpen(false);
          await resetDeviceWallet();
          router.replace("/(onboarding)/welcome");
        }}
        onSecondary={() => setEraseOpen(false)}
      />

      {/* ✅ Global toast only when phrase modal is NOT open (prevents duplicates) */}
      {!toastInsidePhraseModal ? <Toast message={toastMsg} visible={toastVisible} /> : null}
    </Screen>
  );
}
