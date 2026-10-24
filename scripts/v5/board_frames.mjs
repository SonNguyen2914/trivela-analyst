// Board scene rendered frame by frame at a true 390x693 phone viewport
// (so the site's own media queries pick its single-column layout), at
// device scale 1080/390 -> crisp 1080x1920 frames. One page load.
import { chromium } from "playwright";
import fs from "node:fs";
const FPS = 30, DUR = 10, D = 1080 / 390, dir = "recordings/v5/board_frames";
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 693 }, deviceScaleFactor: D, colorScheme: "dark" });
await p.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "::-webkit-scrollbar{display:none}html{scrollbar-width:none}"; document.head.appendChild(s); }));
await p.goto("https://namson.dev/bet-suggester", { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
await p.waitForSelector("main article", { timeout: 90000 });
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1200);
const card = await p.evaluate(() => { const a = document.querySelectorAll("main article")[3]; const r = a.getBoundingClientRect(); return { top: r.top + scrollY, h: r.height }; });
// eased path: header -> first cards -> card 4 centred, then hold for the punch-in
const keys = [[0, 0], [0.9, 0], [2.6, 560], [3.2, 560], [5.6, card.top - 693 / 2 + card.h / 2], [10, card.top - 693 / 2 + card.h / 2]];
const ease = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const yAt = (t) => { for (let i = 1; i < keys.length; i++) { const [t0, y0] = keys[i - 1], [t1, y1] = keys[i]; if (t <= t1) return y0 + (y1 - y0) * ease((t - t0) / (t1 - t0 || 1)); } return keys.at(-1)[1]; };
for (let f = 0; f < FPS * DUR; f++) {
  await p.evaluate((y) => window.scrollTo(0, y), Math.round(yAt(f / FPS)));
  await p.screenshot({ path: `${dir}/${String(f).padStart(4, "0")}.png` });
}
// punch-in target: card 4's model/market rows, in video px at the final scroll
const r = await p.evaluate(() => { const a = document.querySelectorAll("main article")[3]; const e = a.querySelector(".border-t") ?? a; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
await b.close();
fs.writeFileSync("recordings/v5/board_target.json", JSON.stringify({ x: r.x * D, y: r.y * D, w: r.w * D, h: r.h * D }));
console.log("frames done", JSON.stringify(r));
