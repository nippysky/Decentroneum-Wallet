// src/lib/walletconnect/deepLink.ts
//
// Extracts a WalletConnect pairing URI from an incoming deep link — either
// the app's custom scheme (decentwallet://wc?uri=wc%3A...) or a universal
// link (https://decentroneum.com/wc?uri=wc%3A...). This is the primary way
// pairing happens on mobile: a dapp shows "Decent Wallet" in its connect
// list, the OS hands the link to this app, and we pair automatically —
// no copy-pasting required. Manually pasting a wc: URI (Settings →
// Connections) remains as a fallback for dapps that only show a QR code.
export function extractWcUri(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("wc:")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const fromQuery = parsed.searchParams.get("uri");
    if (fromQuery && fromQuery.startsWith("wc:")) return fromQuery;
  } catch {
    // Not a parseable URL (and not a bare wc: string either) — ignore.
  }
  return null;
}
