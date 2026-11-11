// The tool registry: the whitelist of everything Trivela Agent can do.
// The LLM can only name a tool and its arguments; this file decides what that
// means. There is no eval, no shell and no free-form file access anywhere.
//
//   API calls   get_prediction, get_market_prices, compare_model_vs_market, list_matches
//   Database    add_to_watchlist, list_watchlist, remove_from_watchlist*,
//               log_pick, list_picks, clear_picks*
//   Files       export_report (written to the sandboxed exports folder only)
//   System      run_simulation (a capped, read-only re-simulation of the model's own goal rates)
//   (* destructive: needs a confirmation token from a Confirm click)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Db } from "./store";
import { nowIso } from "./store";
import { compare, label, loadMatch, market, prediction, type Catalog, type MatchRef } from "./matches";

export type ArgSpec =
  | { type: "match"; desc: string }
  | { type: "int"; min: number; max: number; default?: number; desc: string }
  | { type: "number"; min: number; max: number; default?: number; desc: string }
  | { type: "enum"; values: string[]; default?: string; desc: string };

export type ToolResult = {
  title: string;
  text?: string;
  table?: { columns: string[]; rows: (string | number)[][] };
  download?: { url: string; name: string };
};

export type Ctx = { db: Db; session: string; catalog: Catalog; exportsDir: string; fetcher?: typeof fetch };

export type Tool = {
  name: string;
  domain: "api" | "database" | "files" | "system";
  description: string;
  args: Record<string, ArgSpec>;
  destructive: boolean;
  run: (args: any, ctx: Ctx) => Promise<ToolResult>;
};

// Per-session caps so a public demo cannot fill the disk.
export const CAPS = { watchlist: 20, picks: 50, exports: 20 };

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);
const cents = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${Math.round(x * 100)}¢`);
const ref = (ctx: Ctx, key: string): MatchRef => {
  const m = ctx.catalog.find((c) => c.key === key);
  if (!m) throw new Error(`match ${key} is not in the catalog`);
  return m;
};
const count = (ctx: Ctx, table: string) =>
  Number((ctx.db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE session = ?`).get(ctx.session) as any).c);

async function predictionOf(ctx: Ctx, key: string) {
  const d = await loadMatch(key, ctx.fetcher);
  const p = prediction(d);
  if (!p) throw new Error(`Trivela has no model prediction for ${label(ref(ctx, key))} yet`);
  return { d, p };
}

// Seeded generator, so a re-run with the same inputs gives the same answer.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda: number, r: () => number) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}

