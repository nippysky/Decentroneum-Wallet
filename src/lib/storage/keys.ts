// src/lib/storage/keys.ts
//
// Every key the app writes to SecureStore / AsyncStorage, in one place, so a
// key can never be spelled two different ways in two different files.

export const STORAGE_KEYS = {
  HAS_WALLET: "dw_has_wallet",
  /**
   * The encrypted vault. Unversioned by design — the format version lives
   * INSIDE the record (see VAULT_VERSION), where a reader can act on it,
   * rather than in the key name, where it only fragments storage and invites
   * the "which key is current?" question this file exists to answer.
   */
  VAULT: "dw_vault",
  BIOMETRIC_ENABLED: "dw_biometric_enabled",
  AUTOLOCK_ENABLED: "dw_autolock_enabled",
  BIO_PIN: "dw_bio_pin",
  THEME_MODE: "DW_THEME_MODE",
  NOTIFICATIONS_ENABLED: "dw_notifications_enabled",
  PUSH_TOKEN: "dw_push_token",
  TOKEN_REGISTRY_CACHE: "dw_token_registry_cache_v1",
} as const;

/**
 * Vault records written by development builds. None of these can be read any
 * more; they are deleted on launch by purgeLegacyVaults().
 *
 * Do NOT add to this list once the app is in the stores. After release, a
 * format change needs a real migration — deleting a stranger's vault is
 * deleting their money. This list is only defensible while the only installs
 * that exist are our own test devices.
 */
export const LEGACY_VAULT_KEYS = ["dw_vault_v1", "dw_vault_v2", "dw_vault_v3"] as const;
