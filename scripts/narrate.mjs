// Speaks every narration line in record.mjs (the second argument of cap())
// and writes recordings/narration/manifest.json: line -> {file, ms}.
// NARR_VOICE picks the macOS voice, e.g. "Ava (Premium)".
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const src = fs.readFileSync("scripts/record.mjs", "utf8");
const lines = [...src.matchAll(/cap\("(?:[^"\\]|\\.)+",\s*"((?:[^"\\]|\\.)+)"/g)].map((m) => m[1]);
fs.rmSync("recordings/narration", { recursive: true, force: true });
fs.mkdirSync("recordings/narration", { recursive: true });
const manifest = {};
lines.forEach((t, i) => {
  const file = `recordings/narration/${String(i).padStart(2, "0")}.aiff`;
  execFileSync("say", ["-v", process.env.NARR_VOICE ?? "Samantha", "-r", process.env.NARR_RATE ?? "185", "-o", file, t]);
  const sec = Number(/estimated duration: ([\d.]+)/.exec(execFileSync("afinfo", [file]).toString())?.[1] ?? 0);
  manifest[t] = { file, ms: Math.round(sec * 1000) };
});
fs.writeFileSync("recordings/narration/manifest.json", JSON.stringify(manifest, null, 1));
console.log(lines.length, "lines,", Math.round(Object.values(manifest).reduce((a, x) => a + x.ms, 0) / 1000), "s of speech");
