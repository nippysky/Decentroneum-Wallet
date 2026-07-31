// app/(tabs)/settings.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/src/state/toast";
import { Pressable, Switch, View, ScrollView } from "react-native";
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
import { seedColor, seedTag } from "@/src/features/accounts/seedVisuals";
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

  // Reset whenever the sheet closes, so reopening never shows a stale error,
  // a half-typed passcode, or — the bug this fixes — a spinner that never
  // stops.
  //
  // On SUCCESS, onConfirm hides this sheet. That flips `visible`, which is in
  // the effect above's dependency list, so its cleanup runs and sets
  // alive = false BEFORE the `finally` executes — meaning setBusy(false) was
  // skipped and `busy` stayed true forever. Reopening then found busy === true,
  // so the auto-submit bailed out, the keypad stayed disabled, and close() was
  // blocked by its own busy guard: no way out but killing the app.
  //
  // Clearing busy here makes the closed state authoritative, whatever happened
  // on the way out.
  useEffect(() => {
    if (visible) return;
    setPin("");
    setErr(null);
    setBusy(false);
  }, [visible]);

  // Deliberately NOT gated on `busy`. Blocking dismissal while a flag is set
  // is how a stuck flag becomes a trapped user; the worst case here is an
  // abandoned passcode check, which costs nothing.
  const close = () => {
    setPin("");
    setErr(null);
    setBusy(false);
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
  seeds,
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  accounts: { id: string; label: string; seedId: string }[];
  seeds: { id: string; label: string }[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();

  return (
    <FullSheet
      visible={visible}
      title="Erase everything from this device?"
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

        {/* Precise about what is destroyed. Accounts are not deleted — they
            cannot be — but this device's copy of every recovery phrase is,
            and that is irreversible. The user's real decision is "do I have
            all these words?", so the copy points straight at it. */}
        <T color={theme.muted} style={{ fontSize: 16, lineHeight: 23 }}>
          This deletes every recovery phrase stored on this device — not just the account you&apos;re
          viewing. Your accounts still exist on the blockchain, but this app will have no way to
          reach them. Anything whose words you haven&apos;t written down is gone for good.
        </T>

        {/* Grouped by phrase, because that is the unit of recovery. Seeing
            "Recovery phrase 2 — do you have these words?" is the prompt that
            actually stops someone erasing a backup they never wrote down. */}
        <View style={{ borderRadius: RADIUS.lg, backgroundColor: theme.surface2, padding: SPACING.md, gap: SPACING.sm }}>
          <T variant="caption" weight="semibold" color={theme.muted}>
            {accounts.length} account{accounts.length === 1 ? "" : "s"} across {seeds.length} recovery
            phrase{seeds.length === 1 ? "" : "s"} will be removed
          </T>
          {seeds.map((seed, i) => (
            <View key={seed.id} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: seedColor(i) }} />
                <T variant="caption" weight="semibold" color={theme.muted}>
                  {seedTag(i)} · {seed.label}
                </T>
              </View>
              {accounts
                .filter((a) => a.seedId === seed.id)
                .map((a) => (
                  <T key={a.id} weight="semibold" numberOfLines={1} style={{ paddingLeft: 9 }}>
                    {a.label}
                  </T>
                ))}
            </View>
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
  const seeds = useAccounts((s) => s.seeds);
  const [eraseBusy, setEraseBusy] = useState(false);


  const [eraseOpen, setEraseOpen] = useState(false);

  const [bioPendingOn, setBioPendingOn] = useState(false);
  const [bioLabel, setBioLabel] = useState<string>("Biometrics");

  // Recovery phrase flow
  const [viewPhrasePending, setViewPhrasePending] = useState(false);
  const [phraseOpen, setPhraseOpen] = useState(false);
  const [phraseRevealed, setPhraseRevealed] = useState(false);
  const [phrase, setPhrase] = useState<string>("");
  /**
   * What the revealed phrase is and what it covers. A wallet can hold several
   * phrases, and each covers only its own accounts — so the screen must name
   * the phrase and say how many other phrases are NOT covered by it. Someone
   * who writes down one phrase believing they are done is the failure this
   * exists to prevent.
   */
  const [phraseMeta, setPhraseMeta] = useState<{
    label: string;
    accountCount: number;
    otherSeedCount: number;
  } | null>(null);
  /** Phrase chooser, only reachable when the wallet holds more than one. */
  const [seedPickerOpen, setSeedPickerOpen] = useState(false);
  /** Held between the passcode check and the phrase choice, then wiped. */
  const stepUpKeyRef = useRef<Uint8Array | null>(null);

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

  // Block screenshots / recording for as long as the phrase sheet is open.
  //
  // These must stay ABOVE the redirect below. Locking the wallet flips
  // isUnlocked to false while this screen is still mounted, and a hook that
  // runs on one render but not the next makes React throw "rendered fewer
  // hooks than expected" — a hard crash, on the security screen.
  useScreenGuard(phraseOpen);
  useScreenshotWarning(
    () => toast.error("Screenshot saved to your photos — delete it. Photos sync to the cloud."),
    phraseOpen
  );

  if (!isUnlocked) return <Redirect href="/unlock" />;

  const beginEnableBiometrics = async () => {
    const ok = await isBiometricsAvailable();
    if (!ok) {
      // Nothing to decide, so nothing to confirm. The old sheet offered a
      // close icon, an "OK" and a "Cancel" that all did the same thing —
      // three exits from a message that only reports device state.
      toast.error(`${bioLabel} isn’t set up on this device`);
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

  /** Hand a decrypted phrase to the reveal sheet, always hidden to start. */
  const showPhrase = (revealed: {
    mnemonic: string;
    seedLabel: string;
    accountCount: number;
    otherSeedCount: number;
  }) => {
    setPhrase(revealed.mnemonic.trim());
    setPhraseMeta({
      label: revealed.seedLabel,
      accountCount: revealed.accountCount,
      otherSeedCount: revealed.otherSeedCount,
    });
    setPhraseRevealed(false);
    setPhraseOpen(true);
  };

  const closePhrase = () => {
    setPhraseOpen(false);
    setPhraseRevealed(false);
    setPhrase("");
    setPhraseMeta(null);
    // The step-up key has done its job. Dropping the reference here means the
    // decrypted vault key isn't left reachable from this screen's closure
    // after the sheet is gone.
    stepUpKeyRef.current = null;
  };

  const closeSeedPicker = () => {
    setSeedPickerOpen(false);
    stepUpKeyRef.current = null;
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


            <Row
              icon="key-outline"
              title={seeds.length > 1 ? "View recovery phrases" : "View recovery phrase"}
              subtitle={
                seeds.length > 1 ? `${seeds.length} phrases · requires passcode` : "Requires passcode"
              }
              onPress={() => setViewPhrasePending(true)}
            />
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
          // Step-up auth: re-verify the passcode even though the app is
          // already unlocked, then decrypt only what was asked for.
          const { key, seeds: unlockedSeeds, activeAccountId } = await unlockVault(pin);
          setViewPhrasePending(false);

          // More than one phrase means there is a real choice to make, and
          // guessing it for the user is how they end up backing up the wrong
          // one. Ask.
          if (unlockedSeeds.length > 1) {
            stepUpKeyRef.current = key;
            setSeedPickerOpen(true);
            return;
          }

          const revealed = await useAccounts.getState().revealMnemonic(key, activeAccountId);
          if (!revealed?.mnemonic) throw new Error("Recovery phrase unavailable");
          showPhrase(revealed);
        }}
      />

      {/* Which phrase? Only ever shown when the wallet holds more than one.
          Listing them with the same colour and P-tag used in the accounts
          list is what lets someone match "the green one" here to the group
          they saw there. */}
      <FullSheet visible={seedPickerOpen} title="Choose a recovery phrase" onClose={closeSeedPicker}>
        <T color={theme.muted}>
          Each phrase backs up only the accounts under it. Back up all {seeds.length} to cover this
          wallet.
        </T>
        <View style={{ height: SPACING.lg }} />
        <View style={{ gap: SPACING.sm }}>
          {seeds.map((seed, i) => (
            <Pressable
              key={seed.id}
              onPress={async () => {
                const key = stepUpKeyRef.current;
                if (!key) return;
                try {
                  const revealed = await useAccounts.getState().revealSeed(key, seed.id);
                  setSeedPickerOpen(false);
                  showPhrase(revealed);
                } catch {
                  toast.error("Couldn't open that recovery phrase");
                }
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.md,
                padding: SPACING.md,
                borderRadius: RADIUS.xl,
                backgroundColor: theme.surface2,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View style={{ width: 4, height: 34, borderRadius: 2, backgroundColor: seedColor(i) }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T weight="semibold" numberOfLines={1}>
                  {seed.label}
                </T>
                <T variant="caption" color={theme.muted}>
                  {seedTag(i)} · {seed.accountCount} account{seed.accountCount === 1 ? "" : "s"}
                  {seed.isPrimary ? " · original" : ""}
                </T>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.muted} />
            </Pressable>
          ))}
        </View>
      </FullSheet>

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
          {phraseMeta
            ? `Restores ${phraseMeta.accountCount} account${
                phraseMeta.accountCount === 1 ? "" : "s"
              } under ${phraseMeta.label}.` +
              (phraseMeta.otherSeedCount > 0
                ? ` It does NOT cover your other ${phraseMeta.otherSeedCount} phrase${
                    phraseMeta.otherSeedCount === 1 ? "" : "s"
                  } — back ${phraseMeta.otherSeedCount === 1 ? "that one" : "those"} up too.`
                : " Hides after 30 seconds.")
            : "Hides after 30 seconds."}
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

      {/* Erase sheet — the one truly irreversible action in Settings, so it
          gets the same hold-to-confirm gesture as an on-chain broadcast,
          plus an explicit account count instead of vague "your wallet data"
          copy. */}
      <EraseWalletSheet
        visible={eraseOpen}
        accounts={accountsForErase}
        seeds={seeds}
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
