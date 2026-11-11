import type { NextApiRequest, NextApiResponse } from "next";
import { allowRate } from "../../../lib/limits";
import { clientIp, ctxFor, getSession } from "../../../lib/agent/http";
import { getCatalog } from "../../../lib/agent/matches";
import { executeStep, getPlan } from "../../../lib/agent/executor";
import { getDb } from "../../../lib/agent/store";

// POST { planId, step, token? } -> runs one step of a stored, validated plan.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = getSession(req, res);
  if (!allowRate(`exec:${clientIp(req)}`, 60, 60_000)) return res.status(429).json({ error: "Too many steps a minute. Wait a moment." });
  const planId = String(req.body?.planId ?? "");
  const step = Number(req.body?.step);
  if (!/^[a-f0-9]{24}$/.test(planId) || !Number.isInteger(step)) return res.status(400).json({ error: "bad plan or step" });
  const p = getPlan(getDb(), session, planId);
  if (!p) return res.status(404).json({ error: "unknown plan" });
  const catalog = await getCatalog(p.demo);
  const token = typeof req.body?.token === "string" ? req.body.token : undefined;
  res.status(200).json(await executeStep(ctxFor(session, catalog), planId, step, token));
}
