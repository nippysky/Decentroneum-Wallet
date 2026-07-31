#!/usr/bin/env node
//
// scripts/verify-hd-wallet.js
//
// Proof that the HD (BIP-44) vault does what it claims, run against the REAL
// src/lib/crypto/vault.ts — not a reimplementation of it. expo-secure-store
// and expo-crypto are stubbed with an in-memory store and Node's CSPRNG;
// everything else (scrypt, NaCl, ethers, the migration logic) is the shipping
// code path.
//
//   node scripts/verify-hd-wallet.js
//
// Why this file exists: the person running it is about to import a phrase that
// holds real funds. "It typechecks" is not evidence. These assertions are.
//
// What is proved:
//   1. Derivation matches the published Hardhat/Anvil test vectors, so the
//      addresses are the same ones MetaMask/Ledger/Rabby show.
//   2. A fresh vault's first account is index 0 of its own phrase.
//   3. Added accounts are indexes 1, 2, 3… of the SAME phrase — no new phrase.
//   4. A development-era v1/v2 vault record is DELETED, not migrated, and the
//      device lands on onboarding rather than an unlock screen it cannot pass.
//   5. Hiding an account never deletes it: the index is retained, unhiding
//      returns the identical address, and "Add account" always allocates the
//      LOWEST free index so no account can ever be stranded.
//   6. A second recovery phrase is a FULL seed: it gets its own accounts at
//      its own indexes, its accounts are attributable to it, and each phrase
//      reports exactly what it does and does not cover.
//   7. Every account can produce a working signer, and the signer's address
//      equals the address shown in the UI. (An account you can see but cannot
//      spend from is the same as lost.)
//   8. Locking and reloading from storage reproduces identical addresses.
"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");
const crypto = require("crypto");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");

// ─── Module plumbing ────────────────────────────────────────────────────────
// Compile the app's .ts on demand, resolve its "@/" alias, and swap the two
// Expo native modules for Node equivalents. Nothing else is substituted.

const memoryStore = new Map();

