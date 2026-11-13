import { chromium } from 'playwright-core';
const B='https://anything-fighter.vercel.app';
const b = await chromium.launch({executablePath:'/usr/bin/google-chrome', args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const jobs = JSON.parse(process.argv[2]);
for (const [name,url,w,h,wait,full] of jobs) {
  const ctx = await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:(w>1000?1.5:2)});
  const p = await ctx.newPage();
  try { await p.goto(B+url,{waitUntil:'networkidle',timeout:90000}); } catch(e){ console.log('nav',name,e.message.slice(0,80)); }
  await p.waitForTimeout(wait);
  await p.screenshot({path:`/workspace/report/assets/${name}.png`, fullPage:!!full, timeout:180000, animations:'allow'});
  console.log('ok',name); await ctx.close();
}
await b.close();
