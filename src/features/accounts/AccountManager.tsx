// src/features/accounts/AccountManager.tsx
//
// Dual/multi-account management UI: switch, add (create or import), rename,
// remove. Lives under Settings → Accounts, and its switcher row is reused on
// the Home dashboard.
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { toast } from "@/src/state/toast";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SPACING } from "@/src/theme/tokens";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { useNotificationFeed } from "@/src/state/notificationsFeed";
import { createWallet } from "@/src/lib/chain/wallet";
import { unregisterAddressForPush } from "@/src/lib/notifications/register";
import type { Account } from "@/src/lib/crypto/vault";

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

function initialsFor(label: string) {
  const parts = label.trim().split(/\s+/);
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : label.slice(0, 2);
  return s.toUpperCase();
}

function Avatar({ label, active }: { label: string; active: boolean }) {
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
      }}
    >
      <T weight="bold" style={{ color: active ? theme.bg : theme.text, fontSize: 14 }}>
        {initialsFor(label)}
      </T>
    </View>
  );
}

// Backdrop is intentionally NOT dismiss-on-tap. In a wallet, an accidental
// edge-tap that silently closes a sheet mid-action is worse than one extra
// deliberate tap on a close button — every sheet here has an explicit
// close/cancel affordance instead.
function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, justifyContent: "flex-end" }}>{children}</View>
    </View>
  );
}

// Full-bleed sheet: edge-to-edge horizontally so account rows get the whole
// screen width to breathe, rounded only at the top like a native sheet.
function SheetShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: theme.bgElevated,
        borderTopLeftRadius: RADIUS.xxl,
        borderTopRightRadius: RADIUS.xxl,
        paddingTop: SPACING.lg,
        paddingHorizontal: SPACING.lg,
        paddingBottom: Math.max(insets.bottom, SPACING.lg),
        gap: SPACING.md,
        maxHeight: "88%",
      }}
    >
      {children}
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

function AddAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const vaultKey = useSession((s) => s.vaultKey);
  const addAccount = useAccounts((s) => s.addAccount);

  const [mode, setMode] = useState<"choose" | "create" | "import">("choose");
  const [mnemonic, setMnemonic] = useState("");
  const [phrase, setPhrase] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const words = useMemo(() => phrase.split(" ").filter(Boolean), [phrase]);

  // Live feedback for the import field. A recovery phrase is 12 or 24
  // words — anything else is definitely wrong, and telling the user that
  // *while they type* beats failing after they hit the button.
  const importWords = useMemo(() => mnemonic.trim().split(/\s+/).filter(Boolean), [mnemonic]);
  const importPhraseComplete = importWords.length === 12 || importWords.length === 24;
  const importPhraseInvalid = importWords.length > 0 && !importPhraseComplete && importWords.length > 12;
  const importWordCountLabel = importWords.length > 12 ? "24-word" : "12- or 24-word";

  const reset = () => {
    setMode("choose");
    setMnemonic("");
    setPhrase("");
    setLabel("");
    setErr(null);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const beginCreate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const w = await createWallet();
      setPhrase(w.mnemonic);
      setMode("create");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to generate account");
    } finally {
      setBusy(false);
    }
  };

  const confirmCreate = async () => {
    if (!vaultKey) return;
    setBusy(true);
    setErr(null);
    try {
      await addAccount(vaultKey, { mnemonic: phrase, label: label.trim() || undefined });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      close();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add account");
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
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
      await addAccount(vaultKey, { mnemonic: cleaned, label: label.trim() || undefined });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      close();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <Backdrop>
        <SheetShell>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.md }}>
              <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>
                {mode === "choose" ? "Add account" : mode === "create" ? "New account" : "Import account"}
              </T>
              <Pressable onPress={close} style={{ padding: 8 }}>
                <Ionicons name="close" size={18} color={theme.text} />
              </Pressable>
            </View>

            {mode === "choose" ? (
              <View style={{ gap: SPACING.md }}>
                <T color={theme.muted}>Manage more than one wallet inside Decent Wallet — switch instantly, no need to sign out.</T>
                <Pressable
                  onPress={beginCreate}
                  disabled={busy}
                  style={({ pressed }) => ({
                    padding: SPACING.lg,
                    borderRadius: RADIUS.lg,
                    backgroundColor: theme.surface2,
                    opacity: pressed ? 0.7 : 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.md,
                  })}
                >
                  <Ionicons name="add-circle-outline" size={22} color={theme.text} />
                  <View style={{ flex: 1 }}>
                    <T weight="semibold">Create a new account</T>
                    <T variant="caption" color={theme.muted}>Generates a brand-new recovery phrase</T>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => setMode("import")}
                  disabled={busy}
                  style={({ pressed }) => ({
                    padding: SPACING.lg,
                    borderRadius: RADIUS.lg,
                    backgroundColor: theme.surface2,
                    opacity: pressed ? 0.7 : 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.md,
                  })}
                >
                  <Ionicons name="download-outline" size={22} color={theme.text} />
                  <View style={{ flex: 1 }}>
                    <T weight="semibold">Import an existing account</T>
                    <T variant="caption" color={theme.muted}>Use a 12 or 24-word recovery phrase</T>
                  </View>
                </Pressable>
              </View>
            ) : null}

            {mode === "create" ? (
              <View style={{ gap: SPACING.md }}>
                <T color={theme.muted}>Write these words down. This is the only way to recover this account.</T>
                <View style={{ borderRadius: RADIUS.lg, backgroundColor: theme.surface2, padding: SPACING.md }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {words.map((w, i) => (
                      <View key={`${w}-${i}`} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: theme.bg, flexDirection: "row", gap: 6 }}>
                        <T variant="caption" color={theme.muted}>{i + 1}</T>
                        <T weight="semibold">{w}</T>
                      </View>
                    ))}
                  </View>
                </View>

                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Label (optional) e.g. Savings"
                  placeholderTextColor={theme.muted}
                  style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface2, padding: SPACING.md, color: theme.text }}
                />

                {err ? <T color={theme.danger}>{err}</T> : null}

                <Button title="I saved it — add account" loading={busy} onPress={confirmCreate} />
                <Button title="Back" variant="outline" disabled={busy} onPress={() => setMode("choose")} />
              </View>
            ) : null}

            {mode === "import" ? (
              <View style={{ gap: SPACING.md }}>
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
                    Type or paste your {importWordCountLabel} recovery phrase below, with a single space between each
                    word. Order matters. We never send it anywhere — it&apos;s encrypted on this device only.
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
                      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, padding: 4, opacity: pressed ? 0.6 : 1 })}
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
                      borderColor: importPhraseInvalid ? theme.danger : importPhraseComplete ? theme.positive : theme.border,
                      backgroundColor: theme.surface2,
                      padding: SPACING.md,
                      color: theme.text,
                      fontSize: 16,
                      lineHeight: 24,
                    }}
                  />

                  {/* Live word counter — the single most useful signal when
                      entering a phrase, and the thing people most often get
                      wrong (a missing or duplicated word). */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <T
                      variant="caption"
                      color={importPhraseInvalid ? theme.danger : importPhraseComplete ? theme.positive : theme.muted}
                    >
                      {importWords.length === 0
                        ? "0 words"
                        : `${importWords.length} word${importWords.length === 1 ? "" : "s"}`}
                      {importPhraseComplete ? " · looks right" : ""}
                    </T>
                    {mnemonic ? (
                      <Pressable onPress={() => setMnemonic("")} hitSlop={8} style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}>
                        <T variant="caption" weight="semibold" color={theme.muted}>
                          Clear
                        </T>
                      </Pressable>
                    ) : null}
                  </View>

                  {importPhraseInvalid ? (
                    <T variant="caption" color={theme.danger}>
                      A recovery phrase is 12 or 24 words. You have {importWords.length}.
                    </T>
                  ) : null}
                </View>
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Label (optional) e.g. Trading"
                  placeholderTextColor={theme.muted}
                  style={{ borderRadius: RADIUS.md, backgroundColor: theme.surface2, padding: SPACING.md, color: theme.text }}
                />

                {err ? <T color={theme.danger}>{err}</T> : null}

                <Button title="Add account" loading={busy} disabled={!importPhraseComplete} onPress={confirmImport} />
                <Button title="Back" variant="outline" disabled={busy} onPress={() => setMode("choose")} />
              </View>
            ) : null}
          </ScrollView>
        </SheetShell>
      </Backdrop>
    </Modal>
  );
}

