import type { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/agent/http";
import { issueConfirmToken } from "../../../lib/agent/executor";
import { getDb } from "../../../lib/agent/store";

// POST { planId, step } -> a single-use token for that one destructive step (5 minutes).
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = getSession(req, res);
  const out = issueConfirmToken(getDb(), session, String(req.body?.planId ?? ""), Number(req.body?.step));
  res.status(out.token ? 200 : 400).json(out);
}
