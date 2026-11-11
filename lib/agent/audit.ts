// The audit log: one row for every plan, confirmation and step the agent
// handles, including the ones it refused. Insert and read only.

import { nowIso, type Db } from "./store";

export type AuditEntry = {
  session: string;
  request?: string | null;
  planId?: string | null;
  step?: number | null;
  tool: string;
  args?: unknown;
  status: string; // planned | invalid | clarify | confirmed | done | failed | refused | skipped | llm_error
  error?: string | null;
};

export function audit(db: Db, e: AuditEntry): void {
  db.prepare(
    "INSERT INTO audit_log (at, session, request, plan_id, step, tool, args_json, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    nowIso(), e.session, e.request ?? null, e.planId ?? null, e.step ?? null, e.tool,
    e.args === undefined ? null : JSON.stringify(e.args), e.status, e.error ? e.error.slice(0, 300) : null,
  );
}

export type AuditRow = {
  id: number; at: string; request: string | null; plan_id: string | null; step: number | null;
  tool: string; args_json: string | null; status: string; error: string | null;
};

export function readAudit(db: Db, session: string, limit = 100): AuditRow[] {
  return db.prepare(
    "SELECT id, at, request, plan_id, step, tool, args_json, status, error FROM audit_log WHERE session = ? ORDER BY id DESC LIMIT ?",
  ).all(session, limit) as unknown as AuditRow[];
}
