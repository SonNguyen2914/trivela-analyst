// v5 capture: 1080x1920 frames of 390-CSS-px pages (html zoom), no captions
// and no zoom in-page. Logs narration starts and punch-in targets (video px)
// per scene; post.py does the punch-ins and captions on the recorded frames.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "recordings/v5";
const Z = 1080 / 390;
const BAR = 2000;
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const prev = fs.existsSync(`${OUT}/scenes.json`) ? JSON.parse(fs.readFileSync(`${OUT}/scenes.json`, "utf8")) : [];
fs.mkdirSync(OUT, { recursive: true });
const NARR = JSON.parse(fs.readFileSync("recordings/v5-narration/manifest.json", "utf8"));
const CSS = `html{zoom:${Z}} ::-webkit-scrollbar{display:none} html{scrollbar-width:none}`;
// Analyst app only: its own two-column grid collapsed to one (never on namson.dev)
const APP_CSS = `.grid{grid-template-columns:1fr!important} .wrap{max-width:390px!important}`;
const browser = await chromium.launch();
const scenes = [];

async function scene(name, url, body, cssW = 390) {
  if (ONLY.length && !ONLY.includes(name)) { const old = prev.find((x) => x.name === name); if (old) { scenes.push(old); console.log(name, "kept"); return; } }
  fs.rmSync(`${OUT}/${name}`, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, colorScheme: "dark",
    recordVideo: { dir: `${OUT}/${name}`, size: { width: 1080, height: 1920 } } });
  const css = CSS.replace(`zoom:${Z}`, `zoom:${1080 / cssW}`) + (url.startsWith("http://localhost") ? APP_CSS : "");
  await ctx.addInitScript((css) => {
    const add = () => { if (document.getElementById("v5")) return; const s = document.createElement("style"); s.id = "v5"; s.textContent = css; document.head.appendChild(s); };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", add) : add();
  }, css);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  const lines = [], zooms = [];
  let start = 0;
  const now = () => (Date.now() - t0 - start) / 1000;
  const s = {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    async ready(sel) { if (sel) await page.waitForSelector(sel, { timeout: 90000 }).catch(() => {}); await page.waitForTimeout(600); start = Date.now() - t0; },
    async say(key, extraMs = 120) { const n = NARR[key]; lines.push({ key, at: now() }); await page.waitForTimeout(n.ms + extraMs); },
    sayAsync(key) { const n = NARR[key]; lines.push({ key, at: now() }); return n.ms; },
    // punch-in on an element for ms; the rect is in video pixels
    async punch(sel, ms) {
      const el = page.locator(sel).first();
      await el.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(150);
      const r = await el.evaluate((e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
      zooms.push({ t0: now(), t1: now() + ms / 1000, ...r });
      await page.waitForTimeout(ms);
    },
    glide: (to, ms) => page.evaluate(({ to, ms }) => new Promise((done) => {
      const from = window.scrollY, t0 = performance.now();
      const ease = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      const step = (t) => { const k = Math.min(1, (t - t0) / ms); window.scrollTo(0, from + (to - from) * ease(k)); k < 1 ? requestAnimationFrame(step) : done(); };
      requestAnimationFrame(step);
    }), { to, ms }),
  };
  await body(s);
  const used = Date.now() - t0 - start;
  const dur = Math.ceil(used / BAR) * BAR;
  await page.waitForTimeout(dur - used + 120);
  await ctx.close();
  const file = fs.readdirSync(`${OUT}/${name}`).find((f) => f.endsWith(".webm"));
  scenes.push({ name, file: `${OUT}/${name}/${file}`, start: start / 1000, dur: dur / 1000, lines, zooms });
  console.log(name, dur / 1000, "s");
}

const APP = "http://localhost:3100/?demo=1";

// 0-3s hook: a verified number
await scene("hook", APP, async (s) => {
  await s.ready(".headline .num");
  s.sayAsync("hook");
  await s.punch(".headline .num", 3600);
});

// landing: the scroll story
await scene("landing", "https://namson.dev", async (s) => {
  await s.ready("body");
  s.sayAsync("landing");
  await s.wait(700);
  await s.glide(10000, 1500); await s.wait(1300);
  await s.glide(20600, 1400); await s.wait(1400);
  await s.glide(46300, 1500); await s.wait(2000);
});

// board: one load, scroll 4-6 cards, punch in on one card's rows
await scene("board", "https://namson.dev/bet-suggester", async (s) => {
  await s.ready("main article");
  await s.wait(900);
  s.sayAsync("board");
  await s.glide(1500, 1600); await s.wait(400);
  await s.glide(4200, 2600); await s.wait(300);
  await s.punch("main article:nth-of-type(4) .border-t", 2600);
}, 430);

// analyst reveal + verified + ask + prompt engineering (one page, one session)
await scene("analyst", APP, async (s) => {
  await s.ready(".headline");
  s.sayAsync("reveal");
  await s.punch(".headline", 3400);
  s.sayAsync("verified");
  await s.punch(".section li .num", 2300);
  await s.punch(".section li:nth-child(2) .num", 2300);
  await s.page.locator("#ask").scrollIntoViewIfNeeded();
  s.sayAsync("ask");
  await s.page.click("#ask");
  await s.page.type("#ask", "How likely is a draw?", { delay: 80 });
  await s.page.click(".ask .btn");
  await s.page.waitForSelector(".answer", { timeout: 60000 });
  await s.punch(".answer", 2200);
  await s.page.fill("#ask", "");
  await s.page.type("#ask", "Will Saka score twice?", { delay: 70 });
  await s.page.click(".ask .btn");
  await s.page.waitForFunction(() => document.querySelector(".qa")?.textContent?.includes("Saka"), null, { timeout: 60000 });
  await s.punch(".answer", 2600);
  await s.page.click("details.how summary");
  s.sayAsync("prompt");
  await s.punch("details.how .step:nth-child(2)", 2300);
  await s.punch("details.how .step:nth-child(4)", 2300);
  await s.punch("details.how .step:nth-child(3)", 2300);
});

// end card
const card = `data:text/html,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@800;900&family=JetBrains+Mono&display=swap"><style>
html,body{margin:0;height:100%;background:#0d1411;color:#e4ede8;font-family:Archivo,sans-serif}
.c{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:22px;text-align:center}
h1{font-size:62px;line-height:.95;margin:0;letter-spacing:-.02em}h1 span{color:#3ccf95}
p{margin:0;font:16px 'JetBrains Mono',monospace;color:#93a39b}p b{color:#e4ede8;font-weight:400}
.ok{font:900 26px Archivo;color:#062418;background:#3ccf95;border-radius:10px;padding:6px 14px}</style></head>
<body><div class="c"><div class="ok">✓ every number verified</div><h1>TRIVELA<br><span>ANALYST</span></h1>
<p><b>namson.dev/bet-suggester</b></p><p>github.com/SonNguyen2914/trivela-analyst</p></div></body></html>`)}`;
await scene("close", card, async (s) => {
  await s.ready(".c");
  await s.say("close", 400);
});

await browser.close();
fs.writeFileSync(`${OUT}/scenes.json`, JSON.stringify(scenes, null, 1));
console.log("total", scenes.reduce((a, x) => a + x.dur, 0), "s");
