// app/(tabs)/explorer.tsx
import React from "react";
import { Redirect } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { ExplorerScreen } from "@/src/features/explorer/ExplorerScreen";
import { useSession } from "@/src/state/session";

export default function ExplorerTab() {
  const isUnlocked = useSession((s) => s.isUnlocked);
  if (!isUnlocked) return <Redirect href="/unlock" />;

  return (
    <Screen>
      <ExplorerScreen />
    </Screen>
  );
}
