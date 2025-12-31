// src/theme/ThemeProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useCallback, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

import { dark, light, Theme } from "./tokens";
import { STORAGE_KEYS } from "@/src/lib/storageKeys";

export type Mode = "system" | "light" | "dark";

type Ctx = {
  theme: Theme;
  mode: Mode;
  setMode: (m: Mode) => void;

  // optional convenience
  resolvedMode: "light" | "dark";
};

const ThemeCtx = createContext<Ctx>({
  theme: light,
  mode: "system",
  setMode: () => {},
  resolvedMode: "light",
});

function isMode(x: any): x is Mode {
  return x === "system" || x === "light" || x === "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme(); // "light" | "dark" | null
  const [mode, setModeState] = useState<Mode>("system");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate saved preference on first mount
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(STORAGE_KEYS.THEME_MODE);
        if (!alive) return;

        if (saved && isMode(saved)) setModeState(saved);
        else setModeState("system"); // first install default
      } catch {
        setModeState("system");
      } finally {
        if (alive) setHydrated(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Persist + update mode
  const setMode = useCallback(async (m: Mode) => {
    setModeState(m);
    try {
      await SecureStore.setItemAsync(STORAGE_KEYS.THEME_MODE, m, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    } catch {
      // If it fails, we still changed in memory; next launch will fallback to system.
    }
  }, []);

  const resolvedMode = useMemo<"light" | "dark">(() => {
    const sys = system === "dark" ? "dark" : "light";
    const m = mode === "system" ? sys : mode;
    return m === "dark" ? "dark" : "light";
  }, [mode, system]);

  const theme = useMemo(() => (resolvedMode === "dark" ? dark : light), [resolvedMode]);

  // Avoid a quick “flash” of system theme before hydration
  if (!hydrated) return null;

  return (
    <ThemeCtx.Provider value={{ theme, mode, setMode, resolvedMode }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
