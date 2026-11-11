// The executor: runs a stored, already-validated plan one step at a time.
// - Only plans that passed the validator are ever stored, so only those run.
// - Steps run in order; a step whose depends_on step did not finish "done" is
//   skipped and says which step failed.
// - A destructive step runs only with a single-use confirmation token, issued
//   when the person clicks Confirm on that exact step of that exact plan.
// - Every outcome, including refusals, is written to the audit log.

import crypto from "node:crypto";
import { audit } from "./audit";
import { nowIso, type Db } from "./store";
import { TOOLS, type Ctx, type ToolResult } from "./tools";
import type { Plan } from "./validator";

export const PLAN_TTL_MS = 30 * 60_000;
export const TOKEN_TTL_MS = 5 * 60_000;

export type StoredPlan = { id: string; session: string; request: string; plan: Plan; demo: boolean; createdAt: string };
export type StepOutcome = { step: number; status: "done" | "failed" | "skipped" | "refused"; result?: ToolResult; error?: string };

export function savePlan(db: Db, session: string, request: string, plan: Plan, demo: boolean): string {
  const id = crypto.randomBytes(12).toString("hex");
  db.prepare("INSERT INTO plans (id, session, request, plan_json, demo, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, session, request, JSON.stringify(plan), demo ? 1 : 0, nowIso());
  return id;
}

export function getPlan(db: Db, session: string, id: string): StoredPlan | null {
  const r = db.prepare("SELECT id, session, request, plan_json, demo, created_at FROM plans WHERE id = ? AND session = ?").get(String(id), session) as any;
  if (!r) return null;
  return { id: r.id, session: r.session, request: r.request, plan: JSON.parse(r.plan_json), demo: !!r.demo, createdAt: r.created_at };
}

const runs = (db: Db, planId: string) =>
  new Map((db.prepare("SELECT step, status FROM step_runs WHERE plan_id = ?").all(planId) as any[]).map((r) => [Number(r.step), String(r.status)]));

export function issueConfirmToken(db: Db, session: string, planId: string, step: number, now = Date.now()): { token?: string; error?: string } {
  const p = getPlan(db, session, planId);
  if (!p) return { error: "unknown plan" };
  const s = p.plan.steps[step - 1];
  if (!s) return { error: "unknown step" };
  if (!s.destructive) return { error: "this step does not need confirmation" };
  const token = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO confirm_tokens (token, session, plan_id, step, expires_at) VALUES (?, ?, ?, ?, ?)").run(token, session, planId, step, now + TOKEN_TTL_MS);
  audit(db, { session, request: p.request, planId, step, tool: s.tool, args: s.args, status: "confirmed" });
  return { token };
}

function useToken(db: Db, session: string, planId: string, step: number, token: string | undefined, now: number): boolean {
  if (!token || typeof token !== "string") return false;
  const r = db.prepare("SELECT session, plan_id, step, expires_at, used FROM confirm_tokens WHERE token = ?").get(token) as any;
  if (!r || r.used || r.session !== session || r.plan_id !== planId || Number(r.step) !== step || Number(r.expires_at) < now) return false;
  db.prepare("UPDATE confirm_tokens SET used = 1 WHERE token = ?").run(token);
  return true;
}

export async function executeStep(ctx: Ctx, planId: string, step: number, token?: string, now = Date.now()): Promise<StepOutcome> {
  const { db, session } = ctx;
  const p = getPlan(db, session, planId);
  if (!p) return { step, status: "refused", error: "unknown plan" };
  const s = p.plan.steps[step - 1];
  if (!s) return { step, status: "refused", error: "unknown step" };
  const base = { session, request: p.request, planId, step, tool: s.tool, args: s.args };
  const refuse = (error: string): StepOutcome => { audit(db, { ...base, status: "refused", error }); return { step, status: "refused", error }; };

  if (now - Date.parse(p.createdAt) > PLAN_TTL_MS) return refuse("this plan has expired; ask again");
  const done = runs(db, planId);
  if (done.has(step)) return refuse("this step already ran");
  for (let i = 1; i < step; i++) if (!done.has(i)) return refuse(`step ${i} has not run yet; steps run in order`);

  const record = (o: StepOutcome) => {
    db.prepare("INSERT INTO step_runs (plan_id, step, status, result_json, error, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(planId, step, o.status, o.result ? JSON.stringify(o.result) : null, o.error ?? null, nowIso());
    audit(db, { ...base, status: o.status, error: o.error });
    return o;
  };

  const failedDep = s.depends_on.find((d) => done.get(d) !== "done");
  if (failedDep) return record({ step, status: "skipped", error: `skipped because step ${failedDep} did not finish` });

  if (s.destructive && !useToken(db, session, planId, step, token, now)) {
    return refuse("this step deletes data and needs your confirmation (click Confirm)");
  }

  const tool = TOOLS[s.tool];
  if (!tool) return record({ step, status: "failed", error: "tool is not in the registry" });
  try {
    const result = await tool.run(s.args, ctx);
    return record({ step, status: "done", result });
  } catch (e: any) {
    return record({ step, status: "failed", error: String(e?.message ?? e).slice(0, 200) });
  }
}
