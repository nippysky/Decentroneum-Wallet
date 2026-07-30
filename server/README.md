# Decent Wallet Push Server

Server-side half of Decent Wallet's push notifications (see `PLAN.md` §6 in
the repo root for the architecture rationale). The app already notifies
users of incoming funds while it's open, via a client-side balance watcher
(`src/lib/notifications/watcher.ts`). That can't fire while the app is
backgrounded or fully killed — only a real push notification, sent by a
server, can do that. This is that server.

## What it does

1. **`POST /register`** — a device proves it controls a wallet address (by
   signing a short message with that address's private key — see
   `src/verify.ts`) and registers its Expo push token against that address.
   The matching client code is `src/lib/notifications/register.ts` in the
   main app.
2. **Chain watcher** (`src/chainWatcher.ts`) — holds one persistent
   WebSocket connection to the RPC node and subscribes to new block headers
   and tracked-token `Transfer` logs; the node pushes matching events to us
   the instant they happen, rather than us asking on a timer. It watches for:
   - native ETN transfers to any registered address (found by inspecting
     each new block's transactions — native transfers emit no log)
   - ERC-20 `Transfer` events for every token in the published registry at
     `https://decentroneum.com/api/token-list.json`, to any registered
     address. The list is fetched at boot and refreshed every 30 minutes, so
     listing a token needs no server change. If the registry is ever
     unreachable at boot, the last good list is read from SQLite.

   A low-frequency HTTP reconcile pass (`RECONCILE_INTERVAL_MS`, default
   30s) and automatic reconnect-with-backoff cover the two edge cases a pure
   subscription can't: a dropped subscription message, and the socket
   itself going down.
3. **Expo Push API** (`src/expoPush.ts`) — batches and sends the resulting
   notifications, pruning push tokens Expo reports as no longer valid.

Storage is a single SQLite file (`better-sqlite3`) — registrations, a
"last processed block" cursor, and a dedupe table so the same transfer is
never notified twice. That's enough for one Decentroneum-scale deployment;
swap `src/db.ts` for Postgres/Redis if you need to run more than one
instance behind a load balancer (the cursor and dedupe table are the only
things that need to be shared across instances).

## Running it

```bash
cd server
cp .env.example .env      # fill in RPC_URL, RPC_WS_URL, MARKET_API_KEY
npm install
npm run dev                # tsx watch — restarts on change
```

Production:

```bash
npm run build
npm start
```

## Deploying (DigitalOcean droplet, alongside aku-api / ugwo-api)

```bash
# on the droplet
mkdir -p /var/www/decent-wallet-push && cd /var/www/decent-wallet-push
# copy server/ here (scp/rsync/git clone — whatever you use for the other two APIs)
cp .env.example .env && nano .env      # fill in RPC_URL, RPC_WS_URL, MARKET_API_KEY
npm install
npm run build
pm2 start ecosystem.config.js
pm2 save                                # persists across reboots (run `pm2 startup` once if you haven't already)
```

Put it behind nginx + TLS like the other two APIs, e.g. an nginx server block proxying
`push.decentroneum.com` → `127.0.0.1:8787`, then `certbot --nginx -d push.decentroneum.com`.
Update `PUSH_SERVER_URL` in `src/lib/notifications/register.ts` (main app) to match.

**Two independent layers of resilience are built in:**
- In-process: `chainWatcher.ts` reconnects the WebSocket with exponential backoff on
  disconnect, and a watchdog force-reconnects if no block notification arrives for
  ~20s (covers a socket that stalls silently without firing `close`). A low-frequency
  HTTP reconcile pass backfills anything a subscription message ever drops.
- Process-level: `index.ts` catches `uncaughtException`/`unhandledRejection` so a
  stray error doesn't kill the whole server. `ecosystem.config.js` adds pm2 as the
  outer safety net — `autorestart: true` brings the whole Node process back if it
  ever does exit unexpectedly, with `pm2 save` + `pm2 startup` surviving droplet reboots.

## Before going live

- **Get this actually reachable** and update `PUSH_SERVER_URL` in
  `src/lib/notifications/register.ts` (main app) to point at it.
- **EAS project ID**: `app.json`'s `extra.eas.projectId` is a placeholder —
  set it to a real EAS project so `Notifications.getExpoPushTokenAsync()`
  can mint real Expo push tokens on-device.
- **RPC reliability**: point `RPC_URL` at a dedicated/paid RPC endpoint for
  production traffic rather than a shared public one.
- **Horizontal scaling**: if you outgrow one instance, move `cursor` and
  `sent_events` to a shared store (Postgres/Redis) so two watcher instances
  don't double-process the same blocks.
