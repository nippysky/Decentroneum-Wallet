# Decentroneum Push Server

Server-side half of Decentroneum's push notifications. The app already notifies
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
nano .env                  # see "Configuration" below
npm install
npm run dev                # tsx watch — restarts on change
```

Production:

```bash
npm run build
npm start
```

## Configuration

**Every setting has a default in `src/config.ts`. `.env` only overrides them.**

That is why the live `.env` is short and why a variable can be absent there and
still have a value — `PRICE_REFRESH_INTERVAL_MS` is not in the droplet's `.env`,
so it uses the code default. There is deliberately no `.env.example`: two files
listing the same keys drift apart, and the one with the comments was never the
one actually running. `config.ts` is the single source of truth, and each value
carries the reasoning for the number next to it.

`.env` should contain **only** what is secret or environment-specific:

| Variable | Why it must be set here |
| --- | --- |
| `RPC_URL`, `RPC_WS_URL` | contain your provider API key |
| `RPC_FALLBACK_URLS` | deployment-specific |
| `MARKET_API_KEY` | secret |
| `MARKET_API_MONTHLY_CAP` | must match your plan (Demo = `10000`) |
| `MARKET_API_KEYED_BASE_URL`, `MARKET_API_AUTH_MODE` | set to whatever `npm run verify:key` reports |
| `DB_PATH`, `PORT`, `CHAIN_ID` | deployment-specific |
| `REQUIRE_SIGNATURE` | `true` in production |

Anything else — refresh cadences, liquidity floor, anchor token, rate limits —
lives in `config.ts` with its rationale. Override in `.env` only when a specific
deployment genuinely needs to differ, and expect to explain why.

### The market-data budget

The CoinGecko Demo tier gives 10,000 credits/month, resetting on the 1st. Our
cadences are sized at roughly **5,790/month for two listed tokens**, leaving
substantial headroom; the arithmetic is in the `RANGES` comment in
`src/marketData.ts`. Each additional token costs about 930/month, so past ~6
tokens the cadences need raising or the plan needs upgrading.

Two counters exist and they are not the same thing — see `src/apiBudget.ts`:

- **rate** (`api_calls`) counts every attempt, including refused ones
- **credits** (`api_usage`) counts only responses the provider actually served

Verify the accounting and see the live figures:

```bash
npm run verify:budget
```

## Deploying

Deploy target is a DigitalOcean droplet running the service under pm2 behind
nginx. The host is deliberately not written down here — this repository is
public. Set it once in your shell instead:

```bash
export DEPLOY_HOST=user@your-server        # not root; see below
export DEPLOY_DIR=/var/www/decentroneum-push
```

**Don't deploy as root.** The commands below use `$DEPLOY_HOST` so the account
is yours to choose; a non-root user with write access to `$DEPLOY_DIR` and
permission to run pm2 is enough, and it means a leaked key isn't a leaked box.

**First time only**, on the droplet:

```bash
mkdir -p $DEPLOY_DIR && cd $DEPLOY_DIR
nano .env                              # see "Configuration" below
```

**Every deploy** — push code from your machine, then build on the droplet:

```bash
# from the repo root, LOCALLY. Note the trailing slash on server/ — without it
# rsync creates $DEPLOY_DIR/server/ instead of syncing into it.
rsync -avz --delete \
  --exclude '.env' \
  --exclude 'node_modules/' \
  --exclude 'data/' \
  --exclude 'logs/' \
  --exclude 'dist/' \
  server/ $DEPLOY_HOST:$DEPLOY_DIR/
```

```bash
# then on the droplet
cd $DEPLOY_DIR
npm install            # NOT --omit=dev: `npm run build` needs typescript
npm run build
pm2 restart decentroneum-push
```

**The five excludes are load-bearing, not decoration.** `--delete` removes
anything on the droplet that isn't in your local `server/`, and every excluded
path exists *only* on the droplet:

| Exclude | Why deleting it would hurt |
| --- | --- |
| `.env` | the live secrets — RPC keys, market API key. Not in git. |
| `data/` | the SQLite database: every push registration, the block cursor, the dedupe table |
| `logs/` | pm2 output/error logs |
| `node_modules/` | built for the droplet's platform; syncing macOS binaries breaks `better-sqlite3` |
| `dist/` | rebuilt on the droplet from the synced `src/` |

Drop any one of them from the command and `--delete` will remove the real thing
on the server. If you are ever unsure, run it once with `--dry-run` first.

Put it behind nginx + TLS, e.g. an nginx server block proxying
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

- **RPC reliability**: point `RPC_URL` at a dedicated/paid RPC endpoint for
  production traffic rather than a shared public one.
- **Horizontal scaling**: if you outgrow one instance, move `cursor` and
  `sent_events` to a shared store (Postgres/Redis) so two watcher instances
  don't double-process the same blocks.
