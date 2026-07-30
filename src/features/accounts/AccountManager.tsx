// src/features/accounts/AccountManager.tsx
//
// Accounts, grouped by the recovery phrase they come from.
//
// ─── Why grouped ────────────────────────────────────────────────────────────
//
// A wallet can hold several phrases, and each phrase is an independent backup.
// A flat list of accounts would hide the only fact that matters when a phone
// is lost: WHICH phrase restores WHICH account. So the list is grouped, every
// group carries a colour and a "P1/P2" tag, and each group has its own "Add
// account" — because adding an account is an action on a phrase, not on the
// wallet as a whole.
//
// MetaMask shows the same grouping but keeps a separate "imported accounts"
// bucket that belongs to no phrase and is quietly excluded from any backup.
// There is no such bucket here: every account sits under a phrase, so the
// screen can never imply a coverage that doesn't exist.
//
// Lives under Settings → Accounts; the switcher row is reused on Home.
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import * as Clipboard from "expo-clipboard";
import { hapticSelect, hapticSuccess } from "@/src/lib/haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { toast } from "@/src/state/toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SCREEN_PADDING, SPACING } from "@/src/theme/tokens";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { useNotificationFeed } from "@/src/state/notificationsFeed";
import { unregisterAddressForPush } from "@/src/lib/notifications/register";
import { seedColor, seedTag } from "./seedVisuals";
import type { Account, SeedInfo } from "@/src/lib/crypto/vault";

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function initialsFor(label: string) {
  const parts = label.trim().split(/\s+/);
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : label.slice(0, 2);
  return s.toUpperCase();
}

function Avatar({ label, active, tint }: { label: string; active: boolean; tint?: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: RADIUS.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? theme.primary : theme.surface2,
        // A thin ring in the phrase's colour, so an account is attributable
        // even in the compact rows where the group header isn't visible.
        borderWidth: tint ? 2 : 0,
        borderColor: tint ?? "transparent",
      }}
    >
      <T weight="bold" style={{ color: active ? theme.bg : theme.text, fontSize: 14 }}>
        {initialsFor(label)}
      </T>
    </View>
  );
}

/** The "P1" chip. Colour AND text, never colour alone — see seedVisuals. */
function SeedChip({ index, small }: { index: number; small?: boolean }) {
  const color = seedColor(index);
  return (
    <View
      style={{
        paddingHorizontal: small ? 5 : 7,
        paddingVertical: small ? 1 : 2,
        borderRadius: 999,
        backgroundColor: `${color}22`,
        borderWidth: 1,
        borderColor: color,
      }}
    >
      <T weight="bold" color={color} style={{ fontSize: small ? 9 : 10 }}>
        {seedTag(index)}
      </T>
    </View>
  );
}

// Backdrop is intentionally NOT dismiss-on-tap. In a wallet, an accidental
// edge-tap that silently closes a sheet mid-action is worse than one extra
// deliberate tap on a close button — every sheet here has an explicit
// close/cancel affordance instead. Every sheet is also full-screen: the old
// half-sheet left a blurred strip down both edges and a card floating in the
// middle, which made a wallet action look like a cookie banner.
function Backdrop({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.bg }}>{children}</View>;
}

function SheetShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        // Safe area on BOTH ends: the header never slides under the notch,
        // and the last control never sits under the home indicator or an
        // Android gesture bar.
        paddingTop: insets.top + SPACING.md,
        paddingHorizontal: SCREEN_PADDING,
        paddingBottom: Math.max(insets.bottom, SPACING.lg),
        gap: SPACING.md,
      }}
    >
      {children}
    </View>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
        {title}
      </T>
      <Pressable hitSlop={6} onPress={onClose} style={{ padding: 8 }}>
        <Ionicons name="close" size={18} color={theme.text} />
      </Pressable>
    </View>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { theme } = useTheme();
  const tint = danger ? theme.danger : theme.text;
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: SPACING.md,
        paddingVertical: 14,
        paddingHorizontal: 4,
        borderRadius: RADIUS.md,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={19} color={tint} />
      <T weight="semibold" color={tint}>
        {label}
      </T>
    </Pressable>
  );
}

