import { launchBrowser, withVideo, sleep, waitFightReady, skipVsAfter, mash, openKoCard, goto, SITE } from './lib.mjs';
import { readFileSync, existsSync } from 'node:fs';

const RESULT = '/workspace/demo/clips/FORGE-RESULT.json';
if (!existsSync(RESULT)) {
  console.error('No forge result; skip hydra fight');
  process.exit(0);
}
const r = JSON.parse(readFileSync(RESULT, 'utf8'));
if (!r.success || !r.jobId) {
  console.error('Forge did not succeed; skip hydra fight', r.finalStatus, r.error);
  process.exit(0);
}
const id = r.jobId;
const url = `/fight?p1=${encodeURIComponent(id)}&p2=mug&arena=toy-shop&cpu=easy`;
console.log('Recording Hydra Punch fight', url);
const browser = await launchBrowser();
try {
  await withVideo(browser, 'N_hydra_fight', async (page) => {
    await goto(page, url);
    await waitFightReady(page, 'N_hydra');
    await skipVsAfter(page, 1400);
    await sleep(page, 2600);
    const ko = await mash(page, 22);
    if (ko) {
      await sleep(page, 1200);
      await openKoCard(page);
      await sleep(page, 4000);
    }
  });
} finally {
  await browser.close();
}
console.log('hydra fight done');
