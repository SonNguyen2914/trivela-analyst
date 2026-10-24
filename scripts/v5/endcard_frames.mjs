// End card built inside namson.dev (real fonts, header, colours), rendered
// frame by frame at the true phone viewport with a staggered reveal.
import { chromium } from "playwright";
import fs from "node:fs";
const FPS = 30, DUR = 4, D = 1080 / 390, dir = "recordings/v5/end_frames";
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 693 }, deviceScaleFactor: D, colorScheme: "dark" });
const MONO = "'Geist Mono', ui-monospace, monospace", HEAD = "'Archivo', sans-serif";
await p.setContent(`<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,800&family=Geist+Mono:wght@400&family=Geist:wght@400&display=swap">
<style>
html,body{margin:0;background:#0a0a0a;color:#f5f5f7}
.bar{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #1d1d21}
.ic{width:22px;height:22px;border:1px solid #2a2a2f;border-radius:7px;display:grid;place-items:center;color:#797983}
.ob{font-family:${MONO};font-size:10px;letter-spacing:2.2px;color:#797983;border:1px solid #2a2a2f;border-radius:8px;padding:7px 9px}
.ec{padding:34px 16px 0}
.ec .eb{font-family:${MONO};font-size:11px;letter-spacing:1.2px;color:#797983;text-transform:uppercase}
.ec h2{font-family:${HEAD};font-stretch:75%;font-weight:800;text-transform:uppercase;font-size:56px;line-height:.9;letter-spacing:-.6px;margin:12px 0 0}
.ec h2 em{font-style:normal;color:#f2b632}
.ec p{font-family:'Geist',system-ui,sans-serif;font-size:15px;line-height:1.45;color:#d6d6dc;margin:16px 0 0;max-width:340px}
.ec .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.ec .pill{font-family:${MONO};font-size:11px;letter-spacing:1.1px;text-transform:uppercase;color:#f5f5f7;border:1px solid #2a2a2f;border-radius:999px;padding:9px 13px;display:flex;align-items:center;gap:7px}
.ec .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.ec .rule{border-top:1px dashed #2a2a2f;margin:22px 0 14px}
.ec .gh{font-family:${MONO};font-size:11px;line-height:1.7;letter-spacing:.6px;color:#797983}
.ec .gh b{color:#f5f5f7;font-weight:400}
.ec > *{opacity:0;transform:translateY(10px);animation:ecin .5s cubic-bezier(.2,.8,.2,1) forwards}
.ec > *:nth-child(1){animation-delay:.08s}.ec > *:nth-child(2){animation-delay:.24s}.ec > *:nth-child(3){animation-delay:.4s}
.ec > *:nth-child(4){animation-delay:.56s}.ec > *:nth-child(5){animation-delay:.72s}.ec > *:nth-child(6){animation-delay:.88s}
@keyframes ecin{to{opacity:1;transform:none}}
</style></head><body>
<div class="bar"><span class="ic"><svg viewBox="0 0 9 9" width="9" height="9"><rect x="0" y="5.5" width="2" height="3.5" fill="currentColor"/><rect x="3.5" y="3" width="2" height="6" fill="currentColor"/><rect x="7" y="0.5" width="2" height="8.5" fill="currentColor"/></svg></span>
<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 17c5 2 10 0 14-8" stroke="#f2b632" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="19" cy="6.5" r="1.8" fill="#f2b632"/></svg>
<span class="ob">OPEN THE BOARD</span></div>
<div class="ec">
  <div class="eb">Trivela · Analyst · CS4680</div>
  <h2>Every number,<br><em>verified.</em></h2>
  <p>An AI analyst for Trivela. It explains each prediction in plain English, and it can't make up a number.</p>
  <div class="row">
    <span class="pill"><i class="dot" style="background:#f2b632"></i>Live on namson.dev</span>
    <span class="pill"><i class="dot" style="background:#a78bfa"></i>EPL</span>
    <span class="pill"><i class="dot" style="background:#f87171"></i>La Liga</span>
    <span class="pill"><i class="dot" style="background:#38bdf8"></i>MLS</span>
  </div>
  <div class="rule"></div>
  <div class="gh">namson.dev/bet-suggester<br><b>github.com/SonNguyen2914/trivela-analyst</b></div>
</div></body></html>`, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
await p.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
for (let f = 0; f < FPS * DUR; f++) {
  await p.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), (f / FPS) * 1000);
  await p.screenshot({ path: `${dir}/${String(f).padStart(4, "0")}.png` });
}
await b.close();
console.log("end card frames done");