const stubs = {
  "expo-secure-store": {
    getItemAsync: async (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItemAsync: async (k, v) => void memoryStore.set(k, v),
    deleteItemAsync: async (k) => void memoryStore.delete(k),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "whenUnlockedThisDeviceOnly",
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  },
  "expo-crypto": {
    getRandomBytesAsync: async (n) => new Uint8Array(crypto.randomBytes(n)),
    getRandomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (stubs[request]) return request;
  if (request.startsWith("@/")) {
    return origResolve.call(this, path.join(ROOT, request.slice(2)), ...rest);
  }
  return origResolve.call(this, request, ...rest);
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (stubs[request]) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

require.extensions[".ts"] = function (module, filename) {
  const src = fs.readFileSync(filename, "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      allowJs: true,
    },
    fileName: filename,
  });
  module._compile(out.outputText, filename);
};

// ─── Assertion helpers ──────────────────────────────────────────────────────

let failures = 0;
let checks = 0;

function ok(label, cond, detail) {
  checks += 1;
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

function eqAddr(label, a, b) {
  ok(label, String(a).toLowerCase() === String(b).toLowerCase(), `${a}\n      !== ${b}`);
}

function section(title) {
  console.log(`\n${title}`);
}

// ─── The code under test ────────────────────────────────────────────────────

const { ethers } = require("ethers");
const vault = require(path.join(ROOT, "src/lib/crypto/vault.ts"));
const derive = require(path.join(ROOT, "src/lib/crypto/derive.ts"));
const { STORAGE_KEYS } = require(path.join(ROOT, "src/lib/storage/keys.ts"));

const PIN = "135790";

/** Wipe storage so each scenario starts from nothing. */
function resetStorage() {
  memoryStore.clear();
}

async function main() {
  console.log("HD wallet (BIP-44) verification — running the real vault.ts\n");

  // ── 1. Derivation against published vectors ───────────────────────────────
  // If this section fails, nothing else matters: the wallet would be showing
  // addresses that no other wallet can reach.
  section("1. BIP-44 derivation matches the published Hardhat/Anvil vectors");
  const TEST_MNEMONIC = "test test test test test test test test test test test junk";
  const EXPECTED = [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  ];
  EXPECTED.forEach((expected, i) => {
    eqAddr(`index ${i} -> ${expected}`, derive.addressAtIndex(TEST_MNEMONIC, i), expected);
  });
  ok(
    "pathForIndex(3) is m/44'/60'/0'/0/3",
    derive.pathForIndex(3) === "m/44'/60'/0'/0/3",
    derive.pathForIndex(3)
  );
  eqAddr(
    "addressFromMnemonic == addressAtIndex(_, 0)",
    derive.addressFromMnemonic(TEST_MNEMONIC),
    EXPECTED[0]
  );
  ok(
    "a negative index is rejected rather than silently coerced",
    (() => {
      try {
        derive.pathForIndex(-1);
        return false;
      } catch {
        return true;
      }
    })()
  );

  // ── 2. Fresh vault ────────────────────────────────────────────────────────
  section("2. A fresh vault's first account is index 0 of its own phrase");
  resetStorage();
  const seed = ethers.Wallet.createRandom().mnemonic.phrase;
  const created = await vault.initializeVault(PIN, { mnemonic: seed });
  const u0 = await vault.unlockVault(PIN);
  const firstId = created.accounts[0].id;

  eqAddr(
    "account 1 address == addressAtIndex(seed, 0)",
    created.accounts[0].address,
    derive.addressAtIndex(seed, 0)
  );
  ok("account 1 is index 0", created.accounts[0].index === 0, String(created.accounts[0].index));
  ok(
    "account 1 is attributed to the wallet's only phrase",
    created.accounts[0].seedId === created.seeds[0].id
  );
  ok("that phrase is flagged primary", created.seeds[0].isPrimary === true);
  ok(
    "the stored seed decrypts to the phrase we supplied",
    (await vault.getBackupPhrase(u0.key, firstId)).mnemonic === seed
  );

  // ── 3. Derived accounts ───────────────────────────────────────────────────
  section("3. 'Add account' derives the next index — it does NOT mint a new phrase");
  await vault.addDerivedAccount(u0.key, { label: "Second" });
  const a3 = await vault.addDerivedAccount(u0.key, { label: "Third" });
  const three = a3.accounts;

  eqAddr("account 2 == addressAtIndex(seed, 1)", three[1].address, derive.addressAtIndex(seed, 1));
  eqAddr("account 3 == addressAtIndex(seed, 2)", three[2].address, derive.addressAtIndex(seed, 2));
  ok(
    "the seed is unchanged after adding accounts",
    (await vault.getBackupPhrase(u0.key, firstId)).mnemonic === seed
  );
  ok(
    "the phrase reports it now covers all 3 accounts",
    (await vault.getBackupPhrase(u0.key, three[2].id)).accountCount === 3
  );
  ok(
    "and warns about no other phrases, because there are none",
    (await vault.getBackupPhrase(u0.key, three[2].id)).otherSeedCount === 0
  );
  ok(
    "all three addresses are distinct",
    new Set(three.map((a) => a.address.toLowerCase())).size === 3
  );
  ok(
    "re-adding the wallet's OWN phrase is refused, not silently duplicated",
    await (async () => {
      try {
        await vault.addSeed(u0.key, { mnemonic: seed });
        return false;
      } catch {
        return true;
      }
    })()
  );

  // The headline claim: this phrase in MetaMask yields these same accounts.
  section("3b. The same phrase in any other wallet yields the same accounts");
  three.forEach((acct, i) => {
    const external = ethers.HDNodeWallet.fromPhrase(seed, undefined, `m/44'/60'/0'/0/${i}`);
    eqAddr(`independent derivation of index ${i}`, acct.address, external.address);
  });

  // ── 4. Legacy records are destroyed, not upgraded ─────────────────────────
  section("4. A development-era vault record is purged, not migrated");
  resetStorage();
  memoryStore.set("dw_vault_v2", JSON.stringify({ v: 2, accounts: [{ id: "old" }] }));
  memoryStore.set("dw_vault_v1", JSON.stringify({ v: 1 }));
  memoryStore.set(STORAGE_KEYS.HAS_WALLET, "1");

  const purged = await vault.purgeLegacyVaults();
  ok("purgeLegacyVaults reports it removed something", purged === true);
  ok("the v2 record is gone", !memoryStore.has("dw_vault_v2"));
  ok("the v1 record is gone", !memoryStore.has("dw_vault_v1"));
  ok(
    "HAS_WALLET is cleared, so the app shows onboarding rather than a dead unlock screen",
    (await vault.hasWallet()) === false
  );
  ok(
    "unlocking a device with only legacy data fails cleanly",
    await (async () => {
      try {
        await vault.unlockVault(PIN);
        return false;
      } catch (e) {
        return /vault not found/i.test(String(e && e.message));
      }
    })()
  );

  // A real vault must survive the purge untouched — the sweep has to be
  // precise, or it is just a way to delete someone's wallet at launch.
  resetStorage();
  const keepSeed = ethers.Wallet.createRandom().mnemonic.phrase;
  const keep = await vault.initializeVault(PIN, { mnemonic: keepSeed });
  memoryStore.set("dw_vault_v2", "stale");
  ok("a legacy record alongside a real vault is still removed", (await vault.purgeLegacyVaults()) === true);
  ok("...but the current vault survives", memoryStore.has(STORAGE_KEYS.VAULT));
  ok("...and HAS_WALLET stays set", (await vault.hasWallet()) === true);
  eqAddr(
    "...and the account still unlocks to the same address",
    (await vault.unlockVault(PIN)).accounts[0].address,
    keep.accounts[0].address
  );
  ok("purging again is a no-op", (await vault.purgeLegacyVaults()) === false);

  // ── 5. Hiding is reversible and exact ─────────────────────────────────────
  // A derived address cannot be deleted — it exists on-chain regardless — so
  // the destructive-looking action has to be honest about being a hide.
  section("5. Hiding an account is reversible and exact");
  resetStorage();
  const rSeed = ethers.Wallet.createRandom().mnemonic.phrase;
  const rInit = await vault.initializeVault(PIN, { mnemonic: rSeed });
  const ru = await vault.unlockVault(PIN);
  const second = (await vault.addDerivedAccount(ru.key)).account;
  eqAddr("account 2 is index 1", second.address, derive.addressAtIndex(rSeed, 1));

  const afterHide = await vault.hideAccount(second.id);
  ok(
    "the hidden account is flagged, not deleted",
    afterHide.accounts.find((a) => a.id === second.id)?.hidden === true
  );
  ok("it still exists in the vault", afterHide.accounts.length === 2);
  ok(
    "the phrase still counts it as backed up",
    afterHide.seeds[0].accountCount === 2 && afterHide.seeds[0].visibleAccountCount === 1
  );
  ok(
    "you cannot switch to a hidden account",
    await (async () => {
      try {
        await vault.setActiveAccount(second.id);
        return false;
      } catch (e) {
        return /hidden/i.test(String(e && e.message));
      }
    })()
  );

  const afterUnhide = await vault.unhideAccount(second.id);
  eqAddr(
    "unhiding returns the identical address",
    afterUnhide.accounts.find((a) => a.id === second.id).address,
    second.address
  );

  section("5b. 'Add account' never strands an index");
  // The bug this guards: with accounts at 0 and 1, hiding 0 and adding used
  // to produce index 2, leaving index 0 unreachable from the UI. Lowest-free
  // allocation means a gap is always filled before a new index is minted.
  resetStorage();
  const gSeed = ethers.Wallet.createRandom().mnemonic.phrase;
  await vault.initializeVault(PIN, { mnemonic: gSeed });
  const gu = await vault.unlockVault(PIN);
  const g1 = (await vault.addDerivedAccount(gu.key)).account; // index 1
  const g2 = (await vault.addDerivedAccount(gu.key)).account; // index 2
  ok("indexes so far are 0,1,2", g1.index === 1 && g2.index === 2);

  // Simulate a vault that somehow lost its middle index entirely (a hidden
  // account is still present, so this is the harsher case).
  const raw = JSON.parse(memoryStore.get(STORAGE_KEYS.VAULT));
  raw.accounts = raw.accounts.filter((a) => a.index !== 1);
  memoryStore.set(STORAGE_KEYS.VAULT, JSON.stringify(raw));

  const filled = (await vault.addDerivedAccount(gu.key)).account;
  ok("the next add fills the GAP at index 1, not index 3", filled.index === 1, String(filled.index));
  eqAddr("...at exactly the address that index always had", filled.address, g1.address);

  section("5c. The last visible account cannot be hidden away");
  resetStorage();
  const lSeed = ethers.Wallet.createRandom().mnemonic.phrase;
  const lInit = await vault.initializeVault(PIN, { mnemonic: lSeed });
  await vault.unlockVault(PIN);
  ok(
    "hiding the only account is refused",
    await (async () => {
      try {
        await vault.hideAccount(lInit.accounts[0].id);
        return false;
      } catch (e) {
        return /at least one account/i.test(String(e && e.message));
      }
    })()
  );
  ok("...so the wallet can never open onto nothing", (await vault.listAccounts()).some((a) => !a.hidden));

  // ── 6. A second phrase is a first-class seed ──────────────────────────────
  // The whole point of the multi-seed design: an imported phrase is not a
  // lesser kind of thing. It gets sub-accounts exactly like the original.
  section("6. A second recovery phrase behaves exactly like the first");
  resetStorage();
  const seedA = ethers.Wallet.createRandom().mnemonic.phrase;
  const seedB = ethers.Wallet.createRandom().mnemonic.phrase;

  const initA = await vault.initializeVault(PIN, { mnemonic: seedA });
  const mu = await vault.unlockVault(PIN);
  const added = await vault.addSeed(mu.key, { mnemonic: seedB, label: "Trading" });

  eqAddr(
    "the new phrase's first account is index 0 of THAT phrase",
    added.account.address,
    derive.addressAtIndex(seedB, 0)
  );
  ok("the wallet now holds 2 phrases", added.seeds.length === 2, String(added.seeds.length));
  ok("the second phrase kept its label", added.seeds[1].label === "Trading", added.seeds[1].label);
  ok("the first phrase is flagged primary", added.seeds[0].isPrimary === true);
  ok("the second phrase is not", added.seeds[1].isPrimary === false);

  // Sub-accounts under the SECOND phrase — the thing that was impossible
  // before, and the reason a user with a funded MetaMask phrase cares.
  for (let i = 1; i <= 3; i += 1) {
    const res = await vault.addDerivedAccount(mu.key, { seedId: added.seedId });
    eqAddr(
      `"Add account" ${i} under phrase 2 -> its Account ${i + 1}`,
      res.account.address,
      derive.addressAtIndex(seedB, i)
    );
    ok(`...and it is attributed to phrase 2`, res.account.seedId === added.seedId);
  }

  // Indexes are per-phrase, so phrase 1 is unaffected by anything above.
  const afterB = await vault.addDerivedAccount(mu.key, { seedId: added.seeds[0].id });
  eqAddr(
    "phrase 1 continues at ITS own index 1, untouched by phrase 2",
    afterB.account.address,
    derive.addressAtIndex(seedA, 1)
  );

  const finalSeeds = await vault.listSeeds();
  ok(
    "phrase 1 reports 2 accounts",
    finalSeeds[0].accountCount === 2,
    String(finalSeeds[0].accountCount)
  );
  ok(
    "phrase 2 reports 4 accounts",
    finalSeeds[1].accountCount === 4,
    String(finalSeeds[1].accountCount)
  );
  ok(
    "every account names the phrase it came from",
    (await vault.listAccounts()).every((a) => a.seedId === finalSeeds[0].id || a.seedId === finalSeeds[1].id)
  );

  section("6a. Hiding the ACTIVE account moves you somewhere visible");
  const activeBefore = (await vault.listAccounts()).find((a) => !a.hidden);
  const movedOn = await vault.hideAccount(activeBefore.id);
  ok(
    "the active account is visible after the hide",
    movedOn.accounts.find((a) => a.id === movedOn.activeAccountId)?.hidden === false
  );
  await vault.unhideAccount(activeBefore.id);

  section("6b. Each phrase reports honestly what it does and does not cover");
  const backupA = await vault.getSeedPhrase(mu.key, finalSeeds[0].id);
  const backupB = await vault.getSeedPhrase(mu.key, finalSeeds[1].id);
  ok("phrase 1 decrypts to phrase 1", backupA.mnemonic === seedA);
  ok("phrase 2 decrypts to phrase 2", backupB.mnemonic === seedB);
  ok("phrase 1 says it covers 2 accounts", backupA.accountCount === 2);
  ok("phrase 2 says it covers 4 accounts", backupB.accountCount === 4);
  ok("phrase 1 warns about 1 other phrase", backupA.otherSeedCount === 1);
  ok("phrase 2 warns about 1 other phrase", backupB.otherSeedCount === 1);
  ok(
    "asking via an ACCOUNT returns that account's phrase, not the primary",
    (await vault.getBackupPhrase(mu.key, added.account.id)).mnemonic === seedB
  );

  section("6c. Duplicate phrases and unremovable primaries are refused");
  ok(
    "re-adding a phrase the wallet already holds is refused",
    await (async () => {
      try {
        await vault.addSeed(mu.key, { mnemonic: seedB });
        return false;
      } catch (e) {
        return /already have this recovery phrase/i.test(String(e && e.message));
      }
    })()
  );
  ok(
    "adding the wallet's ORIGINAL phrase again is refused too",
    await (async () => {
      try {
        await vault.addSeed(mu.key, { mnemonic: seedA });
        return false;
      } catch {
        return true;
      }
    })()
  );
  ok(
    "the primary phrase cannot be removed",
    await (async () => {
      try {
        await vault.removeSeed(finalSeeds[0].id);
        return false;
      } catch (e) {
        return /original recovery phrase/i.test(String(e && e.message));
      }
    })()
  );

  section("6d. Removing a phrase removes exactly its own accounts");
  const beforeRemoval = await vault.listAccounts();
  const removed = await vault.removeSeed(finalSeeds[1].id);
  ok(
    "phrase 2's 4 accounts are gone",
    removed.accounts.length === beforeRemoval.length - 4,
    `${removed.accounts.length} vs ${beforeRemoval.length}`
  );
  ok("phrase 1's accounts all survive", removed.accounts.every((a) => a.seedId === finalSeeds[0].id));
  ok("only 1 phrase remains", removed.seeds.length === 1);
  ok(
    "the active account is one that still exists",
    removed.accounts.some((a) => a.id === removed.activeAccountId)
  );
  eqAddr(
    "the original first account is still exactly where it was",
    removed.accounts[0].address,
    initA.accounts[0].address
  );

  // Re-adding the removed phrase must restore the SAME addresses — this is
  // what makes removal safe rather than destructive.
  const restored = await vault.addSeed(mu.key, { mnemonic: seedB });
  eqAddr(
    "re-adding phrase 2 returns its original first address",
    restored.account.address,
    derive.addressAtIndex(seedB, 0)
  );

  // ── 7. Every visible account can actually sign ────────────────────────────
  section("7. Every account can produce a signer whose address matches the UI");
  const finalAccounts = await vault.listAccounts();
  for (const acct of finalAccounts) {
    const secret = await vault.getAccountSecret(mu.key, acct.id);
    const signer = ethers.HDNodeWallet.fromPhrase(secret.mnemonic, undefined, secret.path);
    eqAddr(`${acct.label} signs as its own address`, signer.address, acct.address);
  }

  // ── 8. Reload from storage ────────────────────────────────────────────────
  section("8. Locking and reloading from storage reproduces identical addresses");
  const before = finalAccounts.map((a) => `${a.address}|${a.kind}|${a.index ?? ""}`).join(",");
  const reopened = await vault.unlockVault(PIN);
  const after = reopened.accounts.map((a) => `${a.address}|${a.kind}|${a.index ?? ""}`).join(",");
  ok("account set is byte-identical after a fresh unlock", before === after, `${before}\n      !== ${after}`);
  ok(
    "a wrong passcode is rejected",
    await (async () => {
      try {
        await vault.unlockVault("000000");
        return false;
      } catch {
        return true;
      }
    })()
  );

  // ── 9. The selected account survives a restart ───────────────────────────
  // Launch reads this BEFORE the passcode screen, so it must be readable
  // without the vault key — and it must never point at an account the list
  // won't show.
  section("9. The active account persists across a restart");
  resetStorage();
  const pSeed = ethers.Wallet.createRandom().mnemonic.phrase;
  await vault.initializeVault(PIN, { mnemonic: pSeed });
  const pu = await vault.unlockVault(PIN);
  const picks = [];
  for (let i = 0; i < 4; i += 1) picks.push((await vault.addDerivedAccount(pu.key)).account);

  const tenth = picks[3];
  await vault.setActiveAccount(tenth.id);

  ok(
    "the choice is readable WITHOUT unlocking (what launch does)",
    (await vault.getActiveAccountId()) === tenth.id
  );
  ok(
    "...and unlocking agrees with it",
    (await vault.unlockVault(PIN)).activeAccountId === tenth.id
  );

  // Hiding the selected account must not leave the launch path pointing at
  // something the accounts list refuses to render.
  await vault.hideAccount(tenth.id);
  const afterHidden = await vault.getActiveAccountId();
  ok(
    "hiding the selected account falls back to a VISIBLE one",
    !!afterHidden && (await vault.listAccounts()).find((a) => a.id === afterHidden)?.hidden === false
  );

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed`);
  if (failures > 0) console.log("\nDo NOT import a funded phrase until this passes.");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nHarness crashed:", e);
  process.exit(1);
});
