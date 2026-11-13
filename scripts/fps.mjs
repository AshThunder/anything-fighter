// fps sanity: node scripts/fps.mjs [query]  — counts rAF frames for 5 s mid-fight (headless swiftshader = CPU GL, a worst case)
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(`${execSync("npm root -g").toString().trim()}/playwright`);
const q = (process.argv[2] ?? "p1=mug&p2=duck&arena=stage") + "&debug=1";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const vp of [{ width: 1280, height: 720 }, { width: 800, height: 450 }]) {
  const p = await b.newPage({ viewport: vp });
  await p.goto(`http://localhost:3100/fight?${q}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(8000);
  const r = await p.evaluate(() => new Promise((res) => {
    const ts = []; let on = true;
    const f = (t) => { ts.push(t); if (on) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    setTimeout(() => {
      on = false;
      const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b);
      res({ fps: +(ts.length / 5).toFixed(1), p50: d.length ? +d[d.length >> 1].toFixed(1) : null, p95: d.length ? +d[Math.floor(d.length * 0.95)].toFixed(1) : null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null });
    }, 5000);
  }));
  r.render = await p.evaluate(() => new Promise((res) => {
    const g = window.__gl; if (!g) return res(null);
    g.info.autoReset = false; g.info.reset();
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else {
      const i = g.info; res({ framesSampled: n, callsPerFrame: Math.round(i.render.calls / n), trianglesPerFrame: Math.round(i.render.triangles / n), geometries: i.memory.geometries, textures: i.memory.textures, dpr: g.getPixelRatio() });
    } };
    requestAnimationFrame(f);
  }));
  console.log(q, `${vp.width}x${vp.height}`, JSON.stringify(r));
  await p.close();
}
await b.close();
