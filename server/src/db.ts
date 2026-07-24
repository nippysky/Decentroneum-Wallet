import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    push_token TEXT NOT NULL,
    platform TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(address, push_token)
  );

  CREATE INDEX IF NOT EXISTS idx_registrations_address ON registrations (address);
  CREATE INDEX IF NOT EXISTS idx_registrations_push_token ON registrations (push_token);

  CREATE TABLE IF NOT EXISTS cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_block INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sent_events (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL DEFAULT -1,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tx_hash, log_index, address)
  );
`);

export function getLastProcessedBlock(defaultBlock: number): number {
  const row = db.prepare("SELECT last_block FROM cursor WHERE id = 1").get() as { last_block: number } | undefined;
  return row?.last_block ?? defaultBlock;
}

export function setLastProcessedBlock(blockNumber: number): void {
  db.prepare(
    `INSERT INTO cursor (id, last_block) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET last_block = excluded.last_block`
  ).run(blockNumber);
}

export function addRegistration(address: string, pushToken: string, platform?: string): void {
  db.prepare(
    `INSERT INTO registrations (address, push_token, platform) VALUES (?, ?, ?)
     ON CONFLICT(address, push_token) DO NOTHING`
  ).run(address.toLowerCase(), pushToken, platform ?? null);
}

export function removeRegistration(pushToken: string, address?: string): void {
  if (address) {
    db.prepare("DELETE FROM registrations WHERE push_token = ? AND address = ?").run(pushToken, address.toLowerCase());
  } else {
    db.prepare("DELETE FROM registrations WHERE push_token = ?").run(pushToken);
  }
}

export function getPushTokensForAddress(address: string): string[] {
  const rows = db.prepare("SELECT push_token FROM registrations WHERE address = ?").all(address.toLowerCase()) as {
    push_token: string;
  }[];
  return rows.map((r) => r.push_token);
}

export function wasAlreadySent(txHash: string, address: string, logIndex = -1): boolean {
  const row = db
    .prepare("SELECT 1 FROM sent_events WHERE tx_hash = ? AND log_index = ? AND address = ?")
    .get(txHash, logIndex, address.toLowerCase());
  return !!row;
}

export function markSent(txHash: string, address: string, logIndex = -1): void {
  db.prepare(
    `INSERT INTO sent_events (tx_hash, log_index, address) VALUES (?, ?, ?)
     ON CONFLICT(tx_hash, log_index, address) DO NOTHING`
  ).run(txHash, logIndex, address.toLowerCase());
}
