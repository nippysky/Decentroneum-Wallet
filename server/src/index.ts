import { config } from "./config";
import { createServer } from "./server";
import { startChainWatcher } from "./chainWatcher";
import { startTokenRegistry, stopTokenRegistry } from "./tokenRegistry";

// One bad response body, one flaky network error deep in a promise chain,
// and a naive Node process just dies — taking down live delivery until
// something notices and restarts it. Every async path in chainWatcher.ts
// and expoPush.ts already catches its own errors, but this is the backstop:
// log it, stay up. If pm2/systemd restarts us anyway (see ecosystem file /
// deploy notes), that's fine — this just means a single transient error in
// something we didn't anticipate doesn't take the whole watcher down with it.
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException — continuing:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection — continuing:", reason);
});

const app = createServer();

const httpServer = app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
});

// Load the published token registry before the watcher starts: the initial
// backfill and the WebSocket log subscriptions both read the tracked-token
// list at startup, so fetching it first avoids a window where a listed token
// is silently unwatched until the next refresh.
let stopWatcher: () => void = () => {};
startTokenRegistry()
  .catch((err) => console.error("[server] token registry failed to load:", err))
  .finally(() => {
    stopWatcher = startChainWatcher();
  });

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] received ${signal} — shutting down…`);
  stopTokenRegistry();
  stopWatcher();
  httpServer.close(() => process.exit(0));
  // Don't hang forever waiting for in-flight requests to drain.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
