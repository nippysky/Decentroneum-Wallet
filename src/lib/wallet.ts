// src/lib/wallet.ts
import * as Crypto from "expo-crypto";
import { ethers } from "ethers";
import { ELECTRONEUM } from "@/src/lib/networks";

/**
 * SECURITY NOTES
 * - Never log mnemonic / private key / raw tx.
 * - Keep mnemonic in memory only.
 * - All functions below take mnemonic explicitly to avoid hidden global state.
 */

export type CreatedWallet = {
  mnemonic: string;
  address: string;
};

export type TxResult = {
  hash: string;
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

// ✅ Singleton provider (less flaky, more “wallet-grade”)
let _provider: ethers.JsonRpcProvider | null = null;

export function getProvider() {
  if (_provider) return _provider;

  _provider = new ethers.JsonRpcProvider(ELECTRONEUM.rpcUrl, {
    chainId: ELECTRONEUM.chainId,
    name: ELECTRONEUM.name,
  });

  return _provider;
}

export async function createWallet(): Promise<CreatedWallet> {
  const entropy = await Crypto.getRandomBytesAsync(16);
  const mnemonic = ethers.Mnemonic.fromEntropy(entropy).phrase;
  const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic);
  return { mnemonic, address: wallet.address };
}

export function addressFromMnemonic(mnemonic: string): string {
  return ethers.HDNodeWallet.fromPhrase(mnemonic).address;
}

export function getSigner(mnemonic: string) {
  return ethers.HDNodeWallet.fromPhrase(mnemonic).connect(getProvider());
}

/** Native ETN balance (as bigint, in wei) */
export async function getNativeBalanceWei(address: string): Promise<bigint> {
  return getProvider().getBalance(address);
}

/** Estimate gas + fees for any tx request */
export async function estimateFees(opts: {
  from: string;
  tx: ethers.TransactionRequest;
}) {
  const provider = getProvider();

  const [feeData, gasLimit] = await Promise.all([
    provider.getFeeData(),
    provider.estimateGas({ ...opts.tx, from: opts.from }),
  ]);

  let feeWei = 0n;

  // EIP-1559
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    feeWei = gasLimit * feeData.maxFeePerGas;
    return {
      gasLimit,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      feeWei,
      mode: "eip1559" as const,
    };
  }

  // Legacy
  if (feeData.gasPrice) {
    feeWei = gasLimit * feeData.gasPrice;
    return {
      gasLimit,
      gasPrice: feeData.gasPrice,
      feeWei,
      mode: "legacy" as const,
    };
  }

  return { gasLimit, feeWei: 0n, mode: "unknown" as const };
}

export async function sendNativeETN(opts: {
  mnemonic: string;
  to: string;
  amountEth: string;
}): Promise<TxResult> {
  const { mnemonic, to, amountEth } = opts;

  if (!ethers.isAddress(to)) throw new Error("Invalid recipient address");

  const signer = getSigner(mnemonic);

  const tx: ethers.TransactionRequest = {
    to,
    value: ethers.parseEther(amountEth),
    chainId: ELECTRONEUM.chainId,
  };

  const fee = await estimateFees({ from: signer.address, tx });

  tx.gasLimit = fee.gasLimit;

  if (fee.mode === "eip1559") {
    tx.maxFeePerGas = fee.maxFeePerGas;
    tx.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
  } else if (fee.mode === "legacy") {
    tx.gasPrice = fee.gasPrice;
  }

  const resp = await signer.sendTransaction(tx);
  return { hash: resp.hash };
}

export async function sendErc20(opts: {
  mnemonic: string;
  tokenAddress: string;
  to: string;
  amount: string;
  decimals: number;
}): Promise<TxResult> {
  const { mnemonic, tokenAddress, to, amount, decimals } = opts;

  if (!ethers.isAddress(tokenAddress)) throw new Error("Invalid token address");
  if (!ethers.isAddress(to)) throw new Error("Invalid recipient address");

  const signer = getSigner(mnemonic);
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

  const amountRaw = ethers.parseUnits(amount, decimals);
  const txReq = await c.transfer.populateTransaction(to, amountRaw);

  const tx: ethers.TransactionRequest = {
    to: tokenAddress,
    data: txReq.data,
    value: 0n,
    chainId: ELECTRONEUM.chainId,
  };

  const fee = await estimateFees({ from: signer.address, tx });

  tx.gasLimit = fee.gasLimit;

  if (fee.mode === "eip1559") {
    tx.maxFeePerGas = fee.maxFeePerGas;
    tx.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
  } else if (fee.mode === "legacy") {
    tx.gasPrice = fee.gasPrice;
  }

  const resp = await signer.sendTransaction(tx);
  return { hash: resp.hash };
}
