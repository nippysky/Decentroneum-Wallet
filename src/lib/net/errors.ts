// src/lib/net/errors.ts
//
// Turns a network or RPC failure into something a person can act on.
//
// ─── Why this exists ────────────────────────────────────────────────────────
//
// The wallet screen used to render `e.message` directly. A live user saw:
//
//     no runners?!
//
// in red, under their balance. That is Ankr's internal message for "this
// endpoint currently has no backend nodes" — accurate for them, meaningless to
// anyone holding a phone. It reads like the wallet is broken rather than like
// the network is briefly unreachable, which in a wallet is the difference
// between a shrug and a panic.
//
// Upstream operators are free to change these strings whenever they like, and
// none of them are written for end users. So nothing from a provider is ever
// shown directly: we classify, then say something of our own.
//
// The original message is not discarded — it goes to the console, where it is
// useful to us and invisible to the user.

/** Provider strings that mean "we could not serve this request right now". */
const UPSTREAM_UNAVAILABLE = [
  "no runners", // Ankr: no backend nodes available for this chain
  "no backend",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "502",
  "503",
  "504",
];

const TIMEOUT = ["timeout", "timed out", "etimedout", "aborted", "abort"];

const OFFLINE = [
  "network request failed", // React Native's fetch, when there is no route out
  "network error",
  "failed to fetch",
  "enotfound",
  "econnrefused",
  "econnreset",
  "dns",
];

const RATE_LIMITED = ["rate limit", "too many requests", "429"];

function matches(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/**
 * A short, honest, user-facing sentence for a failed network call.
 *
 * Deliberately never names the provider or the endpoint. Which RPC we happened
 * to fall through to is our problem, not the user's, and naming it invites
 * people to conclude the wrong thing about their own funds.
 *
 * @param context what the app was doing — completes "Couldn't load your ___".
 */
export function friendlyNetworkError(err: unknown, context = "balance"): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err ?? "");

  // Kept for us, not shown to them.
  if (raw) console.warn(`[net] ${context} failed:`, raw);

  const s = raw.toLowerCase();

  if (matches(s, OFFLINE)) {
    return "No internet connection. Check your network and pull down to retry.";
  }
  if (matches(s, TIMEOUT)) {
    return `Timed out loading your ${context}. Pull down to retry.`;
  }
  if (matches(s, RATE_LIMITED)) {
    return "The network is busy right now. Pull down to retry in a moment.";
  }
  if (matches(s, UPSTREAM_UNAVAILABLE)) {
    return "The Electroneum network is temporarily unreachable. Pull down to retry.";
  }

  // Unrecognised. Still say nothing raw — an unknown provider string is
  // exactly the case this file exists to contain.
  return `Couldn't load your ${context}. Pull down to retry.`;
}
