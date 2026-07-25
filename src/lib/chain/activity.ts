// src/lib/chain/activity.ts
//
// Per-asset activity history for the token detail screen, backed by the
// Blockscout Etherscan-compatible REST API (same server the block explorer
// itself uses — see ELECTRONEUM.explorer in networks.ts). Two focused
// queries instead of a generic "explorer" feature: native ETN transfers
// (action=txlist) and a single ERC-20 contract's transfer log for one
// address (action=tokentx&contractaddress=...) — exactly the activity that
// belongs on that asset's own page, nothing more.
import { ELECTRONEUM } from "./networks";

export type ActivityItem = {
  hash: string;
  from: string;
  to: string;
  valueRaw: string; // raw integer string, in the asset's smallest unit
  timestamp: number; // unix seconds
  direction: "in" | "out" | "self";
  failed: boolean;
};

const FETCH_TIMEOUT_MS = 10_000;

function baseUrl() {
  return `${ELECTRONEUM.explorer}api`;
}

async function fetchJson(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl()}?${qs}`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function direction(from: string, to: string, owner: string): "in" | "out" | "self" {
  const f = from?.toLowerCase() === owner.toLowerCase();
  const t = to?.toLowerCase() === owner.toLowerCase();
  if (f && t) return "self";
  if (f) return "out";
  return "in";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Native ETN transfer history for an address. Never throws — [] on any failure. */
export async function fetchNativeActivity(address: string, limit = 30): Promise<ActivityItem[]> {
  const json = await fetchJson({
    module: "account",
    action: "txlist",
    address,
    sort: "desc",
    page: "1",
    offset: String(limit),
  });

  const rows = Array.isArray(json?.result) ? json.result : [];

  return rows
    .filter((r: any) => str(r.value) !== "0") // pure contract calls with no value transfer aren't "activity" for the ETN page
    .map((r: any) => ({
      hash: str(r.hash),
      from: str(r.from),
      to: str(r.to),
      valueRaw: str(r.value) || "0",
      timestamp: Number(r.timeStamp) || 0,
      direction: direction(str(r.from), str(r.to), address),
      failed: str(r.isError) === "1" || str(r.txreceipt_status) === "0",
    }))
    .filter((r: ActivityItem) => !!r.hash);
}

/** ERC-20 transfer history for one token contract, scoped to one address. Never throws. */
export async function fetchTokenActivity(tokenAddress: string, address: string, limit = 30): Promise<ActivityItem[]> {
  const json = await fetchJson({
    module: "account",
    action: "tokentx",
    contractaddress: tokenAddress,
    address,
    sort: "desc",
    page: "1",
    offset: String(limit),
  });

  const rows = Array.isArray(json?.result) ? json.result : [];

  return rows
    .map((r: any) => ({
      hash: str(r.hash),
      from: str(r.from),
      to: str(r.to),
      valueRaw: str(r.value) || "0",
      timestamp: Number(r.timeStamp) || 0,
      direction: direction(str(r.from), str(r.to), address),
      failed: false, // an indexed ERC-20 Transfer log only exists if the transfer succeeded
    }))
    .filter((r: ActivityItem) => !!r.hash);
}

export function explorerTxUrl(hash: string): string {
  return `${ELECTRONEUM.explorer}tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${ELECTRONEUM.explorer}address/${address}`;
}

export function explorerTokenUrl(address: string): string {
  return `${ELECTRONEUM.explorer}token/${address}`;
}
