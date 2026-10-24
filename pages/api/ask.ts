import type { NextApiRequest, NextApiResponse } from "next";
import { loadSheet, runAsk } from "../../lib/analyst";
import { allowAsk, takeDailyCall } from "../../lib/limits";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { league = "", id = "", demo, question = "" } = req.body ?? {};
  const q = String(question).trim();
  if (!q) return res.status(400).json({ error: "Type a question first." });
  if (q.length > 300) return res.status(400).json({ error: "Keep questions under 300 characters." });
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
  if (!allowAsk(ip)) return res.status(429).json({ error: "You've asked a lot this hour. Try again later." });
  if (!takeDailyCall()) return res.status(429).json({ error: "Today's analyst budget is used up." });
  let sheet;
  try { sheet = await loadSheet(String(league), String(id), demo ? String(demo) : undefined); }
  catch (e: any) { return res.status(400).json({ error: `Could not load this match from Trivela: ${e.message}` }); }
  res.status(200).json(await runAsk(sheet, q));
}
