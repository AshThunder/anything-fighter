import { chromium } from 'playwright-core';
import { mkdirSync, renameSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const SITE = 'https://anything-fighter.vercel.app';
export const CHROME = '/usr/bin/google-chrome';
export const CLIPS = '/workspace/demo/clips';
export const STILLS = '/workspace/demo/clips/stills';
export const PHOTO_HYDRANT = '/workspace/anything-fighter/public/examples/fire-hydrant.jpg';
export const PHOTO_DUCK = '/workspace/anything-fighter/public/examples/rubber-duck.jpg';

mkdirSync(STILLS, { recursive: true });
mkdirSync(join(CLIPS, 'raw'), { recursive: true });
mkdirSync(join(CLIPS, 'mp4'), { recursive: true });

export const CHROME_ARGS = [
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-dev-shm-usage',
  '--disable-background-timer-throttling',
];

export async function launchBrowser() {
  return chromium.launch({ executablePath: CHROME, args: CHROME_ARGS, headless: true });
}

export async function guardPage(page, { allowPipelinePost = false } = {}) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await route.continue();
      return;
    }
    const isPipeline = /\/api\/pipeline(\/|\?|$)/.test(url);
    const isRoom = /\/api\/room(\/|\?|$)/.test(url);
    const isWorldCreate = /\/api\/arenas/.test(url) && method !== 'GET';
    if (isRoom || isWorldCreate) {
      console.log('BLOCKED', method, url.slice(0, 180));
      await route.abort('failed');
      return;
    }
    if (isPipeline && !allowPipelinePost) {
      console.log('BLOCKED', method, url.slice(0, 180));
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
}

export async function withVideo(browser, name, fn, { width = 1920, height = 1080, recW, recH, dsf = 1, isMobile = false, allowPipelinePost = false } = {}) {
  const recDir = join(CLIPS, 'raw', `tmp-${name}`);
  mkdirSync(recDir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    isMobile,
    hasTouch: isMobile,
    recordVideo: { dir: recDir, size: { width: recW || width, height: recH || height } },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await guardPage(page, { allowPipelinePost });
  let error = null;
  try {
    await fn(page);
    await page.screenshot({ path: join(STILLS, `${name}.png`), timeout: 30000 }).catch((e) => console.log('still fail', name, e.message));
  } catch (e) {
    error = e;
    console.error('SHOT ERROR', name, e?.message || e);
    await page.screenshot({ path: join(STILLS, `${name}-error.png`), timeout: 15000 }).catch(() => {});
  }
  const vid = page.video();
  await ctx.close().catch(() => {});
  if (vid) {
    const src = await vid.path();
    const dest = join(CLIPS, 'raw', `${name}.webm`);
    if (src && existsSync(src)) {
      renameSync(src, dest);
      const { statSync } = await import('node:fs');
      console.log('saved', dest, statSync(dest).size, 'bytes', error ? `(with error: ${error.message})` : 'ok');
    } else {
      console.error('VIDEO MISSING for', name, 'path was', src);
      if (!error) error = new Error('video file missing for ' + name);
    }
  }
  if (error) throw error;
}

export async function sleep(page, ms) {
  await page.waitForTimeout(ms);
}

export async function waitFightReady(page, label = 'fight') {
  await page.waitForSelector('[data-game-root], [data-hud], [data-vs-splash]', { timeout: 90000 });
  // Give GameScene a moment to mount the splat layer before deciding there isn't one.
  await page.waitForTimeout(2000);
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-game-root]');
      const kind = root?.getAttribute('data-arena');
      const s = document.querySelector('[data-splat-state]');
      if (kind === 'splat' || s) {
        if (!s) return false;
        const st = s.getAttribute('data-splat-state');
        return st === 'ready' || st === 'failed';
      }
      return !!root;
    }, { timeout: 80000 });
  } catch {
    console.log(label, 'splat wait timed out');
  }
  const info = await page.evaluate(() => ({
    splat: document.querySelector('[data-splat-state]')?.getAttribute('data-splat-state') || 'none',
    arena: document.querySelector('[data-game-root]')?.getAttribute('data-arena') || '?',
  }));
  console.log(label, 'splat=', info.splat, 'arena=', info.arena, 'vs=', await page.locator('[data-vs-splash]').count());
  return info.splat;
}

export async function skipVsAfter(page, ms = 1600) {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const n = await page.locator('[data-vs-splash]').count();
    if (n && Date.now() - t0 >= ms) {
      await page.locator('[data-vs-splash]').click({ force: true }).catch(() => {});
      break;
    }
    if (!n) break;
    await page.waitForTimeout(200);
  }
  // wait until fight actually starts (combo hint / touchpad / fight flash)
  await page.waitForSelector('[data-combo-hint], [data-touchpad], [data-hud]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
}

export async function mash(page, seconds) {
  const end = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < end) {
    if (await page.locator('[data-victory], [data-ko]').count()) {
      console.log('KO/victory reached at', i);
      return true;
    }
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(160);
    await page.keyboard.up('KeyD');
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(140);
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(140);
    await page.keyboard.press('KeyK');
    await page.waitForTimeout(280);
    if (i % 3 === 2) {
      await page.keyboard.press('KeyU');
      await page.waitForTimeout(420);
    }
    if (i % 5 === 4) {
      await page.keyboard.press('KeyI');
      await page.waitForTimeout(300);
    }
    i++;
  }
  return (await page.locator('[data-victory], [data-ko]').count()) > 0;
}

export async function openKoCard(page) {
  const ko = page.locator('[data-action="ko-card"]');
  if (await ko.count()) {
    await ko.click();
    await page.waitForTimeout(2000);
    return true;
  }
  return false;
}

export async function goto(page, path, wait = 'domcontentloaded') {
  const url = path.startsWith('http') ? path : SITE + path;
  await page.goto(url, { waitUntil: wait, timeout: 90000 });
}
