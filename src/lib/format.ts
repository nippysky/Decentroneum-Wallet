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

/**
 * A token balance sized to fit a list row.
 *
 * Commas keep normal balances readable — "12,345.67" is instantly legible in
 * a way "12345.67" is not. But comma-grouping alone doesn't scale: a token
 * with a trillion supply renders "1,000,000,000,000.00", twenty characters
 * that will either clip mid-number or shove the rest of the row off the card.
 * A clipped number is worse than a rounded one, because "1,000,000,00…" reads
 * as a different quantity entirely.
 *
 * So: exact and comma-grouped below a million, abbreviated above it. The
 * exact figure is always one tap away on the asset's own screen, which is the
 * right place for precision.
 *
 *   999999.5   → "999,999.50"
 *   1000000    → "1M"
 *   1250000    → "1.25M"
 *   3400000000 → "3.4B"
 */
export function formatTokenAmountCompact(amount: number): string {
  if (!Number.isFinite(amount)) return "0.00";
  if (amount < 0) return `-${formatTokenAmountCompact(-amount)}`;

  // A real but tiny holding must not render as "0.00" — that says you own
  // nothing when you own something.
  if (amount > 0 && amount < 0.01) return "< 0.01";

  // Below a million, exact and comma-grouped. Predictable beats clever: a
  // balance of 999,999.50 is shown as 999,999.50, not rounded up to "1M".
  if (amount < 1e6) {
    return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Largest unit first.
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
  ];

  for (const [threshold, suffix] of units) {
    if (amount >= threshold) {
      // Two significant-ish decimals, then trimmed: 1.00M reads as noise,
      // 1.25M carries information.
      return `${trimZeros((amount / threshold).toFixed(2))}${suffix}`;
    }

    // Rounding can cross a unit boundary: 999,999,999 is below 1e9, so the
    // naive path drops it into the "M" bucket where it rounds to "1000M" —
    // wrong-looking, and longer than an abbreviation is meant to be. If it
    // rounds up INTO this unit, use this unit.
    if (Number((amount / threshold).toFixed(2)) >= 1) return `1${suffix}`;
  }

  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
