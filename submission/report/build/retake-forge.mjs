import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const SITE = 'https://anything-fighter.vercel.app';
const PHOTO = '/workspace/anything-fighter/public/examples/rubber-duck.jpg';
const CHROME = '/usr/bin/google-chrome';
const OUT = '/workspace/shots/live-forge';

function blocked(url, method) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return /\/api\/(pipeline|room|world|arenas|fighters|moderation)/i.test(url)
    || /ous-sg\.kujiale\.com|lux3d|rendercloud|spatialgen/i.test(url);
}

async function prep(page, label) {
  let blockedCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (blocked(req.url(), req.method())) {
      blockedCount++;
      console.log('BLOCKED', label, req.method(), req.url().slice(0, 160));
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.goto(SITE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('[data-forge-panel]', { timeout: 60000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-forge-panel]');
    const t = el ? el.innerText : '';
    return t.includes('Aholo live') || t.includes('Mock pipeline');
  }, { timeout: 30000 });
  const text = await page.locator('[data-forge-panel]').innerText();
  if (text.includes('Mock pipeline')) {
    throw new Error(`${label}: live site still shows Mock pipeline — aborting, will not replace assets`);
  }
  if (!text.includes('Aholo live')) {
    throw new Error(`${label}: expected Aholo live badge`);
  }
  // Set the example photo (local state only — does not start a job)
  await page.locator('[data-forge-panel] input[type="file"]:not([capture])').setInputFiles(PHOTO);
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-forge-panel] img[alt="your object"]');
    const btn = document.querySelector('[data-forge-panel] [data-action="forge"]');
    return !!(img && btn && /Forge it/i.test(btn.textContent || ''));
  }, { timeout: 15000 });
  // Tick opt-in AFTER file pick (pick() resets sharePhoto)
  await page.locator('[data-share-photo] input[type="checkbox"]').first().check();
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-share-photo]');
    return box && /I took this photo/i.test(box.innerText);
  }, { timeout: 10000 });
  // Leave attestation unchecked so the form still shows that consent is required.
  await page.locator('[data-forge-panel]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  return () => blockedCount;
}

async function clipPanel(page, path, pad = 14) {
  const loc = page.locator('[data-forge-panel]');
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await loc.boundingBox();
  if (!box) throw new Error('no bounding box for forge panel');
  const vp = page.viewportSize();
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const width = Math.min(vp.width - x, box.width + pad * 2);
  const height = Math.min(vp.height - y, box.height + pad * 2);
  if (height < box.height) {
    throw new Error(`viewport too short to contain panel: panel ${box.height}px, clip ${height}px, vp ${vp.width}x${vp.height}, box y=${box.y}`);
  }
  await page.screenshot({
    path,
    clip: { x, y, width, height },
    animations: 'disabled',
    timeout: 60000,
  });
  console.log('wrote', path, { x, y, width, height, panel: box });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

// Desktop — matches original 1280x800 framing; dsf 2 for print sharpness
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const getBlocked = await prep(page, 'desktop');
  await page.screenshot({ path: `${OUT}/desktop-full.png`, animations: 'disabled', timeout: 60000 });
  await clipPanel(page, `${OUT}/desktop-panel.png`, 16);
  const txt = await page.locator('[data-forge-panel]').innerText();
  writeFileSync(`${OUT}/desktop-text.txt`, txt);
  console.log('desktop blocked POSTs:', getBlocked());
  console.log('desktop panel text has Mock?', txt.includes('Mock pipeline'), 'has Aholo live?', txt.includes('Aholo live'));
  await ctx.close();
}

// Mobile — 412 CSS px like the original, taller so the full panel fits, dsf 2
{
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 1400 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const getBlocked = await prep(page, 'mobile');
  await page.screenshot({ path: `${OUT}/mobile-full.png`, animations: 'disabled', timeout: 60000 });
  await clipPanel(page, `${OUT}/mobile-panel.png`, 12);
  const txt = await page.locator('[data-forge-panel]').innerText();
  writeFileSync(`${OUT}/mobile-text.txt`, txt);
  console.log('mobile blocked POSTs:', getBlocked());
  console.log('mobile panel text has Mock?', txt.includes('Mock pipeline'), 'has Aholo live?', txt.includes('Aholo live'));
  await ctx.close();
}

await browser.close();
console.log('done');
