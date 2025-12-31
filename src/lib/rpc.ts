// src/lib/rpc.ts
import { ELECTRONEUM } from "./networks";

type RpcOk<T> = { jsonrpc: "2.0"; id: number; result: T };
type RpcErr = { jsonrpc: "2.0"; id: number; error: { code: number; message: string } };

async function rpc<T>(method: string, params: any[] = []): Promise<T> {
  const res = await fetch(ELECTRONEUM.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });

  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = (await res.json()) as RpcOk<T> | RpcErr;

  if ("error" in data) throw new Error(data.error.message);
  return data.result;
}

export async function getNativeBalanceWei(address: string): Promise<bigint> {
  const hex = await rpc<string>("eth_getBalance", [address, "latest"]);
  return BigInt(hex);
}
