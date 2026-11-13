// Polish-pass screenshots: node scripts/screens-polish.mjs [baseUrl]   (ONLY=name to run one)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(`${execSync("npm root -g").toString().trim()}/playwright`);
const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = new URL("../screens/", import.meta.url).pathname;
const only = process.env.ONLY;
const want = (n) => !only || only.split(",").includes(n);
const args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"];
const browser = await chromium.launch({ args });
const errs = [];
const mk = async (opts = { viewport: { width: 1440, height: 900 } }) => {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  return p;
};
const shot = async (p, n, full = false) => { await p.screenshot({ path: OUT + n, fullPage: full, timeout: 120000 }); console.log(n); };
const page = await mk();

if (want("landing")) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  await shot(page, "landing.png", true);
  await page.locator("text=Fight in your room").scrollIntoViewIfNeeded();
  await shot(page, "room-scan.png");
}
if (want("gallery")) {
  await page.goto(BASE + "/gallery", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.locator("button:has-text('3D')").first().click();
  await page.waitForTimeout(5000);
  await shot(page, "gallery.png", true);
}
const fight = async (q, n, keys = ["KeyJ", "KeyK"], wait = 7000) => {
  await page.goto(`${BASE}/fight?${q}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  for (let i = 0; i < 6; i++) { await page.keyboard.press(keys[i % keys.length]); await page.waitForTimeout(230); }
  await shot(page, n);
};
if (want("intro")) {
  await page.goto(`${BASE}/fight?p1=sneaker&p2=toaster&arena=stage`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=FIGHT!", { timeout: 20000 }).catch(() => {});
  await shot(page, "fight-intro.png");
}
if (want("2p")) {
  await page.goto(`${BASE}/fight?p1=mug&p2=cactus&arena=stage&mode=2p`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6500);
  await page.keyboard.down("KeyD"); await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(600);
  await page.keyboard.up("KeyD"); await page.keyboard.up("ArrowLeft");
  for (let i = 0; i < 6; i++) { await page.keyboard.press(i % 2 ? "KeyK" : "KeyF"); await page.waitForTimeout(220); }
  await shot(page, "fight-2p.png");
}
if (want("practice")) await fight("p1=duck&p2=sneaker&arena=stage&mode=practice", "practice.png");
if (want("victory")) {
  await page.goto(`${BASE}/fight?p1=toaster&p2=cactus&arena=stage&debug=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);
  await page.evaluate(() => { window.__sim.f[1].hp = 12; });
  for (let i = 0; i < 90 && !(await page.locator("text=wins!").count()); i++) {
    await page.keyboard.down("KeyD"); await page.waitForTimeout(120); await page.keyboard.up("KeyD");
    await page.keyboard.press(i % 2 ? "KeyK" : "KeyJ"); await page.waitForTimeout(250);
  }
  await page.waitForTimeout(4000);
  await shot(page, "victory.png");
  await page.click('[data-action="ko-card"]');
  await page.waitForTimeout(2500);
  await shot(page, "ko-card.png");
  const clip = await page.locator('[data-action="clip"]').getAttribute("download").catch(() => null);
  console.log("clip download:", clip);
}
if (want("mobile")) {
  const m = await mk({ ...devices["iPhone 13"], deviceScaleFactor: 1, defaultBrowserType: undefined });
  await m.goto(BASE + "/", { waitUntil: "networkidle" });
  await m.waitForTimeout(4000);
  await shot(m, "mobile-landing.png");
  const ml = await mk({ ...devices["iPhone 13 landscape"], deviceScaleFactor: 1, defaultBrowserType: undefined });
  const m2 = ml;
  await m2.goto(`${BASE}/fight?p1=mug&p2=duck&arena=stage`, { waitUntil: "networkidle" });
  await m2.waitForSelector("[data-touchpad]", { timeout: 60000 }).catch(() => console.log("no touchpad"));
  await m2.waitForTimeout(3000);
  await m2.locator('[data-touch="punch"], button:has-text("PUNCH")').first().tap().catch((e) => console.log("tap:", e.message.split("\n")[0]));
  await m2.waitForTimeout(400);
  await shot(m2, "mobile-fight.png");
  const ov = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("mobile horizontal overflow:", ov);
}
console.log("errors:", [...new Set(errs)].slice(0, 10));
await browser.close();
