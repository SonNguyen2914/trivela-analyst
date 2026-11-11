// The validator: every plan is checked here, in full, before any step runs.
// A plan is all-or-nothing: one bad step rejects the whole plan, so a partly
// invalid plan is never executed. This is the "Source A" check of the
// verification ladder: the tool registry and the live match catalog are the
// sources of truth, and anything that cannot be traced to them is refused.

import { TOOLS, type ArgSpec } from "./tools";
import type { Catalog } from "./matches";

export const MAX_STEPS = 6;

export type Step = { tool: string; args: Record<string, unknown>; why: string; depends_on: number[]; destructive: boolean };
export type Plan = { steps: Step[]; summary: string };
export type Validated =
  | { ok: true; kind: "plan"; plan: Plan }
  | { ok: true; kind: "question"; question: string; summary: string }
  | { ok: false; errors: string[] };

function checkArg(name: string, spec: ArgSpec, value: unknown, catalog: Catalog, where: string, errors: string[]): unknown {
  if (value === undefined || value === null) {
    if ("default" in spec && spec.default !== undefined) return spec.default;
    errors.push(`${where}: missing required argument "${name}"`);
    return undefined;
  }
  switch (spec.type) {
    case "match":
      if (typeof value !== "string" || !catalog.some((m) => m.key === value)) {
        errors.push(`${where}: "${name}" = ${JSON.stringify(value)} is not a match key from the catalog (never guess match ids)`);
        return undefined;
      }
      return value;
    case "int":
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
      if (!Number.isFinite(n) || (spec.type === "int" && !Number.isInteger(n))) {
        errors.push(`${where}: "${name}" must be ${spec.type === "int" ? "a whole number" : "a number"}`);
        return undefined;
      }
      if (n < spec.min || n > spec.max) {
        errors.push(`${where}: "${name}" = ${n} is out of range (${spec.min}-${spec.max})`);
        return undefined;
      }
      return n;
    }
    case "enum":
      if (typeof value !== "string" || !spec.values.includes(value)) {
        errors.push(`${where}: "${name}" must be one of ${spec.values.join(", ")}`);
        return undefined;
      }
      return value;
  }
}

export function validatePlan(raw: unknown, catalog: Catalog): Validated {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["the reply was not a JSON object"] };
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.slice(0, 300) : "";

  if (typeof o.question === "string" && o.question.trim()) {
    if (Array.isArray(o.plan) && o.plan.length) return { ok: false, errors: ["a reply that asks a question must have an empty plan"] };
    return { ok: true, kind: "question", question: o.question.trim().slice(0, 300), summary };
  }
  if (!Array.isArray(o.plan)) return { ok: false, errors: ['missing "plan" array (or a "question")'] };
  if (o.plan.length === 0) return { ok: false, errors: ["the plan is empty; ask a question instead if the request is unclear"] };
  if (o.plan.length > MAX_STEPS) return { ok: false, errors: [`the plan has ${o.plan.length} steps; the limit is ${MAX_STEPS}`] };
  if (!summary) errors.push('missing "summary"');

  const steps: Step[] = o.plan.map((s: any, i: number) => {
    const where = `step ${i + 1}`;
    if (!s || typeof s !== "object") { errors.push(`${where}: not an object`); return null as any; }
    const tool = TOOLS[s.tool];
    if (!tool) { errors.push(`${where}: unknown tool ${JSON.stringify(s.tool)} (only registry tools can run)`); return null as any; }
    const given = s.args && typeof s.args === "object" && !Array.isArray(s.args) ? s.args : {};
    if (s.args !== undefined && given !== s.args) errors.push(`${where}: "args" must be an object`);
    for (const k of Object.keys(given)) if (!(k in tool.args)) errors.push(`${where}: unknown argument "${k}" for ${tool.name}`);
    const args: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(tool.args)) args[k] = checkArg(k, spec, given[k], catalog, where, errors);
    const why = typeof s.why === "string" ? s.why.trim().slice(0, 200) : "";
    if (!why) errors.push(`${where}: missing "why"`);
    const dep = s.depends_on ?? [];
    const depends_on: number[] = [];
    if (!Array.isArray(dep)) errors.push(`${where}: "depends_on" must be a list of earlier step numbers`);
    else for (const d of dep) {
      if (!Number.isInteger(d) || d < 1 || d > i) errors.push(`${where}: depends_on ${JSON.stringify(d)} must name an earlier step (1-${i})`);
      else depends_on.push(d);
    }
    return { tool: tool.name, args, why, depends_on, destructive: tool.destructive };
  });

  return errors.length ? { ok: false, errors } : { ok: true, kind: "plan", plan: { steps, summary } };
}
