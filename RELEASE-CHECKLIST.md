# Decent Wallet — production release checklist

Everything still outstanding before the App Store / Play Store submissions,
in the order it needs doing. Items are marked with where the work happens:
**[code]**, **[dashboard]**, or **[dns]**.

---

## 1. Play Console declarations **[dashboard]**

- **Financial Features Declaration** — declare as a **software wallet**.
  Non-custodial wallets are explicitly **out of scope** of Google's crypto
  licensing requirements, so no government licence is needed. Say
  non-custodial clearly.
- **Data Safety form.** What the app actually does: no analytics, no crash
  SDKs, no advertising ID. Data handled = wallet address + Expo push token,
  sent to our own push server, used only for transaction notifications, and
  deletable in-app via Settings → Erase wallet.
- **Age rating** — expect to land at a mature rating because the in-app dApp
  browser allows unrestricted web access.

## 2. App Store Connect **[dashboard]**

- Submit under the **Organization** account (NIPPYSKY LIMITED, Team
  `375ZLBZ5UC`) — Apple requires this for wallet apps; individual accounts
  are rejected under Guideline 3.1.5(a).
- Privacy manifest is generated from `app.json` (`ios.privacyManifests`) —
  confirm `ios/DecentWallet/PrivacyInfo.xcprivacy` exists after prebuild.
- Encryption: `ITSAppUsesNonExemptEncryption: false` is already set.
- Age rating: same reasoning as Play — the dApp browser drives it up.
- Privacy Policy URL: https://decentroneum.com/privacy
- Terms URL: https://decentroneum.com/terms

---

## 3. Housekeeping

- **Move the unused Firebase service-account key out of the repo.**
  `decent-wallet-c7e6f-firebase-adminsdk-*.json` at the repo root is
  referenced nowhere (the push server uses the Expo Push API, not FCM
  directly). It's gitignored, but it's a live private key sitting in a
  project directory — move it to `~/.secrets/`.
- **`expo-screen-capture` is installed but unused.** For a wallet, blocking
  screenshots on the recovery-phrase screen is a genuine security feature.
  Either wire it up or drop the dependency.
- **`@react-navigation/*` packages are installed but unimported.** Harmless
  while unused, but a footgun: importing `@react-navigation/native` breaks
  the Metro build outright on SDK 56+. Consider removing once the build is
  confirmed stable.
- **Droplet:** `apt update && apt upgrade` + reboot pending (48 updates, one
  security). pm2 `save` is done, so processes come back automatically.
- Commit both repos — the droplet is currently ahead of git history.

---

## Already done — no action needed

- Token registry auto-syncs: the push server fetches
  `/api/token-list.json` every 30 min. Listing a token needs **no** server
  change and **no** `TRACKED_TOKENS` edit. Verify with
  `curl -s https://push.decentroneum.com/health`.
- `TRACKED_TOKENS` on the droplet is now a disaster-fallback only. Leave it
  populated; never edit it again.
- Legal pages live at /privacy and /terms, linked from wallet Settings and
  from onboarding (pre-wallet-creation consent).
- Token submission intake at /tokens/submit with on-chain verification.
