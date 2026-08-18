# Decentroneum

Non-custodial mobile wallet (formerly “Decent Wallet”) for the **Electroneum Smart Chain** (EVM chain ID
`52014`). Expo SDK 57 / React Native 0.86, iOS and Android.

Keys are generated on-device, encrypted with a passcode-derived scrypt key, and
stored in the iOS Keychain / Android Keystore. Recovery phrases never leave the
device and are never transmitted.

---

## Quick start

```bash
npm install
npx expo start          # then press i / a, or scan with a dev build
```

The app requires a **development build** (`expo-dev-client`), not Expo Go —
it uses native modules Expo Go doesn't bundle.

```bash
npx expo prebuild --clean
npx expo run:ios          # or run:android
```

## Checks — run before any release

```bash
npm run verify:hd    # 84 assertions against the real vault. Must print PASS.
npm run typecheck
npm run lint
```

`verify:hd` runs `src/lib/crypto/vault.ts` in Node with the Expo native modules
stubbed, and asserts BIP-44 derivation against the published Hardhat/Anvil test
vectors, multi-phrase isolation, hide/unhide reversibility, and that no
migration path can move an existing address. **Never ship a change to
`src/lib/crypto/` without it passing** — the failure mode is unreachable funds.

---

## How the wallet is organised

```
app/                     expo-router routes only — thin compositions
src/
  components/            shared UI primitives
  features/accounts/     account + recovery-phrase management
  lib/
    chain/               RPC, ERC-20, signing, network config
    crypto/              vault, BIP-44 derivation, scrypt KDF   ← the core
    notifications/       push registration + balance watcher
    tokens/              token registry, native asset identity
  state/                 zustand stores (no secrets held here)
  theme/                 tokens, typography, ThemeProvider
server/                  push notification service (separate deploy)
scripts/verify-hd-wallet.js
```

### The vault model, in one paragraph

A vault holds one or more **seeds** (recovery phrases). Each seed owns accounts
derived at BIP-44 `m/44'/60'/0'/0/N` — the standard path, so the same phrase
yields the same addresses in MetaMask, Ledger and Rabby. "Add account"
increments N; nothing new is generated and there is nothing new to back up.
Importing a phrase creates a **new seed**, so its sub-accounts can all be
restored. There is deliberately no "imported account" category floating outside
the phrase hierarchy — that category is where people lose funds, because it
escapes a seed backup silently. Full reasoning is in the header comment of
`src/lib/crypto/vault.ts`.

### Accounts are hidden, never deleted

A derived address exists on-chain whether the app shows it or not, so there is
no "delete account" — only **hide**, which keeps the index and unhides to the
identical address. Removing a whole recovery phrase *is* a real removal and
carries a warning. See `hideAccount` in the vault.

---

## Releasing

Store submission answers — Play Data Safety, Financial Features, Apple App
Privacy, review notes — are in **[SUBMISSION-GUIDE.md](./SUBMISSION-GUIDE.md)**,
derived from a repeatable code audit rather than from memory.

```bash
eas build --platform android --profile preview      # installable APK, test first
eas build --platform android --profile production   # AAB for Play
eas build --platform ios     --profile production
eas submit --platform android --latest              # -> internal track, draft
```

Uploads always land on the **internal** track as a **draft**, so nothing ever
rolls out on its own. To reach real users, **promote the same bundle** through
closed → open → production inside Play Console (Test and release → the release →
Promote release). Promotion carries the exact AAB that was tested — there is no
rebuild and no second upload, which is the entire reason tracks exist. There is
deliberately no submit profile that uploads straight to production.

JS-only changes ship over the air:

```bash
eas update --branch production --message "..."
```

Anything touching `app.json`, a config plugin, or a native dependency needs a
full `eas build`. `runtimeVersion` is `appVersion`, so bumping `version` cuts
existing installs off from updates until they install a new build — intended
safety behaviour, not a bug.

---

## Things that will bite you

**`react-dom` and `react-native-web` look unused — they are peer dependencies
of `expo-router`.** Do not remove them.

**`@react-navigation/*` are installed but never imported.** `expo-router` pulls
its own copies transitively, so they are removable in principle. Not worth the
build risk for a marginally smaller dependency tree.

**Every build profile in `eas.json` must declare a `channel`.** `app.json` sets
`updates.url`, but a binary only knows where to look for updates if its build
profile named a channel. Without one, EAS Build warns *"a channel is not
specified … EAS Update will be disabled for the build"* — and it means it: that
binary can never receive an OTA update, and no `eas update` can retrofit it.
The only fix is a new build. Channel names here match branch names
(`production`, `preview`, `development`), so `eas update --branch production`
reaches the production channel.

**`platforms` is `["ios","android"]` in `app.json`, deliberately.** The app
cannot run on web (the vault needs SecureStore), and leaving web enabled made
`eas update` fail trying to bundle `expo-sqlite`'s web worker.

**Local builds can fail with `Library not loaded: ReactNativeDependencies`.**
That is stale Xcode DerivedData disagreeing with a changed pod graph, not a code
problem:

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/Decentroneum-*
npx expo prebuild --clean && npx expo run:ios
```

EAS builds on clean machines and is never affected.
