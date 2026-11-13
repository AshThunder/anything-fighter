/**
 * ONE live forge only. Refuses to run if the lock / result file already exists.
 * Share photo stays OFF. Photo = fire hydrant. Name = Hydra Punch.
 */
import { launchBrowser, withVideo, sleep, goto, PHOTO_HYDRANT, SITE, STILLS, CLIPS } from './lib.mjs';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LOCK = '/workspace/demo/clips/FORGE-LOCK.json';
const RESULT = '/workspace/demo/clips/FORGE-RESULT.json';
const TIMELINE = '/workspace/demo/clips/forge-timeline.json';

if (existsSync(LOCK) || existsSync(RESULT)) {
  console.error('REFUSING to run a second forge. Lock/result already exists:');
  if (existsSync(LOCK)) console.error(readFileSync(LOCK, 'utf8'));
  if (existsSync(RESULT)) console.error(readFileSync(RESULT, 'utf8'));
  process.exit(2);
}

writeFileSync(LOCK, JSON.stringify({ startedAt: new Date().toISOString(), name: 'Hydra Punch', photo: 'fire-hydrant.jpg', share: false }, null, 2));

const timeline = [];
const note = (event, extra = {}) => {
  const row = { t: Date.now(), event, ...extra };
  timeline.push(row);
  writeFileSync(TIMELINE, JSON.stringify(timeline, null, 2));
  console.log('TL', event, JSON.stringify(extra));
};

const browser = await launchBrowser();
let result = {
  fighterName: 'Hydra Punch',
  photo: 'fire-hydrant.jpg',
  sharePhoto: false,
  startedAt: new Date().toISOString(),
  success: false,
  mode: null,
  jobId: null,
  error: null,
  finalStatus: null,
  fightUrl: null,
  galleryUrl: SITE + '/gallery',
};

