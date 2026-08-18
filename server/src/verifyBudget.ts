// server/src/verifyBudget.ts
//
//   npm run verify:budget
//
// Proves the market-API accounting is honest, and prints what this month has
// actually cost so far.
//
// ─── Why this script exists ──────────────────────────────────────────────────
//
// The monthly counter and the provider's dashboard disagreed badly: ours said
// 10,000 used while CoinGecko's said 6,743. We had shut the price charts off
// for a third of a month over calls that were never billed.
//
// The cause was that one function incremented BOTH the per-minute rate log and
// the monthly credit counter. Those measure different things:
//
//   - a 429 still counts against the RATE (it hit their server)
//   - a 429 does NOT count against CREDITS (they refused to serve it)
//
// and every retry after a 429 re-entered that function, so a single logical
// fetch could bill three or four credits locally and none upstream.
//
// The split is now: `acquireCall` books a rate slot, `recordBillableCall` bills
// a credit and is only reached once a non-429 response has come back. This
// script asserts that separation holds, because the failure mode is silent —
// nothing errors, the feature just goes dark early.
//
// Runs against a THROWAWAY database, so it never touches real usage figures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-verify-"));
process.env.DB_PATH = path.join(tmpDir, "verify.db");
process.env.MARKET_API_MONTHLY_CAP = "10";
process.env.MARKET_API_MIN_SPACING_MS = "0";
process.env.MARKET_API_MAX_CALLS_PER_MINUTE = "10000";
process.env.MARKET_API_JITTER_MS = "0";

// Imported AFTER the env is set: config.ts and db.ts both read it at module load.
const { acquireCall, recordBillableCall, monthlyUsed, isBudgetExhausted, budgetStatus } =
  require("./apiBudget") as typeof import("./apiBudget");

const P = "verify-provider";
let pass = 0;
let fail = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log("  ✓", name);
    pass += 1;
  } else {
    console.log("  ✗", name);
    fail += 1;
  }
}

async function main() {
  console.log("\n═══ market API budget accounting ═══\n");

  check("a fresh month starts at zero credits", monthlyUsed(P) === 0);

  // Booking rate slots must not spend credits. This is the regression that
  // cost us a third of a month.
  for (let i = 0; i < 5; i += 1) await acquireCall(P);
  check("5 rate reservations spend 0 credits", monthlyUsed(P) === 0);

  recordBillableCall(P);
  recordBillableCall(P);
  recordBillableCall(P);
  check("3 served responses bill 3 credits", monthlyUsed(P) === 3);

  // The exact shape of the old bug: one fetch, rate-limited twice, then served.
  // Three reservations, one billable response.
  await acquireCall(P);
  await acquireCall(P);
  await acquireCall(P);
  recordBillableCall(P);
  check("429 → 429 → 200 bills exactly 1 credit, not 3", monthlyUsed(P) === 4);

  check("not exhausted while under cap", !isBudgetExhausted(P));

  while (monthlyUsed(P) < 10) recordBillableCall(P);
  check("exhausted once the cap is reached", isBudgetExhausted(P));

  const s = budgetStatus(P);
  check("status reports used and cap truthfully", s.monthlyUsed === 10 && s.monthlyCap === 10);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + fail} checks passed\n`);

  // Deliberately NOT reporting live config or usage here.
  //
  // An earlier version of this script did, and it lied: `config.ts` reads
  // process.env once at import, and this file has to set a fake cap BEFORE
  // that import to make the test deterministic. So the "live" figures it
  // printed were the test's fixtures — it cheerfully reported
  // "monthly cap configured: 10" on a server capped at 10,000.
  //
  // A test process cannot also be a status process. For real numbers:
  console.log("For live usage, ask the running server rather than this script:\n");
  console.log("  curl -s http://127.0.0.1:8787/market/status | python3 -m json.tool\n");
  console.log("Its `api.monthlyUsed` should track your provider dashboard closely.\n");

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.error(err);
  process.exit(1);
});
