// app/browser/web.tsx
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as SecureStore from "expo-secure-store";
import { ethers } from "ethers";

import { useTheme } from "@/src/theme/ThemeProvider";
import { T } from "@/src/ui/T";
import { Button } from "@/src/ui/Button";
import { IconButton } from "@/src/ui/IconButton";
import { HoldToConfirm } from "@/src/ui/HoldToConfirm";

import { useSession } from "@/src/state/session";
import { getDomain } from "@/src/lib/url";
import { isDomainConnected, setDomainConnected, disconnectDomain } from "@/src/lib/permissions";
import { ELECTRONEUM } from "@/src/lib/networks";
import { getProvider, getSigner, normalizeDappTx } from "@/src/lib/wallet";

type RpcReq = {
  id: number;
  origin: string;
  method: string;
  params?: any[];
};

type WVMessage =
  | { type: "ETN_CONNECT_REQUEST"; origin: string }
  | { type: "ETN_RPC_REQUEST"; id: number; origin: string; method: string; params?: any[] }
  | { type: "ETN_PING"; origin: string };

type MenuItem = {
  label: string;
  hint?: string;
  destructive?: boolean;
  onPress: () => void;
};

type RecentItem = {
  url: string;
  title?: string;
  lastVisited: number;
};

const RECENTS_KEY = "dw:browser:recents:v1";
const MAX_RECENTS = 20;

function stripDw(url: string) {
  try {
    const u = new URL(url);
    u.searchParams.delete("dw");
    return u.toString();
  } catch {
    return url.replace(/([?&])dw=\d+(&?)/g, (m, p1, p2) => {
      if (p1 === "?" && p2) return "?";
      if (p1 === "?" && !p2) return "";
      if (p1 === "&" && p2) return "&";
      return "";
    }).replace(/[?&]$/, "");
  }
}

function cacheBustUrl(url: string) {
  const base = stripDw(url);
  try {
    const u = new URL(base);
    u.searchParams.set("dw", String(Date.now()));
    return u.toString();
  } catch {
    const join = base.includes("?") ? "&" : "?";
    return `${base}${join}dw=${Date.now()}`;
  }
}

async function readRecents(): Promise<RecentItem[]> {
  const raw = await SecureStore.getItemAsync(RECENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRecents(items: RecentItem[]) {
  await SecureStore.setItemAsync(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)));
}

async function upsertRecent(url: string, title?: string) {
  const clean = stripDw(url);
  const items = await readRecents();
  const now = Date.now();

  const next: RecentItem[] = [
    { url: clean, title, lastVisited: now },
    ...items.filter((x) => x.url !== clean),
  ];

  await writeRecents(next);
}

