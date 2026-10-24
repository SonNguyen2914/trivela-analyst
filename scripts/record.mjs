// Records a ~75 s vertical (9:16) demo. Short on-screen captions; the
// narrator carries the detail; a spotlight dims everything except the
// element being talked about.
// Usage: node scripts/record.mjs [analystUrl]  -> recordings/trivela-analyst-demo.webm
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const SITE = "https://namson.dev/bet-suggester/epl/401878768";
fs.mkdirSync("recordings", { recursive: true });
const OVERLAY_CSS = `
  html{zoom:2}
  #tv-cap{position:fixed;left:0;right:0;bottom:44px;margin:0 auto;width:480px;text-align:center;z-index:99999;
    font:800 26px/1.25 Archivo,system-ui,sans-serif;color:#fff;background:rgba(8,14,11,.9);padding:12px 18px;border-radius:14px;pointer-events:none}
  #tv-cap:empty{display:none}
  .tv-spot{position:relative;z-index:9998!important;outline:3px solid #3ccf95;outline-offset:6px;border-radius:8px;
    box-shadow:0 0 0 9999px rgba(0,0,0,.62)!important;transition:box-shadow .3s}
`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, colorScheme: "dark",
  recordVideo: { dir: "recordings/raw", size: { width: 1080, height: 1920 } } });
await ctx.addInitScript(({ css, local }) => {
  const add = () => {
    if (document.getElementById("tv-style")) return;
    const st = document.createElement("style"); st.id = "tv-style";
    st.textContent = css + (location.port === local ? ".grid{grid-template-columns:1fr!important}.wrap{max-width:540px!important}" : "");
    document.head.appendChild(st);
    const d = document.createElement("div"); d.id = "tv-cap"; document.body.appendChild(d);
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", add) : add();
}, { css: OVERLAY_CSS, local: new URL(BASE).port });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);

const NARR = fs.existsSync("recordings/narration/manifest.json") ? JSON.parse(fs.readFileSync("recordings/narration/manifest.json", "utf8")) : {};
const timeline = [];
const t0 = Date.now();


const prep = async () => {};
// cap(caption, narration): caption on screen, narration spoken.
const cap = async (text, say, ms = 1800) => {
  await page.evaluate((t) => { const el = document.getElementById("tv-cap"); if (el) el.textContent = t; }, text);
  timeline.push({ text, t: Date.now() - t0, file: NARR[say]?.file });
  await wait(Math.max(ms, NARR[say] ? NARR[say].ms + 500 : 0));
};
const spot = async (sel) => {
  await page.evaluate(() => document.querySelectorAll(".tv-spot").forEach((e) => e.classList.remove("tv-spot")));
  if (!sel) return;
  const el = page.locator(sel).first();
  if (!(await el.count())) return;
  await el.evaluate((e) => { e.scrollIntoView({ block: "center", behavior: "smooth" }); e.classList.add("tv-spot"); });
  await wait(500);
};

// 1. The real site: the problem
await page.goto(SITE, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForSelector("text=Everton", { timeout: 30000 }).catch(() => {});
await wait(1200);
const START = Date.now() - t0; // video is trimmed to start here
await cap("This is Trivela", "This is Trivela, my soccer prediction site. It simulates every match ten thousand times.");
await page.evaluate(() => window.scrollTo({ top: 700, behavior: "smooth" })); await wait(900);
await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "smooth" }));
await cap("Powerful… but hard to read", "But all those numbers are hard for a normal fan to read.");

// 2. The Analyst
await page.goto(BASE, { waitUntil: "networkidle" });
await prep();
await page.waitForSelector(".headline", { timeout: 60000 });
await spot("h1");
await cap("Meet Trivela Analyst", "So I built Trivela Analyst. An AI that explains the model in plain English.");
await spot(".headline");
await cap("A plain-English read", "It writes a short preview: the headline, why, the risks, and how the model compares with the market.");
await spot(".headline .num");
await cap("Every number is verified ✓", "And here's the key part. Every number is checked against Trivela's data on the server. Green means verified.");

// 3. Ask
await spot(".ask form");
await page.fill("#ask", "How likely is a draw?");
await cap("Ask anything", "You can ask it anything about the match.");
await page.click(".ask .btn");
await page.waitForSelector(".answer", { timeout: 60000 });
await spot(".answer");
await cap("Grounded answers", "Answers come only from Trivela's numbers.");
await spot(".ask form");
await page.fill("#ask", "Will Saka score 2 goals?");
await page.click(".ask .btn");
await page.waitForFunction(() => document.querySelector(".qa")?.textContent?.includes("Saka"), null, { timeout: 60000 });
await spot(".answer");
await cap("No data? No guessing.", "If the data isn't there, it says so. It never makes numbers up.");

// 4. Prompt engineering
await spot(null);
await page.click("details.how summary");
await spot("details.how .steps");
await cap("4 prompt patterns", "Under the hood: a persona, a verification ladder, a strict JSON template, and a few-shot example.");
await spot("details.how pre");
await cap("Fails? One retry. Then flagged.", "If a number fails the check, the AI gets one retry. Anything still wrong is flagged, never shown as fact.");

// 5. Live + close
await spot(null);
await page.click("details.how summary");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await wait(500);
await page.click(".tabs button:has-text('Premier League')"); await wait(600);
await spot(".fx");
await cap("Live matches, 4 leagues", "It works on live matches in four leagues.");
await spot(null);
await cap("Trivela Analyst", "Trivela Analyst. Predictions you can read, and numbers you can trust.", 2500);

await ctx.close(); await browser.close();
const raw = fs.readdirSync("recordings/raw").filter((f) => f.endsWith(".webm")).map((f) => "recordings/raw/" + f);
raw.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
fs.copyFileSync(raw[0], "recordings/trivela-analyst-demo.webm");
fs.writeFileSync("recordings/timeline.json", JSON.stringify({ start: START, items: timeline }, null, 1));
console.log("saved recordings/trivela-analyst-demo.webm");
