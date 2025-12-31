// app/(tabs)/_layout.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, View, Animated } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";

import { useTheme } from "@/src/theme/ThemeProvider";
import { T } from "@/src/ui/T";

type RouteName = "wallet" | "browser" | "settings";

const TAB_ORDER: RouteName[] = ["wallet", "browser", "settings"];

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

  return <Ionicons name={icon as any} size={22} color={color} />;
}

function AppleTabBar({ state, descriptors, navigation }: any) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [barW, setBarW] = useState(0);
  const animX = useRef(new Animated.Value(0)).current;

  const activeIndex = state.index ?? 0;

  const containerPad = 10;
  const barH = 64;
  const bottomPad = Math.max(insets.bottom, 10);

  const itemW = useMemo(() => {
    if (!barW) return 0;
    const inner = barW - containerPad * 2;
    return inner / TAB_ORDER.length;
  }, [barW]);

  useEffect(() => {
    if (!itemW) return;
    Animated.spring(animX, {
      toValue: activeIndex * itemW,
      useNativeDriver: true,
      stiffness: 260,
      damping: 26,
      mass: 0.9,
    }).start();
  }, [activeIndex, itemW, animX]);

  const bg = theme.card; // “surface”
  const border = theme.border;
  const textMuted = theme.muted;
  const text = theme.text;

  const pillBg = theme.bg; // the “active pill” background

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 10 + bottomPad,
      }}
    >
      <View
        onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
        style={{
          height: barH,
          borderRadius: 26,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: border,
          backgroundColor: bg,
        }}
      >
        {/* iOS blur layer for that “native glass” feel */}
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={22}
            tint="default"
            style={{ position: "absolute", inset: 0 }}
          />
        ) : null}

        <View
          style={{
            flex: 1,
            padding: containerPad,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          {/* Active pill */}
          {barW > 0 ? (
            <Animated.View
              style={{
                position: "absolute",
                left: containerPad,
                top: containerPad,
                width: itemW,
                height: barH - containerPad * 2,
                borderRadius: 20,
                backgroundColor: pillBg,
                borderWidth: 1,
                borderColor: border,
                transform: [{ translateX: animX }],
              }}
            />
          ) : null}

          {state.routes.map((route: any, index: number) => {
            const name = route.name as RouteName;
            const focused = state.index === index;
            const label =
              descriptors[route.key]?.options?.title ??
              name.charAt(0).toUpperCase() + name.slice(1);

            const onPress = async () => {
              await Haptics.selectionAsync().catch(() => {});
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });

              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: "tabLongPress",
                target: route.key,
              });
            };

            const iconColor = focused ? text : textMuted;

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                onLongPress={onLongPress}
                style={({ pressed }) => ({
                  width: itemW || undefined,
                  flex: itemW ? undefined : 1,
                  height: barH - containerPad * 2,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View style={{ alignItems: "center", gap: 4 }}>
                  <TabIcon name={name} focused={focused} color={iconColor} />
                  <T
                    variant="caption"
                    weight={focused ? "semibold" : "medium"}
                    style={{
                      color: iconColor,
                      fontSize: 12,
                      lineHeight: 14,
                    }}
                  >
                    {label.toUpperCase()}
                  </T>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  // IMPORTANT: useTheme() inside the component so changes re-render the Tabs + tabBar
  useTheme();

  return (
    <Tabs
      tabBar={(props) => <AppleTabBar {...props} />}
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
