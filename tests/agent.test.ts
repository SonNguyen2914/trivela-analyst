// Trivela Agent: validator, planner retry loop, executor, confirmation gate,
// audit log, file sandbox and rate limit. The LLM is mocked and every match
// comes from the saved demo snapshots, so no test touches the network.

import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, type Db } from "../lib/agent/store";
import { demoCatalog, compare, market, prediction, loadMatch, type Catalog } from "../lib/agent/matches";
import { validatePlan, MAX_STEPS } from "../lib/agent/validator";
import { planRequest, agentSystemPrompt } from "../lib/agent/planner";
import { executeStep, issueConfirmToken, savePlan, PLAN_TTL_MS } from "../lib/agent/executor";
import { readAudit } from "../lib/agent/audit";
import { TOOLS, type Ctx } from "../lib/agent/tools";
import { LlmError, MockClient, withRetry, type LlmClient } from "../lib/llm";
import { allowRate, resetRates } from "../lib/limits";

const DEMO = "demo:arsenal-everton";
const offline: typeof fetch = async () => { throw new Error("network is off in tests"); };
// A catalog with the demo matches plus one "live" match whose fetch always fails.
const catalog: Catalog = [...demoCatalog(), { key: "epl:123", league: "epl", home: "Live FC", away: "Offline United", kickoff: "2026-11-10T20:00Z", demo: false }];

let db: Db;
let ctx: Ctx;
const S = "a".repeat(32);
beforeEach(() => {
  db = openDb(":memory:");
  ctx = { db, session: S, catalog, exportsDir: fs.mkdtempSync(path.join(os.tmpdir(), "agent-exports-")), fetcher: offline };
  resetRates();
});

const step = (tool: string, args: object = {}, depends_on: number[] = []) => ({ tool, args, why: "test", depends_on });
const plan = (...steps: object[]) => ({ plan: steps, summary: "test plan" });
function stored(...steps: object[]) {
  const v = validatePlan(plan(...steps), catalog);
  if (!v.ok || v.kind !== "plan") throw new Error("fixture plan invalid: " + JSON.stringify(v));
  return savePlan(db, S, "test request", v.plan, true);
}

describe("validator", () => {
  it("accepts a valid plan and fills defaults", () => {
    const v = validatePlan(plan(step("add_to_watchlist", { match: DEMO }), step("list_watchlist", {}, [1])), catalog);
    expect(v.ok).toBe(true);
    if (v.ok && v.kind === "plan") {
      expect(v.plan.steps[0].args).toEqual({ match: DEMO, threshold_pts: 5 });
      expect(v.plan.steps[1].depends_on).toEqual([1]);
    }
  });
  it("rejects unknown tools, so nothing outside the registry can run", () => {
    const v = validatePlan(plan(step("run_shell", { cmd: "rm -rf /" })), catalog);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0]).toMatch(/unknown tool/);
  });
  it("rejects match keys that are not in the catalog (no guessed ids)", () => {
    const v = validatePlan(plan(step("get_prediction", { match: "epl:999999" })), catalog);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0]).toMatch(/not a match key from the catalog/);
  });
  it("rejects out-of-range values, wrong types and unknown arguments", () => {
    const v = validatePlan(plan(
      step("run_simulation", { match: DEMO, n_sims: 10_000_000 }),
      step("log_pick", { match: DEMO, outcome: "win" }),
      step("list_picks", { extra: 1 }),
      step("remove_from_watchlist", { id: 1.5 }),
    ), catalog);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.join("\n")).toMatch(/out of range/);
      expect(v.errors.join("\n")).toMatch(/must be one of home, draw, away/);
      expect(v.errors.join("\n")).toMatch(/unknown argument "extra"/);
      expect(v.errors.join("\n")).toMatch(/whole number/);
    }
  });
  it("rejects the whole plan if any one step is bad (never a partial plan)", () => {
    const v = validatePlan(plan(step("list_watchlist"), step("nope")), catalog);
    expect(v.ok).toBe(false);
  });
  it("caps the number of steps", () => {
    const v = validatePlan(plan(...Array.from({ length: MAX_STEPS + 1 }, () => step("list_picks"))), catalog);
    expect(v.ok).toBe(false);
  });
  it("only allows depends_on to point at earlier steps", () => {
    expect(validatePlan(plan(step("list_picks", {}, [2]), step("list_picks")), catalog).ok).toBe(false);
  });
  it("accepts a clarifying question with an empty plan, and refuses a question with steps", () => {
    const q = validatePlan({ plan: [], question: "Which match?", summary: "unclear" }, catalog);
    expect(q.ok && q.kind === "question").toBe(true);
    expect(validatePlan({ plan: [step("list_picks")], question: "Which?", summary: "x" }, catalog).ok).toBe(false);
  });
  it("flags destructive tools", () => {
    const v = validatePlan(plan(step("clear_picks")), catalog);
    expect(v.ok && v.kind === "plan" && v.plan.steps[0].destructive).toBe(true);
  });
});