function shorten(addr: string) {
  if (!addr) return "";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function chainIdHex() {
  return "0x" + ELECTRONEUM.chainId.toString(16).toUpperCase();
}

function tryDecodeHexToUtf8(hex: string) {
  try {
    if (typeof hex !== "string") return null;
    if (!hex.startsWith("0x")) return null;
    const bytes = ethers.getBytes(hex);
    return ethers.toUtf8String(bytes);
  } catch {
    return null;
  }
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sanitizeEip712Types(types: any) {
  if (!types || typeof types !== "object") return {};
  const copy: any = { ...types };
  delete copy.EIP712Domain;
  return copy;
}

function injected() {
  return `
    (function () {
      const send = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      const pending = {};
      let rid = 0;

      function rpc(method, params) {
        const id = ++rid;
        send({ type: 'ETN_RPC_REQUEST', id, origin: location.origin, method, params: params || [] });
        return new Promise((resolve, reject) => {
          pending[id] = { resolve, reject };
        });
      }

      window.__DW_RESPOND = function (id, result, error) {
        const p = pending[id];
        if (!p) return;
        delete pending[id];
        if (error) p.reject(new Error(error.message || error));
        else p.resolve(result);
      };

      const listeners = {};
      function emit(event, payload) {
        (listeners[event] || []).forEach((fn) => {
          try { fn(payload); } catch (_) {}
        });
      }

      const ethereum = {
        isDecentWallet: true,
        isMetaMask: false,

        get chainId() { return '${chainIdHex()}'; },
        get selectedAddress() { return (window.__DW_ACCOUNTS && window.__DW_ACCOUNTS[0]) || null; },

        on: (event, fn) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(fn);
        },
        removeListener: (event, fn) => {
          listeners[event] = (listeners[event] || []).filter((x) => x !== fn);
        },

        request: async ({ method, params }) => {
          if (method === 'eth_requestAccounts') {
            send({ type: 'ETN_CONNECT_REQUEST', origin: location.origin });
            return await new Promise((resolve, reject) => {
              window.__DW_RESOLVE_ACCOUNTS = resolve;
              window.__DW_REJECT_ACCOUNTS = reject;
            });
          }
          if (method === 'eth_accounts') return window.__DW_ACCOUNTS || [];
          if (method === 'eth_chainId') return '${chainIdHex()}';

          return rpc(method, params || []);
        }
      };

      Object.defineProperty(window, 'ethereum', { value: ethereum, configurable: true });

      send({ type: 'ETN_PING', origin: location.origin });

      window.__DW_NOTIFY_ACCOUNTS = function (accounts) {
        try {
          window.__DW_ACCOUNTS = accounts;
          emit('accountsChanged', accounts);
        } catch (_) {}
      };
    })();
  `;
}

const PUBLIC_RPC_METHODS = new Set<string>([
  "web3_clientVersion",
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getCode",
  "eth_getLogs",
]);

const CONNECTED_READ_RPC_METHODS = new Set<string>([
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_call",
  "eth_estimateGas",
]);

const SIGN_METHODS = new Set<string>([
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
]);

function isPublicRpc(method: string) {
  return PUBLIC_RPC_METHODS.has(method);
}
function isConnectedReadRpc(method: string) {
  return CONNECTED_READ_RPC_METHODS.has(method);
}
function isSignMethod(method: string) {
  return SIGN_METHODS.has(method);
}

function MenuSheet({
  visible,
  onClose,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  items: MenuItem[];
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={{ position: "absolute", inset: 0 }} />
        <Pressable onPress={onClose} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.border,
              overflow: "hidden",
              paddingBottom: 12 + Math.max(insets.bottom, 6),
            }}
          >
            <View style={{ padding: 16, paddingBottom: 12 }}>
              <T variant="h2" weight="bold" style={{ fontSize: 18, lineHeight: 22 }}>
                Options
              </T>
              <T variant="caption" color={theme.muted}>
                Manage this site and navigation.
              </T>
            </View>

            <View style={{ height: 1, backgroundColor: theme.border }} />

            {items.map((it, idx) => (
              <Pressable
                key={it.label}
                onPress={() => {
                  onClose();
                  it.onPress();
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  opacity: pressed ? 0.92 : 1,
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderTopColor: theme.border,
                })}
              >
                <T weight="semibold" color={it.destructive ? "#EF4444" : theme.text}>
                  {it.label}
                </T>
                {it.hint ? (
                  <T variant="caption" color={theme.muted} style={{ marginTop: 2 }}>
                    {it.hint}
                  </T>
                ) : null}
              </Pressable>
            ))}

            <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
              <Button title="Cancel" variant="outline" onPress={onClose} />
            </View>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

function ConnectSheet({
  visible,
  origin,
  onApprove,
  onDeny,
}: {
  visible: boolean;
  origin: string;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDeny}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={{ position: "absolute", inset: 0 }} />
        <Pressable onPress={onDeny} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 18,
              gap: 10,
              paddingBottom: 14 + Math.max(insets.bottom, 6),
            }}
          >
            <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
              Connect wallet?
            </T>

            <T color={theme.muted}>
              This site will be able to view your address. Only connect to sites you trust.
            </T>

            <View
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
              }}
            >
              <T weight="semibold">{origin}</T>
              <T variant="caption" color={theme.muted}>
                Permission: view address
              </T>
            </View>

            <View style={{ height: 6 }} />
            <Button title="Connect" onPress={onApprove} />
            <Button title="Not now" variant="outline" onPress={onDeny} />
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

