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
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
] as const;

export async function createWallet(): Promise<CreatedWallet> {
  // 16 bytes entropy => 12-word mnemonic
  const entropy = await Crypto.getRandomBytesAsync(16);
  const mnemonic = ethers.Mnemonic.fromEntropy(entropy).phrase;

  const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic);
  return { mnemonic, address: wallet.address };
}

export function addressFromMnemonic(mnemonic: string): string {
  return ethers.HDNodeWallet.fromPhrase(mnemonic).address;
}

export function getProvider() {
  // ethers v6 provider (supports provider.send(method, params))
  return new ethers.JsonRpcProvider(ELECTRONEUM.rpcUrl, {
    chainId: ELECTRONEUM.chainId,
    name: ELECTRONEUM.name,
  });
}

export function getSigner(mnemonic: string) {
  const provider = getProvider();
  return ethers.HDNodeWallet.fromPhrase(mnemonic).connect(provider);
}

/** Native ETN balance (as bigint, in wei) */
export async function getNativeBalanceWei(address: string): Promise<bigint> {
  const provider = getProvider();
  return provider.getBalance(address);
}

/** Native ETN balance formatted */
export async function getNativeBalance(address: string): Promise<string> {
  const wei = await getNativeBalanceWei(address);
  return ethers.formatEther(wei);
}

/**
 * Send native ETN
 * - amountEth: string like "0.5"
 * Returns tx hash.
 */
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

  const provider = getProvider();
  const [feeData, gasLimit] = await Promise.all([
    provider.getFeeData(),
    provider.estimateGas({ ...tx, from: signer.address }),
  ]);

  tx.gasLimit = gasLimit;

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    tx.maxFeePerGas = feeData.maxFeePerGas;
    tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  } else if (feeData.gasPrice) {
    tx.gasPrice = feeData.gasPrice;
  }

  const resp = await signer.sendTransaction(tx);
  return { hash: resp.hash };
}

/**
 * ERC-20 balance
 * - tokenAddress: ERC-20 contract
 * - decimals: if you already know it (from allowlist), pass it to skip a call
 */
export async function getErc20Balance(opts: {
  tokenAddress: string;
  owner: string;
  decimals?: number;
}): Promise<{ raw: bigint; formatted: string; decimals: number }> {
  const { tokenAddress, owner } = opts;

  if (!ethers.isAddress(tokenAddress)) throw new Error("Invalid token address");
  if (!ethers.isAddress(owner)) throw new Error("Invalid owner address");

  const provider = getProvider();
  const c = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  const decimals = typeof opts.decimals === "number" ? opts.decimals : Number(await c.decimals());
  const raw: bigint = await c.balanceOf(owner);
  const formatted = ethers.formatUnits(raw, decimals);

  return { raw, formatted, decimals };
}

/**
 * Utility: format with 2dp + human readable separators.
 * Example: "12345.6789" -> "12,345.68"
 */
export function formatAmount2dp(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Dapp tx params usually come in as strings (hex) per EIP-1193.
 * We normalize them into an ethers TransactionRequest.
 */
export function normalizeDappTx(input: any): ethers.TransactionRequest {
  const tx: ethers.TransactionRequest = {};

  if (input?.to && ethers.isAddress(input.to)) tx.to = input.to;
  if (input?.from && ethers.isAddress(input.from)) tx.from = input.from;

  // value can be hex string like "0x0" or decimal string; handle both
  if (typeof input?.value === "string") {
    try {
      tx.value = input.value.startsWith("0x") ? BigInt(input.value) : ethers.parseEther(input.value);
    } catch {}
  }

  if (typeof input?.data === "string") tx.data = input.data;

  // gas/gasLimit
  const gl = input?.gas ?? input?.gasLimit;
  if (typeof gl === "string" && gl.startsWith("0x")) {
    try {
      tx.gasLimit = BigInt(gl);
    } catch {}
  }

  // fees
  if (typeof input?.gasPrice === "string" && input.gasPrice.startsWith("0x")) {
    try {
      tx.gasPrice = BigInt(input.gasPrice);
    } catch {}
  }
  if (typeof input?.maxFeePerGas === "string" && input.maxFeePerGas.startsWith("0x")) {
    try {
      tx.maxFeePerGas = BigInt(input.maxFeePerGas);
    } catch {}
  }
  if (
    typeof input?.maxPriorityFeePerGas === "string" &&
    input.maxPriorityFeePerGas.startsWith("0x")
  ) {
    try {
      tx.maxPriorityFeePerGas = BigInt(input.maxPriorityFeePerGas);
    } catch {}
  }

  // nonce
  if (typeof input?.nonce === "string" && input.nonce.startsWith("0x")) {
    try {
      tx.nonce = Number(BigInt(input.nonce));
    } catch {}
  }

  tx.chainId = ELECTRONEUM.chainId;
  return tx;
}
