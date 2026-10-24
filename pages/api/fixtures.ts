import type { NextApiRequest, NextApiResponse } from "next";
import { LEAGUES, demoList } from "../../lib/analyst";

const TRIVELA = process.env.TRIVELA_API ?? "https://wc26-bet-suggester-production.up.railway.app";
const cache = new Map<string, { at: number; body: any }>();

// Upcoming fixtures for the four leagues Trivela models, plus the demo set.
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const hit = cache.get("all");
  if (hit && Date.now() - hit.at < 300_000) return res.status(200).json(hit.body);
  const leagues: Record<string, any[]> = {};
  await Promise.all(LEAGUES.map(async (lg) => {
    try {
      const r = await fetch(`${TRIVELA}/api/${lg}/schedule`, { signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      const rows: any[] = Array.isArray(d) ? d : (Object.values(d).find(Array.isArray) as any[]) ?? [];
      leagues[lg] = rows.filter((x) => x.state === "pre").slice(0, 8)
        .map((x) => ({ id: x.id, date: x.date, home: x.home?.name, away: x.away?.name }));
    } catch { leagues[lg] = []; }
  }));
  const body = { leagues, demo: demoList() };
  cache.set("all", { at: Date.now(), body });
  res.status(200).json(body);
}
