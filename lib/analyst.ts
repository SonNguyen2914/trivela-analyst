// Orchestration: fact sheet -> prompt -> LLM -> verify -> one retry with the
// violations listed -> strip and flag anything still unverified. If the LLM
// fails, the caller gets the raw model numbers instead of a blank card.

import fs from "node:fs";
import path from "node:path";
import { buildFactSheet, sheetForPrompt, type FactSheet } from "./factSheet";
import { checkText, type Segment, type Violation } from "./verify";
import { getClient, type ChatMessage, type LlmClient } from "./llm";

const TRIVELA = process.env.TRIVELA_API ?? "https://wc26-bet-suggester-production.up.railway.app";
export const LEAGUES = ["epl", "laliga", "mls", "ligamx"] as const;
export type League = (typeof LEAGUES)[number];

function prompt(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), "prompts", name), "utf8");
}
export function systemPrompt(kind: "preview" | "ask", sheet: FactSheet): string {
  const parts = [prompt("1-persona.md"), prompt("2-verification-ladder.md")];
  if (kind === "preview") parts.push(prompt("3-template.md"), prompt("4-few-shot.md"));
  else parts.push(prompt("5-ask.md"));
  parts.push("FACT SHEET (Source A)\n" + sheetForPrompt(sheet));
  return parts.join("\n\n---\n\n");
}

const DEMO_FILES: Record<string, string> = {
  "arsenal-everton": "arsenal-everton.json",
  "montreal-nashville": "montreal-nashville.json",
  "rayo-elche": "rayo-elche.json",
};
export function demoList() {
  return Object.keys(DEMO_FILES).map((slug) => {
    const d = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "demo", DEMO_FILES[slug]), "utf8"));
    return { slug, league: d._demo.league, eventId: d._demo.event_id, home: d.match.home.name, away: d.match.away.name, date: d.match.date };
  });
}

export async function loadSheet(league: string, eventId: string, demo?: string): Promise<FactSheet> {
  if (demo) {
    const file = DEMO_FILES[demo];
    if (!file) throw new Error("unknown demo match");
    const d = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "demo", file), "utf8"));
    return buildFactSheet(d._demo.league, d._demo.event_id, d);
  }
  if (!(LEAGUES as readonly string[]).includes(league) || !/^\d{1,12}$/.test(eventId)) throw new Error("bad match id");
  const r = await fetch(`${TRIVELA}/api/${league}/match/${eventId}`, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`Trivela ${r.status}`);
  return buildFactSheet(league, eventId, await r.json());
}

export type Trace = { attempt: number; raw: string; violations: Violation[] }[];
export type Rendered = { segments: Segment[]; flagged: number };

const render = (text: string, sheet: FactSheet): Rendered => {
  const { segments, violations } = checkText(text, sheet);
  return { segments, flagged: violations.length };
};

function parseJson(text: string): any | null {
  const s = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(s); } catch { return null; }
}

// All the strings in a preview, for checking in one pass.
const previewStrings = (p: any): string[] =>
  [p?.headline, ...(p?.why ?? []), ...(p?.risks ?? []), p?.market_view].filter((x) => typeof x === "string");

export type PreviewOut = {
  ok: boolean;
  sheet: FactSheet;
  preview?: { headline: Rendered; why: Rendered[]; risks: Rendered[]; market_view: Rendered; confidence: string };
  trace: Trace;
  provider: string;
  model: string;
  system: string;
  fallbackReason?: string;
};

export async function runPreview(sheet: FactSheet, client: LlmClient = getClient()): Promise<PreviewOut> {
  const system = systemPrompt("preview", sheet);
  const messages: ChatMessage[] = [{ role: "user", content: "Write the match preview now." }];
  const trace: Trace = [];
  let provider = client.name, model = "";
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await client.complete(system, messages);
      provider = res.provider; model = res.model;
      const p = parseJson(res.text);
      const violations: Violation[] = p
        ? previewStrings(p).flatMap((s) => checkText(s, sheet).violations)
        : [{ text: res.text.slice(0, 80), reason: "reply was not the required JSON object" }];
      trace.push({ attempt, raw: res.text, violations });
      if (p && (violations.length === 0 || attempt === 2)) {
        return {
          ok: true, sheet, trace, provider, model, system,
          preview: {
            headline: render(p.headline ?? "", sheet),
            why: (p.why ?? []).map((s: string) => render(s, sheet)),
            risks: (p.risks ?? []).map((s: string) => render(s, sheet)),
            market_view: render(p.market_view ?? "", sheet),
            confidence: ["low", "medium", "high"].includes(p.confidence) ? p.confidence : "low",
          },
        };
      }
      // Iterative refinement: one retry, listing exactly what failed.
      messages.push({ role: "assistant", content: res.text });
      messages.push({
        role: "user",
        content: "These numbers or parts failed verification against the fact sheet:\n" +
          violations.map((v) => `- "${v.text}": ${v.reason}`).join("\n") +
          "\nRewrite the whole JSON. Use only {{F#}} placeholders for numbers.",
      });
    }
    return { ok: false, sheet, trace, provider, model, system, fallbackReason: "the reply could not be read as the required JSON" };
  } catch (e: any) {
    return { ok: false, sheet, trace, provider, model, system, fallbackReason: `the language model did not answer (${String(e?.message ?? e).slice(0, 60)})` };
  }
}

export type AskOut = { ok: boolean; answer?: Rendered; trace: Trace; provider: string; model: string; fallbackReason?: string };

export async function runAsk(sheet: FactSheet, question: string, client: LlmClient = getClient()): Promise<AskOut> {
  const system = systemPrompt("ask", sheet);
  const messages: ChatMessage[] = [{ role: "user", content: question.slice(0, 300) }];
  const trace: Trace = [];
  let provider = client.name, model = "";
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await client.complete(system, messages, 400);
      provider = res.provider; model = res.model;
      const { violations } = checkText(res.text, sheet);
      trace.push({ attempt, raw: res.text, violations });
      if (violations.length === 0 || attempt === 2) return { ok: true, answer: render(res.text, sheet), trace, provider, model };
      messages.push({ role: "assistant", content: res.text });
      messages.push({ role: "user", content: "Unverified numbers: " + violations.map((v) => `"${v.text}"`).join(", ") + ". Answer again using only {{F#}} placeholders." });
    }
  } catch (e: any) {
    return { ok: false, trace, provider, model, fallbackReason: `the language model did not answer (${String(e?.message ?? e).slice(0, 60)})` };
  }
  return { ok: false, trace, provider, model };
}
