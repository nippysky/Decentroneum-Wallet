// src/lib/haptics.ts
//
// Safe, fire-and-forget haptics.
//
// Why this exists: expo-haptics functions return promises that REJECT on any
// device without the relevant hardware (older Androids, the iOS Simulator,
// phones with system haptics disabled). Call sites throughout the app were
// written as:
//
//     onPress={async () => {
//       await Haptics.impactAsync(...);   // ← rejects here
//       doTheActualThing();               // ← never runs
//     }}
//
// so on those devices the button appeared dead: the press registered, the
// handler threw, and nothing happened. That was the root cause of the
// "I wrote it down" button needing several hard presses (it worked only on
// the taps where the haptics call happened to resolve first).
//
// Everything here is synchronous, returns void, and can never throw. Haptics
// are a garnish — they must never gate program logic.
import * as Haptics from "expo-haptics";

const fire = (p: Promise<void>) => {
  p.catch(() => {});
};

/** Light tap — buttons, keypad keys, toggles. */
export const hapticTap = () => fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** Medium thud — destructive or high-commitment actions. */
export const hapticImpact = () => fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

/** Selection tick — pickers, tab changes, list selection. */
export const hapticSelect = () => fire(Haptics.selectionAsync());

/** Success chime — transaction sent, wallet created. */
export const hapticSuccess = () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** Warning buzz — reversible mistake (wrong word order, unsaved change). */
export const hapticWarning = () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

/** Error buzz — rejected passcode, failed send. */
export const hapticError = () => fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
