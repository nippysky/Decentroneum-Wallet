import { ethers } from "ethers";

const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function buildRegistrationMessage(address: string, pushToken: string, timestamp: string): string {
  // Must match src/lib/notifications/register.ts#buildRegistrationMessage
  // BYTE FOR BYTE. A signature is only valid over the exact text that produced
  // it, so editing this line — even the wording — invalidates every signature
  // made by an app build that still sends the old text. Change it only
  // alongside a coordinated app release.
  return [
    "Register this device for Decentroneum notifications.",
    `address:${address.toLowerCase()}`,
    `pushToken:${pushToken}`,
    `timestamp:${timestamp}`,
  ].join("\n");
}

/**
 * Verifies that `signature` was produced by the private key controlling
 * `address`, over a message binding this exact address + pushToken +
 * timestamp — so a leaked signature can't be replayed to register a
 * different device, and stale signatures are rejected outright.
 */
export function verifyRegistrationProof(opts: {
  address: string;
  pushToken: string;
  timestamp: string;
  signature: string;
}): { ok: true } | { ok: false; reason: string } {
  const skew = Math.abs(Date.now() - Date.parse(opts.timestamp));
  if (!Number.isFinite(skew) || skew > MAX_SKEW_MS) {
    return { ok: false, reason: "Signature timestamp expired — try again." };
  }

  const message = buildRegistrationMessage(opts.address, opts.pushToken, opts.timestamp);

  try {
    const recovered = ethers.verifyMessage(message, opts.signature);
    if (recovered.toLowerCase() !== opts.address.toLowerCase()) {
      return { ok: false, reason: "Signature does not match address." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Malformed signature." };
  }
}
