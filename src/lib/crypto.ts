// src/lib/crypto.ts
import nacl from "tweetnacl";
import * as Crypto from "expo-crypto";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

export function b64(bytes: Uint8Array) {
  return encodeBase64(bytes);
}
export function unb64(s: string) {
  return decodeBase64(s);
}

export async function randomBytes(n: number) {
  const bytes = await Crypto.getRandomBytesAsync(n);
  return new Uint8Array(bytes);
}

export async function randomNonce() {
  return randomBytes(nacl.secretbox.nonceLength); // 24 bytes
}
