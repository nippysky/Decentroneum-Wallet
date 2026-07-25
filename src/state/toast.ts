// src/state/toast.ts
//
// One global toast queue for the whole app.
//
// Previously every screen that wanted a toast re-implemented the same
// message/visible/timer triple locally (settings.tsx, AccountManager.tsx,
// ReceiveModal.tsx, ConnectionsPanel.tsx …), which meant inconsistent
// durations, duplicated timers, and toasts that couldn't be fired from
// non-component code (stores, lib functions, catch blocks).
//
// Now anything, anywhere, can call `toast.success("Copied")` — including
// plain async functions with no React context.
import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

type ToastState = {
  message: string;
  kind: ToastKind;
  visible: boolean;
  /** Bumped on every show() so the host can re-trigger its animation even
   *  when the same message fires twice in a row. */
  nonce: number;

  show: (message: string, kind?: ToastKind, durationMs?: number) => void;
  hide: () => void;
};

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set, get) => ({
  message: "",
  kind: "info",
  visible: false,
  nonce: 0,

  show: (message, kind = "info", durationMs) => {
    if (!message) return;
    if (hideTimer) clearTimeout(hideTimer);

    // Errors linger a little longer — they carry more to read and matter more.
    const ms = durationMs ?? (kind === "error" ? 3200 : 1800);

    set({ message, kind, visible: true, nonce: get().nonce + 1 });
    hideTimer = setTimeout(() => set({ visible: false }), ms);
  },

  hide: () => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ visible: false });
  },
}));

/**
 * Imperative facade — usable from anywhere, component or not.
 *
 *   toast.success("Address copied");
 *   toast.error(e?.message ?? "Something went wrong");
 */
export const toast = {
  show: (m: string, k?: ToastKind, ms?: number) => useToast.getState().show(m, k, ms),
  info: (m: string, ms?: number) => useToast.getState().show(m, "info", ms),
  success: (m: string, ms?: number) => useToast.getState().show(m, "success", ms),
  error: (m: string, ms?: number) => useToast.getState().show(m, "error", ms),
  hide: () => useToast.getState().hide(),
};
