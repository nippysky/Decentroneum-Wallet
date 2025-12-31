// src/ui/SettingsRow.tsx
import React from "react";
import { Pressable, Switch, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/src/theme/ThemeProvider";
import { T } from "@/src/ui/T";

export function SettingsRow({
  title,
  subtitle,
  icon,
  onPress,
  right,
  showChevron = false,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  onPress?: () => void;
  right?: React.ReactNode;
  showChevron?: boolean;
}) {
  const { theme } = useTheme();

  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress as any}
      style={({ pressed }: any) => [
        {
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
        {icon ? (
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.bg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={icon} size={18} color={theme.text} />
          </View>
        ) : null}

        <View style={{ flex: 1, gap: 2 }}>
          <T weight="semibold">{title}</T>
          {subtitle ? <T variant="caption" color={theme.muted}>{subtitle}</T> : null}
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {right}
        {showChevron ? <Ionicons name="chevron-forward" size={18} color={theme.muted} /> : null}
      </View>
    </Container>
  );
}

export function SettingsSwitch({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: theme.border, true: theme.primary }}
      thumbColor={theme.card}
    />
  );
}
