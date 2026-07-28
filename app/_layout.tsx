// app/_layout.tsx
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import { router, Stack } from "expo-router";
import { ThemeProvider } from "@/src/theme/ThemeProvider";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { useTokens } from "@/src/state/tokens";
import { useNotifications } from "@/src/state/notifications";
import { useNotificationFeed } from "@/src/state/notificationsFeed";
import { useWalletConnect } from "@/src/state/walletconnect";
import { extractWcUri } from "@/src/lib/walletconnect/deepLink";
import { SessionProposalSheet } from "@/src/features/walletconnect/SessionProposalSheet";
import { SessionRequestSheet } from "@/src/features/walletconnect/SessionRequestSheet";
import { ToastHost } from "@/src/components/ToastHost";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Addresses / hashes / recovery phrases — see FONT.mono in typography.ts
    JetBrainsMono_400Regular,
  });

  const hydrate = useSession((s) => s.hydrate);
  const lock = useSession((s) => s.lock);
  const autoLockEnabled = useSession((s) => s.autoLockEnabled);
  const isUnlocked = useSession((s) => s.isUnlocked);
  const hydrateAccounts = useAccounts((s) => s.hydrate);
  const hydrateTokens = useTokens((s) => s.hydrate);
  const hydrateNotifications = useNotifications((s) => s.hydrate);
  const refreshNotificationFeed = useNotificationFeed((s) => s.refresh);
  const initWalletConnect = useWalletConnect((s) => s.init);

  // 1) Hydrate persisted session prefs (autolock/biometric flags, etc.),
  //    non-secret account metadata (addresses/labels only), the token
  //    registry (bundled defaults first, remote list refreshed in
  //    background), the local notification log, and start the
  //    incoming-funds notification watcher (on by default for everyone).
  useEffect(() => {
    hydrate().catch(() => {});
    hydrateAccounts().catch(() => {});
    hydrateTokens().catch(() => {});
    hydrateNotifications().catch(() => {});
    refreshNotificationFeed().catch(() => {});
  }, [hydrate, hydrateAccounts, hydrateTokens, hydrateNotifications, refreshNotificationFeed]);

  // 1b) Deep-link from a tapped OS notification banner into the right
  //     in-app screen (same routing the in-app bell list uses), switching
  //     to the relevant account first if the notification was for a
  //     non-active one.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;

      refreshNotificationFeed().catch(() => {});

      (async () => {
        const accountId = typeof data.accountId === "string" ? data.accountId : null;
        if (accountId) {
          const accounts = useAccounts.getState().accounts;
          const target = accounts.find((a) => a.id === accountId);
          if (target && target.id !== useAccounts.getState().activeAccountId) {
            await useAccounts.getState().switchAccount(target.id).catch(() => {});
          }
        }

        const route = typeof data.route === "string" ? data.route : "/(tabs)/wallet";
        router.push(route as any);
      })();
    });

    return () => sub.remove();
  }, [refreshNotificationFeed]);

  // WalletConnect's relay connection only makes sense once there's a wallet
  // to connect — initialize lazily on first unlock, not at cold start.
  useEffect(() => {
    if (isUnlocked) initWalletConnect().catch(() => {});
  }, [isUnlocked, initWalletConnect]);

  // 1c) Deep-link pairing: a dapp's "Connect Wallet" flow hands the OS
  //     either our custom scheme (decentwallet://wc?uri=wc:...) or a
  //     universal link (https://decentroneum.com/wc?uri=wc:...); either way
  //     we land here with a URL to pull the wc: URI out of. If the wallet
  //     is still locked when it arrives (cold start via deep link), stash
  //     it and pair automatically the moment the user unlocks instead of
  //     silently dropping it.
  const pendingWcUriRef = useRef<string | null>(null);

  const handleIncomingUrl = useCallback((url: string | null) => {
    const uri = extractWcUri(url);
    if (!uri) return;

    if (useSession.getState().isUnlocked && useWalletConnect.getState().initialized) {
      useWalletConnect.getState().pair(uri).catch(() => {});
    } else {
      pendingWcUriRef.current = uri;
    }
  }, []);

  useEffect(() => {
    Linking.getInitialURL().then(handleIncomingUrl).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => handleIncomingUrl(e.url));
    return () => sub.remove();
  }, [handleIncomingUrl]);

  useEffect(() => {
    if (!isUnlocked || !pendingWcUriRef.current) return;
    const uri = pendingWcUriRef.current;
    pendingWcUriRef.current = null;
    initWalletConnect()
      .then(() => useWalletConnect.getState().pair(uri))
      .catch(() => {});
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
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="send" options={{ presentation: "modal" }} />
        <Stack.Screen name="notifications" options={{ presentation: "modal" }} />
        <Stack.Screen name="scan" options={{ presentation: "modal" }} />
      </Stack>
      {isUnlocked ? (
        <>
          <SessionProposalSheet />
          <SessionRequestSheet />
        </>
      ) : null}

      {/* Global toast — mounted last so it paints above every screen. */}
      <ToastHost />
    </ThemeProvider>
  );
}