function SignSheet({
  visible,
  origin,
  kind,
  address,
  messagePreview,
  warning,
  isSigning,
  onApprove,
  onDeny,
}: {
  visible: boolean;
  origin: string;
  kind: "message" | "typedData";
  address: string;
  messagePreview: string;
  warning: string;
  isSigning: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDeny}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={{ position: "absolute", inset: 0 }} />
        <Pressable onPress={onDeny} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 18,
              gap: 12,
              paddingBottom: 14 + Math.max(insets.bottom, 6),
            }}
          >
            <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
              Sign request
            </T>

            <View
              style={{
                padding: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
                gap: 6,
              }}
            >
              <T weight="semibold" numberOfLines={1}>
                {origin}
              </T>
              <T variant="caption" color={theme.muted}>
                {kind === "typedData" ? "Type: Typed data (EIP-712)" : "Type: Message"}
              </T>
              <T variant="caption" color={theme.muted} numberOfLines={1}>
                Signing as: {shorten(address)}
              </T>
            </View>

            <View
              style={{
                padding: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
                gap: 6,
              }}
            >
              <T variant="caption" color={theme.muted}>
                Preview
              </T>
              <T numberOfLines={4} style={{ fontFamily: "Lexend_500Medium" }}>
                {messagePreview}
              </T>
            </View>

            <View
              style={{
                padding: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
              }}
            >
              <T weight="semibold">Be careful</T>
              <T variant="caption" color={theme.muted}>
                {warning}
              </T>
            </View>

            <View style={{ height: 6 }} />

            <HoldToConfirm
              title={isSigning ? "Signing…" : "Hold to sign"}
              holdingTitle="Release to cancel"
              disabled={isSigning}
              onConfirmed={onApprove}
            />

            <Button title="Reject" variant="outline" onPress={onDeny} disabled={isSigning} />
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

function TxSheet({
  visible,
  origin,
  to,
  valueEth,
  feeEth,
  totalEth,
  isEstimating,
  isSending,
  hasData,
  dataPreview,
  simulationStatus,
  onApprove,
  onDeny,
}: {
  visible: boolean;
  origin: string;
  to: string;
  valueEth: string;
  feeEth: string;
  totalEth: string;
  isEstimating: boolean;
  isSending: boolean;
  hasData: boolean;
  dataPreview: string;
  simulationStatus: "unknown" | "ok" | "warn";
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const row = (label: string, val: string, mono?: boolean) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <T variant="caption" color={theme.muted}>
        {label}
      </T>
      <T weight="semibold" style={mono ? { fontVariant: ["tabular-nums"] } : undefined} numberOfLines={1}>
        {val}
      </T>
    </View>
  );

  const showWarn = simulationStatus === "warn";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDeny}>
      <View style={{ flex: 1 }}>
        <BlurView intensity={30} tint="default" style={{ position: "absolute", inset: 0 }} />
        <Pressable onPress={onDeny} style={{ flex: 1, padding: 18, justifyContent: "flex-end" }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.card,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 18,
              gap: 12,
              paddingBottom: 14 + Math.max(insets.bottom, 6),
            }}
          >
            <T variant="h2" weight="bold" style={{ fontSize: 20, lineHeight: 24 }}>
              {hasData ? "Approve contract call" : "Confirm transaction"}
            </T>

            {showWarn ? (
              <View
                style={{
                  padding: 12,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.bg,
                }}
              >
                <T weight="semibold">Caution</T>
                <T variant="caption" color={theme.muted}>
                  This looks like a contract interaction. It may move tokens or request approvals. Review carefully.
                </T>
              </View>
            ) : null}

            <View
              style={{
                padding: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.bg,
                gap: 8,
              }}
            >
              <T weight="semibold" numberOfLines={1}>
                {origin}
              </T>

              {row("To", shorten(to), true)}
              {row("Type", hasData ? "Contract interaction" : "Send")}
              {row("Amount", `${valueEth} ${ELECTRONEUM.symbol}`, true)}

              {hasData ? (
                <View style={{ gap: 4 }}>
                  <T variant="caption" color={theme.muted}>
                    Data (preview)
                  </T>
                  <T style={{ fontFamily: "Lexend_500Medium" }} numberOfLines={1}>
                    {dataPreview}
                  </T>
                </View>
              ) : null}

              {row("Network fee", isEstimating ? "Estimating…" : `${feeEth} ${ELECTRONEUM.symbol}`, true)}
              <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 4 }} />
              {row("Total", isEstimating ? "—" : `${totalEth} ${ELECTRONEUM.symbol}`, true)}
            </View>

            {isEstimating ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 6 }}>
                <ActivityIndicator />
                <T variant="caption" color={theme.muted}>
                  Estimating fee…
                </T>
              </View>
            ) : null}

            <View style={{ height: 6 }} />

            <HoldToConfirm
              title={isSending ? "Sending…" : "Hold to confirm"}
              holdingTitle="Release to cancel"
              disabled={isEstimating || isSending}
              onConfirmed={onApprove}
            />

            <Button title="Reject" variant="outline" onPress={onDeny} disabled={isSending} />
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

