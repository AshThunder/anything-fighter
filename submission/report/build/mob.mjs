import { chromium } from 'playwright-core';
const B='https://anything-fighter.vercel.app';
const b = await chromium.launch({executablePath:'/usr/bin/google-chrome', args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist']});
for (const [name,url,w,h,wait] of [["m-fight-land","/fight?p1=duck&p2=toaster&arena=rooftop-dojo&mode=practice",915,412,25000],["m-fight","/fight?p1=cactus&p2=sneaker&arena=toy-shop&mode=practice",412,915,25000],["m-home","/",412,915,5000]]) {
  const ctx = await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:2, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'});
  const p = await ctx.newPage();
  try { await p.goto(B+url,{waitUntil:'networkidle',timeout:90000}); } catch(e){ console.log('nav',name); }
  await p.waitForTimeout(wait);
  await p.screenshot({path:`/workspace/report/assets/${name}.png`, timeout:180000});
  console.log('ok',name); await ctx.close();
}
await b.close();
