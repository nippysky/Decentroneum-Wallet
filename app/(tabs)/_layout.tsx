// app/(tabs)/_layout.tsx
import React, { useMemo } from "react";
import { Platform, Pressable, View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";

import { useTheme } from "@/src/theme/ThemeProvider";

type RouteName = "wallet" | "browser" | "settings";

function TabIcon({
  name,
  focused,
  color,
}: {
  name: RouteName;
  focused: boolean;
  color: string;
}) {
  const icon = useMemo(() => {
    switch (name) {
      case "wallet":
        return focused ? "wallet" : "wallet-outline";
      case "browser":
        return focused ? "compass" : "compass-outline";
      case "settings":
        return focused ? "settings" : "settings-outline";
      default:
        return "ellipse-outline";
    }
  }, [name, focused]);

  return <Ionicons name={icon as any} size={24} color={color} />;
}

/**
 * Native-feeling, edge-to-edge tab bar. No floating card, no text labels —
 * just icons (filled when active) plus a small dot indicator, exactly like
 * the system tab bars this app is trying to feel as native as.
 */
function EdgeTabBar({ state, navigation }: any) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.bg,
        overflow: "hidden",
      }}
    >
      {Platform.OS === "ios" ? (
        <BlurView intensity={26} tint="default" style={{ position: "absolute", inset: 0 }} />
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 10),
        }}
      >
        {state.routes.map((route: any, index: number) => {
          const name = route.name as RouteName;
          const focused = state.index === index;

          const onPress = async () => {
            await Haptics.selectionAsync().catch(() => {});
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          const onLongPress = () => {
            navigation.emit({ type: "tabLongPress", target: route.key });
          };

          const color = focused ? theme.text : theme.muted;

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityRole="button"
              accessibilityLabel={name}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                paddingVertical: 4,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <TabIcon name={name} focused={focused} color={color} />
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: focused ? theme.accent : "transparent",
                }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  // IMPORTANT: useTheme() inside the component so changes re-render the Tabs + tabBar
  useTheme();

  return (
    <Tabs
      tabBar={(props) => <EdgeTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="wallet" options={{ title: "Wallet" }} />
      <Tabs.Screen name="browser" options={{ title: "Browser" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
