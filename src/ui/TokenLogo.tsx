// src/ui/TokenLogo.tsx
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "@/src/theme/ThemeProvider";
import { T } from "@/src/ui/T";

export function TokenLogo({
  symbol,
  uri,
  size = 36,
}: {
  symbol: string;
  uri?: string;
  size?: number;
}) {
  const { theme } = useTheme();
  const [failed, setFailed] = useState(false);

  const initials = useMemo(() => (symbol || "?").slice(0, 2).toUpperCase(), [symbol]);

  if (!uri || failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.35),
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <T weight="bold" style={{ fontSize: 12 }}>
          {initials}
        </T>
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.35),
        overflow: "hidden",
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.bg,
      }}
    >
      <Image
        source={{ uri }}
        style={{ width: "100%", height: "100%" }}
        contentFit="cover"
        transition={140}
        onError={() => setFailed(true)}
      />
    </View>
  );
}
