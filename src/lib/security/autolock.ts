// src/lib/autolock.ts
import { AppState, AppStateStatus } from "react-native";

export function attachAutoLock({
  isEnabled,
  lock,
}: {
  isEnabled: () => boolean;
  lock: () => void;
}) {
  let current: AppStateStatus = AppState.currentState;

  const sub = AppState.addEventListener("change", (next) => {
    // When leaving active -> background/inactive, lock
    if (current === "active" && (next === "inactive" || next === "background")) {
      if (isEnabled()) lock();
    }
    current = next;
  });

  return () => sub.remove();
}
