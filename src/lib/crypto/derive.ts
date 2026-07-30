// src/lib/crypto/derive.ts
//
// BIP-44 key derivation. This file decides which addresses the wallet
// controls, so it is deliberately tiny and depends on nothing but ethers.
//
// ─── Why the path is written out explicitly ─────────────────────────────────
//
// `m/44'/60'/0'/0/N` is the Ethereum standard, and it is what MetaMask, Trust,
// Rabby, Ledger and every other mainstream wallet uses. The derivation is
// deterministic, so the same phrase produces the same addresses everywhere —
// which is the entire reason a person can move between wallets carrying
// nothing but twelve words.
//
//   m / 44' / 60' / 0' / 0 / N
//       │     │     │    │   └── address index — the only part that varies
//       │     │     │    └────── external chain (0 = receiving addresses)
//       │     │     └─────────── account
//       │     └───────────────── coin type: 60 = Ethereum and all EVM chains
//       └─────────────────────── BIP-44
//
// ethers' `fromPhrase(m)` already defaults to index 0 of this exact path, so
// accounts created before HD support existed ARE index 0 and keep their
// addresses across the v3 migration. Nothing moves.
//
// Verified against the published Hardhat/Anvil test mnemonic ("test test …
// junk"): indexes 0-4 reproduce 0xf39F…, 0x7099…, 0x3C44…, 0x90F7… and
// 0x15d3… exactly — the same addresses MetaMask shows for that phrase.
//
// Getting this wrong is not a cosmetic bug. It would show someone an address
// no other wallet can reach, and funds sent there would be unrecoverable
// outside this app. Do not change the path without re-running those vectors.
import { ethers } from "ethers";

/** The standard Ethereum account path for a given address index. */
export function pathForIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Account index must be a non-negative integer");
  }
  return `m/44'/60'/0'/0/${index}`;
}

/** Address at a given index of a seed phrase. */
export function addressAtIndex(mnemonic: string, index: number): string {
  return ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, pathForIndex(index)).address;
}

/**
 * Address of a phrase's FIRST account.
 *
 * Identical to addressAtIndex(mnemonic, 0); it keeps its own name because
 * "the address of this phrase" is what a caller importing a standalone wallet
 * actually means.
 */
export function addressFromMnemonic(mnemonic: string): string {
  return addressAtIndex(mnemonic, 0);
}
