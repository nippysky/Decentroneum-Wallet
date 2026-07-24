// src/state/tokens.ts
import { create } from "zustand";
import { DEFAULT_TOKENS, getTokenList, ListedToken } from "@/src/lib/tokens/registry";

export type TokensState = {
  tokens: ListedToken[];
  loading: boolean;
  lastError: string | null;

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const useTokens = create<TokensState>((set) => ({
  tokens: DEFAULT_TOKENS, // instant, offline-safe default so the UI never blocks
  loading: false,
  lastError: null,

  hydrate: async () => {
    set({ loading: true });
    try {
      const tokens = await getTokenList();
      set({ tokens, loading: false, lastError: null });
    } catch (e: any) {
      set({ loading: false, lastError: e?.message ?? "Failed to load token list" });
    }
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const tokens = await getTokenList({ forceRefresh: true });
      set({ tokens, loading: false, lastError: null });
    } catch (e: any) {
      set({ loading: false, lastError: e?.message ?? "Failed to refresh token list" });
    }
  },
}));
