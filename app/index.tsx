// app/index.tsx
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { hasWallet } from "@/src/lib/vault";
import { useTheme } from "@/src/theme/ThemeProvider";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Index() {
  const router = useRouter();
  const { theme } = useTheme();

  useEffect(() => {
    (async () => {
      try {
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
