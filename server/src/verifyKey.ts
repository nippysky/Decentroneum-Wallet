// server/src/verifyKey.ts
//
// Run:  npm run verify:key
//
// Finds which base URL + auth mechanism your CoinGecko key actually works with,
// by trying every plausible combination against one known-good endpoint and
// printing the HTTP status of each.
//
// This exists because guessing was wrong. CoinGecko's keyless documentation
// lists both `api.coingecko.com/api/v3/onchain` and
// `pro-api.coingecko.com/api/v3/onchain` as "don't use these, use the
// geckoterminal root" — which implies they're the KEYED roots, but doesn't
// state which one pairs with a Demo key, and the onboarding screen passes the
// key as a QUERY PARAMETER (`x_cg_demo_api_key=`) while the reference docs
// describe a HEADER (`x-cg-demo-api-key`). Four plausible combinations, no
// authoritative statement of which is correct for onchain + Demo.
//
// So: test them. One call each, ~12s apart, against a pool lookup we know
// returns data. Whichever returns 200 is the answer, and the script prints the
// exact env lines to paste.
import { config } from "./config";

// BOLT — verified to have a WETN pool, so a 200 here means real data, not just
// a reachable endpoint.
const TEST_PATH = `/networks/${config.geckoTerminalNetwork}/tokens/0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1/pools`;

type Attempt = {
  label: string;
  baseUrl: string;
  /** How the key is presented, if at all. */
  auth: "header-demo" | "header-pro" | "query-demo" | "query-pro" | "none";
};

const ATTEMPTS: Attempt[] = [
  {
    label: "keyless geckoterminal root (current fallback)",
    baseUrl: "https://api.geckoterminal.com/api/v2",
    auth: "none",
  },
  {
    label: "coingecko root + demo key HEADER",
    baseUrl: "https://api.coingecko.com/api/v3/onchain",
    auth: "header-demo",
  },
  {
    label: "coingecko root + demo key QUERY PARAM",
    baseUrl: "https://api.coingecko.com/api/v3/onchain",
    auth: "query-demo",
  },
  {
    label: "pro root + demo key HEADER",
    baseUrl: "https://pro-api.coingecko.com/api/v3/onchain",
    auth: "header-demo",
  },
  {
    label: "pro root + demo key QUERY PARAM",
    baseUrl: "https://pro-api.coingecko.com/api/v3/onchain",
    auth: "query-demo",
  },
  {
    label: "geckoterminal root + demo key HEADER",
    baseUrl: "https://api.geckoterminal.com/api/v2",
    auth: "header-demo",
  },
];

