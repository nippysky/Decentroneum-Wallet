// src/lib/security/biometrics.ts
//
// What to CALL the device's biometric sensor, and whether it can be used.
//
// ─── Why this file exists ───────────────────────────────────────────────────
//
// This logic was written out twice — once in the unlock screen, once in
// settings — and both copies labelled an Android fingerprint reader "Touch ID".
// Touch ID is Apple's trademark. On a Samsung it is simply wrong, and it is the
// kind of wrong that makes a wallet look like it was ported carelessly.
//
// Same failure mode as the duplicated ETN logo URL: two copies, two chances to
// drift, and they did. One module now owns the answer.
//
// ─── What the app actually asks for ─────────────────────────────────────────
//
// Nothing here requests a SPECIFIC modality. Unlocking reads the stored
// passcode back from SecureStore with `requireAuthentication: true`, which
// hands the prompt to the platform — iOS LocalAuthentication, Android
// BiometricPrompt — and accepts whatever that device offers. Face, fingerprint,
// iris: if the OS presents it, we take it.
//
// So when an Android user sees only a fingerprint prompt, that is Android's
// decision, not ours. Keystore-backed keys (`setUserAuthenticationRequired`)
// require a **Class 3 / Strong** biometric. Face unlock on most Android phones
// is Class 1 or 2 — camera-only, defeatable by a photograph — so Android
// refuses to expose it for this purpose. Only a handful of devices ship Class 3
// face recognition.
//
// That restriction is worth keeping. A wallet key should not be unlockable by
// something a printed photo can satisfy.
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import type { Ionicons } from "@expo/vector-icons";

export type BiometricMeta = {
  /** Shown on buttons and settings rows. Platform-correct, never borrowed. */
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const GENERIC: BiometricMeta = { label: "Biometrics", icon: "scan-outline" };

/**
 * The device's own name for its sensor.
 *
 * Apple's marks are used ONLY on Apple hardware. Android gets the names
 * Android itself uses, which is also what the system prompt will say — so the
 * button and the sheet it opens agree.
 */
export async function biometricMeta(): Promise<BiometricMeta> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const iris = types.includes(LocalAuthentication.AuthenticationType.IRIS);

    if (Platform.OS === "ios") {
      // Ionicons has no Face ID glyph; "scan-outline" is the closest read.
      if (face) return { label: "Face ID", icon: "scan-outline" };
      if (finger) return { label: "Touch ID", icon: "finger-print-outline" };
      return GENERIC;
    }

    // Android. Fingerprint is checked FIRST on purpose: a device may report
    // face capability that Android will not actually offer for a
    // Keystore-backed unlock (see the Class 3 note above), and naming a method
    // the prompt then refuses to show is worse than naming the one it will.
    if (finger) return { label: "Fingerprint", icon: "finger-print-outline" };
    if (face) return { label: "Face Unlock", icon: "scan-outline" };
    if (iris) return { label: "Iris", icon: "eye-outline" };
    return GENERIC;
  } catch {
    return GENERIC;
  }
}

/**
 * Hardware present AND something enrolled.
 *
 * Both halves matter: a phone with a fingerprint reader and no registered
 * finger will fail the prompt rather than skip it, so offering the option
 * would be offering a dead end.
 */
export async function isBiometricsAvailable(): Promise<boolean> {
  try {
    const [has, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return has && enrolled;
  } catch {
    return false;
  }
}
