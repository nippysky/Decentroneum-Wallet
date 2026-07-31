// app/index.tsx
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { hasWallet, purgeLegacyVaults } from "@/src/lib/crypto/vault";
import { useTheme } from "@/src/theme/ThemeProvider";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Index() {
  const router = useRouter();
  const { theme } = useTheme();

  useEffect(() => {
    (async () => {
      try {
        // Development builds may still hold a vault in a format nothing can
        // read. Clearing it BEFORE the hasWallet check is what keeps such a
        // device off an unlock screen it could never get past.
        //
        // Deliberately silent: the user-visible result (landing on onboarding)
        // already says everything, and a red console warning on every cold
        // start just trains people to ignore warnings.
        await purgeLegacyVaults();

        const exists = await hasWallet();
        router.replace(exists ? "/unlock" : "/welcome");
      } finally {
        await SplashScreen.hideAsync();
      }
    })();
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