const TOOL_LIST: Tool[] = [
  {
    name: "list_matches", domain: "api", destructive: false,
    description: "List the matches the agent can work with (upcoming Trivela fixtures, plus saved demo matches).",
    args: {},
    async run(_a, ctx) {
      return {
        title: `${ctx.catalog.length} matches available`,
        table: { columns: ["Match key", "Match", "League", "Kickoff (UTC)"], rows: ctx.catalog.map((m) => [m.key, label(m), m.league.toUpperCase(), m.kickoff.slice(0, 16).replace("T", " ")]) },
      };
    },
  },
  {
    name: "get_prediction", domain: "api", destructive: false,
    description: "Trivela's model prediction for one match: win/draw/loss probabilities, expected goals and likeliest scores.",
    args: { match: { type: "match", desc: "match key from the catalog" } },
    async run(a, ctx) {
      const { p } = await predictionOf(ctx, a.match);
      return {
        title: `Prediction · ${p.home} vs ${p.away}`,
        text: `Trivela model ${p.version}${p.nSims ? `, ${p.nSims.toLocaleString("en-US")} simulations` : ""}. Expected goals ${p.xgHome?.toFixed(2) ?? "n/a"} – ${p.xgAway?.toFixed(2) ?? "n/a"}.`,
        table: {
          columns: ["Outcome", "Probability"],
          rows: [[`${p.home} win`, pct(p.pHome)], ["Draw", pct(p.pDraw)], [`${p.away} win`, pct(p.pAway)],
            ...p.scorelines.slice(0, 3).map((s) => [`Exact score ${s.score}`, pct(s.prob)])],
        },
      };
    },
  },
  {
    name: "get_market_prices", domain: "api", destructive: false,
    description: "The prediction market's current 3-way prices for one match (what the crowd thinks).",
    args: { match: { type: "match", desc: "match key from the catalog" } },
    async run(a, ctx) {
      const d = await loadMatch(a.match, ctx.fetcher);
      const m = market(d);
      if (!m) throw new Error(`no market prices are listed for ${label(ref(ctx, a.match))}`);
      const r = ref(ctx, a.match);
      return {
        title: `Market prices · ${label(r)}`,
        text: `Source: ${m.source}. A price of 60¢ means the market puts it near 60%.`,
        table: { columns: ["Outcome", "Price"], rows: [[`${r.home} win`, cents(m.home)], ["Draw", cents(m.draw)], [`${r.away} win`, cents(m.away)]] },
      };
    },
  },
  {
    name: "compare_model_vs_market", domain: "api", destructive: false,
    description: "Compare Trivela's model with the market for one match, outcome by outcome, with the gap in percentage points.",
    args: { match: { type: "match", desc: "match key from the catalog" } },
    async run(a, ctx) {
      const { d, p } = await predictionOf(ctx, a.match);
      const m = market(d);
      const c = m && compare(p, m);
      if (!c) throw new Error(`no complete market prices to compare for ${p.home} vs ${p.away}`);
      const big = [...c].sort((x, y) => Math.abs(y.gapPts) - Math.abs(x.gapPts))[0];
      return {
        title: `Model vs market · ${p.home} vs ${p.away}`,
        text: `Biggest disagreement: ${big.outcome}, model ${pct(big.model)} vs market ${pct(big.marketFair)} (${big.gapPts > 0 ? "+" : ""}${big.gapPts} pts). Market prices have the overround removed.`,
        table: { columns: ["Outcome", "Model", "Market (fair)", "Gap (pts)"], rows: c.map((r) => [r.outcome, pct(r.model), pct(r.marketFair), r.gapPts]) },
      };
    },
  },
  {
    name: "add_to_watchlist", domain: "database", destructive: false,
    description: "Track a match: flag it when model and market disagree by more than threshold_pts percentage points.",
    args: {
      match: { type: "match", desc: "match key from the catalog" },
      threshold_pts: { type: "number", min: 1, max: 50, default: 5, desc: "gap in percentage points that should flag the match (1-50)" },
    },
    async run(a, ctx) {
      if (count(ctx, "watchlist") >= CAPS.watchlist) throw new Error(`the watchlist is full (${CAPS.watchlist} matches); remove one first`);
      const r = ref(ctx, a.match);
      const res = ctx.db.prepare("INSERT INTO watchlist (session, match_key, label, threshold_pts, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(ctx.session, r.key, label(r), a.threshold_pts, nowIso());
      return { title: "Added to watchlist", text: `#${res.lastInsertRowid}: ${label(r)}, flagged when the gap is over ${a.threshold_pts} pts.` };
    },
  },
  {
    name: "list_watchlist", domain: "database", destructive: false,
    description: "Show the watchlist, with each match's current biggest model-vs-market gap and whether it is flagged.",
    args: {},
    async run(_a, ctx) {
      const rows = ctx.db.prepare("SELECT id, match_key, label, threshold_pts FROM watchlist WHERE session = ? ORDER BY id").all(ctx.session) as any[];
      const out: (string | number)[][] = [];
      for (const w of rows) {
        let gap = "n/a", flag = "–";
        try {
          const d = await loadMatch(w.match_key, ctx.fetcher);
          const p = prediction(d), m = market(d), c = p && m && compare(p, m);
          if (c) {
            const g = Math.max(...c.map((x) => Math.abs(x.gapPts)));
            gap = `${g} pts`; flag = g > w.threshold_pts ? "FLAGGED" : "quiet";
          }
        } catch { gap = "unavailable"; }
        out.push([w.id, w.label, `${w.threshold_pts} pts`, gap, flag]);
      }
      return { title: `Watchlist · ${rows.length} match${rows.length === 1 ? "" : "es"}`, table: { columns: ["#", "Match", "Threshold", "Biggest gap now", "Status"], rows: out } };
    },
  },
  {
    name: "remove_from_watchlist", domain: "database", destructive: true,
    description: "Remove one watchlist entry by its # id. Destructive: the user must confirm.",
    args: { id: { type: "int", min: 1, max: 1_000_000_000, desc: "watchlist entry # (from list_watchlist)" } },
    async run(a, ctx) {
      const res = ctx.db.prepare("DELETE FROM watchlist WHERE id = ? AND session = ?").run(a.id, ctx.session);
      if (Number(res.changes) === 0) throw new Error(`there is no watchlist entry #${a.id}`);
      return { title: "Removed from watchlist", text: `Entry #${a.id} removed.` };
    },
  },
  {
    name: "log_pick", domain: "database", destructive: false,
    description: "Record your own prediction for a match (home, draw or away, with a confidence), next to the model's probability for it.",
    args: {
      match: { type: "match", desc: "match key from the catalog" },
      outcome: { type: "enum", values: ["home", "draw", "away"], desc: "the result you predict" },
      confidence: { type: "enum", values: ["low", "medium", "high"], default: "medium", desc: "how sure you are" },
    },
    async run(a, ctx) {
      if (count(ctx, "picks") >= CAPS.picks) throw new Error(`the prediction journal is full (${CAPS.picks}); clear it first`);
      const r = ref(ctx, a.match);
      let modelProb: number | null = null;
      try {
        const p = prediction(await loadMatch(a.match, ctx.fetcher));
        if (p) modelProb = a.outcome === "home" ? p.pHome : a.outcome === "draw" ? p.pDraw : p.pAway;
      } catch { /* the pick is still recorded without the model's number */ }
      const res = ctx.db.prepare("INSERT INTO picks (session, match_key, label, outcome, confidence, model_prob, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(ctx.session, r.key, label(r), a.outcome, a.confidence, modelProb, nowIso());
      return { title: "Pick recorded", text: `#${res.lastInsertRowid}: ${label(r)}, ${a.outcome} (${a.confidence} confidence). The model gives that outcome ${pct(modelProb)}.` };
    },
  },
  {
    name: "list_picks", domain: "database", destructive: false,
    description: "Show your prediction journal.",
    args: {},
    async run(_a, ctx) {
      const rows = ctx.db.prepare("SELECT id, label, outcome, confidence, model_prob, created_at FROM picks WHERE session = ? ORDER BY id").all(ctx.session) as any[];
      return {
        title: `Prediction journal · ${rows.length} pick${rows.length === 1 ? "" : "s"}`,
        table: { columns: ["#", "Match", "Your pick", "Confidence", "Model's probability", "Logged (UTC)"], rows: rows.map((r) => [r.id, r.label, r.outcome, r.confidence, pct(r.model_prob), String(r.created_at).slice(0, 16).replace("T", " ")]) },
      };
    },
  },
  {
    name: "clear_picks", domain: "database", destructive: true,
    description: "Delete every pick in your prediction journal. Destructive: the user must confirm.",
    args: {},
    async run(_a, ctx) {
      const res = ctx.db.prepare("DELETE FROM picks WHERE session = ?").run(ctx.session);
      return { title: "Prediction journal cleared", text: `${res.changes} pick(s) deleted.` };
    },
  },
  {
    name: "export_report", domain: "files", destructive: false,
    description: "Write a report for one match (prediction, market and comparison) as a Markdown or CSV file, and give a download link.",
    args: {
      match: { type: "match", desc: "match key from the catalog" },
      format: { type: "enum", values: ["md", "csv"], default: "md", desc: "file format" },
    },
    async run(a, ctx) {
      if (count(ctx, "exports") >= CAPS.exports) throw new Error(`this session already has ${CAPS.exports} exports`);
      const { d, p } = await predictionOf(ctx, a.match);
      const m = market(d), c = m && compare(p, m);
      const r = ref(ctx, a.match);
      let body: string;
      if (a.format === "csv") {
        const rows: (string | number)[][] = [["section", "item", "value"],
          ["prediction", `${p.home} win`, p.pHome], ["prediction", "Draw", p.pDraw], ["prediction", `${p.away} win`, p.pAway],
          ["prediction", `${p.home} expected goals`, p.xgHome ?? ""], ["prediction", `${p.away} expected goals`, p.xgAway ?? ""],
          ...(c ?? []).flatMap((x) => [["market_fair", x.outcome, Number(x.marketFair.toFixed(4))], ["gap_pts", x.outcome, x.gapPts]])];
        body = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
      } else {
        body = [`# ${p.home} vs ${p.away}`, "", `${r.league.toUpperCase()} · kickoff ${r.kickoff} · report written ${nowIso()} by Trivela Agent`, "",
          "## Trivela model", "", "| Outcome | Probability |", "|---|---|",
          `| ${p.home} win | ${pct(p.pHome)} |`, `| Draw | ${pct(p.pDraw)} |`, `| ${p.away} win | ${pct(p.pAway)} |`, "",
          `Expected goals: ${p.xgHome?.toFixed(2) ?? "n/a"} – ${p.xgAway?.toFixed(2) ?? "n/a"} (model ${p.version}).`, "",
          "## Model vs market", "",
          ...(c ? ["| Outcome | Model | Market (fair) | Gap (pts) |", "|---|---|---|---|", ...c.map((x) => `| ${x.outcome} | ${pct(x.model)} | ${pct(x.marketFair)} | ${x.gapPts} |`)]
            : ["No complete market prices for this match."]),
          "", "_Match prediction and analysis only._", ""].join("\n");
      }
      const slug = `${r.home}-${r.away}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      const name = `${slug}-${crypto.randomBytes(5).toString("hex")}.${a.format}`;
      const file = path.join(ctx.exportsDir, name);
      if (path.dirname(path.resolve(file)) !== path.resolve(ctx.exportsDir)) throw new Error("refused: export path left the exports folder");
      fs.mkdirSync(ctx.exportsDir, { recursive: true });
      fs.writeFileSync(file, body, { flag: "wx" });
      ctx.db.prepare("INSERT INTO exports (name, session, match_key, created_at) VALUES (?, ?, ?, ?)").run(name, ctx.session, r.key, nowIso());
      return { title: `Report ready · ${label(r)}`, text: `${a.format.toUpperCase()} report written.`, download: { url: `/api/agent/export/${name}`, name } };
    },
  },
  {
    name: "run_simulation", domain: "system", destructive: false,
    description: "Re-run a Monte Carlo simulation of one match from the model's own expected goals (Poisson), with n_sims between 1,000 and 50,000, and compare it with the published prediction.",
    args: {
      match: { type: "match", desc: "match key from the catalog" },
      n_sims: { type: "int", min: 1000, max: 50000, default: 10000, desc: "number of simulated matches (1,000-50,000)" },
    },
    async run(a, ctx) {
      const { p } = await predictionOf(ctx, a.match);
      if (p.xgHome === null || p.xgAway === null) throw new Error("the model published no expected goals for this match");
      const seed = [...a.match].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
      const r = rng(seed);
      let hw = 0, dr = 0, aw = 0;
      const scores = new Map<string, number>();
      for (let i = 0; i < a.n_sims; i++) {
        const h = poisson(p.xgHome, r), g = poisson(p.xgAway, r);
        if (h > g) hw++; else if (h === g) dr++; else aw++;
        const k = `${h}-${g}`; scores.set(k, (scores.get(k) ?? 0) + 1);
      }
      const top = [...scores.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
      return {
        title: `Simulation · ${p.home} vs ${p.away} · ${a.n_sims.toLocaleString("en-US")} runs`,
        text: `Independent Poisson goals from the model's expected goals (${p.xgHome.toFixed(2)} – ${p.xgAway.toFixed(2)}). The published model also adjusts for draws and more, so small differences are expected. Read-only: the model itself is unchanged.`,
        table: {
          columns: ["Outcome", "This simulation", "Published model"],
          rows: [[`${p.home} win`, pct(hw / a.n_sims), pct(p.pHome)], ["Draw", pct(dr / a.n_sims), pct(p.pDraw)], [`${p.away} win`, pct(aw / a.n_sims), pct(p.pAway)],
            ...top.map(([s, c]) => [`Score ${s}`, pct(c / a.n_sims), "–"])],
        },
      };
    },
  },
];

export const TOOLS: Record<string, Tool> = Object.fromEntries(TOOL_LIST.map((t) => [t.name, t]));

// The registry as the planner sees it, injected into the system prompt.
export function toolsForPrompt(): string {
  return TOOL_LIST.map((t) => {
    const args = Object.entries(t.args).map(([k, s]) => {
      const range = s.type === "int" || s.type === "number" ? ` ${s.min}-${s.max}` : s.type === "enum" ? ` one of ${s.values.join("|")}` : "";
      const def = "default" in s && s.default !== undefined ? `, default ${s.default}` : "";
      return `    ${k}: ${s.type}${range}${def} (${s.desc})`;
    });
    return [`- ${t.name}${t.destructive ? " [DESTRUCTIVE: needs user confirmation]" : ""}: ${t.description}`, ...(args.length ? args : ["    (no arguments)"])].join("\n");
  }).join("\n");
}
