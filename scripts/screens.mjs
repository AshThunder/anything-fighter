// Usage: node scripts/screens.mjs [baseUrl]  → screens/*.png
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
const globalRoot = execSync("npm root -g").toString().trim();
const { chromium } = require(`${globalRoot}/playwright`);

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = new URL("../screens/", import.meta.url).pathname;
const only = process.env.ONLY;

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

if (!only || only === "landing") {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: OUT + "landing.png", fullPage: true });
  console.log("landing.png");
}

const fight = async (q, name, { punches = 0, wait = 4500 } = {}) => {
  await page.goto(`${BASE}/fight?${q}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyD");
  for (let i = 0; i < punches; i++) {
    await page.keyboard.press(i % 3 === 2 ? "KeyK" : "KeyJ");
    await page.waitForTimeout(260);
  }
  await page.screenshot({ path: OUT + name });
  console.log(name);
};

if (!only || only === "fight") await fight("p1=mug&p2=duck&arena=stage", "fight.png", { punches: 5 });
if (only === "custom") await fight(process.env.Q, process.env.NAME ?? "custom.png", { punches: Number(process.env.PUNCHES ?? 4), wait: Number(process.env.WAIT ?? 6000) });
if (!only || only === "victory") {
  await page.goto(`${BASE}/fight?p1=${process.env.VP1 ?? "toaster"}&p2=cactus&arena=stage&debug=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  await page.evaluate(() => { window.__sim.f[1].hp = 12; });
  for (let i = 0; i < 90; i++) {
    const done = await page.locator("text=wins!").count();
    if (done) break;
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(120);
    await page.keyboard.up("KeyD");
    await page.keyboard.press(i % 2 ? "KeyK" : "KeyJ");
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "victory.png" });
  console.log("victory.png");
}
console.log(logs.slice(0, 25).join("\n"));
await browser.close();
