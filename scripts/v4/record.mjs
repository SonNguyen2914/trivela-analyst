// v4 short: landing page -> board -> Trivela Analyst -> close, ~60 s, 9:16.
// Each scene is its own page (own video file) so page loads never show.
// Captions are Nate-Herk style: 2-3 spoken words at a time, bold caps,
// key words in accent green. Scene lengths snap to 2 s bars (120 BPM).
import { chromium } from "playwright";
import fs from "node:fs";

const ANALYST = "http://localhost:3100";
const LANDING = "https://namson.dev";
const BOARD = "https://namson.dev/bet-suggester";
const OUT = "recordings/v4";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const NARR = JSON.parse(fs.readFileSync("recordings/v4-narration/manifest.json", "utf8"));
const BAR = 2000;
const HL = /^(AI|NUMBERS?|TRIVELA|ANALYST|VERIFIED|CHECKED|GUESS|ANYTHING|PLAIN|ENGLISH|ELEVEN|WALL|OCTOBER|LIVE|REAL|NOT|PROMPT)$/;

const CSS = `
  html{zoom:2;scroll-behavior:smooth}
  #tv-cap{position:fixed;left:0;right:0;top:74%;margin:0 auto;width:500px;text-align:center;z-index:99999;pointer-events:none;
    font:900 40px/1.05 Archivo,"Arial Black",system-ui,sans-serif;letter-spacing:-.01em;color:#fff;text-transform:uppercase;
    -webkit-text-stroke:7px #000;paint-order:stroke fill;text-shadow:0 4px 18px rgba(0,0,0,.6)}
  #tv-cap .hl{color:#3ccf95}
  #tv-cap.pop{animation:tvpop .16s ease-out}
  @keyframes tvpop{from{transform:scale(.82)}to{transform:scale(1)}}
  .tv-zoom{transition:transform .45s cubic-bezier(.2,.8,.2,1);transform-origin:var(--ox,50%) var(--oy,30%)}
  .tv-spot{outline:3px solid #3ccf95;outline-offset:6px;border-radius:8px}
`;
const browser = await chromium.launch();
const scenes = [];

async function scene(name, url, { localGrid = false, zoom = 2 } = {}, body) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, colorScheme: "dark",
    recordVideo: { dir: `${OUT}/${name}`, size: { width: 1080, height: 1920 } } });
  await ctx.addInitScript(({ css, grid, zoom }) => {
    const add = () => {
      if (document.getElementById("tv-style")) return;
      const st = document.createElement("style"); st.id = "tv-style";
      st.textContent = css.replace("zoom:2", "zoom:" + zoom).replace("width:500px", "width:" + Math.round(1000 / zoom) + "px") + (grid ? ".grid{grid-template-columns:1fr!important}.wrap{max-width:540px!important;padding-left:58px!important;padding-right:58px!important}" : "");
      document.head.appendChild(st);
      const d = document.createElement("div"); d.id = "tv-cap"; document.body.appendChild(d);
      document.body.classList.add("tv-zoom");
    };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", add) : add();
  }, { css: CSS, grid: localGrid, zoom });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  const lines = [];
  const api = {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    async ready(sel) { if (sel) await page.waitForSelector(sel, { timeout: 90000 }).catch(() => {}); await page.waitForTimeout(700); api.start = Date.now() - t0; },
    // Speak one narration line: captions run through it 2-3 words at a time.
    async say(key) {
      const n = NARR[key]; if (!n) throw new Error("no narration for " + key);
      lines.push({ key, at: Date.now() - t0 - api.start, file: n.file });
      const words = n.text.split(/\s+/);
      const chunks = [];
      for (let i = 0; i < words.length;) { const k = words.length - i === 4 ? 2 : Math.min(3, words.length - i); chunks.push(words.slice(i, i + k)); i += k; }
      const total = words.join("").length;
      for (const c of chunks) {
        const html = c.map((w) => { const clean = w.replace(/[^A-Za-z]/g, "").toUpperCase(); return HL.test(clean) ? `<span class="hl">${w}</span>` : w; }).join(" ");
        await page.evaluate((h) => { const el = document.getElementById("tv-cap"); el.innerHTML = h; el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }, html);
        await page.waitForTimeout(Math.max(260, (n.ms * c.join("").length) / total));
      }
      await page.evaluate(() => { document.getElementById("tv-cap").innerHTML = ""; });
      await page.waitForTimeout(150);
    },
    async zoom(sel, scale = 1.35) {
      await page.evaluate(({ sel, scale }) => {
        const b = document.body;
        if (!sel) { b.style.transform = ""; document.querySelectorAll(".tv-spot").forEach((e) => e.classList.remove("tv-spot")); return; }
        const el = document.querySelector(sel); if (!el) return;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        // html has zoom:2, so client rects are in zoomed pixels: halve them.
        // Small targets zoom on their own centre; wide ones zoom on the page
        // centre line so text never runs off the sides.
        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 2, cx = (r.left + r.width / 2) / z, cy = (r.top + r.height / 2) / z + window.scrollY / z;
        const wide = r.width / z > 300;
        b.style.setProperty("--ox", wide ? "50%" : `${Math.min(Math.max(cx, 120), 420)}px`);
        b.style.setProperty("--oy", `${cy}px`);
        b.style.transform = `scale(${scale})`;
        el.classList.add("tv-spot");
      }, { sel, scale });
      await page.waitForTimeout(450);
    },
    scrollBy: (y) => page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), y),
    // Glide to a CSS-pixel position over ms (no await: runs under the narration)
    glide: (to, ms) => page.evaluate(({ to, ms }) => {
      const from = window.scrollY, t0 = performance.now();
      const ease = (x) => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      const step = (now) => { const k = Math.min(1, (now - t0) / ms); window.scrollTo(0, from + (to - from) * ease(k)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }, { to, ms }),
  };
  await body(api);
  // pad the scene up to a whole number of bars
  const used = Date.now() - t0 - api.start;
  const dur = Math.ceil(used / BAR) * BAR;
  await page.waitForTimeout(dur - used + 100);
  await ctx.close();
  const file = fs.readdirSync(`${OUT}/${name}`).find((f) => f.endsWith(".webm"));
  scenes.push({ name, file: `${OUT}/${name}/${file}`, start: api.start, dur, lines });
}

