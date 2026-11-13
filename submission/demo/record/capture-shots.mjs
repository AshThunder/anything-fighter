import { launchBrowser, withVideo, sleep, waitFightReady, skipVsAfter, mash, openKoCard, goto, PHOTO_DUCK, PHOTO_HYDRANT, STILLS } from './lib.mjs';

const want = new Set(process.argv.slice(2));
const run = (name) => want.size === 0 || want.has(name);
const failed = [];
async function shot(name, fn, opts) {
  if (!run(name)) return;
  try { await withVideo(browser, name, fn, opts); }
  catch (e) { failed.push(name); console.error('CONTINUE after', name, e.message); }
}

const browser = await launchBrowser();

try {
  await shot('A_hook', async (page) => {
      await goto(page, '/fight?p1=mug&p2=duck&arena=toy-shop&cpu=easy');
      await waitFightReady(page, 'A_hook');
      // keep VS for a beat (RenderCloud posters), then fight
      await sleep(page, 2000);
      await skipVsAfter(page, 0);
      await sleep(page, 2800); // intro
      await mash(page, 12);
    });

  await shot('B_home', async (page) => {
      await goto(page, '/');
      await page.waitForSelector('[data-forge-panel]', { timeout: 60000 });
      await page.waitForFunction(() => document.querySelector('[data-forge-panel]')?.innerText.includes('Aholo live') || document.querySelector('[data-forge-panel]')?.innerText.includes('Mock'));
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await sleep(page, 14000);
    });

  await shot('C_forge_form', async (page) => {
      await goto(page, '/');
      await page.waitForSelector('[data-forge-panel]');
      await page.locator('[data-forge-panel]').scrollIntoViewIfNeeded();
      const n = await page.locator('[data-forge-panel] input[type="file"]').count();
      console.log('C file inputs', n);
      await page.locator('[data-forge-panel] input[type="file"]').first().setInputFiles(PHOTO_HYDRANT);
      await page.waitForSelector('[data-forge-panel] img[alt="your object"]', { timeout: 15000 });
      await page.waitForFunction(() => /Forge it/i.test(document.querySelector('[data-action="forge"]')?.textContent || ''), { timeout: 10000 });
      await page.locator('#fighter-name').fill('Hydra Punch');
      await page.locator('[data-share-photo] input[type="checkbox"]').first().check();
      await page.waitForFunction(() => /I took this photo/i.test(document.querySelector('[data-share-photo]')?.innerText || ''));
      // hold so VO can cover the form — NEVER click forge
      await sleep(page, 20000);
    });

  await shot('D_gallery_roster', async (page) => {
      await goto(page, '/gallery');
      await page.waitForSelector('[data-gallery-card]', { timeout: 60000 });
      for (const id of ['mug', 'sneaker', 'duck', 'toaster', 'cactus']) {
        const card = page.locator(`[data-gallery-card="${id}"]`);
        if (await card.count()) {
          await card.scrollIntoViewIfNeeded();
          await sleep(page, 1800);
        }
      }
      await sleep(page, 1500);
    });

  await shot('E_select', async (page) => {
      await goto(page, '/');
      await page.waitForSelector('[data-select]');
      await page.locator('[data-select]').scrollIntoViewIfNeeded();
      await sleep(page, 1500);
      const mug = page.locator('[data-select] button[data-fighter="mug"]');
      if (await mug.count()) await mug.click();
      await sleep(page, 1200);
      // pick opponent slot if present, then duck
      const cpuSlot = page.locator('[data-select] [data-side="1"], [data-select] button:has-text("CPU"), [data-select] [data-slot="1"]');
      // click a slot labeled CPU / P2 if we can find one
      const sides = page.locator('[data-select] [data-side]');
      if ((await sides.count()) >= 2) await sides.nth(1).click();
      await sleep(page, 400);
      const duck = page.locator('[data-select] button[data-fighter="duck"]');
      if (await duck.count()) await duck.click();
      await sleep(page, 8000); // 3D versus preview
    });

  await shot('F_stages', async (page) => {
      await goto(page, '/');
      await page.waitForSelector('[data-stage-select]');
      await page.locator('[data-stage-select]').scrollIntoViewIfNeeded();
      await sleep(page, 1500);
      for (const id of ['toy-shop', 'rooftop-dojo', 'kitchen-colosseum', 'my-room']) {
        const card = page.locator(`[data-arena="${id}"]`).first();
        if (await card.count()) {
          await card.scrollIntoViewIfNeeded();
          await card.click();
          await sleep(page, 2200);
        }
      }
      // show room builder area without submitting
      const builder = page.locator('#forge ~ *, [data-stage-select]');
      await page.evaluate(() => {
        const el = document.querySelector('[data-stage-select]');
        el?.scrollIntoView({ block: 'start' });
      });
      await sleep(page, 2500);
    });

  await shot('G_fight_toyshop', async (page) => {
      await goto(page, '/fight?p1=mug&p2=duck&arena=toy-shop&cpu=easy');
      await waitFightReady(page, 'G_toyshop');
      await skipVsAfter(page, 1400);
      await sleep(page, 2600);
      const ko = await mash(page, 35);
      if (ko) {
        await sleep(page, 1500);
        await openKoCard(page);
        await sleep(page, 4000);
      }
    });

  await shot('G2_fight_rooftop', async (page) => {
      await goto(page, '/fight?p1=duck&p2=toaster&arena=rooftop-dojo&cpu=easy');
      await waitFightReady(page, 'G2_rooftop');
      await skipVsAfter(page, 1200);
      await sleep(page, 2500);
      await mash(page, 16);
    });

  await shot('H_fight_myroom', async (page) => {
      await goto(page, '/fight?p1=sneaker&p2=mug&arena=my-room&cpu=easy');
      await waitFightReady(page, 'H_myroom');
      await skipVsAfter(page, 1200);
      await sleep(page, 2500);
      await mash(page, 14);
    });

  await shot('I_gallery_detail', async (page) => {
      await goto(page, '/gallery');
      await page.waitForSelector('[data-gallery-card="mug"]', { timeout: 60000 });
      for (const id of ['mug', 'toaster', 'cactus', 'sneaker', 'duck']) {
        const card = page.locator(`[data-gallery-card="${id}"]`);
        if (await card.count()) {
          await card.scrollIntoViewIfNeeded();
          await sleep(page, 2500);
        }
      }
    });

  await shot('K_mobile_home', async (page) => {
      await goto(page, '/');
      await page.waitForSelector('[data-forge-panel]');
      await sleep(page, 2500);
      await page.locator('[data-forge-panel]').scrollIntoViewIfNeeded();
      await sleep(page, 3000);
      if (await page.locator('[data-select]').count()) {
        await page.locator('[data-select]').scrollIntoViewIfNeeded();
        await sleep(page, 3000);
      }
    }, { width: 412, height: 915, recW: 1080, recH: 1920, dsf: 2, isMobile: true });

  await shot('K_mobile_gallery', async (page) => {
      await goto(page, '/gallery');
      await page.waitForSelector('[data-gallery-card]', { timeout: 60000 });
      await sleep(page, 2000);
      await page.evaluate(async () => {
        window.scrollTo({ top: 400, behavior: 'smooth' });
      });
      await sleep(page, 4000);
    }, { width: 412, height: 915, recW: 1080, recH: 1920, dsf: 2, isMobile: true });

  await shot('K_mobile_fight', async (page) => {
      await goto(page, '/fight?p1=mug&p2=cactus&arena=toy-shop&cpu=easy');
      await waitFightReady(page, 'K_mobile');
      await skipVsAfter(page, 1000);
      await sleep(page, 2500);
      // use on-screen touch pad
      const punch = page.locator('[data-btn="punch"]');
      const kick = page.locator('[data-btn="kick"]');
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        if (await punch.count()) await punch.tap().catch(() => punch.click({ force: true }));
        await sleep(page, 200);
        if (await kick.count()) await kick.tap().catch(() => kick.click({ force: true }));
        await sleep(page, 280);
      }
    }, { width: 412, height: 915, recW: 1080, recH: 1920, dsf: 2, isMobile: true });

  await shot('L_close', async (page) => {
      await goto(page, '/');
      await page.waitForSelector('[data-forge-panel]');
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await sleep(page, 6000);
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
      await sleep(page, 5000);
    });

  console.log('ALL REQUESTED SHOTS DONE');
  if (failed.length) { console.error('failed shots', failed); process.exitCode = 1; }
} catch (e) {
  console.error('CAPTURE BATCH FAILED', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
