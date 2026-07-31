// app/browser/web.tsx
//
// Decent Wallet — In-app browser w/ injected provider (EIP-1193-ish).
// Goal: “MetaMask-style” experience for dapps INSIDE our WebView, without WalletConnect.
// Security model: per-domain permission gate (connect -> view address -> then allow signing/tx).
//
// Key fix:
// - Inject provider BEFORE page scripts run using injectedJavaScriptBeforeContentLoaded
// - Bridge must work even when window.ReactNativeWebView isn’t ready yet (iOS timing)
// - Use AsyncStorage recents to match app/(tabs)/browser.tsx

import "react-native-get-random-values"; // helps ethers on RN

import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View, Linking } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isRecordableUrl } from "@/src/lib/browser/recents";
import { ethers } from "ethers";

import { useTheme } from "@/src/theme/ThemeProvider";
import { T } from "@/src/components/T";
import { Button } from "@/src/components/Button";
import { IconButton } from "@/src/components/IconButton";
import { HoldToConfirm } from "@/src/components/HoldToConfirm";
import { FullSheet } from "@/src/components/FullSheet";
import { TextButton } from "@/src/components/TextButton";

import { useSession } from "@/src/state/session";
import { useAccounts } from "@/src/state/accounts";
import { getAccountSecret } from "@/src/lib/crypto/vault";
import { getDomain } from "@/src/lib/url";
import { isDomainConnected, setDomainConnected, disconnectDomain } from "@/src/lib/storage/dappPermissions";
import { ELECTRONEUM } from "@/src/lib/chain/networks";
import { estimateFees, getSigner, normalizeDappTx, sendRaw } from "@/src/lib/chain/wallet";
import { notifyLocal } from "@/src/lib/notifications/local";
import { RADIUS, SPACING } from "@/src/theme/tokens";

type RpcReq = {
  id: number;
  origin: string;
  method: string;
  params?: unknown[];
};

type WVMessage =
  | { type: "ETN_CONNECT_REQUEST"; origin: string }
  | { type: "ETN_RPC_REQUEST"; id: number; origin: string; method: string; params?: unknown[] }
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

const RECENTS_KEY = "dw_browser_recents_v2";
const MAX_RECENTS = 20;

/**
 * Remove our cache-busting query param so the displayed URL stays clean.
 */
function stripDw(url: string) {
  try {
    const u = new URL(url);
    u.searchParams.delete("dw");
    return u.toString();
  } catch {
    return url
      .replace(/([?&])dw=\d+(&?)/g, (_m, p1, p2) => {
        if (p1 === "?" && p2) return "?";
        if (p1 === "?" && !p2) return "";
        if (p1 === "&" && p2) return "&";
        return "";
      })
      .replace(/[?&]$/, "");
  }
}

/**
 * Forces a reload even if the webview cache is sticky.
 */
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

function safeParseRecents(raw: string | null): RecentItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.url === "string" && typeof x.lastVisited === "number")
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

async function readRecents(): Promise<RecentItem[]> {
  const raw = await AsyncStorage.getItem(RECENTS_KEY);
  return safeParseRecents(raw);
}

async function writeRecents(items: RecentItem[]) {
  const compact = items.slice(0, MAX_RECENTS).map((x) => ({
    url: x.url,
    title: x.title?.slice(0, 80),
    lastVisited: x.lastVisited,
  }));
  await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(compact));
}

async function upsertRecent(url: string, title?: string) {
  const clean = stripDw(url);

  // Search-result pages are transit, not destinations — see lib/browser/recents.
  if (!isRecordableUrl(clean)) return;

  const items = await readRecents();
  const now = Date.now();

  const next: RecentItem[] = [{ url: clean, title, lastVisited: now }, ...items.filter((x) => x.url !== clean)];
  await writeRecents(next);
}

