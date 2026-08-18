# Decentroneum — store submission guide

Answers for every question the two consoles will ask, grounded in the code
audit in §0 below. Where a policy is genuinely ambiguous this file says so
rather than guessing confidently.

**The single fact that drives most answers:** Decentroneum is
**non-custodial**. Keys are generated on-device, encrypted with a
passcode-derived scrypt key, and stored in the iOS Keychain / Android
Keystore. We never hold, transmit or have access to user funds or keys. Both
stores treat that very differently from an exchange or a custodial wallet.

App identity:

| | |
| --- | --- |
| Name | Decentroneum |
| Bundle ID / package | `com.decentroneum.wallet` |
| Version | 1.0.0 |
| Privacy Policy | https://decentroneum.com/privacy |
| Terms | https://decentroneum.com/terms |

---

# Part 1 — Google Play Console

## 1.1 Financial features declaration

Path: **App content → Financial features**

- **Does your app provide financial features?** → **Yes**
- Select: **Cryptocurrency exchange and/or software wallet** →
  **Software wallet** only. Do **not** tick exchange: the app has no trading,
  no swap, no fiat on-ramp, no order book.
- When asked about custody, answer **non-custodial / self-custody**.

**What actually happens, verified in the console.** Declaring "Cryptocurrency
wallet" triggers a **Documentation** step listing every regulated country
(Bahrain, Canada, EU, Japan, UK, US…) demanding licence uploads. That is
expected and is **not** a blocker.

Open each row and you will find two confirmation checkboxes at the bottom:

- ☑ **"I confirm that my app is a non-custodial software wallet"** ← tick this
- ☐ "…does not offer the purchase, holding, or exchange of cryptocurrencies in
  this country/region and I have applied the necessary geo-restriction
  measures" ← **leave unticked**

Tick only the first. Leave entity name, licence type, licence number and the
upload area **empty**, then Save. Repeat for every row including
"All countries / regions".

The second checkbox would be false on two counts: the app *does* hold crypto
(that is what a wallet does), and there is **no geo-restriction anywhere in the
code**.

Google's policy states plainly: *"Non-custodial wallets are out of scope of the
Cryptocurrency Exchanges and Software Wallets policy."* The licence columns in
their own table are populated only for **Exchanges** — the Software Wallets
column is empty or "Not required" for every country. So no MiCA, FCA or FinCEN
registration applies here.

