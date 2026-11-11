// SQLite storage for Trivela Agent (Node's built-in node:sqlite, no extra
// dependency). Every row is scoped to an anonymous session id, so one visitor
// can never read or change another visitor's watchlist, picks or exports.
// The audit log is append-only: triggers in the database refuse UPDATE and
// DELETE, so not even a bug in this code can rewrite history.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, session TEXT NOT NULL, request TEXT NOT NULL,
  plan_json TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS step_runs (
  plan_id TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL,
  result_json TEXT, error TEXT, at TEXT NOT NULL, PRIMARY KEY (plan_id, step)
);
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, match_key TEXT NOT NULL,
  label TEXT NOT NULL, threshold_pts REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, match_key TEXT NOT NULL,
  label TEXT NOT NULL, outcome TEXT NOT NULL, confidence TEXT NOT NULL,
  model_prob REAL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exports (
  name TEXT PRIMARY KEY, session TEXT NOT NULL, match_key TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS confirm_tokens (
  token TEXT PRIMARY KEY, session TEXT NOT NULL, plan_id TEXT NOT NULL, step INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, session TEXT NOT NULL,
  request TEXT, plan_id TEXT, step INTEGER, tool TEXT NOT NULL, args_json TEXT,
  status TEXT NOT NULL, error TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
`;

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

let shared: Db | null = null;
export function getDb(): Db {
  if (!shared) shared = openDb(process.env.AGENT_DB ?? path.join(process.cwd(), "var", "agent.db"));
  return shared;
}

export const nowIso = () => new Date().toISOString();
