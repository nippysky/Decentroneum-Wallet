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
        if (await purgeLegacyVaults()) {
          console.warn("[vault] removed a development-era vault record — starting fresh");
        }

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
