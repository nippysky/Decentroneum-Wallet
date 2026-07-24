// src/lib/walletconnect/namespaces.ts
import { buildApprovedNamespaces } from "@walletconnect/utils";
import type { ProposalTypes } from "@walletconnect/types";
import { ELECTRONEUM } from "@/src/lib/chain/networks";

const CHAIN = `eip155:${ELECTRONEUM.chainId}`;

const SUPPORTED_METHODS = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
];

const SUPPORTED_EVENTS = ["accountsChanged", "chainChanged"];

/**
 * Builds the namespaces we approve for a session proposal — always just the
 * Electroneum Smart Chain, with the given account. Any proposal that
 * requires a chain we don't support (required, not optional) should be
 * rejected before this is called.
 */
export function buildElectroneumNamespaces(proposalParams: ProposalTypes.Struct, address: string) {
  return buildApprovedNamespaces({
    proposal: proposalParams,
    supportedNamespaces: {
      eip155: {
        chains: [CHAIN],
        methods: SUPPORTED_METHODS,
        events: SUPPORTED_EVENTS,
        accounts: [`${CHAIN}:${address}`],
      },
    },
  });
}

/** True if the proposal only requires chains we can actually serve. */
export function proposalIsSupported(proposalParams: ProposalTypes.Struct): boolean {
  const required = proposalParams.requiredNamespaces?.eip155;
  if (!required) return true; // nothing strictly required — fine
  return (required.chains ?? []).every((c) => c === CHAIN);
}