export function AccountManager() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const accounts = useAccounts((s) => s.accounts);
  const activeAccountId = useAccounts((s) => s.activeAccountId);
  const switchAccount = useAccounts((s) => s.switchAccount);
  const renameAccount = useAccounts((s) => s.renameAccount);
  const removeAccount = useAccounts((s) => s.removeAccount);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? accounts[0] ?? null;

  const [manageOpen, setManageOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [removing, setRemoving] = useState<Account | null>(null);
  /** Which account's 3-dot action menu is open (null = none). */
  const [actionsFor, setActionsFor] = useState<Account | null>(null);

  // RN's <Modal> stacks badly — presenting a second Modal while the manage
  // sheet's Modal is still visible reliably freezes touch handling. So these
  // sub-sheets are mutually exclusive with the manage sheet: close it before
  // opening one, and reopen it when the sub-sheet closes.
  const openAdd = () => {
    setManageOpen(false);
    setAddOpen(true);
  };
  const closeAdd = () => {
    setAddOpen(false);
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
  const openRemove = (a: Account) => {
    setActionsFor(null);
    setManageOpen(false);
    setRemoving(a);
  };
  const closeRemove = () => {
    setRemoving(null);
    setManageOpen(true);
  };

  return (
    <View style={{ gap: SPACING.sm }}>
      {/* Collapsed summary — tapping opens the full list in a sheet, so
          Settings doesn't scroll forever once someone has several accounts. */}
      <Pressable
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
        {activeAccount ? <Avatar label={activeAccount.label} active /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <T weight="semibold" numberOfLines={1}>
            {activeAccount?.label ?? "No account"}
          </T>
          <T variant="caption" color={theme.muted} numberOfLines={1}>
            {activeAccount ? shortAddr(activeAccount.address) : ""}
            {accounts.length > 1 ? `  ·  ${accounts.length} accounts` : ""}
          </T>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.muted} />
      </Pressable>

      {/* The outer sheet keeps its fade (it enters from Settings).
          The nested add/rename/remove sheets use animationType="none":
          they are swapped in the same React batch as the manage sheet
          closing, so fading both meant a fade-out immediately followed
          by a fade-in — slow and heavy for what is really just a
          content change behind the same blurred backdrop. With "none"
          the swap is instant and the backdrop provides the continuity. */}
      {/* Full manage sheet */}
      <Modal visible={manageOpen} transparent animationType="fade" onRequestClose={() => setManageOpen(false)}>
        <Backdrop>
          <SheetShell>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>Accounts</T>
              <Pressable onPress={() => setManageOpen(false)} style={{ padding: 8 }}>
                <Ionicons name="close" size={18} color={theme.text} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
              <View style={{ gap: SPACING.sm }}>
                {accounts.map((a) => {
                  const active = a.id === activeAccountId;
                  return (
                    <Pressable
                      key={a.id}
                      onPress={async () => {
                        if (active) return;
                        await Haptics.selectionAsync().catch(() => {});
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
                        // rather than a different fill, so the row heights
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
                            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.primary }}>
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
                          instead of a cramped row of competing icons. */}
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

                <Pressable
                  onPress={openAdd}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.md,
                    padding: SPACING.md,
                    borderRadius: RADIUS.xl,
                    borderWidth: 1.5,
                    borderColor: theme.border,
                    borderStyle: "dashed",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View style={{ width: 40, height: 40, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface2 }}>
                    <Ionicons name="add" size={20} color={theme.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T weight="semibold">Add account</T>
                    <T variant="caption" color={theme.muted}>
                      Create a new one or import an existing wallet
                    </T>
                  </View>
                </Pressable>
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
              onPress={() => setActionsFor(null)}
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}
            >
              <Pressable
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
                    <T weight="bold" numberOfLines={1}>{actionsFor.label}</T>
                    <T variant="caption" color={theme.muted} numberOfLines={1}>
                      {shortAddr(actionsFor.address)}
                    </T>
                  </View>
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
                {accounts.length > 1 ? (
                  <ActionRow icon="trash-outline" label="Remove account" danger onPress={() => openRemove(actionsFor)} />
                ) : null}

                <View style={{ height: SPACING.sm }} />
                <Button title="Cancel" variant="outline" onPress={() => setActionsFor(null)} />
              </Pressable>
            </Pressable>
          </View>
        ) : null}
      </Modal>

      <AddAccountSheet visible={addOpen} onClose={closeAdd} />

      {/* Rename sheet */}
      <Modal visible={!!editing} transparent animationType="none" onRequestClose={closeEdit}>
        <Backdrop>
          <SheetShell>
            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>Rename account</T>
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

      {/* Remove confirm */}
      <Modal visible={!!removing} transparent animationType="none" onRequestClose={closeRemove}>
        <Backdrop>
          <SheetShell>
            <T weight="bold" style={{ fontSize: 22, lineHeight: 27 }}>Remove account?</T>
            <T color={theme.muted}>
              This removes “{removing?.label}” from this device. You can re-add it later with its recovery phrase.
            </T>
            <Button
              title="Remove"
              onPress={async () => {
                if (removing) {
                  const { id, address } = removing;
                  await removeAccount(id);
                  // Best-effort cleanup scoped to just this account — the
                  // server-side push registration and the local
                  // notification log both outlive a single account removal
                  // otherwise (they're only cleared wholesale on erase).
                  unregisterAddressForPush(address).catch(() => {});
                  useNotificationFeed.getState().removeForAccount(id).catch(() => {});
                }
                closeRemove();
              }}
            />
            <Button title="Cancel" variant="outline" onPress={closeRemove} />
          </SheetShell>
        </Backdrop>
      </Modal>
    </View>
  );
}
