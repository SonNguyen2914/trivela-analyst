import { execFileSync } from "node:child_process";
import fs from "node:fs";
const LINES = {
  hook: "I built an AI that's not allowed to make up numbers.",
  landing: "This is Trivela. It simulates every soccer match ten thousand times.",
  board: "Every fixture, every league. But for most fans, it's a wall of numbers.",
  reveal: "So I added Trivela Analyst, an AI that explains the prediction.",
  verified: "Every number it writes is checked against the model. Check means verified.",
  ask: "Ask it anything. No data? It won't guess.",
  prompt: "Three prompt patterns: a persona, a verification ladder, and a strict JSON template.",
  close: "Trivela Analyst. Live on namson dot dev.",
};
const dir = "recordings/v5-narration";
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const m = {};
for (const [k, text] of Object.entries(LINES)) {
  const file = `${dir}/${k}.aiff`;
  execFileSync("say", ["-v", "Ava (Premium)", "-r", "205", "-o", file, text]);
  const sec = Number(/estimated duration: ([\d.]+)/.exec(execFileSync("afinfo", [file]).toString())[1]);
  m[k] = { file, ms: Math.round(sec * 1000), text: text.replace("namson dot dev", "namson.dev") };
}
fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(m, null, 1));
console.log(Object.entries(m).map(([k, v]) => `${k}:${(v.ms / 1000).toFixed(1)}`).join(" "));
