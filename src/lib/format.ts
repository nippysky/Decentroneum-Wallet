// src/lib/format.ts
import { ethers } from "ethers";

export function formatUnits2dp(raw: bigint, decimals: number) {
  const s = ethers.formatUnits(raw, decimals);
  const [intPartRaw, fracRaw = ""] = s.split(".");
  const intPart = intPartRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracRaw + "00").slice(0, 2);
  return `${intPart}.${frac}`;
}
