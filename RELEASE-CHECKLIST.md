# Decent Wallet — production release checklist

Everything still outstanding before the App Store / Play Store submissions.
Items are marked **[code]**, **[dashboard]**, or **[dns]**.

The store forms below are **pre-filled from a code audit**, not from memory.
Every answer traces to something verifiable in this repo — the audit method is
recorded under each section so it can be re-run when the code changes.

---

## 0. Data audit — the source for every answer below

Re-run before each submission:

```bash
# Every network destination the app can contact
grep -rhoE "https://[a-zA-Z0-9./_%?=&{}$-]+" --include=*.ts --include=*.tsx app src | sort -u

# Analytics / crash / ad SDKs (must stay empty)
node -e 'const d=require("./package.json").dependencies;
console.log(Object.keys(d).filter(k=>/analytics|sentry|bugsnag|amplitude|mixpanel|segment|facebook|admob|appsflyer|branch|datadog|crashlytics/i.test(k)))'

# What is POSTed off-device
grep -n "JSON.stringify" src/lib/notifications/register.ts
```

**Result of the last audit:**

| Destination | What is sent | Why |
| --- | --- | --- |
| `push.decentroneum.com` | wallet address, Expo push token, platform, timestamp, signature | transaction alerts |
| `rpc.electroneum.com`, `rpc.ankr.com`, `52014.rpc.thirdweb.com` | wallet address (in balance/tx queries) | reading the chain — unavoidable for any wallet |
| `decentroneum.com/api/token-list.json` | nothing | token registry |
| site's own `/favicon.ico` | the domain being listed | browser icons, first-party |
| `icons.duckduckgo.com`, `google.com/s2/favicons` | the domain being listed | **fallback only** — see `SiteIcon.tsx` |
| `duckduckgo.com/?q=` | the user's typed search | the user explicitly searched |

**Never sent anywhere:** recovery phrases, private keys, the passcode, balances,
amounts, contacts, location, or any advertising identifier. Zero analytics,
crash-reporting or ad SDKs are installed — verified above.

---

## 1. Play Console — Financial Features **[dashboard]**

- Declare as a **software wallet (non-custodial)**. Say *non-custodial*
  explicitly: keys are generated and stored on-device only, and we never have
  custody, so Google's crypto-exchange licensing requirements are out of scope.

## 2. Play Console — Data Safety form **[dashboard]**

Answers, from the audit above:

- **Does your app collect or share any of the required user data types?** → **Yes**
- **Data type:** *Personal info → Other* — the wallet address.
  - Collected: **Yes** · Shared: **No** · Processed ephemerally: **No**
  - Required or optional: **Required** (for notifications)
  - Purpose: **App functionality** only
- **Data type:** *Device or other IDs* — the Expo push token.
  - Collected: **Yes** · Shared: **No** · Purpose: **App functionality**
- **Data type:** *Web browsing history* — **declare Yes** if you keep the
  third-party favicon fallback, because a browsed domain can reach DuckDuckGo
  or Google. Removing lines 2-3 of `sourcesFor()` in `SiteIcon.tsx` makes this
  a clean **No**. Decide before submitting; don't answer No while the fallback ships.
- **Is all data encrypted in transit?** → **Yes** (HTTPS everywhere)
- **Can users request data deletion?** → **Yes** — Settings → Erase wallet
  unregisters the push token server-side.
- **Analytics / advertising / crash SDKs?** → **None**

## 3. App Store Connect **[dashboard]**

- Submit under the **Organization** account (NIPPYSKY LIMITED, Team
  `375ZLBZ5UC`). Apple rejects wallet apps from individual accounts under
  Guideline 3.1.5(a).
- **App Privacy answers** — must match `ios.privacyManifests` in `app.json`:
  - *Identifiers → Device ID*: collected, **not linked** to identity, **not** used for tracking, purpose **App Functionality**
  - *Other Data*: the wallet address — same three answers
  - Tracking: **No**. `NSPrivacyTracking: false`, `NSPrivacyTrackingDomains: []`
- Encryption: `ITSAppUsesNonExemptEncryption: false` — already set.
- Privacy Policy: https://decentroneum.com/privacy
- Terms: https://decentroneum.com/terms
- After a build, confirm `ios/DecentWallet/PrivacyInfo.xcprivacy` exists.

## 4. Age rating — both stores

Expect a **mature** rating. The in-app dApp browser allows unrestricted web
access, which drives the rating up regardless of the wallet's own content.
Answer the browser questions truthfully; understating it risks removal later.

---

## 5. Still open **[code]**

- **`@react-navigation/*` — 3 packages installed, none imported.** Verified
  `expo-router` does not list them as peer dependencies and pulls its own copies
  (`@react-navigation/core`, `routers` are present transitively), so removing
  them from `package.json` is *probably* safe. **Do not do this immediately
  before a production build** — it changes module resolution, and the payoff is
  only a slightly smaller dependency tree.
- **`react-dom` / `react-native-web`** are now dead: `platforms` is
  `["ios","android"]`. Removable with `npm install`, no prebuild. Same timing
  caution.
- **Droplet:** `apt update && apt upgrade` + reboot pending. pm2 `save` is done,
  so processes return automatically.
- Commit both repos — the droplet is ahead of git history.

---

## Verified done — no action needed

- **Screenshot blocking is wired.** `expo-screen-capture` is used by
  `src/lib/security/screenGuard.ts` and applied on the recovery-phrase screens
  (`settings.tsx`, `(onboarding)/import.tsx`). The earlier "installed but
  unused" note is stale.
- **The Firebase admin private key is no longer in the repo root.** Confirmed
  absent.
- **No analytics, crash or ad SDKs.** Confirmed by dependency scan.
- **`versionCode` / `buildNumber` removed from `app.json`** — EAS owns them
  (`appVersionSource: "remote"`); leaving them baked a stale `1` into the
  manifest.
- **`platforms: ["ios","android"]`** — web is not a target and can't run this
  app (the vault needs SecureStore). This also fixes `eas update`, which used to
  fail trying to bundle web.
- **HD wallet correctness**: `npm run verify:hd` — 84 assertions against the
  real vault, including BIP-44 vectors, multi-phrase isolation, and hide/unhide.
  Run it before any release that touches `src/lib/crypto/`.
- Token registry auto-syncs: the push server fetches `/api/token-list.json`
  every 30 min. Listing a token needs no server change. Verify with
  `curl -s https://push.decentroneum.com/health`.
- `TRACKED_TOKENS` on the droplet is a disaster-fallback only. Never edit it.
- Legal pages at /privacy and /terms, linked from Settings and from onboarding
  (pre-wallet-creation consent).
- Token submission intake at /tokens/submit with on-chain verification.
