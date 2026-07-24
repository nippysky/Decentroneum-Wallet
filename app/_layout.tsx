// app/_layout.tsx
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import { Stack } from "expo-router";
import { ThemeProvider } from "@/src/theme/ThemeProvider";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { useTokens } from "@/src/state/tokens";
import { useNotifications } from "@/src/state/notifications";
import { useWalletConnect } from "@/src/state/walletconnect";
import { SessionProposalSheet } from "@/src/features/walletconnect/SessionProposalSheet";
import { SessionRequestSheet } from "@/src/features/walletconnect/SessionRequestSheet";
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
  const isUnlocked = useSession((s) => s.isUnlocked);
  const hydrateAccounts = useAccounts((s) => s.hydrate);
  const hydrateTokens = useTokens((s) => s.hydrate);
  const hydrateNotifications = useNotifications((s) => s.hydrate);
  const initWalletConnect = useWalletConnect((s) => s.init);

  // 1) Hydrate persisted session prefs (autolock/biometric flags, etc.),
  //    non-secret account metadata (addresses/labels only), the token
  //    registry (bundled defaults first, remote list refreshed in
  //    background), and — if the user previously opted in — restart the
  //    incoming-funds notification watcher.
  useEffect(() => {
    hydrate().catch(() => {});
    hydrateAccounts().catch(() => {});
    hydrateTokens().catch(() => {});
    hydrateNotifications().catch(() => {});
  }, [hydrate, hydrateAccounts, hydrateTokens, hydrateNotifications]);

  // WalletConnect's relay connection only makes sense once there's a wallet
  // to connect — initialize lazily on first unlock, not at cold start.
  useEffect(() => {
    if (isUnlocked) initWalletConnect().catch(() => {});
  }, [isUnlocked, initWalletConnect]);

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
      {isUnlocked ? (
        <>
          <SessionProposalSheet />
          <SessionRequestSheet />
        </>
      ) : null}
    </ThemeProvider>
  );
}
