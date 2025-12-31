// src/lib/blockscout.ts
import { ELECTRONEUM } from "./networks";

type BlockscoutToken = {
  contractAddress: string;
  tokenName: string;
  symbol: string;
  decimals: string;
  balance: string; // usually raw integer string
};

type BlockscoutResponse = {
  status: string;
  message: string;
  result: BlockscoutToken[];
};

// Etherscan-compatible Blockscout API:
// https://instance_base_url/api?module=account&action=tokenlist&address=...
// Docs: Blockscout "tokenlist" endpoint :contentReference[oaicite:1]{index=1}
export async function fetchTokensOwned(address: string): Promise<BlockscoutToken[]> {
  const url =
    `${ELECTRONEUM.explorer}api` +
    `?module=account&action=tokenlist&address=${encodeURIComponent(address)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Explorer HTTP ${res.status}`);

  const data = (await res.json()) as BlockscoutResponse;
  if (!data || !Array.isArray(data.result)) return [];

  return data.result;
}
