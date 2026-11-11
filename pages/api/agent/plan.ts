import type { NextApiRequest, NextApiResponse } from "next";
import { allowRate, takeDailyCall } from "../../../lib/limits";
import { clientIp, getSession } from "../../../lib/agent/http";
import { getCatalog } from "../../../lib/agent/matches";
import { planRequest } from "../../../lib/agent/planner";
import { savePlan } from "../../../lib/agent/executor";
import { audit } from "../../../lib/agent/audit";
import { getDb } from "../../../lib/agent/store";

// POST { request, demo } -> a validated plan (nothing runs yet), a question, or errors.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = getSession(req, res);
  const request = String(req.body?.request ?? "").trim();
  const demo = !!req.body?.demo;
  if (!request) return res.status(400).json({ error: "Type a request first." });
  if (request.length > 400) return res.status(400).json({ error: "Keep requests under 400 characters." });
  const perMin = Number(process.env.AGENT_PLANS_PER_MIN ?? 10);
  if (!allowRate(`plan:${clientIp(req)}`, perMin, 60_000)) return res.status(429).json({ error: `Limit reached: ${perMin} requests a minute. Wait a moment and try again.` });
  if (!takeDailyCall()) return res.status(429).json({ error: "Today's agent budget is used up. Try again tomorrow, or use demo mode." });

  const db = getDb();
  const catalog = await getCatalog(demo);
  const out = await planRequest(request, catalog);
  const r = out.result;
  const meta = { provider: out.provider, model: out.model, trace: out.trace, system: out.system };
  if (!r.ok) {
    audit(db, { session, request, tool: "plan", status: out.llmError ? "llm_error" : "invalid", error: r.errors.join("; ") });
    return res.status(200).json({ ok: false, errors: r.errors, ...meta });
  }
  if (r.kind === "question") {
    audit(db, { session, request, tool: "plan", status: "clarify" });
    return res.status(200).json({ ok: true, kind: "question", question: r.question, summary: r.summary, ...meta });
  }
  const planId = savePlan(db, session, request, r.plan, demo);
  audit(db, { session, request, planId, tool: "plan", args: { steps: r.plan.steps.map((s) => s.tool) }, status: "planned" });
  res.status(200).json({ ok: true, kind: "plan", planId, plan: r.plan, ...meta });
}
