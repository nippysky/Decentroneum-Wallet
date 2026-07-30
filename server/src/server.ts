import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import { config } from "./config";
import { addRegistration, removeRegistration } from "./db";
import { verifyRegistrationProof } from "./verify";
import { tokenRegistryStatus } from "./tokenRegistry";
import {
  priceSeries,
  marketSnapshot,
  marketStatus,
  RANGE_KEYS,
  type Range,
} from "./marketData";

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    // Includes the live token-registry state so you can confirm the watcher
    // is tracking the same tokens the wallet displays — without SSH-ing in.
    res.json({
      ok: true,
      service: "decent-wallet-push-server",
      tokenRegistry: tokenRegistryStatus(),
    });
  });

  /**
   * Body: { address, pushToken, platform, timestamp, signature }
   * `signature` proves control of `address` — see src/verify.ts. The client
   * side of this contract lives in src/lib/notifications/register.ts in the
   * main app.
   */
  app.post("/register", (req, res) => {
    const { address, pushToken, platform, timestamp, signature } = req.body ?? {};

    if (typeof address !== "string" || !ethers.isAddress(address)) {
      return res.status(400).json({ ok: false, error: "Invalid address" });
    }
    if (typeof pushToken !== "string" || !pushToken.startsWith("ExponentPushToken")) {
      return res.status(400).json({ ok: false, error: "Invalid Expo push token" });
    }

    if (config.requireSignature) {
      if (typeof timestamp !== "string" || typeof signature !== "string") {
        return res.status(400).json({ ok: false, error: "Missing signature or timestamp" });
      }
      const verified = verifyRegistrationProof({ address, pushToken, timestamp, signature });
      if (!verified.ok) {
        return res.status(401).json({ ok: false, error: verified.reason });
      }
    }

    addRegistration(address, pushToken, typeof platform === "string" ? platform : undefined);
    console.log(`[server] registered ${address} (${platform ?? "unknown platform"}) for push`);
    res.json({ ok: true });
  });

  /**
   * Token prices + market stats for every listed token, plus native ETN.
   *
   * Served entirely from SQLite — this handler never calls GeckoTerminal. That
   * is the whole point: the upstream free tier is 30 calls/min shared across
   * everyone, so proxying it per-request would make the feature break as the
   * user base grows. Instead a background job refreshes the cache on a fixed
   * schedule and every user reads the same rows.
   *
   * Deliberately NOT merged into decentroneum.com/api/token-list.json: that
   * endpoint is token *identity* (address, symbol, decimals, logo), it changes
   * only when a token is listed, and it's cached for an hour at the CDN and
   * six hours in the app. A price behind those caches would be up to a day
   * stale. Static data and per-minute data need different homes.
   */
  app.get("/market", (_req, res) => {
    res.set("cache-control", "public, max-age=30, stale-while-revalidate=120");
    res.json({ ok: true, ...marketSnapshot() });
  });

  /**
   * Points for the price line for one token over one range.
   * GET /market/history?token=0x…&range=1D|1W|1M|1Y
   */
  app.get("/market/history", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const range = typeof req.query.range === "string" ? req.query.range : "1D";

    // "native" is the sentinel for ETN itself — it has no contract address, so
    // it can't pass an isAddress() check, but it does have a price line.
    if (token !== "native" && !ethers.isAddress(token)) {
      return res.status(400).json({ ok: false, error: 'Invalid token address (or "native" for ETN)' });
    }
    if (!(RANGE_KEYS as string[]).includes(range)) {
      return res.status(400).json({ ok: false, error: `range must be one of ${RANGE_KEYS.join(", ")}` });
    }

    const series = priceSeries(token, range as Range);
    if (!series) {
      // No canonical pool means no reliable price for this token — the app
      // shows "—" rather than a chart. A 404 here is a real answer, not a bug.
      return res.status(404).json({ ok: false, error: "No priced pool for this token" });
    }

    res.set("cache-control", "public, max-age=60, stale-while-revalidate=300");
    res.json({ ok: true, ...series });
  });

  /** Ops visibility: which pool each token resolved to, and API budget used. */
  app.get("/market/status", (_req, res) => {
    res.json({ ok: true, ...marketStatus() });
  });

  app.post("/unregister", (req, res) => {
    const { address, pushToken } = req.body ?? {};
    if (typeof pushToken !== "string") {
      return res.status(400).json({ ok: false, error: "Missing pushToken" });
    }
    removeRegistration(pushToken, typeof address === "string" ? address : undefined);
    console.log(`[server] unregistered a push token${address ? ` for ${address}` : ""}`);
    res.json({ ok: true });
  });

  return app;
}