/* ------------------------- import another phrase --------------------------- */

/**
 * Adds a whole recovery phrase, not a single account.
 *
 * The distinction is the point: once the phrase is in, its accounts are added
 * with the same "Add account" button as the original phrase's. Nothing about
 * it is second-class, so the copy can promise that without qualification.
 */
function ImportPhraseSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const vaultKey = useSession((s) => s.vaultKey);
  const addSeed = useAccounts((s) => s.addSeed);

  const [mnemonic, setMnemonic] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live feedback while typing. A phrase is 12 or 24 words — anything else is
  // definitely wrong, and saying so *during* entry beats failing after the tap.
  const words = useMemo(() => mnemonic.trim().split(/\s+/).filter(Boolean), [mnemonic]);
  const complete = words.length === 12 || words.length === 24;
  const invalid = words.length > 12 && !complete;
  const countLabel = words.length > 12 ? "24-word" : "12- or 24-word";

  const close = () => {
    setMnemonic("");
    setLabel("");
    setErr(null);
    setBusy(false);
    onClose();
  };

  const confirm = async () => {
    if (!vaultKey) return;
    const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
    setErr(null);

    try {
      ethers.HDNodeWallet.fromPhrase(cleaned);
    } catch {
      setErr("That recovery phrase doesn't look valid.");
      return;
    }

    setBusy(true);
    try {
      await addSeed(vaultKey, { mnemonic: cleaned, label: label.trim() || undefined });
      hapticSuccess();
      toast.success("Recovery phrase added");
      close();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add recovery phrase");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="overFullScreen"
      transparent={false}
      statusBarTranslucent
      onRequestClose={close}
    >
      <Backdrop>
        <SheetShell>
          <SheetHeader title="Add recovery phrase" onClose={close} />

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.md }}>
            <View
              style={{
                flexDirection: "row",
                gap: SPACING.sm,
                padding: SPACING.md,
                borderRadius: RADIUS.lg,
                backgroundColor: theme.surface2,
              }}
            >
              <Ionicons name="information-circle-outline" size={18} color={theme.muted} />
              <T variant="caption" color={theme.muted} style={{ flex: 1 }}>
                Type or paste your {countLabel} recovery phrase, with a single space between each
                word. Order matters. We never send it anywhere — it&apos;s encrypted on this device
                only. Its first account is added now; you can add the rest with “Add account”.
              </T>
            </View>

            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T variant="caption" color={theme.muted}>
                  Recovery phrase
                </T>
                <Pressable
                  onPress={async () => {
                    const s = await Clipboard.getStringAsync();
                    if (s?.trim()) {
                      setMnemonic(s.trim().toLowerCase().replace(/\s+/g, " "));
                      toast.success("Phrase pasted");
                    } else {
                      toast.error("Clipboard is empty");
                    }
                  }}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    padding: 4,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons name="clipboard-outline" size={14} color={theme.accent} />
                  <T variant="caption" weight="semibold" color={theme.accent}>
                    Paste
                  </T>
                </Pressable>
              </View>

              <TextInput
                value={mnemonic}
                onChangeText={setMnemonic}
                placeholder="ridge  olive  fabric  sunset  …"
                placeholderTextColor={theme.muted}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                textContentType="none"
                style={{
                  minHeight: 110,
                  textAlignVertical: "top",
                  borderRadius: RADIUS.md,
                  borderWidth: 1.5,
                  borderColor: invalid ? theme.danger : complete ? theme.positive : theme.border,
                  backgroundColor: theme.surface2,
                  padding: SPACING.md,
                  color: theme.text,
                  fontSize: 16,
                  lineHeight: 24,
                }}
              />

              {/* Live word counter — the single most useful signal when
                  entering a phrase, and the thing people most often get wrong
                  (a missing or duplicated word). */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T variant="caption" color={invalid ? theme.danger : complete ? theme.positive : theme.muted}>
                  {words.length === 0 ? "0 words" : `${words.length} word${words.length === 1 ? "" : "s"}`}
                  {complete ? " · looks right" : ""}
                </T>
                {mnemonic ? (
                  <Pressable
                    onPress={() => setMnemonic("")}
                    hitSlop={8}
                    style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
                  >
                    <T variant="caption" weight="semibold" color={theme.muted}>
                      Clear
                    </T>
                  </Pressable>
                ) : null}
              </View>

              {invalid ? (
                <T variant="caption" color={theme.danger}>
                  A recovery phrase is 12 or 24 words. You have {words.length}.
                </T>
              ) : null}
            </View>

            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Name this phrase (optional) e.g. Trading"
              placeholderTextColor={theme.muted}
              style={{
                borderRadius: RADIUS.md,
                backgroundColor: theme.surface2,
                padding: SPACING.md,
                color: theme.text,
              }}
            />

            {err ? <T color={theme.danger}>{err}</T> : null}

            <Button title="Add phrase" loading={busy} disabled={!complete} onPress={confirm} />
            <Button title="Cancel" variant="outline" disabled={busy} onPress={close} />
          </ScrollView>
        </SheetShell>
      </Backdrop>
    </Modal>
  );
}

