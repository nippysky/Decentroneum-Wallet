// src/ui/TabBar.tsx
import React from "react";
import { Platform, Pressable, View } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/src/theme/ThemeProvider";
import { T } from "@/src/ui/T";

export function DWTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const isIOS = Platform.OS === "ios";

  const containerStyle = {
    paddingBottom: Math.max(insets.bottom, 10), // key fix: never touch bezel
    paddingTop: 10,
    paddingHorizontal: 12,
    backgroundColor: "transparent" as const,
  };

  const dockStyle = {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden" as const,

    // Float it a bit from edges (more “wallet premium”)
    marginHorizontal: 12,
    marginBottom: 10,

    ...(isIOS
      ? {
          // subtle iOS shadow
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        }
      : {
          elevation: 8,
        }),
  };

  const Dock = isIOS ? BlurView : View;
  const dockProps = isIOS ? ({ intensity: 24, tint: "default" as const } as const) : ({} as const);

  return (
    <View style={containerStyle}>
      <View style={dockStyle}>
        <Dock
          {...dockProps}
          style={{
            backgroundColor: isIOS ? "transparent" : theme.card,
            padding: 8,
          }}
        >
          <View style={{ flexDirection: "row", gap: 8 }}>
            {state.routes.map((route, index) => {
              const { options } = descriptors[route.key];
              const label =
                options.tabBarLabel?.toString() ??
                options.title ??
                route.name;

              const isFocused = state.index === index;

              const onPress = async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              return (
                <Pressable
                  key={route.key}
                  onPress={onPress}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      height: 46,
                      borderRadius: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isFocused ? theme.border : "transparent",
                    },
                    pressed ? { opacity: 0.9 } : null,
                  ]}
                >
                  <T
                    variant="caption"
                    weight="semibold"
                    color={isFocused ? theme.text : theme.muted}
                    style={{ letterSpacing: 0.6 }}
                  >
                    {label.toUpperCase()}
                  </T>

                  <View
                    style={{
                      marginTop: 6,
                      height: 3,
                      width: 18,
                      borderRadius: 999,
                      backgroundColor: isFocused ? theme.accent : "transparent",
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
        </Dock>
      </View>
    </View>
  );
}
