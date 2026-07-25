// src/lib/format.ts
import { ethers } from "ethers";

export function formatUnits2dp(raw: bigint, decimals: number) {
  const s = ethers.formatUnits(raw, decimals);
  const [intPartRaw, fracRaw = ""] = s.split(".");
  const intPart = intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracRaw + "00").slice(0, 2);
  return `${intPart}.${frac}`;
}

/** Native ETN wei -> "1,234.56" (always 2dp, comma-grouped). */
export function formatNative2dpFromWei(wei: bigint) {
  const s = ethers.formatEther(wei);
  const [intPartRaw, fracRaw = ""] = s.split(".");
  const intPart = intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracRaw + "00").slice(0, 2);
  return `${intPart}.${frac}`;
}

/** Native ETN wei -> comma-grouped string with an arbitrary fixed decimal count. */
export function formatFromWeiWithDp(wei: bigint, dp: number) {
  const s = ethers.formatEther(wei);
  const [intRaw, fracRaw = ""] = s.split(".");
  const intPart = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracRaw + "0".repeat(dp)).slice(0, dp);
  return dp > 0 ? `${intPart}.${frac}` : intPart;
}

const WEI_0_01 = 10n ** 16n; // 0.01 ETN
const WEI_0_0001 = 10n ** 14n; // 0.0001 ETN

/** Network fee display — more decimal places the smaller the fee is, so tiny fees don't just show "0.00". */
export function formatFeeWeiAdaptive(wei: bigint) {
  if (wei === 0n) return "0";
  if (wei < WEI_0_0001) return formatFromWeiWithDp(wei, 8);
  if (wei < WEI_0_01) return formatFromWeiWithDp(wei, 6);
  return formatFromWeiWithDp(wei, 2);
}

export function trimZeros(s: string) {
  if (!s.includes(".")) return s;
  return s.replace(/(\.\d*?[1-9])0+$/g, "$1").replace(/\.0+$/, "");
}

export function sanitizeAmountInput(s: string) {
  const cleaned = s.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

export function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

/** Comma-groups the integer part of an already-decimal string. */
function groupInt(intPart: string) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Display formatter for a raw decimal *string* (e.g. whatever the user
 * typed into an amount field, or a value already converted out of wei).
 *
 * Renders human-readable: "1000" -> "1,000", "1234.5678" -> "1,234.57".
 * Capped at 2 decimal places by default to match the rest of the app.
 *
 * Guard rail: for genuinely tiny non-zero values that would round away to
 * "0.00" we fall back to more precision rather than lying to the user
 * about their balance — showing "0.00" for a real 0.0004 balance is worse
 * than showing "0.0004".
 */
export function formatAmountDisplay(value: string | number, maxDp = 2): string {
  const s = String(value ?? "").trim();
  if (!s) return "";

  const n = Number(s);
  if (!Number.isFinite(n)) return s;

  const negative = s.startsWith("-");
  const [intRaw = "0", fracRaw = ""] = s.replace("-", "").split(".");

  // Would round to all-zeros but isn't actually zero → keep real precision.
  const roundsToZero = Number(`0.${fracRaw || "0"}`) > 0 && Number(intRaw) === 0 && Number(`0.${fracRaw}`) < Number(`0.${"0".repeat(maxDp)}5`);

  if (roundsToZero) {
    const firstSig = fracRaw.search(/[1-9]/);
    const dp = Math.min(fracRaw.length, firstSig + 2);
    return `${negative ? "-" : ""}0.${fracRaw.slice(0, dp)}`;
  }

  const frac = (fracRaw + "0".repeat(maxDp)).slice(0, maxDp);
  const grouped = groupInt(intRaw || "0");
  return `${negative ? "-" : ""}${maxDp > 0 ? `${grouped}.${frac}` : grouped}`;
}
