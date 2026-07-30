// app/(tabs)/_layout.tsx
import React, { useMemo } from "react";
import { Pressable, View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hapticSelect } from "@/src/lib/haptics";

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
 * just icons (filled when active) plus a small dot indicator.
 *
 * Two things here are load-bearing:
 *
 * 1. The bar is IN FLOW, not `position: absolute`. It used to be absolutely
 *    positioned at bottom: 0, which meant it floated on top of the screen
 *    content — and since <Screen> only reserves the safe-area inset, the bar
 *    covered roughly the last 38pt of every tab. The bottom row of a list,
 *    or a button sitting at the end of a screen, was underneath it.
 *
 * 2. Bottom padding is `insets.bottom + gap`, ADDITIVE, never `Math.max`.
 *    max() treats the system inset and our own breathing room as the same
 *    thing, so on a device with a 24pt gesture bar you get 24pt total: the
 *    icons sit directly on the gesture bar with nothing between them. Adding
 *    them keeps a consistent visual gap above the hardware no matter what
 *    the device reports — gesture bar, three-button nav, or nothing at all.
 */
function EdgeTabBar({ state, navigation }: any) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.bg,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingTop: 10,
          // Floor of 8 covers devices that report no bottom inset at all
          // (older Androids with a hardware nav bar outside the app surface).
          paddingBottom: (insets.bottom || 8) + 8,
        }}
      >
        {state.routes.map((route: any, index: number) => {
          const name = route.name as RouteName;
          const focused = state.index === index;

          const onPress = async () => {
            hapticSelect();
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
              accessibilityState={{ selected: focused }}
              accessibilityLabel={name}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                // 48pt tall so the whole column is tappable, not just the
                // 24pt glyph in the middle of it.
                minHeight: 48,
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
