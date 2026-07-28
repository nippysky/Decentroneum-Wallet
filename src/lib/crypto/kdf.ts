// src/lib/crypto/kdf.ts
//
// Passcode → encryption key.
//
// IMPLEMENTATION NOTE (why @noble/hashes and not scrypt-js):
// this used `scrypt-js`, a pure-JS scrypt whose inner loops are slow under
// Hermes — a 6-digit unlock took ~5 seconds on device, long enough that
// testers reasonably read it as a hang. @noble/hashes is also JS but far
// better optimised (measured ~2.2x faster at IDENTICAL parameters, and the
// gap is wider on Hermes than on V8). We already depend on it via ethers,
// so this removes a dependency rather than adding one.
//
// SECURITY NOTE: the parameters below are unchanged. This is purely a
// faster implementation of the same work — no reduction in brute-force
// resistance. N=16384/r=8/p=1 is the standard "interactive" setting, the
// same class Ethereum keystores use.
//
// If unlock is still not snappy enough, the next lever is lowering N — but
// that IS a real tradeoff and worth deciding deliberately. Two things to
// know before doing it:
//   1. Params are persisted per-vault (see vault.ts), so changing the
//      default only affects NEWLY created wallets. Existing ones keep
//      deriving with the params they were created with.
//   2. With a 6-digit PIN the KDF buys less than it appears to — the search
//      space is only 10^6. The real protection is that the encrypted blob
//      lives in the iOS Keychain / Android Keystore and can't be read
//      without a compromised, unlocked device. The KDF is defence-in-depth,
//      not the primary control.
// @noble/hashes v2 exports explicit `.js` subpaths — "@noble/hashes/scrypt"
// (without the extension) is not in its "exports" map and won't resolve.
import { scrypt as nobleScrypt } from "@noble/hashes/scrypt.js";

export type ScryptParams = {
  N: number;
  r: number;
  p: number;
  dkLen: number;
};

/** Standard "interactive" scrypt cost. Unchanged from the previous impl. */
export const DEFAULT_SCRYPT: ScryptParams = {
  N: 16384,
  r: 8,
  p: 1,
  dkLen: 32,
};

export async function deriveKeyScrypt(
  passcode: string,
  salt: Uint8Array,
  params: ScryptParams = DEFAULT_SCRYPT
): Promise<Uint8Array> {
  const pwBytes = new TextEncoder().encode(passcode);
  const out = nobleScrypt(pwBytes, salt, {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: params.dkLen,
  });
  return new Uint8Array(out);
}
