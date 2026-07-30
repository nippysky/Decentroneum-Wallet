// src/lib/security/screenGuard.ts
//
// Blocks screenshots and screen recording while a secret is on screen.
//
// This matters more than it sounds. A screenshot of a recovery phrase goes
// straight into the OS photo library, which for most people syncs to iCloud
// or Google Photos within seconds — so a phrase that was never supposed to
// leave the device ends up in a cloud account protected by a password, which
// is exactly the threat model a seed phrase exists to avoid. It is also a
// common vector for support scams: "just send me a screenshot".
//
// Platform behaviour differs and it's worth knowing which guarantee you get:
//
//   Android — FLAG_SECURE. A hard block. The screenshot fails, screen
//             recording captures black, and the app is hidden from the
//             recents/app-switcher thumbnail.
//
//   iOS     — Apple provides NO API to prevent a screenshot. What
//             expo-screen-capture gives us on iOS is prevention of screen
//             RECORDING/mirroring (the view is obscured) plus a notification
//             after a screenshot is taken. So on iOS this is a deterrent
//             plus a detection hook, not a hard block. That is not a gap in
//             this code — it's the platform.
//
// Because iOS can only tell us after the fact, screens that show a phrase
// should ALSO pair this with a visible warning; see create.tsx.
import { useEffect } from "react";
import * as ScreenCapture from "expo-screen-capture";

/**
 * Prevent capture for as long as the calling component is mounted and
 * `active` is true. Safe to call on any platform; failures are swallowed,
 * because losing haptics-grade nice-to-haves must never block a screen that
 * the user needs in order to back up their wallet.
 */
export function useScreenGuard(active: boolean = true) {
  useEffect(() => {
    if (!active) return;

    let released = false;
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});

    return () => {
      if (released) return;
      released = true;
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, [active]);
}

/**
 * Fires when iOS reports that a screenshot WAS taken (iOS only — Android
 * blocks the screenshot outright, so this never fires there). Use it to warn
 * the user that the image is now in their photo library.
 */
export function useScreenshotWarning(onCaptured: () => void, active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    const sub = ScreenCapture.addScreenshotListener(() => onCaptured());
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