function shorten(addr: string) {
  if (!addr) return "";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Important: many dapps expect a lowercase hex chainId string (0x...).
 */
function chainIdHex() {
  return "0x" + ELECTRONEUM.chainId.toString(16);
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

function sanitizeEip712Types(types: unknown) {
  if (!types || typeof types !== "object") return {};
  const copy: Record<string, unknown> = { ...(types as any) };
  delete (copy as any).EIP712Domain;
  return copy;
}

/**
 * Injects a minimal EIP-1193 provider EARLY.
 *
 * Critical detail:
 * - Some iOS builds don’t have window.ReactNativeWebView ready at "beforeContentLoaded".
 * - But window.webkit.messageHandlers.ReactNativeWebView usually exists.
 * So we support both + queue until bridge is ready.
 */
function injected() {
  return `
    (function () {
      if (window.ethereum && window.ethereum.isDecentWallet) { return true; }

      var pending = {};
      var rid = 0;

      function getBridge() {
        // RN WebView standard
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          return function (msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); };
        }
        // iOS WKWebView underlying bridge (used by RN WebView)
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ReactNativeWebView) {
          return function (msg) { window.webkit.messageHandlers.ReactNativeWebView.postMessage(JSON.stringify(msg)); };
        }
        return null;
      }

      var queue = [];
      function send(payload) {
        var bridge = getBridge();
        if (!bridge) {
          queue.push(payload);
          return;
        }
        bridge(payload);
      }

      // Try to flush queued messages once bridge appears.
      function flushQueue() {
        var bridge = getBridge();
        if (!bridge) return;
        if (!queue.length) return;
        var q = queue.slice();
        queue = [];
        q.forEach(function (p) {
          try { bridge(p); } catch (_) {}
        });
      }

      // Poll briefly; bridge usually appears quickly.
      var flushTimer = setInterval(function () {
        flushQueue();
        if (getBridge()) {
          clearInterval(flushTimer);
        }
      }, 50);

      function rpc(method, params) {
        var id = ++rid;
        send({ type: "ETN_RPC_REQUEST", id: id, origin: location.origin, method: method, params: params || [] });
        return new Promise(function (resolve, reject) {
          pending[id] = { resolve: resolve, reject: reject };
        });
      }

      window.__DW_RESPOND = function (id, result, error) {
        var p = pending[id];
        if (!p) return;
        delete pending[id];

        if (error) {
          var e = new Error(error.message || error);
          if (error && typeof error.code !== "undefined") e.code = error.code;
          p.reject(e);
        } else {
          p.resolve(result);
        }
      };

      var listeners = {};
      function emit(event, payload) {
        (listeners[event] || []).forEach(function (fn) {
          try { fn(payload); } catch (_) {}
        });
      }

      var ethereum = {
        isDecentWallet: true,
        isMetaMask: false,

        // Compatibility niceties
        providers: [],

        get chainId() { return "${chainIdHex()}"; },
        get selectedAddress() { return (window.__DW_ACCOUNTS && window.__DW_ACCOUNTS[0]) || null; },

        on: function (event, fn) {
          listeners[event] = listeners[event] || [];
          listeners[event].push(fn);
        },
        removeListener: function (event, fn) {
          listeners[event] = (listeners[event] || []).filter(function (x) { return x !== fn; });
        },

        request: function (_args) {
          var method = _args && _args.method;
          var params = (_args && _args.params) || [];

          if (method === "eth_requestAccounts") {
            send({ type: "ETN_CONNECT_REQUEST", origin: location.origin });
            return new Promise(function (resolve, reject) {
              window.__DW_RESOLVE_ACCOUNTS = resolve;
              window.__DW_REJECT_ACCOUNTS = reject;
            });
          }

          if (method === "eth_accounts") return Promise.resolve(window.__DW_ACCOUNTS || []);
          if (method === "eth_chainId") return Promise.resolve("${chainIdHex()}");
          if (method === "net_version") return Promise.resolve(String(${ELECTRONEUM.chainId}));

          return rpc(method, params);
        }
      };

      ethereum.providers = [ethereum];

      Object.defineProperty(window, "ethereum", { value: ethereum, configurable: true });

      // Signal injection
      try { window.dispatchEvent(new Event("ethereum#initialized")); } catch (_) {}

      send({ type: "ETN_PING", origin: location.origin });

      window.__DW_NOTIFY_ACCOUNTS = function (accounts) {
        try {
          window.__DW_ACCOUNTS = accounts;
          emit("accountsChanged", accounts);
        } catch (_) {}
      };

      return true;
    })();
  `;
}

// RPC allowlists (read vs privileged)
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

function MenuSheet({ visible, onClose, items }: { visible: boolean; onClose: () => void; items: MenuItem[] }) {
  const { theme } = useTheme();

  return (
    <FullSheet
      visible={visible}
      title="Options"
      subtitle="Manage this site and navigation."
      onClose={onClose}
      footer={<TextButton title="Cancel" onPress={onClose} />}
    >
      <View style={{ gap: 2 }}>
        {items.map((it) => (
          <Pressable hitSlop={6}
            key={it.label}
            onPress={() => {
              onClose();
              it.onPress();
            }}
            // Whole row, full width, 56pt minimum — the old rows were
            // paddingVertical: 8 around a text node, so only the glyphs were
            // live and taps between rows did nothing.
            style={({ pressed }) => ({
              minHeight: 56,
              justifyContent: "center",
              paddingHorizontal: SPACING.md,
              marginHorizontal: -SPACING.md,
              borderRadius: RADIUS.lg,
              backgroundColor: pressed ? theme.surface2 : "transparent",
            })}
          >
            <T weight="semibold" color={it.destructive ? theme.danger : theme.text}>
              {it.label}
            </T>
            {it.hint ? (
              <T variant="caption" color={theme.muted} style={{ marginTop: 2 }}>
                {it.hint}
              </T>
            ) : null}
          </Pressable>
        ))}
      </View>
    </FullSheet>
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

  return (
    <FullSheet
      visible={visible}
      title="Connect wallet?"
      subtitle="This site will be able to view your address. Only connect to sites you trust."
      onClose={onDeny}
      footer={
        <>
          <Button title="Connect" onPress={onApprove} />
          <TextButton title="Not now" onPress={onDeny} />
        </>
      }
    >
      <View
        style={{
          padding: SPACING.md,
          borderRadius: RADIUS.lg,
          backgroundColor: theme.surface2,
        }}
      >
        <T weight="semibold">{origin}</T>
        <T variant="caption" color={theme.muted}>
          Permission: view address
        </T>
      </View>
    </FullSheet>
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

  return (
    <FullSheet
      visible={visible}
      title="Sign request"
      onClose={onDeny}
      footer={
        <>
          <HoldToConfirm
            title={isSigning ? "Signing…" : "Hold to sign"}
            holdingTitle="Release to cancel"
            disabled={isSigning}
            onConfirmed={onApprove}
          />
          <TextButton title="Reject" onPress={onDeny} disabled={isSigning} />
        </>
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.md }}>
        <View style={{ padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: theme.surface2, gap: 6 }}>
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

        <View style={{ padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: theme.surface2, gap: 6 }}>
          <T variant="caption" color={theme.muted}>
            Preview
          </T>
          {/* Full screen means the preview can be read in full instead of
              truncated to four lines inside a half sheet — which matters,
              because "review what you're signing" is the entire point. */}
          <T weight="medium">{messagePreview}</T>
        </View>

        <View style={{ padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: theme.surface2 }}>
          <T weight="semibold">Be careful</T>
          <T variant="caption" color={theme.muted}>
            {warning}
          </T>
        </View>
      </ScrollView>
    </FullSheet>
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
    <FullSheet
      visible={visible}
      title={hasData ? "Approve contract call" : "Confirm transaction"}
      onClose={onDeny}
      footer={
        <>
          <HoldToConfirm
            title={isSending ? "Sending…" : "Hold to confirm"}
            holdingTitle="Release to cancel"
            disabled={isEstimating || isSending}
            onConfirmed={onApprove}
          />
          <TextButton title="Reject" onPress={onDeny} disabled={isSending} />
        </>
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.md }}>
        {showWarn ? (
          <View style={{ padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: theme.surface2 }}>
            <T weight="semibold">Caution</T>
            <T variant="caption" color={theme.muted}>
              This looks like a contract interaction. It may move tokens or request approvals. Review carefully.
            </T>
          </View>
        ) : null}

        <View style={{ padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: theme.surface2, gap: 8 }}>
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
              <T weight="medium" numberOfLines={1}>
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
      </ScrollView>
    </FullSheet>
  );
}

export default function WebScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; readonly?: string }>();

  // Read-only mode: a plain web view with NO wallet provider injected and NO
  // unlock requirement. Used for links that must work before a wallet even
  // exists — Terms of Service and Privacy Policy on the onboarding screen.
  // Without this the legal links bounced to /unlock, which for a brand-new
  // user is a dead end (there is no passcode yet).
  const readOnly = params.readonly === "1";

  const isUnlocked = useSession((s) => s.isUnlocked);
  const vaultKey = useSession((s) => s.vaultKey);
  const activeAccount = useAccounts((s) => s.activeAccount());
  // Visible accounts only — a site should never be offered an account the
  // user has hidden from their own list.
  //
  // The filter MUST live outside the selector. Zustand compares the selector's
  // return value by reference to decide whether to re-render; `.filter()` builds
  // a new array every call, so an inline filter is never equal to itself and
  // the component re-renders forever ("Maximum update depth exceeded"). Select
  // the raw slice, then derive.
  const allAccounts = useAccounts((s) => s.accounts);
  const accounts = useMemo(() => allAccounts.filter((a) => !a.hidden), [allAccounts]);
  const address = activeAccount?.address ?? null;
  const accountId = activeAccount?.id ?? null;
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);

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

  /**
   * Respond to a dapp RPC call (resolves/rejects the Promise in injected provider).
   */
  const respondRpc = useCallback((id: number, result: unknown, error?: any) => {
    const errPayload = error
      ? {
          message: typeof error === "string" ? error : error?.message ?? "Request failed",
          code: typeof error?.code === "number" ? error.code : undefined,
        }
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
        if (${approved ? "false" : "true"} && window.__DW_REJECT_ACCOUNTS) window.__DW_REJECT_ACCOUNTS({ code: 4001, message: 'User rejected' });
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

  /**
   * Switch which of the user's accounts this browser (and any connected
   * site) uses — without leaving the page or reloading it. If the current
   * site is already connected, the dapp gets a live EIP-1193
   * "accountsChanged" event, exactly like switching accounts in MetaMask or
   * Trust Wallet mid-session.
   */
  const switchAccountLive = useCallback(
    async (id: string) => {
      await useAccounts.getState().switchAccount(id);
      setAccountSwitcherOpen(false);

      const next = useAccounts.getState().activeAccount();
      if (!next) return;

      const connected = await isDomainConnected(domain);
      if (connected) {
        webRef.current?.injectJavaScript(`window.__DW_ACCOUNTS = ${JSON.stringify([next.address])}; true;`);
        pushAccountsToPage([next.address]);
      }
    },
    [domain, pushAccountsToPage]
  );

  const hardRefresh = useCallback(() => {
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
    } catch {}
  }, [currentUrl]);

  const copyUrl = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(currentUrl);
    } catch {}
  }, [currentUrl]);

  const beginTxApproval = useCallback(
    async (rpc: RpcReq) => {
      if (!address || !vaultKey) return respondRpc(rpc.id, null, { code: 4900, message: "Wallet locked" });

      const first = rpc.params?.[0];
      if (!first) return respondRpc(rpc.id, null, { code: -32602, message: "Invalid transaction params" });

      const normalized = normalizeDappTx(first);
      normalized.from = address;

      if (!normalized.to || !ethers.isAddress(String(normalized.to))) {
        return respondRpc(rpc.id, null, { code: -32602, message: "Missing or invalid 'to' address" });
      }

      const hasData = typeof normalized.data === "string" && normalized.data !== "0x";
      setSimulationStatus(hasData ? "warn" : "ok");

      const v = normalized.value ? ethers.formatEther(normalized.value as any) : "0";
      const vPretty = Number(v).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";

      setValueEth(vPretty);
      setFeeEth("0.00");
      setTotalEth("0.00");

      setPendingTx({ rpc, to: String(normalized.to), tx: normalized });
      setEstimating(true);

      try {
        // Routed through the same estimateFees() the native SendSheet uses —
        // one shared implementation, so
        // the +10% gasLimit safety buffer (see wallet.ts) and any future fee
        // logic changes apply everywhere a transaction gets broadcast, not
        // just here. This used to be its own hand-rolled copy of the same
        // math with no buffer; that duplication is gone.
        const fee = await estimateFees({ from: address, tx: normalized });

        const txForFee: ethers.TransactionRequest = { ...normalized, gasLimit: fee.gasLimit };
        if (fee.mode === "eip1559") {
          txForFee.maxFeePerGas = fee.maxFeePerGas;
          txForFee.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
        } else if (fee.mode === "legacy") {
          txForFee.gasPrice = fee.gasPrice;
        }

        const feeWei = fee.feeWei;
        const feeEthStr = ethers.formatEther(feeWei);
        const valWei: bigint = normalized.value != null ? ethers.toBigInt(normalized.value as any) : 0n;
        const totWei: bigint = valWei + feeWei;

        const feePretty = Number(feeEthStr).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
        const totalPretty = Number(ethers.formatEther(totWei)).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";

        setFeeEth(feePretty);
        setTotalEth(totalPretty);
        setPendingTx({ rpc, to: String(normalized.to), tx: txForFee });
        setSimulationStatus(hasData ? "warn" : "ok");
      } catch {
        setFeeEth("—");
        setTotalEth("—");
        setSimulationStatus("warn");
      } finally {
        setEstimating(false);
      }
    },
    [address, vaultKey, respondRpc]
  );

  const beginSignApproval = useCallback(
    async (rpc: RpcReq) => {
      if (!address || !vaultKey) return respondRpc(rpc.id, null, { code: 4900, message: "Wallet locked" });

      const params = Array.isArray(rpc.params) ? rpc.params : [];
      const connected = await isDomainConnected(domain);

      if (!connected) {
        setQueuedRpc(rpc);
        setPendingOrigin(rpc.origin);
        return;
      }

      if (rpc.method === "personal_sign") {
        const p0 = params[0] as any;
        const p1 = params[1] as any;

        let msg: any = p0;
        let addrParam: any = p1;

        // Some dapps swap order
        if (typeof p0 === "string" && ethers.isAddress(p0) && typeof p1 === "string") {
          msg = p1;
          addrParam = p0;
        }

        if (!addrParam || typeof addrParam !== "string" || !ethers.isAddress(addrParam)) {
          return respondRpc(rpc.id, null, { code: -32602, message: "Invalid address param" });
        }
        if (addrParam.toLowerCase() !== address.toLowerCase()) {
          return respondRpc(rpc.id, null, { code: 4100, message: "Unauthorized address" });
        }
        if (typeof msg !== "string") {
          return respondRpc(rpc.id, null, { code: -32602, message: "Invalid message param" });
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
        const addrParam = params[0] as any;
        const typedDataRaw = params[1] as any;

        if (!addrParam || typeof addrParam !== "string" || !ethers.isAddress(addrParam)) {
          return respondRpc(rpc.id, null, { code: -32602, message: "Invalid address param" });
        }
        if (addrParam.toLowerCase() !== address.toLowerCase()) {
          return respondRpc(rpc.id, null, { code: 4100, message: "Unauthorized address" });
        }

        const td =
          typeof typedDataRaw === "string"
            ? safeJsonParse(typedDataRaw)
            : typeof typedDataRaw === "object"
              ? typedDataRaw
              : null;

        if (!td || typeof td !== "object") {
          return respondRpc(rpc.id, null, { code: -32602, message: "Invalid typed data" });
        }

        const domainObj = (td as any).domain ?? {};
        const typesObj = sanitizeEip712Types((td as any).types ?? {});
        const messageObj = (td as any).message ?? {};
        const primaryType = (td as any).primaryType;

        const domainName = domainObj?.name ? String(domainObj.name) : "Typed data";
        const preview = `${domainName}${primaryType ? ` • ${primaryType}` : ""}`;

        setPendingSign({
          rpc,
          kind: "typedData",
          preview,
          warning:
            "Typed-data signatures can approve token spending (permits) or other powerful permissions. Only sign if you trust this site.",
          typedData: { domain: domainObj, types: typesObj, message: messageObj, primaryType },
        });
        return;
      }

      respondRpc(rpc.id, null, { code: 4200, message: `Unsupported sign method: ${rpc.method}` });
    },
    [address, domain, vaultKey, respondRpc]
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
          const result = await sendRaw(rpc.method, rpc.params ?? []);
          respondRpc(rpc.id, result);
        } catch (e: any) {
          respondRpc(rpc.id, null, { code: -32000, message: e?.message ?? "RPC failed" });
        }
        return;
      }

      // allow website to ask native wallet to disconnect this domain
