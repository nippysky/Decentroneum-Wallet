// src/lib/erc20.ts
import { ethers } from "ethers";
import { ELECTRONEUM } from "./networks";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

export async function getErc20BalanceRaw(tokenAddress: string, owner: string): Promise<bigint> {
  const provider = new ethers.JsonRpcProvider(ELECTRONEUM.rpcUrl, ELECTRONEUM.chainId);
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const bal: bigint = await c.balanceOf(owner);
  return bal;
}
