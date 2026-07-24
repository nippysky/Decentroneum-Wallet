// src/lib/erc20.ts
import { ethers } from "ethers";
import { getProvider } from "./wallet";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

export async function getErc20BalanceRaw(tokenAddress: string, owner: string): Promise<bigint> {
  // Routed through the shared getProvider() (see wallet.ts) instead of
  // opening its own single-URL connection — this is what gives token
  // balance reads the same RPC failover as everything else in the app.
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, getProvider());
  const bal: bigint = await c.balanceOf(owner);
  return bal;
}