if (rpc.method === "dw_disconnect") {
  await doDisconnect();
  respondRpc(rpc.id, true);
  return;
}


      if (isConnectedReadRpc(rpc.method)) {
        if (!connected || !address) return respondRpc(rpc.id, null, { code: 4100, message: "Not connected" });

        try {
          const p = Array.isArray(rpc.params) ? [...rpc.params] : [];

          if (rpc.method === "eth_getBalance") {
            const target = p?.[0];
            if (!target || typeof target !== "string") return respondRpc(rpc.id, null, { code: -32602, message: "Invalid params" });
            if (target.toLowerCase() !== address.toLowerCase()) return respondRpc(rpc.id, null, { code: 4100, message: "Unauthorized address" });
            const result = await sendRaw("eth_getBalance", p);
            return respondRpc(rpc.id, result);
          }

          if (rpc.method === "eth_getTransactionCount") {
            const target = p?.[0];
            if (!target || typeof target !== "string") return respondRpc(rpc.id, null, { code: -32602, message: "Invalid params" });
            if (target.toLowerCase() !== address.toLowerCase()) return respondRpc(rpc.id, null, { code: 4100, message: "Unauthorized address" });
            const result = await sendRaw("eth_getTransactionCount", p);
            return respondRpc(rpc.id, result);
          }

          if (rpc.method === "eth_call" || rpc.method === "eth_estimateGas") {
            const callObj = p?.[0];
            if (!callObj || typeof callObj !== "object") return respondRpc(rpc.id, null, { code: -32602, message: "Invalid params" });
            (p as any)[0] = { ...(callObj as any), from: address };
            const result = await sendRaw(rpc.method, p);
            return respondRpc(rpc.id, result);
          }

          respondRpc(rpc.id, null, { code: 4200, message: `Unsupported method: ${rpc.method}` });
        } catch (e: any) {
          respondRpc(rpc.id, null, { code: -32000, message: e?.message ?? "RPC failed" });
        }
        return;
      }

      respondRpc(rpc.id, null, { code: 4200, message: `Unsupported method: ${rpc.method}` });
    },
    [address, beginSignApproval, beginTxApproval, doDisconnect, domain, respondRpc]
  );

  const approveTx = useCallback(async () => {
    if (!pendingTx || !vaultKey || !accountId || !address) return;

    setSending(true);
    try {
      // Path, not just the phrase — one seed backs several accounts, so a
      // signer built from the phrase alone would sign as index 0 and spend
      // from the wrong account.
      const { mnemonic, path } = await getAccountSecret(vaultKey, accountId);
      const signer = getSigner(mnemonic, path);
      const txToSend: ethers.TransactionRequest = { ...pendingTx.tx, from: address, chainId: ELECTRONEUM.chainId };
      const resp = await signer.sendTransaction(txToSend);
      respondRpc(pendingTx.rpc.id, resp.hash);
      notifyLocal({
        title: `${ELECTRONEUM.symbol} sent`,
        body: `Transaction to ${domain} sent successfully`,
        data: { accountId, route: "/(tabs)/wallet", kind: "sent" },
      }).catch(() => {});
      setPendingTx(null);
    } catch (e: any) {
      respondRpc(pendingTx.rpc.id, null, { code: -32000, message: e?.message ?? "Transaction failed" });
      setPendingTx(null);
    } finally {
      setSending(false);
    }
  }, [address, vaultKey, accountId, pendingTx, respondRpc, domain]);

  const denyTx = useCallback(() => {
    if (!pendingTx) return;
    respondRpc(pendingTx.rpc.id, null, { code: 4001, message: "User rejected" });
    setPendingTx(null);
  }, [pendingTx, respondRpc]);

  const approveSign = useCallback(async () => {
    if (!pendingSign || !vaultKey || !accountId || !address) return;

    setSigning(true);
    try {
      // Path, not just the phrase — one seed backs several accounts, so a
      // signer built from the phrase alone would sign as index 0 and spend
      // from the wrong account.
      const { mnemonic, path } = await getAccountSecret(vaultKey, accountId);
      const signer = getSigner(mnemonic, path);

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

      respondRpc(pendingSign.rpc.id, null, { code: 4200, message: "Unsupported sign request" });
      setPendingSign(null);
    } catch (e: any) {
      respondRpc(pendingSign.rpc.id, null, { code: -32000, message: e?.message ?? "Signing failed" });
      setPendingSign(null);
    } finally {
      setSigning(false);
    }
  }, [address, vaultKey, accountId, pendingSign, respondRpc]);

  const denySign = useCallback(() => {
    if (!pendingSign) return;
    respondRpc(pendingSign.rpc.id, null, { code: 4001, message: "User rejected" });
    setPendingSign(null);
  }, [pendingSign, respondRpc]);

  if (!isUnlocked && !readOnly) {
    // Navigation is a side effect and must not happen during render — doing
    // so throws "Cannot update a component while rendering a different
    // component". <Redirect> performs the same navigation as an effect,
    // which is the supported way to bounce an unauthenticated route.
    return <Redirect href="/unlock" />;
  }

  const hasData = !!pendingTx && typeof pendingTx.tx.data === "string" && pendingTx.tx.data !== "0x";
  const dataPreview =
    hasData && pendingTx?.tx.data && typeof pendingTx.tx.data === "string"
      ? pendingTx.tx.data.length > 18
        ? `${pendingTx.tx.data.slice(0, 10)}…${pendingTx.tx.data.slice(-6)}`
        : pendingTx.tx.data
      : "0x";

  const menuItems: MenuItem[] = [
    // Wallet-specific actions are meaningless in read-only mode (no provider
    // is injected and there may be no wallet on the device yet).
    ...(!readOnly && accounts.length > 1
      ? [
          {
            label: `Switch account (${shorten(address ?? "")})`,
            hint: "Choose which of your accounts this browser uses.",
            onPress: () => setAccountSwitcherOpen(true),
          } as MenuItem,
        ]
      : []),
    ...(!readOnly
      ? [
          {
            label: "Disconnect site",
            hint: "Revokes this site’s wallet access.",
            destructive: true,
            onPress: doDisconnect,
          } as MenuItem,
        ]
      : []),
    { label: "Hard refresh", hint: "Full reload (fixes iOS refresh errors).", onPress: hardRefresh },
    { label: "Open in Safari", hint: "Use the system browser.", onPress: openInSafari },
    { label: "Copy URL", hint: "Copies the current page link.", onPress: copyUrl },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Top bar */}
      <View
        style={{
          paddingTop: insets.top + SPACING.sm,
          paddingHorizontal: SPACING.md,
          paddingBottom: SPACING.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
          backgroundColor: theme.bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <IconButton icon="close" variant="ghost" onPress={() => router.back()} accessibilityLabel="Close" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T weight="bold" numberOfLines={1}>
              {domain}
            </T>
            <T variant="caption" color={theme.muted} numberOfLines={1}>
              {currentUrl}
            </T>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <IconButton
            icon="arrow-back"
            variant="ghost"
            disabled={!canGoBack}
            onPress={() => webRef.current?.goBack()}
            accessibilityLabel="Back"
          />
          <IconButton icon="reload" variant="ghost" onPress={hardRefresh} accessibilityLabel="Refresh" />
          <IconButton icon="menu" variant="ghost" onPress={() => setMenuOpen(true)} accessibilityLabel="More" />
        </View>
      </View>

      <WebView
        key={wvKey}
        ref={webRef}
        source={{ uri: sourceUrl }}
        // ✅ critical: early injection so dapp boot sees window.ethereum
        injectedJavaScriptBeforeContentLoaded={readOnly ? "true;" : injected()}
        // keep a harmless injectedJavaScript so some Android builds don’t drop the bridge
        injectedJavaScript={"true;"}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        incognito={false}
        setSupportMultipleWindows
        onOpenWindow={(e) => {
          const targetUrl = (e as any).nativeEvent?.targetUrl;
          if (targetUrl) {
            const clean = stripDw(targetUrl);
            setCurrentUrl(clean);
            setSourceUrl(targetUrl);
          }
        }}
        onShouldStartLoadWithRequest={(req) => {
          // Non-http(s) schemes are app-launch links: t.me redirects to
          // tg://, x.com to twitter://, and so on. A WebView can't load
          // those, and blindly handing them to Linking.openURL throws
          // "Unable to open URL … add <scheme> to LSApplicationQueriesSchemes"
          // — which is where those console warnings came from.
          //
          // We check first, open only if the app is actually installed, and
          // otherwise stay on the page silently. The web version of the site
          // works fine, so failing to launch a native app is a non-event and
          // shouldn't surface as an error to the user.
          if (req.url && !/^https?:/i.test(req.url) && !/^about:/i.test(req.url)) {
            Linking.canOpenURL(req.url)
              .then((ok) => (ok ? Linking.openURL(req.url) : null))
              .catch(() => {});
            return false;
          }

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

          if (nav.url) {
            upsertRecent(nav.url, nav.title || undefined).catch(() => {});
          }
        }}
        onLoadEnd={async () => {
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
          const code = (e as any).nativeEvent?.code ?? 0;

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
          const raw = (e as any).nativeEvent?.data;
          if (typeof raw !== "string") return;

          const msg = safeJsonParse(raw) as WVMessage | null;
          if (!msg) return;

          if (msg.type === "ETN_CONNECT_REQUEST") {
            const already = await isDomainConnected(domain);
            if (already) await respondAccounts(msg.origin, true);
            else setPendingOrigin(msg.origin);
            return;
          }

          if (msg.type === "ETN_RPC_REQUEST") {
            const rpc: RpcReq = { id: msg.id, origin: msg.origin, method: msg.method, params: msg.params };
            await handleRpc(rpc);
          }
        }}
      />

      <View style={{ height: Math.max(insets.bottom, 10), backgroundColor: theme.bg }} />

      <MenuSheet visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />

      <FullSheet
        visible={accountSwitcherOpen}
        title="Switch account"
        subtitle="This site will see the account you pick."
        onClose={() => setAccountSwitcherOpen(false)}
        footer={<TextButton title="Cancel" onPress={() => setAccountSwitcherOpen(false)} />}
      >
        <View style={{ gap: 2 }}>
          {accounts.map((a) => (
            <Pressable hitSlop={6}
              key={a.id}
              onPress={() => switchAccountLive(a.id)}
              // 60pt row, full width, pressed state on the row itself — not
              // an opacity fade on a text node with 8pt of padding.
              style={({ pressed }) => ({
                minHeight: 60,
                paddingHorizontal: SPACING.md,
                marginHorizontal: -SPACING.md,
                borderRadius: RADIUS.lg,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: pressed ? theme.surface2 : "transparent",
              })}
            >
              <View>
                <T weight="semibold">{a.label}</T>
                <T variant="caption" color={theme.muted}>
                  {shorten(a.address)}
                </T>
              </View>
              {a.id === accountId ? <Ionicons name="checkmark-circle" size={20} color={theme.accent} /> : null}
            </Pressable>
          ))}
        </View>
      </FullSheet>

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
            respondRpc(queuedRpc.id, null, { code: 4001, message: "User rejected" });
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