describe("planner", () => {
  it("injects the registry and the catalog into the system prompt", () => {
    const sys = agentSystemPrompt(catalog);
    for (const name of Object.keys(TOOLS)) expect(sys).toContain(name);
    expect(sys).toContain(DEMO);
    expect(sys).not.toContain("{{");
  });
  it("sends validation errors back once, then accepts the fixed plan", async () => {
    const bad = JSON.stringify(plan(step("get_prediction", { match: "epl:777" })));
    const good = JSON.stringify(plan(step("get_prediction", { match: DEMO })));
    const out = await planRequest("prediction for arsenal", catalog, new MockClient([bad, good]));
    expect(out.trace).toHaveLength(2);
    expect(out.trace[0].errors[0]).toMatch(/not a match key/);
    expect(out.result.ok).toBe(true);
  });
  it("gives up after the retry and runs nothing", async () => {
    const out = await planRequest("x", catalog, new MockClient(["not json", "still not json"]));
    expect(out.result.ok).toBe(false);
    expect(out.trace).toHaveLength(2);
  });
  it("the no-key fallback planner reads the number of simulations", async () => {
    const { ruleBasedPlanner } = await import("../lib/agent/planner");
    const r = await ruleBasedPlanner(catalog).complete("", [{ role: "user", content: "Simulate Montréal vs Nashville 20,000 times" }]);
    expect(JSON.parse(r.text).plan[0].args.n_sims).toBe(20000);
  });
  it("turns provider failures into a clear message", async () => {
    const down: LlmClient = { name: "claude", complete: async () => { throw new LlmError(401, "bad key"); } };
    const out = await planRequest("x", catalog, down);
    expect(out.result.ok).toBe(false);
    expect(out.llmError).toMatch(/credentials/);
  });
});

describe("LLM retries", () => {
  it("retries 429 and 5xx with exponential backoff", async () => {
    let n = 0;
    const waits: number[] = [];
    const flaky: LlmClient = { name: "x", complete: async () => { n++; if (n < 3) throw new LlmError(n === 1 ? 429 : 503, "busy"); return { text: "ok", provider: "x", model: "x" }; } };
    const r = await withRetry(flaky, 3, 100, async (ms) => { waits.push(ms); }).complete("", []);
    expect(r.text).toBe("ok");
    expect(waits).toEqual([100, 200]);
  });
  it("does not retry permanent errors", async () => {
    let n = 0;
    const bad: LlmClient = { name: "x", complete: async () => { n++; throw new LlmError(400, "bad request"); } };
    await expect(withRetry(bad, 3, 1, async () => {}).complete("", [])).rejects.toThrow();
    expect(n).toBe(1);
  });
});

describe("executor", () => {
  it("runs steps in order and records results", async () => {
    const id = stored(step("add_to_watchlist", { match: DEMO, threshold_pts: 5 }), step("list_watchlist", {}, [1]));
    expect((await executeStep(ctx, id, 2)).status).toBe("refused"); // step 1 first
    expect((await executeStep(ctx, id, 1)).status).toBe("done");
    const two = await executeStep(ctx, id, 2);
    expect(two.status).toBe("done");
    expect(two.result?.table?.rows).toHaveLength(1);
    expect((await executeStep(ctx, id, 1)).status).toBe("refused"); // no re-runs
  });
  it("skips dependent steps when a step fails, and says which one", async () => {
    const id = stored(step("get_prediction", { match: "epl:123" }), step("export_report", { match: "epl:123" }, [1]), step("list_picks"));
    const one = await executeStep(ctx, id, 1);
    expect(one.status).toBe("failed");
    expect(one.error).toMatch(/network is off/);
    const two = await executeStep(ctx, id, 2);
    expect(two.status).toBe("skipped");
    expect(two.error).toMatch(/step 1/);
    expect((await executeStep(ctx, id, 3)).status).toBe("done"); // independent steps still run
  });
  it("keeps sessions apart", async () => {
    const id = stored(step("list_picks"));
    const other = { ...ctx, session: "b".repeat(32) };
    expect((await executeStep(other, id, 1)).error).toBe("unknown plan");
  });
  it("refuses an expired plan", async () => {
    const id = stored(step("list_picks"));
    expect((await executeStep(ctx, id, 1, undefined, Date.now() + PLAN_TTL_MS + 1)).error).toMatch(/expired/);
  });
});

