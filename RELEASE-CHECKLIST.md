# Decent Wallet — production release checklist

Everything still outstanding before the App Store / Play Store submissions,
in the order it needs doing. Items are marked with where the work happens:
**[code]**, **[dashboard]**, or **[dns]**.

---

## 1. Android App Links fingerprint — DEFERRED, DO THIS FIRST

**Status: intentionally skipped during development.** `/.well-known/assetlinks.json`
currently returns **HTTP 503** and logs an error, because
`ANDROID_SHA256_FINGERPRINTS` is unset. That's deliberate — a *wrong*
fingerprint is worse than a missing one, since Android caches the failed
verification.

iOS is unaffected: `apple-app-site-association` is a separate route and is
already configured with `APPLE_TEAM_ID=375ZLBZ5UC`.

### Why it had to wait
The fingerprint that matters is from the **Play App Signing** key, which
Google only generates **after your first upload to Play Console**. It does
not exist yet. Your upload key's fingerprint is *not* the right one — Google
re-signs your build, so users install something signed with a different key.
Using the upload key is the single most common reason Android App Links
silently fail.

### What to do, after the first Play Console upload
1. Play Console → your app → **Test and release → App integrity**
   → **App signing key certificate** → copy the **SHA-256 certificate fingerprint**.
2. Add to Vercel (`decentroneumv4` → Settings → Environment Variables,
   Production scope):
   ```
   ANDROID_SHA256_FINGERPRINTS=AA:BB:CC:…:FF
   ```
   Multiple keys are supported — comma-separated, no spaces. Add your debug
   or EAS keystore fingerprint too if you want App Links working on internal
   builds:
   ```
   ANDROID_SHA256_FINGERPRINTS=<play-signing>,<debug-or-eas>
   ```
   Debug keystore fingerprint, if needed:
   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore \
     -alias androiddebugkey -storepass android -keypass android | grep -A1 SHA256
   ```
   Or, for an EAS-managed keystore: `eas credentials` → Android.
3. **Redeploy** — Vercel does not apply new env vars to existing deployments.
4. Verify:
   ```bash
   curl -s https://decentroneum.com/.well-known/assetlinks.json | python3 -m json.tool
   ```
   Then Google's checker:
   https://developers.google.com/digital-asset-links/tools/generator
5. Reinstall the app on a real device — Android only re-verifies on install.

---

## 2. Verify iOS universal links **[dashboard/test]**

`APPLE_TEAM_ID` is set locally. Confirm it's also in Vercel, then:

```bash
curl -s https://decentroneum.com/.well-known/apple-app-site-association | python3 -m json.tool
curl -s https://app.decentroneum.com/.well-known/apple-app-site-association | python3 -m json.tool
curl -sI https://decentroneum.com/.well-known/apple-app-site-association | grep -i content-type
```

Expect real JSON from **both** hosts and `content-type: application/json`.
The `app.` subdomain is the one to watch — the proxy previously rewrote it
and 404'd.

Validator: https://search.developer.apple.com/appsearch-validation-tool

Test on a **real device**, not the Simulator. iOS caches association results;
if it fails, delete and reinstall before assuming the file is wrong.

---

## 3. WalletConnect WalletGuide submission **[dashboard]**

Makes "Decent Wallet" appear in other dapps' wallet lists. Without it, the
deep-link connect flow works mechanically but no dapp offers your wallet as
an option.

- cloud.reown.com → project **Decentroneum** → **WalletGuide** → Start submission
- Needs: app icon, description, and **App Store + Play Store links** — hence
  after launch.
- Project ID (already wired into the app): `9ec19d32c42939806ffa6242de27b375`

---

## 4. Play Console declarations **[dashboard]**

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

## 5. App Store Connect **[dashboard]**

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

## 6. Housekeeping

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
