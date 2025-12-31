// app/_layout.tsx
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import { Stack } from "expo-router";
import { ThemeProvider } from "@/src/theme/ThemeProvider";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useSession } from "@/src/state/session";
import {
  useFonts,
  Lexend_400Regular,
  Lexend_500Medium,
  Lexend_600SemiBold,
  Lexend_700Bold,
} from "@expo-google-fonts/lexend";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Lexend_400Regular,
    Lexend_500Medium,
    Lexend_600SemiBold,
    Lexend_700Bold,
  });

  const hydrate = useSession((s) => s.hydrate);
  const lock = useSession((s) => s.lock);
  const autoLockEnabled = useSession((s) => s.autoLockEnabled);

  // 1) Hydrate persisted session prefs (autolock/biometric flags, etc.)
  useEffect(() => {
    hydrate().catch(() => {});
  }, [hydrate]);

  // Avoid stale closure inside AppState listener
  const autoLockRef = useRef(autoLockEnabled);
  useEffect(() => {
    autoLockRef.current = autoLockEnabled;
  }, [autoLockEnabled]);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // 2) Auto-lock when app leaves foreground (only if enabled)
  useEffect(() => {
    let current: AppStateStatus = AppState.currentState;

    const sub = AppState.addEventListener("change", (next) => {
      if (
        current === "active" &&
        (next === "inactive" || next === "background") &&
        autoLockRef.current
      ) {
        lock();
      }
      current = next;
    });

    return () => sub.remove();
  }, [lock]);

  if (!fontsLoaded) return null;

  return (
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
