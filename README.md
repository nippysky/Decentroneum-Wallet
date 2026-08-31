# Decentroneum

A non-custodial mobile wallet for the **Electroneum Smart Chain** (EVM chain ID
`52014`). iOS and Android, built with Expo SDK 57 / React Native 0.86.

Recovery phrases are generated on-device, encrypted with a passcode-derived
scrypt key, and stored in the iOS Keychain / Android Keystore. Keys and phrases
never leave the device and are never transmitted.

**Beta:** [TestFlight (iOS)](https://testflight.apple.com/join/5mjQGBvP) · Google Play (open testing)

## Features

- Create a wallet, or import an existing 12- or 24-word BIP-39 phrase
- Multiple recovery phrases, each with its own derived accounts
- Send and receive ETN and Electroneum Smart Chain tokens
- Live prices and charts, sourced from on-chain liquidity pools
- Built-in dApp browser with an injected EIP-1193 provider — no WalletConnect required
- Push notifications for incoming transfers, delivered even when the app is closed
- Face ID / Touch ID / fingerprint unlock, and screenshot protection on secret screens
- Light and dark themes

## Quick start

```bash
npm install
npx expo start
```

The app needs a **development build** (`expo-dev-client`), not Expo Go — it
relies on native modules Expo Go doesn't bundle:

```bash
npx expo prebuild --clean
npx expo run:ios          # or run:android
```

### Checks

```bash
npm run verify:hd    # 84 assertions against the real vault. Must print PASS.
npm run typecheck
npm run lint
```

`verify:hd` executes `src/lib/crypto/vault.ts` in Node with the Expo native
modules stubbed, asserting BIP-44 derivation against the published
Hardhat/Anvil test vectors, multi-phrase isolation, hide/unhide reversibility,
and that no code path can move an existing address. **Never ship a change under
`src/lib/crypto/` without it passing** — the failure mode is unreachable funds.

## Project layout

```
app/                     expo-router routes — thin compositions only
src/
  components/            shared UI primitives
  features/accounts/     account + recovery-phrase management
  lib/
    chain/               RPC, ERC-20, signing, network config
    crypto/              vault, BIP-44 derivation, scrypt KDF   ← the core
    notifications/       push registration + balance watcher
    security/            screen capture guard, biometrics
    tokens/              token registry, native asset identity
  state/                 zustand stores (no secrets held here)
  theme/                 tokens, typography, ThemeProvider
server/                  push notification service (separate deploy)
scripts/verify-hd-wallet.js
```

## How the wallet works

### The vault

A vault holds one or more **seeds** (recovery phrases). Each seed owns accounts
derived at BIP-44 `m/44'/60'/0'/0/N` — the standard path, so the same phrase
yields the same addresses in MetaMask, Ledger and Rabby. "Add account"
increments `N`; nothing new is generated and there is nothing new to back up.
Importing a phrase creates a **new seed**, so its sub-accounts are all
recoverable.

There is deliberately no "imported account" category sitting outside the phrase
hierarchy. That category is where people lose funds, because such accounts
escape a seed backup silently. Full reasoning is in the header of
`src/lib/crypto/vault.ts`.

### Accounts are hidden, never deleted

A derived address exists on-chain whether the app displays it or not, so there
is no "delete account" — only **hide**, which preserves the index and unhides to
the identical address. Removing an entire recovery phrase *is* a real removal
and carries a warning. See `hideAccount` in the vault.

### Token list

Listed tokens come from a published registry, not the app binary, so adding a
token requires no release. The wallet and the push server read the same URL,
which is what stops them drifting apart.

## Releasing

```bash
eas build --platform android --profile preview      # installable APK, test first
eas build --platform all --profile production
eas submit --platform android --latest
```

Uploads land on the internal track as a draft. To reach production, **promote
the same bundle** through the tracks in Play Console rather than uploading
again — promotion ships the exact binary that was tested.

JS and asset changes go out over the air:

```bash
eas update --branch production --message "..."
```

Anything touching `app.json`, a config plugin, or a native dependency needs a
full `eas build`.

## Development notes

**`react-dom` and `react-native-web` look unused — they're peer dependencies of
`expo-router`.** Don't remove them.

**`@react-navigation/*` are installed but never imported.** `expo-router` pulls
its own copies transitively, so they're removable in principle — not worth the
build risk for a marginally smaller dependency tree.

**Every build profile in `eas.json` must declare a `channel`.** `app.json` sets
`updates.url`, but a binary only knows where to look for updates if its build
profile named a channel. Without one, EAS Build warns that updates are disabled
— and means it: that binary can never receive an OTA update, and no `eas update`
can retrofit it. The only fix is a new build.

**`slug` is `decent-wallet` and must stay that way.** It has to match the slug
of the EAS project that `extra.eas.projectId` points at, and Expo does not allow
a slug to be renamed. Changing it fails the build. It's internal and never shown
to users.

**`platforms` is `["ios","android"]` deliberately.** The app can't run on web
(the vault needs SecureStore), and leaving web enabled made `eas update` fail
trying to bundle `expo-sqlite`'s web worker.

**Local iOS builds can fail with `Library not loaded: ReactNativeDependencies`.**
That's stale Xcode DerivedData disagreeing with a changed pod graph, not a code
problem:

```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/Decentroneum-*
npx expo prebuild --clean && npx expo run:ios
```

EAS builds on clean machines and is never affected.