/* ------------------------------ the manager -------------------------------- */

export function AccountManager() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const vaultKey = useSession((s) => s.vaultKey);
  const accounts = useAccounts((s) => s.accounts);
  const seeds = useAccounts((s) => s.seeds);
  const activeAccountId = useAccounts((s) => s.activeAccountId);
  const switchAccount = useAccounts((s) => s.switchAccount);
  const addDerivedAccount = useAccounts((s) => s.addDerivedAccount);
  const renameAccount = useAccounts((s) => s.renameAccount);
  const renameSeed = useAccounts((s) => s.renameSeed);
  const hideAccount = useAccounts((s) => s.hideAccount);
  const unhideAccount = useAccounts((s) => s.unhideAccount);
  const removeSeed = useAccounts((s) => s.removeSeed);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? accounts[0] ?? null;
  const seedIndexById = useMemo(() => {
    const map: Record<string, number> = {};
    seeds.forEach((s, i) => (map[s.id] = i));
    return map;
  }, [seeds]);

  const [manageOpen, setManageOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [hiding, setHiding] = useState<Account | null>(null);
  /** Which phrase's hidden accounts are expanded. */
  const [showHiddenFor, setShowHiddenFor] = useState<Record<string, boolean>>({});
  const [renamingSeed, setRenamingSeed] = useState<SeedInfo | null>(null);
  const [seedLabel, setSeedLabel] = useState("");
  const [removingSeed, setRemovingSeed] = useState<SeedInfo | null>(null);
  /** Which account's 3-dot action menu is open (null = none). */
  const [actionsFor, setActionsFor] = useState<Account | null>(null);
  /** Which phrase's action menu is open. */
  const [seedActionsFor, setSeedActionsFor] = useState<SeedInfo | null>(null);
  /** Seed id currently having an account added, for a per-group spinner. */
  const [addingTo, setAddingTo] = useState<string | null>(null);

  // RN's <Modal> stacks badly — presenting a second Modal while the manage
  // sheet's Modal is still visible reliably freezes touch handling. So these
  // sub-sheets are mutually exclusive with the manage sheet: close it before
  // opening one, and reopen it when the sub-sheet closes.
  const openImport = () => {
    setManageOpen(false);
    setImportOpen(true);
  };
  const closeImport = () => {
    setImportOpen(false);
    setManageOpen(true);
  };
  const openEdit = (a: Account) => {
    setActionsFor(null);
    setManageOpen(false);
    setEditing(a);
    setEditLabel(a.label);
  };
  const closeEdit = () => {
    setEditing(null);
    setManageOpen(true);
  };
  const openHide = (a: Account) => {
    setActionsFor(null);
    setManageOpen(false);
    setHiding(a);
  };
  const closeHide = () => {
    setHiding(null);
    setManageOpen(true);
  };
  const openRenameSeed = (s: SeedInfo) => {
    setSeedActionsFor(null);
    setManageOpen(false);
    setRenamingSeed(s);
    setSeedLabel(s.label);
  };
  const closeRenameSeed = () => {
    setRenamingSeed(null);
    setManageOpen(true);
  };
  const openRemoveSeed = (s: SeedInfo) => {
    setSeedActionsFor(null);
    setManageOpen(false);
    setRemovingSeed(s);
  };
  const closeRemoveSeed = () => {
    setRemovingSeed(null);
    setManageOpen(true);
  };

  const addAccountTo = async (seed: SeedInfo) => {
    if (!vaultKey || addingTo) return;
    setAddingTo(seed.id);
    try {
      const account = await addDerivedAccount(vaultKey, { seedId: seed.id });
      hapticSuccess();
      toast.success(`${account.label} added to ${seed.label}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add account");
    } finally {
      setAddingTo(null);
    }
  };

  const activeSeedIndex = activeAccount ? seedIndexById[activeAccount.seedId] ?? 0 : 0;

  return (
    <View style={{ gap: SPACING.sm }}>
      {/* Collapsed summary — tapping opens the full list in a sheet, so
          Settings doesn't scroll forever once someone has several accounts. */}
      <Pressable
        hitSlop={6}
        onPress={() => setManageOpen(true)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.md,
          padding: SPACING.md,
          borderRadius: RADIUS.xl,
          backgroundColor: theme.surface2,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {activeAccount ? (
          <Avatar
            label={activeAccount.label}
            active
            tint={seeds.length > 1 ? seedColor(activeSeedIndex) : undefined}
          />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <T weight="semibold" numberOfLines={1}>
            {activeAccount?.label ?? "No account"}
          </T>
          <T variant="caption" color={theme.muted} numberOfLines={1}>
            {activeAccount ? shortAddr(activeAccount.address) : ""}
            {accounts.length > 1 ? `  ·  ${accounts.length} accounts` : ""}
            {seeds.length > 1 ? `  ·  ${seeds.length} phrases` : ""}
          </T>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.muted} />
      </Pressable>

      {/* Full manage sheet */}
      <Modal
        visible={manageOpen}
        animationType="slide"
        presentationStyle="overFullScreen"
        transparent={false}
        statusBarTranslucent
        onRequestClose={() => setManageOpen(false)}
      >
        <Backdrop>
          <SheetShell>
            <SheetHeader title="Accounts" onClose={() => setManageOpen(false)} />

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.lg }}>
              <View style={{ gap: SPACING.lg }}>
                {seeds.map((seed, seedIdx) => {
                  const color = seedColor(seedIdx);
                  const group = accounts.filter((a) => a.seedId === seed.id && !a.hidden);
                  const hiddenGroup = accounts.filter((a) => a.seedId === seed.id && a.hidden);
                  const hiddenShown = !!showHiddenFor[seed.id];

                  return (
                    <View key={seed.id} style={{ gap: SPACING.sm }}>
                      {/* ── Group header: which phrase these accounts need ── */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 }}>
                        <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: color }} />
                        <SeedChip index={seedIdx} />
                        <T weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {seed.label}
                        </T>
                        <T variant="caption" color={theme.muted}>
                          {group.length} account{group.length === 1 ? "" : "s"}
                        </T>
                        <View style={{ flex: 1 }} />
                        <Pressable
                          onPress={() => setSeedActionsFor(seed)}
                          hitSlop={10}
                          style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
                          accessibilityLabel={`Actions for ${seed.label}`}
                        >
                          <Ionicons name="ellipsis-horizontal" size={16} color={theme.muted} />
                        </Pressable>
                      </View>

                      {group.map((a) => {
                        const active = a.id === activeAccountId;
                        return (
                          <Pressable
                            hitSlop={6}
                            key={a.id}
                            onPress={async () => {
                              if (active) return;
                              hapticSelect();
                              await switchAccount(a.id);
                              toast.success(`Switched to ${a.label}`);
                            }}
                            style={({ pressed }) => ({
                              flexDirection: "row",
                              alignItems: "center",
                              gap: SPACING.md,
                              padding: SPACING.md,
                              borderRadius: RADIUS.xl,
                              backgroundColor: theme.surface2,
                              // The active account is called out with a border
                              // rather than a different fill, so row heights
                              // and rhythm stay identical down the list.
                              borderWidth: 1.5,
                              borderColor: active ? theme.primary : "transparent",
                              opacity: pressed ? 0.9 : 1,
                            })}
                          >
                            <Avatar label={a.label} active={active} />

                            <View style={{ flex: 1, minWidth: 0 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <T weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
                                  {a.label}
                                </T>
                                {active ? (
                                  <View
                                    style={{
                                      paddingHorizontal: 7,
                                      paddingVertical: 2,
                                      borderRadius: 999,
                                      backgroundColor: theme.primary,
                                    }}
                                  >
                                    <T variant="caption" weight="bold" style={{ color: theme.bg, fontSize: 10 }}>
                                      ACTIVE
                                    </T>
                                  </View>
                                ) : null}
                              </View>
                              <T variant="caption" color={theme.muted} numberOfLines={1}>
                                {shortAddr(a.address)}
                              </T>
                            </View>

                            {/* All per-account actions live behind one 3-dot
                                menu — keeps each row to a single clean line
                                instead of competing icons. */}
                            <Pressable
                              onPress={() => setActionsFor(a)}
                              hitSlop={10}
                              style={({ pressed }) => ({
                                width: 34,
                                height: 34,
                                borderRadius: 999,
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: theme.bg,
                                opacity: pressed ? 0.7 : 1,
                              })}
                              accessibilityLabel={`Actions for ${a.label}`}
                            >
                              <Ionicons name="ellipsis-horizontal" size={16} color={theme.text} />
                            </Pressable>
                          </Pressable>
                        );
                      })}

                      {/* Hidden accounts, collapsed. Listed by name so
                          unhiding is exact — "Add account" would mint a NEW
                          index instead, which is the trap this avoids. */}
                      {hiddenGroup.length > 0 ? (
                        <View style={{ gap: SPACING.sm }}>
                          <Pressable
                            hitSlop={6}
                            onPress={() =>
                              setShowHiddenFor((m) => ({ ...m, [seed.id]: !m[seed.id] }))
                            }
                            style={({ pressed }) => ({
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              paddingVertical: 6,
                              paddingHorizontal: 2,
                              opacity: pressed ? 0.6 : 1,
                            })}
                          >
                            <Ionicons
                              name={hiddenShown ? "chevron-down" : "chevron-forward"}
                              size={14}
                              color={theme.muted}
                            />
                            <T variant="caption" weight="semibold" color={theme.muted}>
                              {hiddenGroup.length} hidden account
                              {hiddenGroup.length === 1 ? "" : "s"}
                            </T>
                          </Pressable>

                          {hiddenShown
                            ? hiddenGroup.map((a) => (
                                <View
                                  key={a.id}
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: SPACING.md,
                                    padding: SPACING.md,
                                    borderRadius: RADIUS.xl,
                                    backgroundColor: theme.surface2,
                                    opacity: 0.75,
                                  }}
                                >
                                  <Avatar label={a.label} active={false} />
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <T weight="semibold" numberOfLines={1}>
                                      {a.label}
                                    </T>
                                    <T variant="caption" color={theme.muted} numberOfLines={1}>
                                      {shortAddr(a.address)}
                                    </T>
                                  </View>
                                  <Pressable
                                    hitSlop={8}
                                    onPress={async () => {
                                      await unhideAccount(a.id);
                                      hapticSuccess();
                                      toast.success(`${a.label} is back`);
                                    }}
                                    style={({ pressed }) => ({
                                      flexDirection: "row",
                                      alignItems: "center",
                                      gap: 5,
                                      paddingVertical: 7,
                                      paddingHorizontal: 11,
                                      borderRadius: 999,
                                      backgroundColor: theme.bg,
                                      opacity: pressed ? 0.7 : 1,
                                    })}
                                  >
                                    <Ionicons name="eye-outline" size={14} color={theme.text} />
                                    <T variant="caption" weight="semibold">
                                      Unhide
                                    </T>
                                  </Pressable>
                                </View>
                              ))
                            : null}
                        </View>
                      ) : null}

                      {/* Add is scoped to THIS phrase, and says so. One tap:
                          there is no phrase to show and nothing to confirm. */}
                      <Pressable
                        hitSlop={6}
                        onPress={() => addAccountTo(seed)}
                        disabled={addingTo === seed.id}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: SPACING.sm,
                          paddingVertical: 12,
                          paddingHorizontal: SPACING.md,
                          borderRadius: RADIUS.xl,
                          borderWidth: 1.5,
                          borderColor: theme.border,
                          borderStyle: "dashed",
                          opacity: pressed || addingTo === seed.id ? 0.6 : 1,
                        })}
                      >
                        <Ionicons
                          name={addingTo === seed.id ? "hourglass-outline" : "add"}
                          size={18}
                          color={theme.muted}
                        />
                        <T variant="caption" weight="semibold" color={theme.muted}>
                          {addingTo === seed.id ? "Adding…" : `Add account to ${seed.label}`}
                        </T>
                      </Pressable>
                    </View>
                  );
                })}

                {/* ── Another phrase entirely ─────────────────────────────── */}
                <Pressable
                  hitSlop={6}
                  onPress={openImport}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.md,
                    padding: SPACING.md,
                    borderRadius: RADIUS.xl,
                    backgroundColor: theme.surface2,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: RADIUS.md,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme.bg,
                    }}
                  >
                    <Ionicons name="download-outline" size={20} color={theme.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T weight="semibold">Add a recovery phrase</T>
                    <T variant="caption" color={theme.muted}>
                      Bring in another wallet — all of its accounts
                    </T>
                  </View>
                </Pressable>

                {/* Says the thing that a grouped list implies but shouldn't
                    leave to inference. Only shown once it applies. */}
                {seeds.length > 1 ? (
                  <View
                    style={{
                      flexDirection: "row",
                      gap: SPACING.sm,
                      padding: SPACING.md,
                      borderRadius: RADIUS.lg,
                      backgroundColor: theme.surface2,
                    }}
                  >
                    <Ionicons name="key-outline" size={16} color={theme.muted} />
                    <T variant="caption" color={theme.muted} style={{ flex: 1 }}>
                      Each phrase restores only the accounts listed under it. Back up all{" "}
                      {seeds.length} to cover this wallet.
                    </T>
                  </View>
                ) : null}
              </View>
            </ScrollView>
          </SheetShell>
        </Backdrop>

        {/* Per-account action menu. Rendered *inside* this same Modal as an
            overlay rather than as its own <Modal> — stacking two native
            Modals is what froze touch handling before. */}
        {actionsFor ? (
          <View style={StyleSheet.absoluteFill}>
            <Pressable
              hitSlop={6}
              onPress={() => setActionsFor(null)}
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}
            >
              <Pressable
                hitSlop={6}
                onPress={() => {}}
                style={{
                  backgroundColor: theme.bgElevated,
                  borderTopLeftRadius: RADIUS.xxl,
                  borderTopRightRadius: RADIUS.xxl,
                  paddingTop: SPACING.lg,
                  paddingHorizontal: SPACING.lg,
                  paddingBottom: Math.max(insets.bottom, SPACING.lg),
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.sm }}>
                  <Avatar label={actionsFor.label} active={actionsFor.id === activeAccountId} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T weight="bold" numberOfLines={1}>
                      {actionsFor.label}
                    </T>
                    <T variant="caption" color={theme.muted} numberOfLines={1}>
                      {shortAddr(actionsFor.address)}
                    </T>
                  </View>
                  {seeds.length > 1 ? <SeedChip index={seedIndexById[actionsFor.seedId] ?? 0} /> : null}
                </View>

                <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 4 }} />

                <ActionRow
                  icon="copy-outline"
                  label="Copy address"
                  onPress={async () => {
                    const a = actionsFor;
                    setActionsFor(null);
                    await Clipboard.setStringAsync(a.address);
                    toast.success("Address copied");
                  }}
                />
                <ActionRow icon="pencil-outline" label="Rename account" onPress={() => openEdit(actionsFor)} />
                {/* "Hide", not "Remove". The address is on the blockchain and
                    cannot be deleted by anyone; calling it deletion would tell
                    the user something false about their funds. */}
                {accounts.filter((a) => !a.hidden).length > 1 ? (
                  <ActionRow icon="eye-off-outline" label="Hide account" onPress={() => openHide(actionsFor)} />
                ) : null}

                <View style={{ height: SPACING.sm }} />
                <Button title="Cancel" variant="outline" onPress={() => setActionsFor(null)} />
              </Pressable>
            </Pressable>
          </View>
        ) : null}

        {/* Per-phrase action menu, same overlay technique. */}
        {seedActionsFor ? (
          <View style={StyleSheet.absoluteFill}>
            <Pressable
              hitSlop={6}
              onPress={() => setSeedActionsFor(null)}
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}
            >
              <Pressable
                hitSlop={6}
                onPress={() => {}}
                style={{
                  backgroundColor: theme.bgElevated,
                  borderTopLeftRadius: RADIUS.xxl,
                  borderTopRightRadius: RADIUS.xxl,
                  paddingTop: SPACING.lg,
                  paddingHorizontal: SPACING.lg,
                  paddingBottom: Math.max(insets.bottom, SPACING.lg),
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingBottom: SPACING.sm }}>
                  <SeedChip index={seedIndexById[seedActionsFor.id] ?? 0} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T weight="bold" numberOfLines={1}>
                      {seedActionsFor.label}
                    </T>
                    <T variant="caption" color={theme.muted} numberOfLines={1}>
                      {seedActionsFor.accountCount} account
                      {seedActionsFor.accountCount === 1 ? "" : "s"}
                      {seedActionsFor.isPrimary ? " · your original phrase" : ""}
                    </T>
                  </View>
                </View>

                <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 4 }} />

                <ActionRow
                  icon="pencil-outline"
                  label="Rename phrase"
                  onPress={() => openRenameSeed(seedActionsFor)}
                />
                {/* The original phrase can't be removed — that would leave a
                    wallet whose first accounts are unreachable while the app
                    still claims a wallet exists. Erase Wallet is the honest
                    action for that, and it lives in Settings. */}
                {!seedActionsFor.isPrimary ? (
                  <ActionRow
                    icon="trash-outline"
                    label="Remove phrase"
                    danger
                    onPress={() => openRemoveSeed(seedActionsFor)}
                  />
                ) : null}

                <View style={{ height: SPACING.sm }} />
                <Button title="Cancel" variant="outline" onPress={() => setSeedActionsFor(null)} />
              </Pressable>
            </Pressable>
          </View>
        ) : null}
      </Modal>

      <ImportPhraseSheet visible={importOpen} onClose={closeImport} />

      {/* Rename account */}
      <Modal
        visible={!!editing}
        animationType="slide"
        presentationStyle="overFullScreen"
        transparent={false}
        statusBarTranslucent
        onRequestClose={closeEdit}
      >
        <Backdrop>
          <SheetShell>
            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
              Rename account
            </T>
            <TextInput
              value={editLabel}
              onChangeText={setEditLabel}
              placeholder="Account name"
              placeholderTextColor={theme.muted}
              style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface2, padding: SPACING.md, color: theme.text }}
            />
            <Button
              title="Save"
              onPress={async () => {
                if (editing && editLabel.trim()) await renameAccount(editing.id, editLabel.trim());
                closeEdit();
              }}
            />
            <Button title="Cancel" variant="outline" onPress={closeEdit} />
          </SheetShell>
        </Backdrop>
      </Modal>

      {/* Rename phrase */}
      <Modal
        visible={!!renamingSeed}
        animationType="slide"
        presentationStyle="overFullScreen"
        transparent={false}
        statusBarTranslucent
        onRequestClose={closeRenameSeed}
      >
        <Backdrop>
          <SheetShell>
            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
              Rename recovery phrase
            </T>
            <T color={theme.muted}>
              A name only you see — it helps you tell your phrases apart when backing them up.
            </T>
            <TextInput
              value={seedLabel}
              onChangeText={setSeedLabel}
              placeholder="e.g. Main, Trading, Cold storage"
              placeholderTextColor={theme.muted}
              style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface2, padding: SPACING.md, color: theme.text }}
            />
            <Button
              title="Save"
              onPress={async () => {
                if (renamingSeed && seedLabel.trim()) await renameSeed(renamingSeed.id, seedLabel.trim());
                closeRenameSeed();
              }}
            />
            <Button title="Cancel" variant="outline" onPress={closeRenameSeed} />
          </SheetShell>
        </Backdrop>
      </Modal>

      {/* Hide account */}
      <Modal
        visible={!!hiding}
        animationType="slide"
        presentationStyle="overFullScreen"
        transparent={false}
        statusBarTranslucent
        onRequestClose={closeHide}
      >
        <Backdrop>
          <SheetShell>
            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
              Hide this account?
            </T>
            <T color={theme.muted}>
              “{hiding?.label}” disappears from your accounts list. It is not deleted — the address
              stays on the blockchain with everything in it, and you can unhide it any time from
              this screen.
            </T>
            <Button
              title="Hide account"
              onPress={async () => {
                if (hiding) {
                  const { id, address } = hiding;
                  await hideAccount(id);
                  // Stop watching an account the user isn't looking at. Both
                  // are restored on unhide by the normal registration pass.
                  unregisterAddressForPush(address).catch(() => {});
                  toast.success("Account hidden");
                }
                closeHide();
              }}
            />
            <Button title="Cancel" variant="outline" onPress={closeHide} />
          </SheetShell>
        </Backdrop>
      </Modal>

      {/* Remove phrase */}
      <Modal
        visible={!!removingSeed}
        animationType="slide"
        presentationStyle="overFullScreen"
        transparent={false}
        statusBarTranslucent
        onRequestClose={closeRemoveSeed}
      >
        <Backdrop>
          <SheetShell>
            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
              Remove this phrase from this device?
            </T>
            {/* Same principle as hiding an account, applied one level up: the
                accounts are not being destroyed, because they can't be. What
                is being removed is this device's stored copy of the words. Say
                exactly that, so the user judges the real risk — "do I have
                these words?" — instead of a scarier imaginary one. */}
            <T color={theme.muted}>
              “{removingSeed?.label}” and its {removingSeed?.accountCount} account
              {removingSeed?.accountCount === 1 ? "" : "s"} stop showing in this app. The accounts
              themselves live on the blockchain and are not deleted — add the phrase again and they
              all come back, balances included.
            </T>
            <View
              style={{
                flexDirection: "row",
                gap: SPACING.sm,
                padding: SPACING.md,
                borderRadius: RADIUS.lg,
                backgroundColor: theme.surface2,
              }}
            >
              <Ionicons name="warning-outline" size={18} color={theme.danger} />
              <T variant="caption" color={theme.muted} style={{ flex: 1 }}>
                So the only question that matters: do you have those 12 or 24 words written down?
                This is the last place they can be shown. Without them, no one — not us, not any
                wallet — can reach those accounts again.
              </T>
            </View>
            <Button
              title="Remove phrase"
              onPress={async () => {
                if (removingSeed) {
                  const doomed = accounts.filter((a) => a.seedId === removingSeed.id);
                  await removeSeed(removingSeed.id);
                  for (const a of doomed) {
                    unregisterAddressForPush(a.address).catch(() => {});
                    useNotificationFeed.getState().removeForAccount(a.id).catch(() => {});
                  }
                  toast.success("Recovery phrase removed from this device");
                }
                closeRemoveSeed();
              }}
            />
            <Button title="Cancel" variant="outline" onPress={closeRemoveSeed} />
          </SheetShell>
        </Backdrop>
      </Modal>
    </View>
  );
}
