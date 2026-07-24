import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import { config } from "./config";
import { addRegistration, removeRegistration } from "./db";
import { verifyRegistrationProof } from "./verify";

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "decent-wallet-push-server" });
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
    res.json({ ok: true });
  });

  app.post("/unregister", (req, res) => {
    const { address, pushToken } = req.body ?? {};
    if (typeof pushToken !== "string") {
      return res.status(400).json({ ok: false, error: "Missing pushToken" });
    }
    removeRegistration(pushToken, typeof address === "string" ? address : undefined);
    res.json({ ok: true });
  });

  return app;
}