export default function WebScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string }>();

  const isUnlocked = useSession((s) => s.isUnlocked);
  const address = useSession((s) => s.address);
  const mnemonic = useSession((s) => s.mnemonic);

  const initialUrl = params.url ?? "https://decentroneum.com";

  const [currentUrl, setCurrentUrl] = useState(stripDw(initialUrl));
  const [sourceUrl, setSourceUrl] = useState(initialUrl);

  const domain = useMemo(() => getDomain(currentUrl), [currentUrl]);

  const webRef = useRef<WebView>(null);

  const [canGoBack, setCanGoBack] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // iOS sometimes throws -1005/-999 on reload; we retry once per user-refresh
  const [wvKey, setWvKey] = useState(0);
  const [, setRefreshTicket] = useState(0);
  const [refreshRetry, setRefreshRetry] = useState(0);

  // Connect flow
  const [pendingOrigin, setPendingOrigin] = useState<string | null>(null);
  const [queuedRpc, setQueuedRpc] = useState<RpcReq | null>(null);

  // Signing flow
  const [pendingSign, setPendingSign] = useState<{
    rpc: RpcReq;
    kind: "message" | "typedData";
    preview: string;
    warning: string;
    messageToSign?: string | Uint8Array;
    typedData?: { domain: any; types: any; message: any; primaryType?: string };
  } | null>(null);
  const [signing, setSigning] = useState(false);

  // Tx flow
  const [pendingTx, setPendingTx] = useState<{
    rpc: RpcReq;
    to: string;
    tx: ethers.TransactionRequest;
  } | null>(null);

  const [feeEth, setFeeEth] = useState("0.00");
  const [valueEth, setValueEth] = useState("0.00");
  const [totalEth, setTotalEth] = useState("0.00");
  const [estimating, setEstimating] = useState(false);
  const [sending, setSending] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState<"unknown" | "ok" | "warn">("unknown");

  const respondRpc = useCallback((id: number, result: any, error?: any) => {
    const errPayload = error
      ? { message: typeof error === "string" ? error : error?.message ?? "Request failed" }
      : null;

    webRef.current?.injectJavaScript(`
      if (window.__DW_RESPOND) window.__DW_RESPOND(${id}, ${JSON.stringify(result)}, ${JSON.stringify(errPayload)});
      true;
    `);
  }, []);

  const pushAccountsToPage = useCallback((accounts: string[]) => {
    webRef.current?.injectJavaScript(`
      if (window.__DW_NOTIFY_ACCOUNTS) window.__DW_NOTIFY_ACCOUNTS(${JSON.stringify(accounts)});
      true;
    `);
  }, []);

  const respondAccounts = useCallback(
    async (origin: string, approved: boolean) => {
      const accounts = approved && address ? [address] : [];
      if (approved) await setDomainConnected(domain, true);

      webRef.current?.injectJavaScript(`
        window.__DW_ACCOUNTS = ${JSON.stringify(accounts)};
        if (${approved ? "true" : "false"} && window.__DW_RESOLVE_ACCOUNTS) window.__DW_RESOLVE_ACCOUNTS(window.__DW_ACCOUNTS);
        if (${approved ? "false" : "true"} && window.__DW_REJECT_ACCOUNTS) window.__DW_REJECT_ACCOUNTS(new Error('User rejected'));
        true;
      `);

      pushAccountsToPage(accounts);
    },
    [address, domain, pushAccountsToPage]
  );

  const doDisconnect = useCallback(async () => {
    await disconnectDomain(domain);
    webRef.current?.injectJavaScript(`window.__DW_ACCOUNTS = []; true;`);
    pushAccountsToPage([]);
  }, [domain, pushAccountsToPage]);

  const hardRefresh = useCallback(() => {
    // true hard refresh: stop -> remount -> cache-bust
    try {
      webRef.current?.stopLoading();
    } catch {}
    setRefreshRetry(0);
    setRefreshTicket((n) => n + 1);
    setWvKey((n) => n + 1);
    setSourceUrl(cacheBustUrl(currentUrl));
  }, [currentUrl]);

  const openInSafari = useCallback(async () => {
    try {
      await Linking.openURL(currentUrl);
    } catch {
      // ignore
    }
  }, [currentUrl]);

  const copyUrl = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(currentUrl);
    } catch {
      // ignore
    }
  }, [currentUrl]);

  const beginTxApproval = useCallback(
    async (rpc: RpcReq) => {
      if (!address || !mnemonic) return respondRpc(rpc.id, null, "Wallet locked");

      const first = rpc.params?.[0];
      if (!first) return respondRpc(rpc.id, null, "Invalid transaction params");

      const normalized = normalizeDappTx(first);
      normalized.from = address;

      if (!normalized.to || !ethers.isAddress(normalized.to)) {
        return respondRpc(rpc.id, null, "Missing or invalid 'to' address");
      }

      const hasData = typeof normalized.data === "string" && normalized.data !== "0x";
      setSimulationStatus(hasData ? "warn" : "ok");

      const v = normalized.value ? ethers.formatEther(normalized.value) : "0";
      const vPretty = Number(v).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";

      setValueEth(vPretty);
      setFeeEth("0.00");
      setTotalEth("0.00");

      setPendingTx({ rpc, to: normalized.to, tx: normalized });
      setEstimating(true);

      try {
        const provider = getProvider();
        const feeData = await provider.getFeeData();
        const gasLimit = await provider.estimateGas({ ...normalized, from: address });

        const txForFee: ethers.TransactionRequest = { ...normalized, gasLimit };

        let feeWei = 0n;
        if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
          txForFee.maxFeePerGas = feeData.maxFeePerGas;
          txForFee.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
          feeWei = gasLimit * feeData.maxFeePerGas;
        } else if (feeData.gasPrice) {
          txForFee.gasPrice = feeData.gasPrice;
          feeWei = gasLimit * feeData.gasPrice;
        }

        const fee = ethers.formatEther(feeWei);
        const valWei: bigint = normalized.value != null ? ethers.toBigInt(normalized.value) : 0n;
        const totWei: bigint = valWei + feeWei;

        const feePretty = Number(fee).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
        const totalPretty =
          Number(ethers.formatEther(totWei)).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";

        setFeeEth(feePretty);
        setTotalEth(totalPretty);
        setPendingTx({ rpc, to: normalized.to, tx: txForFee });
        setSimulationStatus(hasData ? "warn" : "ok");
      } catch {
        setFeeEth("—");
        setTotalEth("—");
        setSimulationStatus("warn");
      } finally {
        setEstimating(false);
      }
    },
    [address, mnemonic, respondRpc]
  );

  const beginSignApproval = useCallback(
    async (rpc: RpcReq) => {
      if (!address || !mnemonic) return respondRpc(rpc.id, null, "Wallet locked");

      const params = Array.isArray(rpc.params) ? rpc.params : [];
      const connected = await isDomainConnected(domain);

      if (!connected) {
        setQueuedRpc(rpc);
        setPendingOrigin(rpc.origin);
        return;
      }

      if (rpc.method === "personal_sign") {
        const p0 = params[0];
        const p1 = params[1];

        let msg: any = p0;
        let addrParam: any = p1;

        if (typeof p0 === "string" && ethers.isAddress(p0) && typeof p1 === "string") {
          msg = p1;
          addrParam = p0;
        }

        if (!addrParam || typeof addrParam !== "string" || !ethers.isAddress(addrParam)) {
          return respondRpc(rpc.id, null, "Invalid address param");
        }
        if (addrParam.toLowerCase() !== address.toLowerCase()) {
          return respondRpc(rpc.id, null, "Unauthorized address");
        }
        if (typeof msg !== "string") {
          return respondRpc(rpc.id, null, "Invalid message param");
        }

        const decoded = tryDecodeHexToUtf8(msg);
        const preview = decoded ?? (msg.length > 220 ? msg.slice(0, 220) + "…" : msg);

        setPendingSign({
          rpc,
          kind: "message",
          preview,
          warning:
            "Signing can authorize actions off-chain. Only sign if you trust this site and understand what you’re approving.",
          messageToSign: msg.startsWith("0x") ? ethers.getBytes(msg) : msg,
        });
        return;
      }

      if (rpc.method === "eth_signTypedData_v4") {
        const addrParam = params[0];
        const typedDataRaw = params[1];

        if (!addrParam || typeof addrParam !== "string" || !ethers.isAddress(addrParam)) {
          return respondRpc(rpc.id, null, "Invalid address param");
        }
        if (addrParam.toLowerCase() !== address.toLowerCase()) {
          return respondRpc(rpc.id, null, "Unauthorized address");
        }

        const td =
          typeof typedDataRaw === "string"
            ? safeJsonParse(typedDataRaw)
            : typeof typedDataRaw === "object"
              ? typedDataRaw
              : null;

        if (!td || typeof td !== "object") {
          return respondRpc(rpc.id, null, "Invalid typed data");
        }

        const domainObj = td.domain ?? {};
        const typesObj = sanitizeEip712Types(td.types ?? {});
        const messageObj = td.message ?? {};
        const primaryType = td.primaryType;

        const domainName = domainObj?.name ? String(domainObj.name) : "Typed data";
        const preview = `${domainName}${primaryType ? ` • ${primaryType}` : ""}`;

        setPendingSign({
          rpc,
          kind: "typedData",
          preview,
          warning:
            "Typed-data signatures can be used to approve token spending (permits) or other powerful permissions. Only sign if you trust this site.",
          typedData: { domain: domainObj, types: typesObj, message: messageObj, primaryType },
        });
        return;
      }

      respondRpc(rpc.id, null, `Unsupported sign method: ${rpc.method}`);
    },
    [address, domain, mnemonic, respondRpc]
  );

  const handleRpc = useCallback(
    async (rpc: RpcReq) => {
      const connected = await isDomainConnected(domain);

      if (rpc.method === "eth_sendTransaction") {
        if (!connected) {
          setQueuedRpc(rpc);
          setPendingOrigin(rpc.origin);
          return;
        }
        await beginTxApproval(rpc);
        return;
      }

      if (isSignMethod(rpc.method)) {
        await beginSignApproval(rpc);
        return;
      }

      if (isPublicRpc(rpc.method)) {
        try {
          const provider = getProvider();
          const result = await provider.send(rpc.method, rpc.params ?? []);
          respondRpc(rpc.id, result);
        } catch (e: any) {
          respondRpc(rpc.id, null, e?.message ?? "RPC failed");
        }
        return;
      }

      if (isConnectedReadRpc(rpc.method)) {
        if (!connected || !address) return respondRpc(rpc.id, null, "Not connected");

        try {
          const provider = getProvider();
          const p = Array.isArray(rpc.params) ? [...rpc.params] : [];

          if (rpc.method === "eth_getBalance") {
            const target = p?.[0];
            if (!target || typeof target !== "string") return respondRpc(rpc.id, null, "Invalid params");
            if (target.toLowerCase() !== address.toLowerCase()) return respondRpc(rpc.id, null, "Unauthorized address");
            const result = await provider.send("eth_getBalance", p);
            return respondRpc(rpc.id, result);
          }

          if (rpc.method === "eth_getTransactionCount") {
            const target = p?.[0];
            if (!target || typeof target !== "string") return respondRpc(rpc.id, null, "Invalid params");
            if (target.toLowerCase() !== address.toLowerCase()) return respondRpc(rpc.id, null, "Unauthorized address");
            const result = await provider.send("eth_getTransactionCount", p);
            return respondRpc(rpc.id, result);
          }

          if (rpc.method === "eth_call" || rpc.method === "eth_estimateGas") {
            const callObj = p?.[0];
            if (!callObj || typeof callObj !== "object") return respondRpc(rpc.id, null, "Invalid params");
            p[0] = { ...callObj, from: address };
            const result = await provider.send(rpc.method, p);
            return respondRpc(rpc.id, result);
          }

          respondRpc(rpc.id, null, `Unsupported method: ${rpc.method}`);
        } catch (e: any) {
          respondRpc(rpc.id, null, e?.message ?? "RPC failed");
        }
        return;
      }

      respondRpc(rpc.id, null, `Unsupported method: ${rpc.method}`);
    },
    [address, beginSignApproval, beginTxApproval, domain, respondRpc]
  );

  const approveTx = useCallback(async () => {
    if (!pendingTx || !mnemonic || !address) return;

    setSending(true);
    try {
      const signer = getSigner(mnemonic);
      const txToSend: ethers.TransactionRequest = { ...pendingTx.tx, from: address, chainId: ELECTRONEUM.chainId };
      const resp = await signer.sendTransaction(txToSend);
      respondRpc(pendingTx.rpc.id, resp.hash);
      setPendingTx(null);
    } catch (e: any) {
      respondRpc(pendingTx.rpc.id, null, e?.message ?? "Transaction failed");
      setPendingTx(null);
    } finally {
      setSending(false);
    }
  }, [address, mnemonic, pendingTx, respondRpc]);

  const denyTx = useCallback(() => {
    if (!pendingTx) return;
    respondRpc(pendingTx.rpc.id, null, "User rejected");
    setPendingTx(null);
  }, [pendingTx, respondRpc]);

  const approveSign = useCallback(async () => {
    if (!pendingSign || !mnemonic || !address) return;

    setSigning(true);
    try {
      const signer = getSigner(mnemonic);

      if (pendingSign.kind === "message") {
        const payload = pendingSign.messageToSign!;
        const sig = await signer.signMessage(payload as any);
        respondRpc(pendingSign.rpc.id, sig);
        setPendingSign(null);
        return;
      }

      if (pendingSign.kind === "typedData") {
        const td = pendingSign.typedData!;
        const sig = await (signer as any).signTypedData(td.domain, td.types, td.message);
        respondRpc(pendingSign.rpc.id, sig);
        setPendingSign(null);
        return;
      }

      respondRpc(pendingSign.rpc.id, null, "Unsupported sign request");
      setPendingSign(null);
    } catch (e: any) {
      respondRpc(pendingSign.rpc.id, null, e?.message ?? "Signing failed");
      setPendingSign(null);
    } finally {
      setSigning(false);
    }
  }, [address, mnemonic, pendingSign, respondRpc]);

  const denySign = useCallback(() => {
    if (!pendingSign) return;
    respondRpc(pendingSign.rpc.id, null, "User rejected");
    setPendingSign(null);
  }, [pendingSign, respondRpc]);

  if (!isUnlocked) {
    router.replace("/unlock");
    return null;
  }

  const hasData = !!pendingTx && typeof pendingTx.tx.data === "string" && pendingTx.tx.data !== "0x";
  const dataPreview =
    hasData && pendingTx?.tx.data && typeof pendingTx.tx.data === "string"
      ? pendingTx.tx.data.length > 18
        ? `${pendingTx.tx.data.slice(0, 10)}…${pendingTx.tx.data.slice(-6)}`
        : pendingTx.tx.data
      : "0x";

  const menuItems: MenuItem[] = [
    { label: "Disconnect site", hint: "Revokes this site’s wallet access.", destructive: true, onPress: doDisconnect },
    { label: "Hard refresh", hint: "Full reload (fixes iOS refresh errors).", onPress: hardRefresh },
    { label: "Open in Safari", hint: "Use the system browser.", onPress: openInSafari },
    { label: "Copy URL", hint: "Copies the current page link.", onPress: copyUrl },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Top bar */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 14,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
          backgroundColor: theme.card,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <IconButton icon="close" variant="ghost" onPress={() => router.back()} accessibilityLabel="Close" />
          <View style={{ flex: 1 }}>
            <T weight="bold" numberOfLines={1}>
              {domain}
            </T>
            <T variant="caption" color={theme.muted} numberOfLines={1}>
              {currentUrl}
            </T>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <IconButton icon="arrow-back" variant="ghost" disabled={!canGoBack} onPress={() => webRef.current?.goBack()} accessibilityLabel="Back" />
          <IconButton icon="reload" variant="ghost" onPress={hardRefresh} accessibilityLabel="Refresh" />
          <IconButton icon="menu" variant="ghost" onPress={() => setMenuOpen(true)} accessibilityLabel="More" />
        </View>
      </View>

      <WebView
        key={wvKey}
        ref={webRef}
        source={{ uri: sourceUrl }}
        injectedJavaScript={injected()}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        incognito={false}
        // allow new-window requests and capture them
        setSupportMultipleWindows
        onOpenWindow={(e) => {
          const targetUrl = e.nativeEvent?.targetUrl;
          if (targetUrl) {
            const clean = stripDw(targetUrl);
            setCurrentUrl(clean);
            setSourceUrl(targetUrl);
          }
        }}
        onShouldStartLoadWithRequest={(req) => {
          // iOS: targetFrame === false => target=_blank / window.open
          const wantsNewWindow = (req as any).targetFrame === false;
          if (wantsNewWindow && req.url) {
            const clean = stripDw(req.url);
            setCurrentUrl(clean);
            setSourceUrl(req.url);
            return false;
          }
          return true;
        }}
        onNavigationStateChange={(nav) => {
          setCanGoBack(!!nav.canGoBack);

          const clean = stripDw(nav.url || currentUrl);
          if (clean !== currentUrl) setCurrentUrl(clean);

          // Persist recent with title
          if (nav.url) {
            upsertRecent(nav.url, nav.title || undefined).catch(() => {});
          }
        }}
        onLoadEnd={async () => {
          // If we initiated a hard refresh, reset retry counter once it successfully loads
          setRefreshRetry(0);

          const already = await isDomainConnected(domain);

          if (already && address) {
            webRef.current?.injectJavaScript(`window.__DW_ACCOUNTS = ${JSON.stringify([address])}; true;`);
            pushAccountsToPage([address]);
          } else {
            pushAccountsToPage([]);
          }
        }}
        onError={(e) => {
          const code = e.nativeEvent.code ?? 0;

          // iOS cancellation noise on reload/navigation:
          // -999 cancelled, -1005 connection lost.
          // Retry once for a user-triggered refresh.
          if ((code === -999 || code === -1005) && refreshRetry < 1) {
            setRefreshRetry((n) => n + 1);
            setTimeout(() => {
              setWvKey((n) => n + 1);
              setSourceUrl(cacheBustUrl(currentUrl));
            }, 280);
            return;
          }
        }}
        renderError={(errorDomain, errorCode, errorDesc) => {
          // For iOS cancel/lost-connection errors, show nothing (we auto-handle).
          if (errorCode === -999 || errorCode === -1005) {
            return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
          }

          return (
            <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 20, gap: 10 }}>
              <T weight="bold">Error loading page</T>
              <T variant="caption" color={theme.muted} style={{ textAlign: "center" }}>
                {errorDomain} ({errorCode}) • {errorDesc}
              </T>
              <View style={{ height: 8 }} />
              <Button title="Try again" onPress={hardRefresh} />
              <Button title="Open in Safari" variant="outline" onPress={openInSafari} />
            </View>
          );
        }}
        onMessage={async (e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data) as WVMessage;

            if (msg.type === "ETN_CONNECT_REQUEST") {
              const already = await isDomainConnected(domain);
              if (already) await respondAccounts(msg.origin, true);
              else setPendingOrigin(msg.origin);
              return;
            }

            if (msg.type === "ETN_RPC_REQUEST") {
              const rpc: RpcReq = { id: msg.id, origin: msg.origin, method: msg.method, params: msg.params };
              await handleRpc(rpc);
              return;
            }
          } catch {
            // ignore
          }
        }}
      />

      {/* Bottom safe-area spacer */}
      <View style={{ height: Math.max(insets.bottom, 10), backgroundColor: theme.bg }} />

      <MenuSheet visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />

      <ConnectSheet
        visible={!!pendingOrigin}
        origin={pendingOrigin ?? ""}
        onApprove={async () => {
          const origin = pendingOrigin;
          setPendingOrigin(null);

          if (origin) await respondAccounts(origin, true);

          if (queuedRpc) {
            const next = queuedRpc;
            setQueuedRpc(null);

            if (isSignMethod(next.method)) await beginSignApproval(next);
            else if (next.method === "eth_sendTransaction") await beginTxApproval(next);
            else await handleRpc(next);
          }
        }}
        onDeny={async () => {
          const origin = pendingOrigin;
          setPendingOrigin(null);

          if (origin) await respondAccounts(origin, false);

          if (queuedRpc) {
            respondRpc(queuedRpc.id, null, "User rejected");
            setQueuedRpc(null);
          }
        }}
      />

      <SignSheet
        visible={!!pendingSign}
        origin={pendingSign?.rpc.origin ?? ""}
        kind={pendingSign?.kind ?? "message"}
        address={address ?? ""}
        messagePreview={pendingSign?.preview ?? ""}
        warning={pendingSign?.warning ?? ""}
        isSigning={signing}
        onApprove={approveSign}
        onDeny={denySign}
      />

      <TxSheet
        visible={!!pendingTx}
        origin={pendingTx?.rpc.origin ?? ""}
        to={pendingTx?.to ?? ""}
        valueEth={valueEth}
        feeEth={feeEth}
        totalEth={totalEth}
        isEstimating={estimating}
        isSending={sending}
        hasData={hasData}
        dataPreview={dataPreview}
        simulationStatus={simulationStatus}
        onApprove={approveTx}
        onDeny={denyTx}
      />
    </View>
  );
}
