// src/components/OnboardingProgress.tsx
import React from "react";
import { View } from "react-native";
import { useTheme } from "@/src/theme/ThemeProvider";

/** Step dots for the create/confirm/passcode onboarding flow. */
export function OnboardingProgress({ step, total }: { step: number; total: number }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 999,
            backgroundColor: i <= step ? theme.accent : theme.border,
          }}
        />
      ))}
    </View>
  );
}