Source: [Understanding Google Play's Cryptocurrency Exchanges and Software Wallets Policy](https://support.google.com/googleplay/android-developer/answer/16329703?hl=en)

## 1.2 Data safety

Path: **App content → Data safety**

- **Does your app collect or share any of the required user data types?** → **Yes**
- **Is all of the user data collected by your app encrypted in transit?** → **Yes** (HTTPS only)
- **Do you provide a way for users to request that their data is deleted?** → **Yes**
  — Settings → Erase wallet also unregisters the push token server-side.

Data types to declare:

| Category | Type | Collected | Shared | Purpose | Required? |
| --- | --- | --- | --- | --- | --- |
| Personal info | Other (wallet address) | Yes | No | App functionality | Required |
| Device or other IDs | Device or other IDs (Expo push token) | Yes | No | App functionality | Required |
| Web browsing history | Web browsing history | **See note** | **Yes, if kept** | App functionality | Optional |

**The browsing-history note — read before answering.** The in-app dApp
browser draws site icons. `src/components/SiteIcon.tsx` tries the site's own
`/favicon.ico` first, but falls back to DuckDuckGo's and Google's icon
services, which discloses the browsed domain to a third party.

- Keep the fallback → answer **Yes** to Web browsing history, shared with third parties.
- Delete lines 2–3 of `sourcesFor()` → answer **No**, honestly.

Do not answer No while the fallback ships. Google audits Data Safety answers
against observed traffic, and a false "No" is an enforcement issue, not a
paperwork one.

**Everything else is No.** No analytics, crash-reporting or advertising SDKs
are installed (verified by dependency scan). No advertising ID. Recovery
phrases, private keys, the passcode, balances and amounts never leave the
device.

## 1.3 Account deletion URL

Path: **App content → Data deletion**

- **Does your app allow users to create an account?** → **No**.
  There is no sign-up, no email, no server-side account — the wallet is local.
  This removes the account-deletion URL requirement entirely.

## 1.4 Content rating questionnaire

Answers as submitted:

| Question | Answer |
| --- | --- |
| Online content accessible from the app (not in the download) | **Yes** — the Featured dApp list and the browser both surface external content |
| Promotion/sale of age-restricted products | No |
| Shares precise location with other users | No |
| Allows purchase of digital goods | No — there is no IAP; an on-chain transfer the user signs is not an in-app purchase |
| Cash rewards, gift cards, play-to-earn, crypto rewards, NFT issuance | **No** |
| Is the app a web browser or search engine | **Yes** |
| Primarily news or educational | No |

**The crypto-rewards answer is the one you may be challenged on.** The
defence: the app *holds and transfers* assets that already exist. It does not
reward anyone with crypto, issue tokens or NFTs, run a play-to-earn loop, or
distribute airdrops or staking rewards. "Issuance" means minting; the app mints
nothing.

Answering **Yes** to the browser question pushes the rating to the top tier.
That is correct — under-declaring unrestricted web access is what gets apps
pulled after launch.

## 1.5 Target audience

- Target age group: **18+**. Do not tick any child age band.
- Appeals to children? → **No**

## 1.6 Store listing

- **Short description (80 chars):**
  `Self-custody wallet for Electroneum. Your keys never leave your device.`
- **Full description** — must state non-custodial early, avoid any wording that
  implies investment returns, price prediction or trading. Suggested opening:

  > Decentroneum is a non-custodial wallet for the Electroneum Smart Chain.
  > Your recovery phrase is generated on your device and encrypted there — we
  > never hold, see, or have access to your keys or your funds. Send and
  > receive ETN and Electroneum tokens, track prices and balances, and connect
  > to Electroneum dApps through the built-in browser.

  Do **not** write: "invest", "earn", "returns", "guaranteed", "profit", or
  anything implying financial advice.

## 1.7 App access (for reviewers)

Google's reviewer must reach every screen. There is no login, but state this
explicitly in **App access → All functionality is available without special access**,
and add a note:

> No account or login is required. On first launch, tap "Create a new wallet"
> and set any 6-digit passcode to reach the full app. All features are
> available immediately. No funds are required to browse the app.

---

# Part 2 — App Store Connect (iOS)

## 2.1 Before anything else — the account type

Apple requires wallet apps to be submitted by an **Organization**, not an
Individual, under Guideline 3.1.5(b): *apps may facilitate virtual currency
storage, provided they are offered by developers enrolled as an organization.*

Submit under **NIPPYSKY LIMITED, Team `375ZLBZ5UC`**. An Individual account is
rejected outright, and organization enrolment takes weeks — so confirm the app
record is under the org before building anything.

Source: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

## 2.2 App Privacy answers

These must match `ios.privacyManifests` in `app.json`, which is already set:

| Data | Collected | Linked to identity | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Identifiers → Device ID (push token) | Yes | **No** | **No** | App Functionality |
| Other Data (wallet address) | Yes | **No** | **No** | App Functionality |

- **Do you or your third-party partners use data for tracking?** → **No**
- If keeping the favicon fallback, also declare **Browsing History → not linked,
  not used for tracking, App Functionality**.

## 2.3 Export compliance

- **Does your app use encryption?** → Yes (HTTPS + local encryption)
- **Does it qualify for exemption?** → **Yes** — standard cryptography only,
  no proprietary algorithms. `ITSAppUsesNonExemptEncryption: false` is already
  set in `app.json`, so this question should be answered automatically.

## 2.4 Age rating

Same reasoning as Play: the unrestricted in-app browser drives it. Expect
**17+**. Answer "Unrestricted Web Access: Yes".

## 2.5 Review notes — write this in the App Review Information box

This is the field that most often decides a crypto rejection. Suggested text:

> Decentroneum is a **non-custodial** wallet for the Electroneum Smart Chain
> (EVM chain ID 52014).
>
> • We do not hold, transmit, or have access to user funds. Private keys and
>   recovery phrases are generated on-device and stored encrypted in the iOS
>   Keychain. They never leave the device and are never transmitted.
> • There is no exchange, no trading, no swap, and no fiat on-ramp.
> • There are no in-app purchases and no accounts — no login is required.
> • The app does not offer investment advice or promise any return.
>
> **To review:** launch the app, tap "Create a new wallet", write down or skip
> the recovery phrase, and set any 6-digit passcode. All functionality is then
> available. No funds are needed to explore the app; balances will show zero.
>
> The in-app browser is a standard WebView for connecting to Electroneum dApps.
> The wallet only signs a transaction after explicit on-screen confirmation.

## 2.6 The likely rejection, and the answer

Crypto wallets commonly get a 3.1.5(b) query asking to confirm custody
arrangements or licensing. The reply is short and factual:

> Decentroneum is non-custodial. The app does not store, transmit or control
> user funds at any point; keys are generated and held only on the user's
> device. No exchange or money-transmission service is offered, so no
> money-transmitter licence applies. The developer is enrolled as an
> organization (NIPPYSKY LIMITED).

---

# Part 2.65 — Play warning: undeclared photo permission

If Play flags `android.permission.READ_MEDIA_IMAGES`, it is **not** your code.
`expo-screen-capture` declares it so it can *detect* screenshots on Android 13.
We do not use detection on Android — `FLAG_SECURE` blocks the screenshot
outright, so there is nothing to detect.

Already fixed, and both halves are needed:

1. `useScreenshotWarning` returns early unless `Platform.OS === "ios"`.
2. `app.json` → `android.blockedPermissions: ["android.permission.READ_MEDIA_IMAGES"]`.

Verify after any prebuild:

```bash
grep uses-permission android/app/src/main/AndroidManifest.xml
```

You should see `READ_MEDIA_IMAGES` with `tools:node="remove"` — that is the
manifest-merger *instruction* to strip it, not a granted permission. The final
merged manifest inside the AAB will not contain it, and the justification box
in Play Console can be left empty.

---

# Part 2.7 — Known open items

- **Droplet:** `apt update && apt upgrade` + reboot still pending. `pm2 save` is
  done, so processes return automatically after the reboot.
- **`@react-navigation/*`** — 3 packages installed, none imported. `expo-router`
  pulls its own copies transitively, so removing them is *probably* safe. Not
  worth doing immediately before or during a submission: it changes module
  resolution and buys only a slightly smaller dependency tree.
- **`react-dom` / `react-native-web` must NOT be removed.** They are declared
  peer dependencies of `expo-router`. An earlier note in this project claimed
  they were dead weight — that was wrong.
- **Favicon fallback** — decide before submitting whether to keep the
  third-party icon services (see the browsing-history note in §1.2).

---

# Part 3 — Build & submit commands

Run the correctness proof first — this touches the vault, so it is not optional:

```bash
npm run verify:hd          # must print PASS — 84/84
npx tsc --noEmit           # must be silent
```

## Android

```bash
# Test on a real device first — production builds an AAB, which cannot be sideloaded
eas build --platform android --profile preview      # installable APK

# Then the Play Store artifact
eas build --platform android --profile production   # AAB
eas submit --platform android --latest
```

## iOS

```bash
eas build --platform ios --profile production
eas submit --platform ios --latest
```

`eas submit` needs App Store Connect API credentials the first time; it will
prompt. Make sure the app record already exists under the **organization**
team before submitting.

## After release — JS-only changes go out over the air

```bash
eas update --branch production --message "..."
```

Native changes (any `app.json`, config plugin, or native dependency edit)
always need a fresh `eas build`. Note `runtimeVersion` is `appVersion`, so
bumping `version` in `app.json` cuts existing installs off from updates until
they install a new build — that is the intended safety behaviour.