describe("confirmation gate", () => {
  async function withPicks() {
    const id = stored(step("log_pick", { match: DEMO, outcome: "home" }), step("log_pick", { match: DEMO, outcome: "draw", confidence: "low" }));
    await executeStep(ctx, id, 1); await executeStep(ctx, id, 2);
  }
  it("refuses a destructive step without a token, then runs it once confirmed", async () => {
    await withPicks();
    const id = stored(step("clear_picks"));
    const no = await executeStep(ctx, id, 1);
    expect(no.status).toBe("refused");
    expect(no.error).toMatch(/confirm/i);
    expect(Number((db.prepare("SELECT COUNT(*) c FROM picks").get() as any).c)).toBe(2);
    const { token } = issueConfirmToken(db, S, id, 1);
    const yes = await executeStep(ctx, id, 1, token);
    expect(yes.status).toBe("done");
    expect(Number((db.prepare("SELECT COUNT(*) c FROM picks").get() as any).c)).toBe(0);
  });
  it("tokens are single-use and bound to one session, plan and step", async () => {
    const a = stored(step("clear_picks"));
    const b = stored(step("clear_picks"));
    const { token } = issueConfirmToken(db, S, a, 1);
    expect((await executeStep(ctx, b, 1, token)).status).toBe("refused"); // other plan
    expect((await executeStep({ ...ctx, session: "c".repeat(32) }, a, 1, token)).status).toBe("refused"); // other session
    expect((await executeStep(ctx, a, 1, "f".repeat(32))).status).toBe("refused"); // made-up token
    expect((await executeStep(ctx, a, 1, token)).status).toBe("done");
  });
  it("tokens expire", async () => {
    const id = stored(step("clear_picks"));
    const { token } = issueConfirmToken(db, S, id, 1, Date.now() - 10 * 60_000);
    expect((await executeStep(ctx, id, 1, token)).status).toBe("refused");
  });
  it("will not issue tokens for safe steps", () => {
    const id = stored(step("list_picks"));
    expect(issueConfirmToken(db, S, id, 1).error).toMatch(/does not need/);
  });
});

describe("audit log", () => {
  it("records every step, refusals included", async () => {
    const id = stored(step("clear_picks"));
    await executeStep(ctx, id, 1);
    const { token } = issueConfirmToken(db, S, id, 1);
    await executeStep(ctx, id, 1, token);
    const rows = readAudit(db, S);
    expect(rows.map((r) => r.status)).toEqual(["done", "confirmed", "refused"]);
    expect(rows.every((r) => r.tool === "clear_picks" && r.plan_id === id)).toBe(true);
  });
  it("is append-only: the database refuses updates and deletes", async () => {
    const id = stored(step("list_picks"));
    await executeStep(ctx, id, 1);
    expect(() => db.prepare("UPDATE audit_log SET status = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  });
  it("only shows a session its own entries", async () => {
    const id = stored(step("list_picks"));
    await executeStep(ctx, id, 1);
    expect(readAudit(db, "d".repeat(32))).toHaveLength(0);
  });
});

describe("tools", () => {
  it("compares model and market with the overround removed", async () => {
    const d = await loadMatch(DEMO);
    const c = compare(prediction(d)!, market(d)!)!;
    expect(c.reduce((s, r) => s + r.marketFair, 0)).toBeCloseTo(1, 6);
    expect(c[0].outcome).toBe("Arsenal win");
  });
  it("writes exports only inside the sandbox folder, with generated names", async () => {
    const id = stored(step("export_report", { match: DEMO, format: "csv" }));
    const r = await executeStep(ctx, id, 1);
    expect(r.status).toBe("done");
    const name = r.result!.download!.name;
    expect(name).toMatch(/^[a-z0-9-]+\.csv$/);
    expect(fs.existsSync(path.join(ctx.exportsDir, name))).toBe(true);
    expect(fs.readFileSync(path.join(ctx.exportsDir, name), "utf8")).toContain('"prediction","Arsenal win"');
  });
  it("run_simulation is capped, seeded and close to the model", async () => {
    const id = stored(step("run_simulation", { match: DEMO, n_sims: 20000 }));
    const r = await executeStep(ctx, id, 1);
    expect(r.status).toBe("done");
    const home = parseFloat(String(r.result!.table!.rows[0][1]));
    const model = parseFloat(String(r.result!.table!.rows[0][2]));
    expect(Math.abs(home - model)).toBeLessThan(10);
  });
});

describe("rate limit", () => {
  it("allows N requests per window per key", () => {
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) expect(allowRate("ip1", 10, 60_000, t + i)).toBe(true);
    expect(allowRate("ip1", 10, 60_000, t + 20)).toBe(false);
    expect(allowRate("ip2", 10, 60_000, t + 20)).toBe(true);
    expect(allowRate("ip1", 10, 60_000, t + 60_001)).toBe(true);
  });
});
