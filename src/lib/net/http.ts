// src/lib/net/http.ts
//
// One place for every outbound HTTP call in the app.
//
// Why this exists: React Native's fetch() has NO default timeout. If a host
// is unreachable (DNS fails, server down, captive portal, airplane mode
// mid-request), the promise simply never settles. Any `await` on it hangs
// forever — which is exactly how a "hold to erase" gesture or a loading
// spinner ends up stuck with no way out but force-quitting the app.
//
// Every network call should go through here so that failure is always
// bounded and always *observable* rather than silent.

/** Default ceiling for a single request. Deliberately short — these are
 *  small JSON calls, not uploads. */
export const DEFAULT_TIMEOUT_MS = 10_000;

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * fetch() with a hard timeout. Aborts the underlying request (so the socket
 * is actually released, not just ignored) and rejects with TimeoutError.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (e: any) {
    // AbortError from our own timer → surface as a clear TimeoutError so
    // callers can distinguish "slow/unreachable" from "server said no".
    if (e?.name === "AbortError") throw new TimeoutError(timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** fetchWithTimeout + JSON parse. Throws on non-2xx. */
export async function fetchJson<T = unknown>(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const res = await fetchWithTimeout(input, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Fire-and-forget: run a promise but never let it block the caller, and
 * never let a rejection surface as an unhandled promise rejection.
 *
 * Use this for best-effort side effects (analytics-ish pings, push
 * deregistration) that must NEVER gate a user-facing action. The whole
 * point is that the UI proceeds immediately regardless of the network.
 */
export function fireAndForget(p: Promise<unknown> | (() => Promise<unknown>)): void {
  try {
    const promise = typeof p === "function" ? p() : p;
    promise.catch(() => {});
  } catch {
    // synchronous throw before the promise even existed — still non-fatal
  }
}

/**
 * Wraps any promise so it can never hang forever. Unlike fetchWithTimeout
 * this works on non-fetch promises too (native module calls, SDK methods
 * that talk to the network internally, etc).
 */
async function withTimeout<T>(p: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Like withTimeout, but resolves to `fallback` instead of throwing when the
 * inner promise times out or fails. For best-effort reads where a stale or
 * empty value is better than a stuck spinner.
 */
export async function withTimeoutOr<T>(p: Promise<T>, fallback: T, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  try {
    return await withTimeout(p, ms);
  } catch {
    return fallback;
  }
}
