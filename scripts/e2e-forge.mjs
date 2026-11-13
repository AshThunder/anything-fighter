// Live UI end-to-end: landing → upload photo → /forge/<id> (practice while waiting) → done → fight. Spends ~60 credits.
// Usage: node scripts/e2e-forge.mjs <photo> "<Name>" [baseUrl]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(`${execSync("npm root -g").toString().trim()}/playwright`);
const [photo, name, BASE = "http://localhost:3100"] = process.argv.slice(2);
const OUT = new URL("../screens/", import.meta.url).pathname;
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
if (photo.startsWith("/forge/")) {
  await page.goto(BASE + photo, { waitUntil: "networkidle" }); // resume watching an existing job
} else {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("input[type=file]").first().setInputFiles(photo);
  await page.fill('input[placeholder="Fighter name"]', name);
  await page.click("text=Forge fighter");
  await page.waitForURL(/\/forge\//, { timeout: 60000 });
  console.log(ts(), "redirected", page.url());
  await page.waitForTimeout(8000);
  await page.screenshot({ path: OUT + "forge-progress.png" });
  await page.click('[data-action="practice"]');
  await page.waitForTimeout(6000);
  await page.locator("[data-game-root]").scrollIntoViewIfNeeded();
  for (let i = 0; i < 8; i++) { await page.keyboard.press(i % 2 ? "KeyK" : "KeyJ"); await page.waitForTimeout(200); }
  await page.screenshot({ path: OUT + "forge-practice.png" });
}
let last = "";
for (;;) {
  const txt = (await page.locator("main.relative").innerText()).replace(/\s+/g, " ");
  const st = (txt.match(/(\d+)%/) ?? [])[0] ?? "";
  if (st !== last) { console.log(ts(), st); last = st; }
  if (await page.locator('[data-action="fight-new"]').count()) break;
  if (await page.locator('[data-action="retry"]').count()) { console.log(ts(), "ERROR shown → clicking retry"); await page.screenshot({ path: OUT + "forge-error.png" }); await page.click('[data-action="retry"]'); }
  if (Date.now() - t0 > 30 * 60e3) { console.log("timeout"); break; }
  await page.waitForTimeout(10000);
}
console.log(ts(), "done");
await page.screenshot({ path: OUT + "forge-done.png" });
await page.click('[data-action="fight-new"]');
await page.waitForTimeout(7000);
for (let i = 0; i < 6; i++) { await page.keyboard.press(i % 2 ? "KeyK" : "KeyJ"); await page.waitForTimeout(250); }
await page.screenshot({ path: OUT + "fight-new-fighter.png" });
console.log(ts(), "fight", page.url(), errs.slice(0, 5));
await browser.close();
