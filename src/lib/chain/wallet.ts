// src/lib/wallet.ts
import * as Crypto from "expo-crypto";
import { ethers } from "ethers";
import { ELECTRONEUM } from "@/src/lib/chain/networks";

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

// Safety margin applied to every gasLimit this wallet uses before it signs and
// broadcasts a transaction on the user's behalf. `provider.estimateGas` runs
// against the current state of the chain at call time; by the time the user
// actually confirms and the tx lands a block or two later, state can have
// shifted just enough (a storage slot warms/colds differently, a branch in the
// contract takes a different path) to push real gas usage slightly above the
// original estimate — enough to make the tx revert out-of-gas after it's
// already been broadcast and paid for. A fixed percentage buffer on gasLimit
// costs the user nothing extra (unused gas is refunded), and removes that
// failure mode entirely.
//
// This ONLY applies to transactions the wallet itself builds and sends
// (SendSheet, WalletConnect tx approval, in-app browser tx approval — all of
// which route through estimateFees below). It must never be applied to a raw
// `eth_estimateGas` RPC response handed back to a dApp over the injected
// provider — that's a passthrough of the node's real answer, and altering it
// would violate the EIP-1193 contract dApps rely on.
const GAS_LIMIT_BUFFER_NUMERATOR = 110n; // +10%
const GAS_LIMIT_BUFFER_DENOMINATOR = 100n;

function bufferGasLimit(estimated: bigint): bigint {
  // Ceiling division — the buffer must never round DOWN below a straight
  // 10% increase, since the entire point is to never end up with less
  // headroom than the raw estimate already had.
  return (estimated * GAS_LIMIT_BUFFER_NUMERATOR + (GAS_LIMIT_BUFFER_DENOMINATOR - 1n)) / GAS_LIMIT_BUFFER_DENOMINATOR;
}

// ✅ Singleton provider (less flaky, more "wallet-grade") — a FallbackProvider
// over ELECTRONEUM.rpcUrl + ELECTRONEUM.rpcFallbackUrls (see networks.ts).
// `quorum: 1` means normal operation only ever queries ONE endpoint per
// call — this is plain ordered failover (try the next one only if the
// current one errors/times out), not multi-provider consensus-checking,
// which would call every endpoint on every request.
//
// Deliberately public/free endpoints only, never a paid API key: this file
// ships inside the compiled app bundle onto every user's device, and a JS
// bundle is trivially reverse-engineerable — anyone could pull a key back
// out of it. A dedicated/paid RPC key belongs server-side only (see
// server/src/config.ts, which the push server uses and which never leaves
// your own infrastructure).
let _provider: ethers.Provider | null = null;
let _rpcProviders: ethers.JsonRpcProvider[] | null = null; // ordered, index 0 = ELECTRONEUM.rpcUrl — see sendRaw() below

function getOrderedProviders(): ethers.JsonRpcProvider[] {
  if (_rpcProviders) return _rpcProviders;
  const network = { chainId: ELECTRONEUM.chainId, name: ELECTRONEUM.name };
  const urls = [ELECTRONEUM.rpcUrl, ...ELECTRONEUM.rpcFallbackUrls];
  _rpcProviders = urls.map((url) => new ethers.JsonRpcProvider(url, network, { staticNetwork: true }));
  return _rpcProviders;
}

export function getProvider(): ethers.Provider {
  if (_provider) return _provider;

  const network = { chainId: ELECTRONEUM.chainId, name: ELECTRONEUM.name };
  const providers = getOrderedProviders();
  const configs = providers.map((provider, i) => ({
    provider,
    priority: i, // lower = tried first; index 0 is ELECTRONEUM.rpcUrl
    stallTimeout: i === 0 ? 4000 : 2500,
    weight: 1,
  }));

  _provider = configs.length > 1 ? new ethers.FallbackProvider(configs, network, { quorum: 1 }) : configs[0].provider;

  return _provider;
}

/**
 * Raw JSON-RPC passthrough (provider.send(method, params)) with the same
 * ordered failover as getProvider(), for the in-app dApp browser's injected
 * EIP-1193 provider. Exists as a separate function because FallbackProvider
 * has no generic `.send()` — dApps calling arbitrary methods (or ones we
 * intentionally pass through raw, like eth_getBalance/eth_getTransactionCount
 * in app/browser/web.tsx) expect the literal single-node JSON-RPC answer,
 * not something a consensus-checking wrapper could give an opinion on.
 * Tries each configured endpoint in order, same as getProvider().
 */
export async function sendRaw(method: string, params: unknown[] = []): Promise<unknown> {
  const providers = getOrderedProviders();
  let lastErr: unknown;
  for (const provider of providers) {
    try {
      return await provider.send(method, params as any[]);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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

  const [feeData, rawGasLimit] = await Promise.all([
    provider.getFeeData(),
    provider.estimateGas({ ...opts.tx, from: opts.from }),
  ]);

  const gasLimit = bufferGasLimit(rawGasLimit);

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

/**
 * ✅ Dapp tx normalization
 * Dapps often send hex strings (0x...), or sometimes decimals.
 * We normalize to an ethers.TransactionRequest safely.
 */
export function normalizeDappTx(input: unknown): ethers.TransactionRequest {
  const obj = (input && typeof input === "object") ? (input as Record<string, unknown>) : {};

  const pickStr = (k: string) => {
    const v = obj[k];
    return typeof v === "string" ? v : undefined;
  };

  const pickNumLike = (k: string): ethers.BigNumberish | undefined => {
    const v = obj[k];
    if (v == null) return undefined;

    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(v);

    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return undefined;
      // hex
      if (s.startsWith("0x")) {
        try { return ethers.toBigInt(s); } catch { return undefined; }
      }
      // decimal int
      if (/^[0-9]+$/.test(s)) {
        try { return BigInt(s); } catch { return undefined; }
      }
      return undefined;
    }

    return undefined;
  };

  const to = pickStr("to");
  const from = pickStr("from");
  const data = pickStr("data") ?? pickStr("input");

  const value = pickNumLike("value");
  const nonce = pickNumLike("nonce");
  const gasLimit = pickNumLike("gasLimit") ?? pickNumLike("gas");
  const gasPrice = pickNumLike("gasPrice");

  const maxFeePerGas = pickNumLike("maxFeePerGas");
  const maxPriorityFeePerGas = pickNumLike("maxPriorityFeePerGas");

  const tx: ethers.TransactionRequest = {};

  if (to) tx.to = to;
  if (from) tx.from = from;
  if (data) tx.data = data.startsWith("0x") ? data : `0x${data}`;
  if (value != null) tx.value = value;
  if (nonce != null) tx.nonce = Number(nonce);
  if (gasLimit != null) tx.gasLimit = gasLimit;

  // prefer 1559 if present
  if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
    tx.maxFeePerGas = maxFeePerGas;
    tx.maxPriorityFeePerGas = maxPriorityFeePerGas;
  } else if (gasPrice != null) {
    tx.gasPrice = gasPrice;
  }

  return tx;
}
