// src/lib/rpc.ts
//
// Previously a hand-rolled raw-fetch JSON-RPC client hitting ELECTRONEUM.rpcUrl
// directly — meaning it silently bypassed the failover chain in wallet.ts's
// getProvider() and only ever had one endpoint to work with. Rewritten on top
// of the shared provider so a failed primary endpoint here fails over to the
// same fallback chain as everything else, instead of this one path going dark
// on its own. Exported signatures are unchanged, so callers need no changes.
import { getProvider } from "./wallet";

export async function getNativeBalanceWei(address: string): Promise<bigint> {
  return getProvider().getBalance(address);
}


