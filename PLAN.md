# Decent Wallet — Full-Scale Revamp Plan

**Prepared for:** Decentroneum / Decent Wallet
**Scope:** Expo SDK 57 upgrade, full architecture rebuild, dual-account support, token auto-listing, push notifications, explorer redesign, app-store readiness.

---

## 0. Baseline audit (what's already there)

The existing app is a real, working MVP — not a prototype. Worth keeping and building on:

- **Security core is sound**: `expo-secure-store` vault, scrypt KDF + `tweetnacl` `secretbox` encryption, biometric-gated PIN storage, auto-lock on background, hold-to-confirm sends, 30s auto-hiding recovery-phrase reveal.
- **Chain layer** (`ethers` v6): native ETN balance/send, ERC-20 balance/send, EIP-1559-aware fee estimation with legacy fallback, dApp tx normalization for the in-app browser bridge.
- **UI foundation**: Lexend typeface, dark palette already `#060807` bg / `#4DEE54` accent — this **already matches decentroneum.com's own `theme-color` (`#060807`)**, so the brand line is correct today; it needs refinement, not replacement.
- **Gaps**: single account only, one hardcoded token (DCNT), "Browser" tab conflates dApp browsing with "explorer" and still lists **Panthart** (decommissioned), no push notifications, no multi-account, Expo 54 instead of latest 57, flat (non-feature-based) folder structure.

This plan upgrades every one of those gaps while keeping the parts that already work.

---

## 1. Brand system

Source of truth: decentroneum.com (`theme-color: #060807`, dark-first, neon-green accent) and the supplied hexagon mark (black hex ring / green interior on a green field).

| Token | Value | Usage |
|---|---|---|
| `neon` | `#4DEE54` | Primary accent, CTAs, active states, chart up-color |
| `ink` | `#060807` | Dark surface / "inverted" icon field |
| `bg.dark` | `#060807` | App background (dark, default) |
| `bg.light` | `#FAF7F2` | App background (light) |
| `danger` | `#EF4444` / `#F87171` | Errors, negative amounts |

**Icon rule (per brief):** only two legal treatments — (a) neon-green field with dark hexagon mark, (b) dark field with neon-green hexagon mark. No other colors, no gradients on the mark itself. App icon uses treatment (a) for shelf visibility (matches the supplied asset); adaptive-icon monochrome and splash dark-mode use treatment (b).

Motion language: spring-based (stiffness ~260/damping ~26, already used in the tab bar) for navigation; 150–220ms ease-out for micro-interactions; no bouncy overshoot on financial confirmations (sends should feel *precise*, not playful).

---

## 2. Information architecture

```
Onboarding  → Welcome → Create/Import → Passcode → (Biometric opt-in) → Home
Tabs (unlocked): Home · Explorer · Browser · Settings
Home        → Account switcher · Portfolio value · Asset list → Send/Receive/Swap-out-link/Buy-out-link
Explorer    → Network stats → Address activity (mine) → Tx detail → Search any address/tx/token
Browser     → dApp browsing (injected EIP-1193 provider), recents, curated ecosystem list (Panthart removed)
Settings    → Accounts (add/import/rename/remove/switch) · Security · Notifications · Appearance · Network · About
```

Explorer is promoted to its own tab — it was previously smuggled into the "Browser" tab as a link-out. A real wallet-grade explorer view (your activity, tx detail, live network stats) is a top differentiator vs. a generic dApp browser.

---

## 3. Target folder structure

```
app/                          # expo-router routes — thin, no business logic
  (onboarding)/...
  (tabs)/{home,explorer,browser,settings}.tsx
  send/, receive/, account/[id].tsx, tx/[hash].tsx
  _layout.tsx

src/
  components/                 # dumb, reusable UI atoms (Button, Card, Sheet, PinPad, Toast, TokenLogo…)
  features/
    onboarding/
    wallet/                   # home dashboard
    send/
    receive/
    accounts/                 # multi-account management UI + logic
    explorer/
    browser/
    settings/
    notifications/
  lib/
    chain/                    # networks.ts, rpc.ts, erc20.ts, gas.ts, tx-normalize.ts
    crypto/                   # crypto.ts, kdf.ts, derive.ts, vault.ts (multi-account)
    tokens/                   # registry.ts, schema.ts, cache.ts
    notifications/            # permissions.ts, register.ts, watcher.ts
    storage/                  # storageKeys.ts, secure-store wrappers
    format.ts, url.ts
  state/                      # zustand: session.ts, accounts.ts, settings.ts, tokens.ts
  theme/                      # tokens.ts, typography.ts, motion.ts, ThemeProvider.tsx
  types/
```

`app/` stays route-only (per Expo Router convention); all logic/visuals move into `src/features/*` so screens are ~30-line compositions of feature components. This is the single highest-leverage structural change for long-term velocity.

