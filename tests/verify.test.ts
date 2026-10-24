import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildFactSheet, displayValue } from "../lib/factSheet";
import { checkText } from "../lib/verify";
import { runAsk, runPreview } from "../lib/analyst";
import { MockClient } from "../lib/llm";

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/demo/arsenal-everton.json"), "utf8"));
const sheet = buildFactSheet("epl", "401878768", raw);
const fact = (label: string) => sheet.facts.find((f) => f.label === label)!;

describe("fact sheet", () => {
  it("gives every fact a unique id and a display value", () => {
    const ids = sheet.facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sheet.facts.length).toBeGreaterThan(20);
    expect(displayValue(fact("Arsenal win probability"))).toBe("51%");
  });
  it("reads the model, the market and form", () => {
    expect(fact("Arsenal expected goals").value).toBeCloseTo(1.63);
    expect(fact("Market price for Arsenal (cents, ask)").value).toBeCloseTo(0.67);
    expect(sheet.facts.some((f) => f.label.startsWith("Arsenal wins in last"))).toBe(true);
  });
});

describe("verifier", () => {
  it("renders placeholders as verified facts", () => {
    const r = checkText("Arsenal at {{F1}}.", sheet);
    expect(r.violations).toHaveLength(0);
    expect(r.segments.find((s) => s.type === "fact")?.text).toBe("51%");
  });
  it("accepts raw numbers that match a fact within rounding", () => {
    expect(checkText("Arsenal win 51% of simulations", sheet).violations).toHaveLength(0);
    expect(checkText("Arsenal win 50.8% of simulations", sheet).violations).toHaveLength(0);
    expect(checkText("The market asks 67¢", sheet).violations).toHaveLength(0);
    expect(checkText("xG of 1.63", sheet).violations).toHaveLength(0);
  });
  it("flags invented numbers and unknown ids", () => {
    expect(checkText("Arsenal win 73% of the time", sheet).violations).toHaveLength(1);
    expect(checkText("Saka has scored 17 goals", sheet).violations.length).toBeGreaterThan(0);
    expect(checkText("see {{F999}}", sheet).violations).toHaveLength(1);
  });
  it("ignores football vocabulary like over 2.5", () => {
    expect(checkText("The over 2.5 line", sheet).violations).toHaveLength(0);
  });
});

describe("refinement loop", () => {
  const good = JSON.stringify({ headline: "Arsenal lead at {{F1}}.", why: ["xG {{F4}}."], risks: ["Draw {{F2}}."], market_view: "Market {{F1}}.", confidence: "medium" });
  const bad = JSON.stringify({ headline: "Arsenal win 88% of the time.", why: ["x"], risks: ["y"], market_view: "z", confidence: "high" });

  it("retries once when a number fails, then succeeds", async () => {
    const out = await runPreview(sheet, new MockClient([bad, good]));
    expect(out.ok).toBe(true);
    expect(out.trace).toHaveLength(2);
    expect(out.trace[0].violations.length).toBeGreaterThan(0);
    expect(out.preview!.headline.flagged).toBe(0);
  });
  it("strips and flags if the retry still fails", async () => {
    const out = await runPreview(sheet, new MockClient([bad, bad]));
    expect(out.ok).toBe(true);
    expect(out.preview!.headline.flagged).toBe(1);
    expect(out.preview!.headline.segments.some((s) => s.type === "flag")).toBe(true);
  });
  it("falls back to raw numbers when the model fails", async () => {
    const broken = { name: "x", complete: async () => { throw new Error("down"); } };
    const out = await runPreview(sheet, broken as any);
    expect(out.ok).toBe(false);
    expect(out.fallbackReason).toMatch(/did not answer/);
  });
  it("ask answers are verified the same way", async () => {
    const out = await runAsk(sheet, "draw?", new MockClient(["A draw is {{F2}}. Confidence: medium"]));
    expect(out.answer!.flagged).toBe(0);
  });
});
