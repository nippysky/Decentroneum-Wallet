import { ethers } from "ethers";

export function addressFromMnemonic(mnemonic: string): string {
  const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic);
  return wallet.address;
}
