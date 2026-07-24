import { scrypt } from "scrypt-js";

export type ScryptParams = {
  N: number;
  r: number;
  p: number;
  dkLen: number;
};

// good mobile-safe defaults
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
  // passcode -> bytes
  const pwBytes = new TextEncoder().encode(passcode);
  const out = await scrypt(pwBytes, salt, params.N, params.r, params.p, params.dkLen);
  return new Uint8Array(out);
}