// 1. Hook: a verified number, punched in
await scene("hook", ANALYST + "/?v=hook", { localGrid: true }, async (s) => {
  await s.ready(".headline .num");
  await s.zoom(".headline .num", 1.9);
  await s.say("hook");
});

// 2. Landing page: hero -> club and nation beeswarms -> explainer card
await scene("landing", LANDING, { zoom: 2.5 }, async (s) => {
  await s.ready("body");
  await s.wait(600);
  s.glide(330, 2600);
  await s.say("landing1");
  s.glide(2350, 3800);
  await s.say("landing2");
  await s.wait(900);
});

// 3. The board: header -> Premier League cards -> punch-in on a card
await scene("board", BOARD, { zoom: 2.5 }, async (s) => {
  await s.ready("main");
  await s.wait(1800);
  s.glide(380, 2200);
  await s.say("board1");
  s.glide(1300, 4200);
  await s.say("board2");
  await s.zoom("main article:nth-of-type(3)", 1.25);
  await s.say("board3");
  await s.zoom(null);
});

// 4. The Analyst
await scene("analyst", ANALYST, { localGrid: true }, async (s) => {
  await s.ready(".headline");
  await s.zoom("h1", 1.3);
  await s.say("analyst1");
  await s.zoom(".headline", 1.2);
  await s.say("analyst2");
  await s.zoom(".section .num", 1.8);
  await s.say("analyst3");
  await s.zoom(null);
  await s.page.fill("#ask", "How likely is a draw?");
  await s.page.click(".ask .btn");
  await s.zoom(".ask form", 1.2);
  await s.say("ask1");
  await s.page.waitForSelector(".answer", { timeout: 60000 });
  await s.zoom(".answer", 1.15);
  await s.page.fill("#ask", "Will Saka score 2 goals?");
  await s.page.click(".ask .btn");
  await s.page.waitForFunction(() => document.querySelector(".qa")?.textContent?.includes("Saka"), null, { timeout: 60000 });
  await s.zoom(null); await s.zoom(".answer", 1.15);
  await s.say("ask2");
  await s.zoom(null);
  await s.page.click("details.how summary");
  await s.zoom("details.how .steps", 1.15);
  await s.say("prompt");
});

// 5. Close
await scene("close", ANALYST + "/?v=close", { localGrid: true }, async (s) => {
  await s.ready(".headline");
  await s.zoom("h1", 1.5);
  await s.say("close");
});

await browser.close();
fs.writeFileSync(`${OUT}/scenes.json`, JSON.stringify(scenes, null, 1));
console.log(scenes.map((x) => `${x.name} ${x.dur / 1000}s`).join(" | "), "| total", scenes.reduce((a, x) => a + x.dur, 0) / 1000, "s");
