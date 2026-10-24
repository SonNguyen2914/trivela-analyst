// v4 narration lines, spoken with the macOS Ava (Premium) voice.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const LINES = {
  hook: "I built an AI that's not allowed to make up numbers.",
  landing1: "This is Trivela, my soccer prediction site.",
  landing2: "It simulates every match ten thousand times.",
  board1: "The board prices every match across eleven competitions.",
  board2: "Win, draw, loss, expected goals, the market.",
  board3: "But for most fans? It's a wall of numbers.",
  analyst1: "So I built Trivela Analyst.",
  analyst2: "It reads the model and explains it in plain English.",
  analyst3: "Every number is checked against the real data. Green means verified.",
  ask1: "Ask it anything.",
  ask2: "Ask what the data can't know, and it won't guess.",
  prompt: "Persona, verification ladder, JSON template, few-shot.",
  close: "Trivela Analyst. Live on namson dot dev, October twenty-fifth.",
};
const dir = "recordings/v4-narration";
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const m = {};
for (const [k, text] of Object.entries(LINES)) {
  const file = `${dir}/${k}.aiff`;
  execFileSync("say", ["-v", "Ava (Premium)", "-r", "192", "-o", file, text]);
  const sec = Number(/estimated duration: ([\d.]+)/.exec(execFileSync("afinfo", [file]).toString())[1]);
  // captions show the words as spoken (namson dot dev -> namson.dev)
  m[k] = { file, ms: Math.round(sec * 1000), text: text.replace("namson dot dev", "namson.dev").replace("twenty-fifth", "25") };
}
fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(m, null, 1));
console.log(Object.keys(m).length, "lines", Math.round(Object.values(m).reduce((a, x) => a + x.ms, 0) / 1000), "s");
