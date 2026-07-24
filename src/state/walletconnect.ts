// src/state/walletconnect.ts
import { create } from "zustand";
import { getSdkError } from "@walletconnect/utils";
import type { SessionTypes, ProposalTypes } from "@walletconnect/types";
import { getWalletConnectClient } from "@/src/lib/walletconnect/client";
import { buildElectroneumNamespaces, proposalIsSupported } from "@/src/lib/walletconnect/namespaces";

export type PendingProposal = {
  id: number;
  params: ProposalTypes.Struct;
  name: string;
  url: string;
  icon?: string;
  supported: boolean;
};

export type PendingRequest = {
  topic: string;
  id: number;
  method: string;
  params: unknown;
  chainId: string;
  dappName?: string;
  dappUrl?: string;
};

type WalletConnectState = {
  initialized: boolean;
  connecting: boolean;
  sessions: SessionTypes.Struct[];
  pendingProposal: PendingProposal | null;
  pendingRequest: PendingRequest | null;
  lastError: string | null;

  init: () => Promise<void>;
  pair: (uri: string) => Promise<void>;

  approveProposal: (address: string) => Promise<void>;
  rejectProposal: () => Promise<void>;

  respondRequestResult: (result: unknown) => Promise<void>;
  respondRequestError: (message: string, code?: number) => Promise<void>;

  disconnectSession: (topic: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
};

export const useWalletConnect = create<WalletConnectState>((set, get) => ({
  initialized: false,
  connecting: false,
  sessions: [],
  pendingProposal: null,
  pendingRequest: null,
  lastError: null,

  init: async () => {
    if (get().initialized) return;

    try {
      const client = await getWalletConnectClient();

      client.on("session_proposal", (event) => {
        const proposer = event.params.proposer.metadata;
        set({
          pendingProposal: {
            id: event.id,
            params: event.params,
            name: proposer.name || "Unknown dapp",
            url: proposer.url || "",
            icon: proposer.icons?.[0],
            supported: proposalIsSupported(event.params),
          },
        });
      });

      client.on("session_request", (event) => {
        const { topic, params, id } = event;
        const session = client.session.get(topic);
        set({
          pendingRequest: {
            topic,
            id,
            method: params.request.method,
            params: params.request.params,
            chainId: params.chainId,
            dappName: session?.peer.metadata.name,
            dappUrl: session?.peer.metadata.url,
          },
        });
      });

      client.on("session_delete", () => {
        get().refreshSessions();
      });

      set({ initialized: true, sessions: client.session.getAll() });
    } catch (e: any) {
      set({ lastError: e?.message ?? "Failed to initialize WalletConnect" });
    }
  },

  pair: async (uri: string) => {
    set({ connecting: true, lastError: null });
    try {
      const client = await getWalletConnectClient();
      await client.pair({ uri: uri.trim() });
      // The "session_proposal" event (registered in init()) fires shortly after.
    } catch (e: any) {
      set({ lastError: e?.message ?? "Couldn't connect — check the link and try again." });
    } finally {
      set({ connecting: false });
    }
  },

  approveProposal: async (address: string) => {
    const proposal = get().pendingProposal;
    if (!proposal) return;

    const client = await getWalletConnectClient();

    try {
      const namespaces = buildElectroneumNamespaces(proposal.params, address);
      const { acknowledged } = await client.approve({ id: proposal.id, namespaces });
      await acknowledged();
      await get().refreshSessions();
    } catch (e: any) {
      set({ lastError: e?.message ?? "Failed to approve connection" });
    } finally {
      set({ pendingProposal: null });
    }
  },

  rejectProposal: async () => {
    const proposal = get().pendingProposal;
    if (!proposal) return;

    const client = await getWalletConnectClient();
    try {
      await client.reject({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
    } catch {
      // best effort
    } finally {
      set({ pendingProposal: null });
    }
  },

  respondRequestResult: async (result: unknown) => {
    const req = get().pendingRequest;
    if (!req) return;

    const client = await getWalletConnectClient();
    try {
      await client.respond({ topic: req.topic, response: { id: req.id, jsonrpc: "2.0", result } });
    } finally {
      set({ pendingRequest: null });
    }
  },

  respondRequestError: async (message: string, code = 5000) => {
    const req = get().pendingRequest;
    if (!req) return;

    const client = await getWalletConnectClient();
    try {
      await client.respond({ topic: req.topic, response: { id: req.id, jsonrpc: "2.0", error: { code, message } } });
    } finally {
      set({ pendingRequest: null });
    }
  },

  disconnectSession: async (topic: string) => {
    const client = await getWalletConnectClient();
    try {
      await client.disconnect({ topic, reason: getSdkError("USER_DISCONNECTED") });
    } catch {
      // best effort
    } finally {
      await get().refreshSessions();
    }
  },

  refreshSessions: async () => {
    const client = await getWalletConnectClient();
    set({ sessions: client.session.getAll() });
  },
}));