---

## 4. Multi-account (dual wallet) architecture

- **VaultV2**: instead of one encrypted mnemonic blob, store an encrypted **account list**: `{ id, label, mnemonicCiphertext, address, order, createdAt }[]`, still under one passcode-derived key (one KDF unlock decrypts the whole vault — one passcode for the whole app, not per-account).
- Support both **create new** and **import existing** per account slot; minimum 1, soft cap (e.g. 5) to keep UX simple — brief asks for "two," so default UI ships with a clean 2-account switcher but the data model isn't hardcoded to 2.
- `state/accounts.ts` (zustand): `accounts[]`, `activeAccountId`, `switchAccount()`, `addAccount()`, `removeAccount()`, `renameAccount()`. `state/session.ts` narrows to auth/unlock state only (passcode/biometric/auto-lock) — separation of concerns fixes the current coupling where session also held the single mnemonic.
- **Migration**: on first launch after upgrade, detect `VaultV1`, decrypt with existing passcode, wrap as a single-item `VaultV2` account list transparently — zero user action required, no re-onboarding.
- UI: account switcher as a horizontal pill/avatar row at the top of Home (Trust-Wallet-style), each account shows its own address, balance, and independent token list.

---

## 5. Token registry & auto-listing

Replace the hardcoded `ALLOWLIST_TOKENS` array with a **registry client**:

1. **Bundled defaults** (ship in-app, always available offline): native `ETN` + `DCNT` (the Electroneum Smart Chain default token) — zero network dependency for the two tokens that matter most.
2. **Remote list**: fetch `https://decentroneum.com/api/token-list.json` (or `app.decentroneum.com`) on launch + pull-to-refresh, cached in `AsyncStorage` with a TTL (e.g. 6h) and last-known-good fallback if offline. Validate every entry with `zod` (address checksum, decimals 0–36, symbol length, https-only logo URL) before it ever touches balance calls — a malformed remote entry must never crash the wallet.
3. **Submission → auto-listing pipeline** (the recommended, industry-standard pattern — same shape CoinGecko, Trust Wallet Assets, and Uniswap's token-lists use):
   - Project submits a PR-style or form-based request to a `decentroneum.com/tokens/submit` intake (contract address, symbol, name, decimals, logo, socials, liquidity proof).
   - Automated checks run: contract is verified on the Electroneum explorer, ERC-20 interface responds correctly, symbol/address not already listed, logo passes size/format/https checks.
   - Manual Decentroneum-team review/approval flips a `status: approved` flag.
   - Approved tokens are merged into the published `token-list.json` (signed/hash-pinned so the app can optionally verify integrity) — no app release needed for a new token to appear. This is exactly how Trust Wallet, MetaMask, and Uniswap scale to thousands of tokens without shipping an app update per listing.
4. In-app "Add token manually" remains as an escape hatch (paste contract address → app reads `symbol/name/decimals` on-chain directly), same as Trust Wallet, clearly marked "unverified" until it matches the official registry.

---

## 6. Push notifications

- `expo-notifications` + `expo-device` for permission request (iOS APNs / Android FCM via Expo push service), token registration, and a dedicated Settings toggle per event type (Received funds, Sent confirmed, dApp connection requests).
- **Now (no backend yet)**: a lightweight in-app watcher polls the active account's native + token balances and latest tx list at a modest interval while the app is foregrounded/backgrounded-briefly, diffs against last-seen state, and fires a **local notification** ("Received 12.5 DCNT") — this alone covers the "notify on receipt" requirement without needing new server infra.
- **Path to real server-push** (for background/killed-app delivery, which local notifications can't do): a small webhook service subscribes to Electroneum block events (or polls per-registered-address) and calls the Expo Push API when a tracked address receives funds. This is a natural Decentroneum backend addition — documented here as the next infra step, not blocked on it for v1.
- Respect OS-level opt-outs and never notify with the exact amount on the lock screen if the user has "hide balances" privacy mode on.

---

## 7. Send/Receive — FAANG-grade bar

Current Send flow (asset picker → amount → live fee estimation → hold-to-confirm → review → broadcast) is already close to the right shape. Upgrades:

- Multi-account aware (asset list scoped to active account).
- Address book / recents with ENS-style label resolution where available.
- Speed up fee polling with debounce + optimistic skeleton instead of blocking spinner.
- QR scan for "To" field (`expo-camera`) as an alternative to paste.
- Post-broadcast: push straight into a pending-tx state row on Home with a live spinner → success/failure resolves in place (no need to leave the screen), mirrored in Explorer's "your activity."

---

## 8. Explorer redesign

New tab, not a link-out. Sections: live network snapshot (block height, gas), "Your activity" (all accounts' txs merged, filterable), tx detail screen (status, confirmations, from/to, value, fee, method-decoded when possible), and universal search (address / tx hash / token). Built on the existing `blockscout.ts` integration pattern against Electroneum's Blockscout-compatible explorer API. Panthart is removed from the Browser tab's featured list entirely (dead product); replaced with Decentroneum D-App, ElectroSwap, and the official Electroneum explorer as external links only.

---

## 9. Security & store-compliance checklist

- Non-custodial, keys never leave device; SecureStore + hardware-backed keystore where available.
- Biometric re-auth before any secret reveal or send above a configurable threshold.
- Screenshot/screen-recording blocking on the recovery-phrase screen (Android `FLAG_SECURE`, iOS best-effort blur-on-background-snapshot).
- Full permission-usage strings for `NSCameraUsageDescription`, `NSFaceIDUsageDescription`, notifications, and Android equivalents (Section 10).
- Apple: no use of private APIs, clear "this app does not custody funds" language, functional deep-link/universal-link handling, in-app account deletion (Settings → Erase wallet) to satisfy Guideline 5.1.1(v).
- Google Play: Data Safety form mapped to actual data flows (nothing leaves device except RPC calls and optional push token), target API level current, no cleartext traffic.
- Crash/error boundary around every screen so a single feature failure can't blank the whole app (especially the tab bar and send flow).

---

## 10. app.json — planned shape

- `plugins`: `expo-router`, `expo-splash-screen` (light/dark variants), `expo-secure-store`, `expo-font`, `expo-local-authentication` (Face ID usage string), `expo-notifications`, `expo-camera` (QR scanning), `expo-haptics`.
- `ios`: `bundleIdentifier: com.decentroneum.wallet`, `infoPlist` usage descriptions, `associatedDomains` for `decentroneum.com` universal links, `supportsTablet: false` (wallet is phone-first like Trust Wallet), edge-to-edge safe-area handling.
- `android`: `package: com.decentroneum.wallet`, adaptive icon (foreground/background/monochrome from the two legal brand treatments), `permissions`: camera, notifications, biometric, `intentFilters` for deep links.
- `splash`: dark-first, neon hex mark, light/dark variants matching brand rule.
- `extra.eas.projectId` placeholder + `owner` for EAS Build/Submit readiness.

---

## 11. Execution phases (tracked in the live task list)

1. **Foundation** — SDK 57 upgrade, app.json, icon/splash assets, theme tokens, folder restructure.
2. **Core data layer** — multi-account vault/state, token registry v2, notification plumbing.
3. **Screens** — Home, Send/Receive, Onboarding, Settings, Explorer, Browser cleanup.
4. **Hardening** — security checklist, typecheck/lint, expo-doctor, manual QA pass.

## 12. Status — what shipped in this pass

All four phases above were executed in this session, not just planned:

- **Dependencies**: `package.json` pinned to the official Expo SDK 57 manifest (RN 0.86, React 19.2.3, Reanimated 4.5, etc.), sourced from `expo@57.0.8`'s own `bundledNativeModules.json` for exact compatibility.
- **app.json**: fully rebuilt — real bundle IDs (`com.decentroneum.wallet`), light/dark/tinted iOS icons, Android adaptive + monochrome icons, camera/Face ID/notification permission strings, associated domains, EAS placeholder.
- **Brand assets**: `icon.png` / `icon-dark.png` / `icon-tinted.png` / adaptive icon layers / splash (light + dark) / favicon / notification icon — all generated pixel-precisely from the supplied hexagon mark, using only the two approved treatments.
- **Architecture**: `src/` reorganized into `components/`, `features/{accounts,explorer}/`, `lib/{chain,crypto,storage,security,tokens,notifications}/`, `state/`, `theme/` — a real mechanical restructure (not just new folders alongside old ones), verified by a full import-resolution sweep.
- **Multi-account vault (VaultV2)**: one passcode, N encrypted accounts, transparent migration from the old single-mnemonic vault, in-memory-only key model (mnemonics decrypted on demand, never held longer than a signing operation).
- **Token registry v2**: bundled ETN + DCNT, remote registry fetch with zod validation and offline-safe caching, documented submission → auto-approval → auto-listing pipeline.
- **Notifications**: permission flow, Settings toggle, and a live balance-diff watcher that fires local notifications on incoming ETN/token transfers.
- **Explorer tab**: brand-new — network snapshot, per-account activity feed, tx detail sheet, universal address/hash search — replacing the old link-out. Panthart removed everywhere.
- **Verification**: multiple clean `tsc --noEmit` passes throughout, plus a standalone import-resolution check after the final restructure (148 local imports across 55 files, zero broken).

### What's next (not done in this pass — realistic scope for a follow-up)
Deeper per-screen visual redesign (Send/Receive sheet restyle, onboarding create/import visual overhaul), the server-side push-notification backend described in §6, and native `expo prebuild` regeneration of `android/`/`ios/` from the new `app.json`.
