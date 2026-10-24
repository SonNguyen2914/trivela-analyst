// Records a ~100 s vertical (9:16) demo with burned-in captions.
// Usage: node scripts/record.mjs [baseUrl]   -> recordings/trivela-analyst-demo.webm
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const W = 1080, H = 1920;
fs.mkdirSync("recordings", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "dark",
  recordVideo: { dir: "recordings/raw", size: { width: 1080, height: 1920 } } });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const cap = async (text, ms = 2800) => {
  await page.evaluate((t) => { const el = document.getElementById("caption"); if (el) el.textContent = t; }, text);
  if (ms) await wait(ms);
};
const scrollTo = (sel) => page.locator(sel).first().scrollIntoViewIfNeeded();
const smooth = (y) => page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "html{zoom:2} #caption{font-size:21px!important;bottom:40px!important;width:88vw;max-width:88vw!important}" });
await cap("⚽ Soccer predictions are a wall of numbers.", 3000);
await cap("Trivela simulates every match 10,000 times… but what does it MEAN?", 3200);
await page.waitForSelector(".headline", { timeout: 60000 });
await cap("Meet Trivela Analyst: an AI that explains the model in plain English.", 3400);
await scrollTo(".headline"); await wait(400);
await cap("Headline, the why, the risks, model vs market, and its confidence.", 3600);
await smooth(420); await wait(1200);
await cap("The catch: LLMs love to make numbers up.", 3000);
const num = page.locator(".headline .num, .section .num").first();
await num.scrollIntoViewIfNeeded(); await num.hover();
await cap("So every number is checked on the server ✓ Hover one to see its source.", 3800);
await scrollTo("#ask"); await wait(300);
await cap("Ask Trivela anything about the match…", 2200);
await page.fill("#ask", "How likely is a draw, and does the market agree?");
await wait(600); await page.click(".ask .btn");
await page.waitForSelector(".answer", { timeout: 60000 }); await scrollTo(".answer");
await cap("Answers are grounded only in Trivela's numbers.", 3600);
await page.fill("#ask", "Will Saka score 2 goals tonight?");
await wait(500); await page.click(".ask .btn");
await page.waitForFunction(() => document.querySelector(".qa")?.textContent?.includes("Saka"), null, { timeout: 60000 });
await scrollTo(".answer");
await cap("Ask for something that isn't in the data, and it says so. No guessing.", 4200);
await page.click("details.how summary"); await scrollTo("details.how .steps");
await cap("Prompt engineering: 1 Persona · 2 Verification ladder · 3 JSON template · 4 Few-shot", 4200);
await scrollTo("details.how pre");
await cap("If a number fails the check, the model gets ONE rewrite with the errors listed…", 3800);
await cap("…anything still unverified is stripped and flagged, never shown as fact.", 3600);
await scrollTo("details.how table");
await cap("Source A: the fact sheet. Every number has an id. Source A always wins.", 3800);
await page.click("details.how summary");
await smooth(0); await wait(600);
await page.click(".tabs button:has-text('Premier League')"); await wait(800);
await cap("Works on live fixtures too: Premier League, La Liga, MLS, Liga MX.", 2600);
const live = page.locator(".fx button").first();
if (await live.count()) {
  await live.click();
  await page.waitForSelector(".headline", { timeout: 60000 }).catch(() => {});
  await smooth(300); await wait(800);
}
await cap("Trivela Analyst: predictions you can read, numbers you can trust.", 3800);
await cap("github.com/SonNguyen2914/trivela-analyst", 3000);
await ctx.close(); await browser.close();
const raw = fs.readdirSync("recordings/raw").filter((f) => f.endsWith(".webm")).map((f) => "recordings/raw/" + f);
raw.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
fs.copyFileSync(raw[0], "recordings/trivela-analyst-demo.webm");
console.log("saved recordings/trivela-analyst-demo.webm");
