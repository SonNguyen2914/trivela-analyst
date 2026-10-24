import type { NextApiRequest, NextApiResponse } from "next";
import { loadSheet, runPreview, type PreviewOut } from "../../lib/analyst";
import { takeDailyCall } from "../../lib/limits";

// One LLM call per match per 15 minutes, shared by every visitor.
const cache = new Map<string, { at: number; out: PreviewOut }>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const league = String(req.query.league ?? "");
  const id = String(req.query.id ?? "");
  const demo = req.query.demo ? String(req.query.demo) : undefined;
  const key = demo ? `demo:${demo}` : `${league}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 900_000) return res.status(200).json({ ...hit.out, cached: true });
  let sheet;
  try { sheet = await loadSheet(league, id, demo); }
  catch (e: any) { return res.status(400).json({ error: `Could not load this match from Trivela: ${e.message}` }); }
  if (!takeDailyCall()) return res.status(200).json({ ok: false, sheet, trace: [], provider: "", model: "", system: "", fallbackReason: "today's analyst budget is used up" });
  const out = await runPreview(sheet);
  if (out.ok) cache.set(key, { at: Date.now(), out });
  res.status(200).json(out);
}