async function attempt(
  a: Attempt,
  keyOverride?: string
): Promise<{ status: number; pools: number | null; note: string }> {
  const key = keyOverride ?? config.marketApiKey;
  const url = new URL(`${a.baseUrl}${TEST_PATH}`);
  const headers: Record<string, string> = { accept: "application/json" };

  if (a.auth === "header-demo") headers["x-cg-demo-api-key"] = key;
  if (a.auth === "header-pro") headers["x-cg-pro-api-key"] = key;
  if (a.auth === "query-demo") url.searchParams.set("x_cg_demo_api_key", key);
  if (a.auth === "query-pro") url.searchParams.set("x_cg_pro_api_key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), { headers, signal: controller.signal });
    let pools: number | null = null;
    let note = "";
    if (res.ok) {
      const json: any = await res.json();
      pools = Array.isArray(json?.data) ? json.data.length : null;
      if (pools === null) note = "200 but no data array — response shape differs";
    } else {
      // The error body usually says exactly what's wrong.
      const body = await res.text();
      note = body.slice(0, 160).replace(/\s+/g, " ");
    }
    return { status: res.status, pools, note };
  } catch (err) {
    return { status: 0, pools: null, note: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A deliberately invalid key, used as a CONTROL.
 *
 * Without this the script can't tell "authenticated" from "auth ignored". The
 * geckoterminal keyless root returns 200 for any request regardless of what
 * headers you attach — so sending a real key there looks identical to sending
 * a fake one, and an earlier version of this script consequently recommended
 * the keyless root as the "keyed" answer. A combination only counts as keyed
 * if the real key SUCCEEDS and the bogus key FAILS.
 */
const BOGUS_KEY = "CG-000000000000000000000000";

/**
 * Catches paste errors before any network call, because the error the API
 * returns for a malformed key ("API Key Missing") points at the wrong
 * problem entirely.
 */
function inspectKeyFormat(key: string): string[] {
  const problems: string[] = [];
  if (!key) return problems;

  if (key !== key.trim()) problems.push("has leading or trailing whitespace");
  if (/^['"]|['"]$/.test(key)) problems.push("is wrapped in quote marks — .env values need no quotes");

  const prefixes = key.match(/CG-/g)?.length ?? 0;
  if (prefixes === 0) problems.push('does not start with "CG-"');
  if (prefixes > 1) {
    problems.push(
      `contains "CG-" ${prefixes} times — the key already includes the prefix, ` +
        `so it should be MARKET_API_KEY=${key.replace(/^(CG-)+/, "CG-")}`
    );
  }
  // Observed real keys are 27 characters: "CG-" + 24.
  if (prefixes === 1 && key.length !== 27) {
    problems.push(`is ${key.length} characters; CoinGecko keys are 27 ("CG-" plus 24)`);
  }
  if (/\s/.test(key)) problems.push("contains a space inside it");

  return problems;
}

async function main() {
  console.log("\n═══ CoinGecko / GeckoTerminal key check ═══\n");

  if (!config.marketApiKey) {
    console.log("MARKET_API_KEY is not set — only the keyless combination can be tested.");
    console.log("Get a free Demo key at https://www.coingecko.com/en/api/pricing\n");
  } else {
    const k = config.marketApiKey;
    console.log(`key     : ${k.slice(0, 6)}…${k.slice(-4)}  (${k.length} chars)`);

    const problems = inspectKeyFormat(k);
    if (problems.length > 0) {
      console.log("\n  ⚠  The key looks malformed before we even call the API:");
      for (const p of problems) console.log(`     • it ${p}`);
      console.log("\n     Fix .env and re-run. A malformed key returns the same");
      console.log("     \"API Key Missing\" error as a missing one, which points at");
      console.log("     the wrong problem.\n");
    }
  }
  console.log(`test    : ${TEST_PATH}\n`);

  const results: {
    a: Attempt;
    status: number;
    pools: number | null;
    note: string;
    /** True only if the real key works AND a bogus key is rejected. */
    reallyAuthenticated: boolean;
  }[] = [];

  for (const a of ATTEMPTS) {
    if (a.auth !== "none" && !config.marketApiKey) continue;

    const r = await attempt(a);
    await new Promise((r2) => setTimeout(r2, 12_000));

    let reallyAuthenticated = false;
    let controlNote = "";

    if (a.auth !== "none" && r.status === 200) {
      // The control. If a junk key also gets 200, this endpoint isn't checking
      // the key at all and the 200 above proves nothing about authentication.
      const control = await attempt({ ...a, label: `${a.label} [control]` }, BOGUS_KEY);
      await new Promise((r2) => setTimeout(r2, 12_000));

      reallyAuthenticated = control.status !== 200;
      controlNote = reallyAuthenticated
        ? "control: bogus key correctly rejected — auth IS being checked"
        : "control: bogus key ALSO returned 200 — this endpoint IGNORES the key (it is keyless)";
    }

    results.push({ a, ...r, reallyAuthenticated });

    const verdict =
      r.status === 200 ? `OK — ${r.pools ?? "?"} pool(s)` : r.status === 0 ? "network error" : `HTTP ${r.status}`;
    console.log(`  ${verdict.padEnd(22)} ${a.label}`);
    console.log(`  ${" ".repeat(22)} ${a.baseUrl}`);
    if (r.note) console.log(`  ${" ".repeat(22)} ${r.note}`);
    if (controlNote) console.log(`  ${" ".repeat(22)} ${controlNote}`);
    console.log("");
  }

  // Only genuinely authenticated combinations count as keyed.
  const working = results.filter((r) => r.status === 200 && (r.pools ?? 0) > 0);

  console.log("─".repeat(70));

  if (working.length === 0) {
    console.log("\nNothing worked. Most likely causes, in order:");
    console.log("  1. The key is newly created and not active yet — wait a few minutes.");
    console.log("  2. The key was pasted with a trailing space or quote marks.");
    console.log("     Check with:  grep MARKET_API_KEY .env | cat -A   (look for trailing $ position)");
    console.log("  3. The Demo plan does not cover onchain endpoints on this account.");
    console.log("\nThe service falls back to the keyless root automatically, so it keeps working.\n");
    process.exit(1);
  }

  // Prefer a genuinely authenticated combination. `reallyAuthenticated` — not
  // just a 200 — because the keyless root returns 200 while ignoring the key,
  // and recommending that as "keyed" is how the earlier false positive
  // happened.
  const keyed = working.find((r) => r.a.auth !== "none" && r.reallyAuthenticated);
  const winner = keyed ?? working.find((r) => r.a.auth === "none") ?? working[0];

  console.log(`\nUse this one: ${winner.a.label}\n`);
  if (winner.a.auth === "none" || !winner.reallyAuthenticated) {
    console.log("  No endpoint actually authenticated the key. The keyless root works");
    console.log("  and is what the service will use. Leave the key unset so the logs");
    console.log("  don't claim a tier we aren't really on:\n");
    console.log("  MARKET_API_KEY=");
    console.log("  MARKET_API_MONTHLY_CAP=0");
  } else {
    console.log("  Add to .env on the droplet:\n");
    console.log(`  MARKET_API_KEYED_BASE_URL=${winner.a.baseUrl}`);
    console.log(`  MARKET_API_AUTH_MODE=${winner.a.auth}`);
  }
  console.log("\n  Then: pm2 restart decent-wallet-push\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nkey check crashed:", err);
  process.exit(1);
});
