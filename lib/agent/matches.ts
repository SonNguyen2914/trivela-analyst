// The matches the agent may act on, and read-only access to their data.
// A match key is "demo:<slug>" (a saved snapshot) or "<league>:<event id>"
// (a live Trivela fixture). The planner is only ever shown keys from this
// catalog, and the validator refuses any key that is not in it.

import fs from "node:fs";
import path from "node:path";
import { LEAGUES } from "../analyst";

const TRIVELA = process.env.TRIVELA_API ?? "https://wc26-bet-suggester-production.up.railway.app";

export type MatchRef = { key: string; league: string; home: string; away: string; kickoff: string; demo: boolean };
export type Catalog = MatchRef[];

const DEMO_DIR = () => path.join(process.cwd(), "data", "demo");

export function demoCatalog(): Catalog {
  return fs.readdirSync(DEMO_DIR()).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(DEMO_DIR(), f), "utf8"));
    return { key: `demo:${f.replace(/\.json$/, "")}`, league: d._demo.league, home: d.match.home.name, away: d.match.away.name, kickoff: d.match.date, demo: true };
  });
}

let liveCache: { at: number; cat: Catalog } | null = null;
export async function liveCatalog(fetcher: typeof fetch = fetch): Promise<Catalog> {
  if (liveCache && Date.now() - liveCache.at < 300_000) return liveCache.cat;
  const out: Catalog = [];
  await Promise.all(LEAGUES.map(async (lg) => {
    try {
      const r = await fetcher(`${TRIVELA}/api/${lg}/schedule`, { signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      const rows: any[] = Array.isArray(d) ? d : (Object.values(d).find(Array.isArray) as any[]) ?? [];
      for (const x of rows.filter((x) => x.state === "pre").slice(0, 6)) {
        if (/^\d{1,12}$/.test(String(x.id))) out.push({ key: `${lg}:${x.id}`, league: lg, home: x.home?.name ?? "?", away: x.away?.name ?? "?", kickoff: x.date ?? "", demo: false });
      }
    } catch { /* a league that does not answer simply has no fixtures */ }
  }));
  out.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  liveCache = { at: Date.now(), cat: out };
  return out;
}

// Demo mode shows only the saved snapshots, so a demo never depends on a live game.
export async function getCatalog(demo: boolean): Promise<Catalog> {
  return demo ? demoCatalog() : [...(await liveCatalog()), ...demoCatalog()];
}

export const label = (m: MatchRef) => `${m.home} vs ${m.away}`;

const dataCache = new Map<string, { at: number; d: any }>();
export async function loadMatch(key: string, fetcher: typeof fetch = fetch): Promise<any> {
  if (key.startsWith("demo:")) {
    const slug = key.slice(5);
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("bad demo key");
    return JSON.parse(fs.readFileSync(path.join(DEMO_DIR(), `${slug}.json`), "utf8"));
  }
  const [lg, id] = key.split(":");
  if (!(LEAGUES as readonly string[]).includes(lg) || !/^\d{1,12}$/.test(id ?? "")) throw new Error("bad match key");
  const hit = dataCache.get(key);
  if (hit && Date.now() - hit.at < 300_000) return hit.d;
  const r = await fetcher(`${TRIVELA}/api/${lg}/match/${id}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Trivela answered ${r.status} for this match`);
  const d = await r.json();
  dataCache.set(key, { at: Date.now(), d });
  return d;
}

// ---- Read-only views of one match payload. Nothing here changes the model.

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
};

export type Prediction = {
  home: string; away: string; pHome: number; pDraw: number; pAway: number;
  xgHome: number | null; xgAway: number | null; nSims: number | null; version: string;
  scorelines: { score: string; prob: number }[];
};

export function prediction(d: any): Prediction | null {
  const run = d?.model?.primary ?? d?.model?.latest;
  const o = run?.outcomes;
  if (!o || n(o.home_win) === null) return null;
  return {
    home: d.match?.home?.name ?? "Home", away: d.match?.away?.name ?? "Away",
    pHome: n(o.home_win)!, pDraw: n(o.draw)!, pAway: n(o.away_win)!,
    xgHome: n(run.xg?.home), xgAway: n(run.xg?.away), nSims: n(run.n_simulations),
    version: String(d.model?.model_version ?? ""),
    scorelines: (run.scorelines ?? []).slice(0, 5).map((s: any) => ({ score: String(s.score), prob: n(s.prob) ?? 0 })),
  };
}

export type Market = { home: number | null; draw: number | null; away: number | null; source: string };

// The 3-way winner market's asking prices (dollars, 0-1).
export function market(d: any): Market | null {
  const home = d?.match?.home?.name, away = d?.match?.away?.name;
  const mk: any[] = d?.book?.markets ?? [];
  if (!mk.length) return null;
  const find = (pred: (l: string) => boolean) => n(mk.find((m) => pred(String(m.label ?? "")))?.yes_ask);
  const out = {
    home: find((l) => l === home || (!!home && home.startsWith(l))),
    draw: find((l) => l === "Tie" || l === "Draw"),
    away: find((l) => l === away || (!!away && away.startsWith(l))),
    source: "prediction market, 3-way winner (ask prices)",
  };
  return out.home === null && out.draw === null && out.away === null ? null : out;
}

export type Comparison = { outcome: string; model: number; marketRaw: number; marketFair: number; gapPts: number }[];

// Model probability vs the market's price with the overround removed
// (the three asks scaled so they add up to 100%). Gap in percentage points.
export function compare(p: Prediction, m: Market): Comparison | null {
  if (m.home === null || m.draw === null || m.away === null) return null;
  const sum = m.home + m.draw + m.away;
  const row = (outcome: string, model: number, raw: number) =>
    ({ outcome, model, marketRaw: raw, marketFair: raw / sum, gapPts: Math.round((model - raw / sum) * 1000) / 10 });
  return [row(`${p.home} win`, p.pHome, m.home), row("Draw", p.pDraw, m.draw), row(`${p.away} win`, p.pAway, m.away)];
}
