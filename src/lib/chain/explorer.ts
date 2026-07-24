// src/lib/blockscout.ts
import { ELECTRONEUM } from "./networks";

type BlockscoutToken = {
  contractAddress: string;
  tokenName: string;
  symbol: string;
  decimals: string;
  balance: string; // usually raw integer string
};

type BlockscoutResponse<T> = {
  status: string;
  message: string;
  result: T;
};

// Etherscan-compatible Blockscout API:
// https://instance_base_url/api?module=account&action=tokenlist&address=...
export async function fetchTokensOwned(address: string): Promise<BlockscoutToken[]> {
  const url =
    `${ELECTRONEUM.explorer}api` +
    `?module=account&action=tokenlist&address=${encodeURIComponent(address)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Explorer HTTP ${res.status}`);

  const data = (await res.json()) as BlockscoutResponse<BlockscoutToken[]>;
  if (!data || !Array.isArray(data.result)) return [];

  return data.result;
}

export type ExplorerTx = {
  hash: string;
  from: string;
  to: string;
  value: string; // wei, decimal string
  gasUsed: string;
  gasPrice: string;
  timeStamp: string; // unix seconds, decimal string
  isError: string; // "0" | "1"
  input: string;
  methodId?: string;
  functionName?: string;
  blockNumber: string;
  confirmations?: string;
};

/** Etherscan-compatible "txlist" — an account's native transaction history. */
export async function fetchAccountTxList(address: string, limit = 25): Promise<ExplorerTx[]> {
  const url =
    `${ELECTRONEUM.explorer}api` +
    `?module=account&action=txlist&address=${encodeURIComponent(address)}` +
    `&sort=desc&page=1&offset=${limit}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Explorer HTTP ${res.status}`);

  const data = (await res.json()) as BlockscoutResponse<ExplorerTx[]>;
  if (!data || !Array.isArray(data.result)) return [];

  return data.result;
}

/** Look up a single transaction by hash directly from the explorer (used by search). */
export async function fetchTxByHash(hash: string): Promise<ExplorerTx | null> {
  // Blockscout's etherscan-compatible "txlist" doesn't support single-hash lookup
  // cleanly across all deployments, so we use the eth-compatible proxy module.
  const url = `${ELECTRONEUM.explorer}api?module=transaction&action=gettxinfo&txhash=${encodeURIComponent(hash)}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as BlockscoutResponse<any>;
  if (!data || data.status !== "1" || !data.result) return null;

  const r = data.result;
  return {
    hash: r.hash ?? hash,
    from: r.from ?? "",
    to: r.to ?? "",
    value: r.value ?? "0",
    gasUsed: r.gasUsed ?? "0",
    gasPrice: r.gasPrice ?? "0",
    timeStamp: r.timeStamp ?? "0",
    isError: r.isError ?? (r.status === "0" ? "1" : "0"),
    input: r.input ?? "0x",
    blockNumber: r.blockNumber ?? "0",
    confirmations: r.confirmations,
  };
}

export function explorerTxUrl(hash: string): string {
  return `${ELECTRONEUM.explorer}tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${ELECTRONEUM.explorer}address/${address}`;
}
