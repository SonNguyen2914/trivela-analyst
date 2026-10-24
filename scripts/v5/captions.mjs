// Renders each caption chunk (2-3 spoken words) as a transparent 1080x260 PNG.
import { chromium } from "playwright";
import fs from "node:fs";
const chunks = JSON.parse(fs.readFileSync("recordings/v5/chunks.json", "utf8"));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 260 } });
fs.mkdirSync("recordings/v5/cap", { recursive: true });
for (const [i, c] of chunks.entries()) {
  await p.setContent(`<html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent"><div style="width:1080px;height:260px;display:flex;align-items:center;justify-content:center">
    <div style="max-width:920px;text-align:center;background:rgba(6,12,9,.74);border-radius:28px;padding:16px 34px;font-family:'Arial Black',Impact,sans-serif;font-size:84px;line-height:1.02;letter-spacing:-1px;color:#fff;text-transform:uppercase;-webkit-text-stroke:12px #000;paint-order:stroke fill">${c.html}</div></div></body></html>`);
  await p.screenshot({ path: `recordings/v5/cap/${String(i).padStart(3, "0")}.png`, omitBackground: true });
}
await b.close();
console.log(chunks.length, "captions");