try {
  await withVideo(browser, 'M_live_forge', async (page) => {
    let pipelinePosts = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/pipeline(\/|\?|$)/.test(req.url())) {
        pipelinePosts += 1;
        note('pipeline-post', { n: pipelinePosts });
      }
    });
    page.on('response', async (res) => {
      if (res.request().method() === 'POST' && /\/api\/pipeline(\/|\?|$)/.test(res.url())) {
        try {
          const data = await res.json();
          const jobId = data?.job?.id || data?.id || null;
          const err = data?.error || null;
          note('pipeline-response', { status: res.status(), jobId, error: err ? String(err).slice(0, 200) : null, mode: data?.job?.mode || data?.mode || null });
          if (jobId) result.jobId = jobId;
          if (err) result.error = String(err).slice(0, 300);
        } catch {
          note('pipeline-response-nonjson', { status: res.status() });
        }
      }
    });

    await goto(page, '/');
    await page.waitForSelector('[data-forge-panel]');
    await page.waitForFunction(() => {
      const t = document.querySelector('[data-forge-panel]')?.innerText || '';
      return t.includes('Aholo live') || t.includes('Mock pipeline');
    }, { timeout: 30000 });
    const liveText = await page.locator('[data-forge-panel]').innerText();
    if (liveText.includes('Mock pipeline')) {
      result.error = 'Home badge showed Mock pipeline (no key) — not starting a forge that would be mock.';
      note('abort-mock-badge');
      throw new Error(result.error);
    }
    note('home-live-ok');

    await page.locator('[data-forge-panel]').scrollIntoViewIfNeeded();
    await page.locator('[data-forge-panel] input[type="file"]:not([capture])').setInputFiles(PHOTO_HYDRANT);
    await page.waitForFunction(() => /Forge it/i.test(document.querySelector('[data-action="forge"]')?.textContent || ''));
    await page.locator('#fighter-name').fill('Hydra Punch');
    // IMPORTANT: share stays OFF
    const shareOn = await page.locator('[data-share-photo] input[type="checkbox"]').first().isChecked();
    if (shareOn) {
      await page.locator('[data-share-photo] input[type="checkbox"]').first().uncheck();
    }
    await sleep(page, 2500); // hold the filled form on camera
    note('about-to-click-forge', { shareOn: false, name: 'Hydra Punch' });

    // SINGLE CLICK
    await page.locator('[data-action="forge"]').click({ timeout: 5000 });
    note('clicked-forge');

    // Wait for navigation or an on-form error. Do not click again.
    let raced = 'timeout';
    try {
      await page.waitForURL(/\/forge\/[^/]+/, { timeout: 45000 });
      raced = 'nav';
    } catch {
      if (await page.locator('[data-forge-panel] [role="alert"]').count()) raced = 'form-error';
      else if (/\/forge\//.test(page.url())) raced = 'nav';
    }
    note('after-click', { raced, url: page.url(), posts: pipelinePosts });

    if (raced === 'form-error') {
      const msg = (await page.locator('[data-forge-panel] [role="alert"]').innerText().catch(() => '')) || 'form error';
      result.error = msg.slice(0, 400);
      await page.screenshot({ path: join(STILLS, 'M_forge-form-error.png') });
      await sleep(page, 4000);
      throw new Error('Forge did not start: ' + result.error);
    }
    if (raced !== 'nav' && !/\/forge\//.test(page.url())) {
      result.error = 'Forge click did not navigate to /forge/:id';
      await page.screenshot({ path: join(STILLS, 'M_forge-no-nav.png') });
      await sleep(page, 4000);
      throw new Error(result.error);
    }

    const m = page.url().match(/\/forge\/([^/?#]+)/);
    if (m) result.jobId = m[1];
    note('on-forge-page', { jobId: result.jobId, url: page.url() });

    // Poll the stage UI until done, error, or 15 min
    const deadline = Date.now() + 15 * 60 * 1000;
    let lastStage = '';
    let practiceClicked = false;
    while (Date.now() < deadline) {
      const snap = await page.evaluate(() => {
        const root = document.querySelector('[data-forge]');
        const text = root?.innerText || document.body.innerText.slice(0, 2000);
        const eyebrow = document.querySelector('[data-forge] .eyebrow, [data-forge] span')?.innerText || '';
        const progress = document.querySelector('[data-forge-progress]')?.innerText || '';
        const demo = !!document.querySelector('[data-demo-forge]');
        const err = document.querySelector('[data-forge-error]')?.innerText || '';
        const ready = /is ready!/i.test(text);
        const fightNew = !!document.querySelector('[data-action="fight-new"]');
        const practice = !!document.querySelector('[data-action="practice"]');
        return { text: text.slice(0, 500), eyebrow, progress, demo, err: err.slice(0, 300), ready, fightNew, practice, title: document.querySelector('[data-forge] h1')?.innerText || '' };
      });

      if (snap.demo) result.mode = 'mock-limit';
      if (/Live · Aholo Lux3D/i.test(snap.eyebrow) || /Live · Aholo Lux3D/i.test(snap.text)) result.mode = result.mode || 'live';
      if (/Mock pipeline/i.test(snap.text)) result.mode = result.mode || 'mock';

      const stageKey = snap.progress + '|' + snap.title;
      if (stageKey !== lastStage) {
        lastStage = stageKey;
        note('stage', { progress: snap.progress, title: snap.title, mode: result.mode, demo: snap.demo });
        const safe = String(snap.progress || 'stage').replace(/[^\w]+/g, '-').slice(0, 40);
        await page.screenshot({ path: join(STILLS, `M_stage-${safe}.png`) }).catch(() => {});
      }

      if (snap.err) {
        result.error = snap.err;
        result.finalStatus = 'error';
        note('forge-error', { err: snap.err });
        await sleep(page, 5000);
        break;
      }
      if (snap.ready || snap.fightNew) {
        result.success = true;
        result.finalStatus = 'ready';
        result.fightUrl = result.jobId ? `${SITE}/fight?p1=${result.jobId}&p2=mug&arena=toy-shop&cpu=easy` : null;
        note('forge-ready', { jobId: result.jobId, mode: result.mode });
        await page.screenshot({ path: join(STILLS, 'M_ready.png') });
        await sleep(page, 6000); // hold the reveal
        break;
      }

      if (!practiceClicked && snap.practice) {
        await page.locator('[data-action="practice"]').click().catch(() => {});
        practiceClicked = true;
        note('practice-clicked');
        await sleep(page, 2000);
      }

      await sleep(page, 2000);
    }

    if (!result.success && !result.error) {
      result.finalStatus = 'timeout';
      result.error = 'Timed out waiting for the forge to finish (15 min).';
      note('timeout');
      await page.screenshot({ path: join(STILLS, 'M_timeout.png') }).catch(() => {});
    }
  }, { allowPipelinePost: true });
} catch (e) {
  result.error = result.error || e.message;
  result.finalStatus = result.finalStatus || 'failed';
  console.error('FORGE SCRIPT ERROR', e);
} finally {
  result.finishedAt = new Date().toISOString();
  writeFileSync(RESULT, JSON.stringify(result, null, 2));
  writeFileSync(TIMELINE, JSON.stringify(timeline, null, 2));
  await browser.close();
  console.log('FORGE RESULT', JSON.stringify(result, null, 2));
  // exit 0 even on failure — we must not retry; caller should read the result file
}

if (!result.success) process.exitCode = 0;
