// The planner: natural-language request -> strict JSON plan.
// System prompt = persona + JSON template (with the tool registry and the
// match catalog injected) + few-shot examples + the verification ladder.
// The reply is validated in full; if it fails, the exact errors go back to
// the model for one rewrite, and if that fails too, nothing runs.

import fs from "node:fs";
import path from "node:path";
import { getClient, withRetry, friendlyLlmError, type ChatMessage, type LlmClient } from "../llm";
import { toolsForPrompt } from "./tools";
import { label, type Catalog } from "./matches";
import { MAX_STEPS, validatePlan, type Validated } from "./validator";

const PROMPTS = ["agent-1-persona.md", "agent-2-template.md", "agent-3-few-shot.md", "agent-4-verification.md"];

export function catalogForPrompt(catalog: Catalog): string {
  if (!catalog.length) return "(no matches available right now)";
  return catalog.map((m) => `${m.key} | ${label(m)} | ${m.league.toUpperCase()} | kickoff ${m.kickoff}${m.demo ? " | saved demo" : ""}`).join("\n");
}

export function agentSystemPrompt(catalog: Catalog, today = new Date().toISOString().slice(0, 10)): string {
  return PROMPTS.map((f) => fs.readFileSync(path.join(process.cwd(), "prompts", f), "utf8")).join("\n\n---\n\n")
    .replaceAll("{{TOOLS}}", toolsForPrompt())
    .replaceAll("{{MATCHES}}", catalogForPrompt(catalog))
    .replaceAll("{{MAX_STEPS}}", String(MAX_STEPS))
    .replaceAll("{{TODAY}}", today);
}

export function parseJson(text: string): unknown {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

export type Attempt = { attempt: number; raw: string; errors: string[] };
export type PlanOut = {
  result: Validated;
  trace: Attempt[];
  provider: string;
  model: string;
  system: string;
  llmError?: string;
};

export async function planRequest(request: string, catalog: Catalog, client?: LlmClient): Promise<PlanOut> {
  const base = client ?? getClient();
  const llm = base.name === "mock" && !client ? ruleBasedPlanner(catalog) : withRetry(base);
  const system = agentSystemPrompt(catalog);
  const messages: ChatMessage[] = [{ role: "user", content: request }];
  const trace: Attempt[] = [];
  let provider = llm.name, model = "";
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await llm.complete(system, messages, 3000);
      provider = res.provider; model = res.model;
      const parsed = parseJson(res.text);
      const result = parsed === null ? { ok: false as const, errors: ["the reply was not a JSON object"] } : validatePlan(parsed, catalog);
      trace.push({ attempt, raw: res.text, errors: result.ok ? [] : result.errors });
      if (result.ok || attempt === 2) return { result, trace, provider, model, system };
      messages.push({ role: "assistant", content: res.text });
      messages.push({
        role: "user",
        content: "Your plan failed validation, so nothing was run:\n" + result.errors.map((e) => `- ${e}`).join("\n") +
          "\nReturn the whole JSON again, fixed. Use only tools and match keys from the lists. If you cannot, return a question instead.",
      });
    }
  } catch (e) {
    return { result: { ok: false, errors: [friendlyLlmError(e)] }, trace, provider, model, system, llmError: friendlyLlmError(e) };
  }
  return { result: { ok: false, errors: ["no plan"] }, trace, provider, model, system };
}

// Runs without an API key (local demo, tests of the page): a few keyword rules
// that produce the same JSON a real model would. The output still goes
// through the same validator.
export function ruleBasedPlanner(catalog: Catalog): LlmClient {
  return {
    name: "mock",
    async complete(_s, messages) {
      const q = messages[messages.length - 1].content.toLowerCase();
      const hit = catalog.find((m) => q.includes(m.home.toLowerCase().split(" ")[0]) || q.includes(m.away.toLowerCase().split(" ")[0]));
      const step = (tool: string, args: object, why: string, depends_on: number[] = []) => ({ tool, args, why, depends_on });
      let out: object;
      if (/clear|delete all|wipe/.test(q) && /pick|journal/.test(q)) out = { plan: [step("clear_picks", {}, "You asked to clear the journal.")], summary: "Clear your prediction journal (needs your confirmation)." };
      else if (/watchlist/.test(q) && /show|list|what/.test(q)) out = { plan: [step("list_watchlist", {}, "Show what you are tracking.")], summary: "Show your watchlist." };
      else if (/journal|my picks/.test(q)) out = { plan: [step("list_picks", {}, "Show your picks.")], summary: "Show your prediction journal." };
      else if (/list|which|what matches/.test(q) && !hit) out = { plan: [step("list_matches", {}, "Show the matches I can work with.")], summary: "List the available matches." };
      else if (!hit && /compare|market/.test(q)) out = { plan: catalog.slice(0, 3).map((m) => step("compare_model_vs_market", { match: m.key }, `Compare ${label(m)}.`)), summary: "Compare model and market for the next matches." };
      else if (!hit) out = { plan: [], question: "Which match do you mean? Pick one from the list, for example " + catalog.slice(0, 2).map(label).join(" or ") + ".", summary: "I need to know the match first." };
      else if (/track|watch/.test(q)) {
        const t = Number(q.match(/(\d+(?:\.\d+)?)\s*(%|pts|points)/)?.[1] ?? 5);
        out = { plan: [step("compare_model_vs_market", { match: hit.key }, "Check the current gap."), step("add_to_watchlist", { match: hit.key, threshold_pts: t }, `Flag it when the gap is over ${t} pts.`)], summary: `Track ${label(hit)}.` };
      } else if (/export|report|download/.test(q)) out = { plan: [step("export_report", { match: hit.key, format: /csv/.test(q) ? "csv" : "md" }, "Write the report file.")], summary: `Export a report for ${label(hit)}.` };
      else if (/simulat/.test(q)) out = { plan: [step("run_simulation", { match: hit.key, n_sims: 10000 }, "Re-simulate from the model's expected goals.")], summary: `Simulate ${label(hit)}.` };
      else out = { plan: [step("get_prediction", { match: hit.key }, "Read the model's prediction."), step("compare_model_vs_market", { match: hit.key }, "See if the market agrees.")], summary: `Prediction and market check for ${label(hit)}.` };
      return { text: JSON.stringify(out), provider: "mock", model: "rules (no API key)" };
    },
  };
}
