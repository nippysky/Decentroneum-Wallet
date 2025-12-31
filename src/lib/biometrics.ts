// src/lib/biometrics.ts
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { STORAGE_KEYS } from "@/src/lib/storageKeys";

export const BIO_PIN_KEY = "DW_BIOMETRIC_PIN_V1";

export async function getBiometricLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "Touch ID";
    return "Biometrics";
  } catch {
    return "Biometrics";
  }
}

export async function isBiometricsAvailable(): Promise<boolean> {
  const has = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return !!has && !!enrolled;
}

export async function setBiometricEnabledFlag(v: boolean) {
  if (v) {
    await SecureStore.setItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED, "1", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED);
  }
}

export async function getBiometricEnabledFlag(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC_ENABLED);
  return v === "1";
}

export async function saveBioPin(pin: string) {
  // Stored behind biometrics (OS enforced)
  await SecureStore.setItemAsync(BIO_PIN_KEY, pin, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    requireAuthentication: true,
  });
}

export async function clearBioPin() {
  await SecureStore.deleteItemAsync(BIO_PIN_KEY);
}

export async function loadBioPin(): Promise<string | null> {
  // Reading will trigger Face ID / Touch ID prompt
  return await SecureStore.getItemAsync(BIO_PIN_KEY, {
    requireAuthentication: true,
  });
}
