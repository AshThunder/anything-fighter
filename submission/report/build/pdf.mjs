import { chromium } from 'playwright-core';
const b = await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const p = await b.newPage();
await p.goto('file:///workspace/report/Anything-Fighter-Report.html',{waitUntil:'networkidle'});
await p.evaluate(()=>document.fonts.ready);
// overflow check
const of = await p.evaluate(()=>[...document.querySelectorAll('.page')].map((pg,i)=>{const ft=pg.querySelector(".foot"); const lim=ft?ft.getBoundingClientRect().top-6:pg.getBoundingClientRect().bottom-40; let mx=0; pg.querySelectorAll('*:not(.foot):not(.foot *)').forEach(e=>{if(e.closest('.foot')||e.closest('.meta'))return; const r=e.getBoundingClientRect(); if(r.height>0) mx=Math.max(mx,r.bottom)}); return [i+1, Math.round(mx-lim)]}));
console.log(JSON.stringify(of));
await p.pdf({path:'/workspace/report/Anything-Fighter-Report.pdf',preferCSSPageSize:true,printBackground:true});
await b.close();
