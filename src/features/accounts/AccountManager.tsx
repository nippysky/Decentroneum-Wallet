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

import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { useTheme } from "@/src/theme/ThemeProvider";
import { RADIUS, SPACING } from "@/src/theme/tokens";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { createWallet } from "@/src/lib/chain/wallet";
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
        backgroundColor: active ? theme.accent : theme.bg,
        borderWidth: 1,
        borderColor: active ? theme.accent : theme.border,
      }}
    >
      <T weight="bold" style={{ color: active ? theme.bg : theme.text, fontSize: 14 }}>
        {initialsFor(label)}
      </T>
    </View>
  );
}

function Backdrop({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <BlurView intensity={30} tint="default" style={StyleSheet.absoluteFillObject} />
      <Pressable onPress={onPress} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
        {children}
      </Pressable>
    </View>
  );
}

function SheetShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={() => {}}
      style={{
        backgroundColor: theme.card,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: theme.border,
        padding: SPACING.xl,
        gap: SPACING.md,
        maxHeight: "86%",
      }}
    >
      {children}
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Backdrop onPress={close}>
        <SheetShell>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.md }}>
              <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
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
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.bg,
                    opacity: pressed ? 0.9 : 1,
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
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.bg,
                    opacity: pressed ? 0.9 : 1,
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
                <View style={{ borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, padding: SPACING.md }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {words.map((w, i) => (
                      <View key={`${w}-${i}`} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, flexDirection: "row", gap: 6 }}>
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
                  style={{ borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, padding: SPACING.md, color: theme.text }}
                />

                {err ? <T color={theme.danger}>{err}</T> : null}

                <Button title={busy ? "Adding…" : "I saved it — add account"} disabled={busy} onPress={confirmCreate} />
                <Button title="Back" variant="outline" disabled={busy} onPress={() => setMode("choose")} />
              </View>
            ) : null}

            {mode === "import" ? (
              <View style={{ gap: SPACING.md }}>
                <TextInput
                  value={mnemonic}
                  onChangeText={setMnemonic}
                  placeholder="twelve or twenty-four words"
                  placeholderTextColor={theme.muted}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  style={{ minHeight: 100, textAlignVertical: "top", borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, padding: SPACING.md, color: theme.text }}
                />
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Label (optional) e.g. Trading"
                  placeholderTextColor={theme.muted}
                  style={{ borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, padding: SPACING.md, color: theme.text }}
                />

                {err ? <T color={theme.danger}>{err}</T> : null}

                <Button title={busy ? "Adding…" : "Add account"} disabled={busy} onPress={confirmImport} />
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
  const accounts = useAccounts((s) => s.accounts);
  const activeAccountId = useAccounts((s) => s.activeAccountId);
  const switchAccount = useAccounts((s) => s.switchAccount);
  const renameAccount = useAccounts((s) => s.renameAccount);
  const removeAccount = useAccounts((s) => s.removeAccount);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [removing, setRemoving] = useState<Account | null>(null);

  return (
    <View style={{ gap: SPACING.sm }}>
      <View style={{ borderRadius: RADIUS.xl, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, overflow: "hidden" }}>
        {accounts.map((a, idx) => {
          const active = a.id === activeAccountId;
          return (
            <View
              key={a.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: SPACING.lg,
                paddingVertical: SPACING.md,
                gap: SPACING.md,
                borderTopWidth: idx === 0 ? 0 : 1,
                borderTopColor: theme.border,
              }}
            >
              <Pressable
                onPress={async () => {
                  if (!active) {
                    await Haptics.selectionAsync().catch(() => {});
                    await switchAccount(a.id);
                  }
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md, flex: 1 }}
              >
                <Avatar label={a.label} active={active} />
                <View style={{ flex: 1 }}>
                  <T weight="semibold">{a.label}</T>
                  <T variant="caption" color={theme.muted}>{shortAddr(a.address)}</T>
                </View>
                {active ? <Ionicons name="checkmark-circle" size={20} color={theme.accent} /> : null}
              </Pressable>

              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(a.address);
                }}
                hitSlop={8}
                style={{ padding: 6 }}
              >
                <Ionicons name="copy-outline" size={17} color={theme.muted} />
              </Pressable>

              <Pressable
                onPress={() => {
                  setEditing(a);
                  setEditLabel(a.label);
                }}
                hitSlop={8}
                style={{ padding: 6 }}
              >
                <Ionicons name="pencil-outline" size={17} color={theme.muted} />
              </Pressable>

              {accounts.length > 1 ? (
                <Pressable onPress={() => setRemoving(a)} hitSlop={8} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={17} color={theme.danger} />
                </Pressable>
              ) : null}
            </View>
          );
        })}

        <Pressable
          onPress={() => setAddOpen(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: SPACING.md,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.md,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View style={{ width: 40, height: 40, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border, borderStyle: "dashed" }}>
            <Ionicons name="add" size={20} color={theme.text} />
          </View>
          <T weight="semibold" color={theme.accent}>Add account</T>
        </Pressable>
      </View>

      <AddAccountSheet visible={addOpen} onClose={() => setAddOpen(false)} />

      {/* Rename sheet */}
      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Backdrop onPress={() => setEditing(null)}>
          <SheetShell>
            <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>Rename account</T>
            <TextInput
              value={editLabel}
              onChangeText={setEditLabel}
              placeholder="Account name"
              placeholderTextColor={theme.muted}
              style={{ borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg, padding: SPACING.md, color: theme.text }}
            />
            <Button
              title="Save"
              onPress={async () => {
                if (editing && editLabel.trim()) await renameAccount(editing.id, editLabel.trim());
                setEditing(null);
              }}
            />
            <Button title="Cancel" variant="outline" onPress={() => setEditing(null)} />
          </SheetShell>
        </Backdrop>
      </Modal>

      {/* Remove confirm */}
      <Modal visible={!!removing} transparent animationType="fade" onRequestClose={() => setRemoving(null)}>
        <Backdrop onPress={() => setRemoving(null)}>
          <SheetShell>
            <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>Remove account?</T>
            <T color={theme.muted}>
              This removes “{removing?.label}” from this device. You can re-add it later with its recovery phrase.
            </T>
            <Button
              title="Remove"
              onPress={async () => {
                if (removing) await removeAccount(removing.id);
                setRemoving(null);
              }}
            />
            <Button title="Cancel" variant="outline" onPress={() => setRemoving(null)} />
          </SheetShell>
        </Backdrop>
      </Modal>
    </View>
  );
}
