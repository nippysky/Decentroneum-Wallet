// app/wc.tsx
//
// Landing target for the /wc deep link (both the custom scheme
// decentwallet://wc?uri=... and the universal links
// https://decentroneum.com/wc / https://app.decentroneum.com/wc). The
// actual pairing is handled by the global URL listener in app/_layout.tsx —
// this screen exists only so Expo Router has a real route to land on
// instead of flashing a "not found" screen, then immediately steps out of
// the way back to the wallet.
import { useEffect } from "react";
import { router } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { Screen } from "@/src/components/Screen";
import { useTheme } from "@/src/theme/ThemeProvider";

export default function WcRedirect() {
  const { theme } = useTheme();

  useEffect(() => {
    const t = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/wallet");
    }, 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.text} />
      </View>
    </Screen>
  );
}
