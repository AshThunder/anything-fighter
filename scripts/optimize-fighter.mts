// node scripts/optimize-fighter.mts <fighterDir>  — compress rigged.glb and strip anim-*.glb in place (keeps *.orig.glb)
import { promises as fs } from "node:fs";
import path from "node:path";
import { optimizeFighterGlb, stripToAnimation } from "../lib/optimize.ts";

const dir = process.argv[2];
for (const f of await fs.readdir(dir)) {
  if (!f.endsWith(".glb") || f.includes(".orig.")) continue;
  const p = path.join(dir, f);
  const orig = p.replace(/\.glb$/, ".orig.glb");
  try { await fs.access(orig); } catch { await fs.copyFile(p, orig); }
  const before = (await fs.stat(orig)).size;
  if (f.startsWith("anim-")) await stripToAnimation(orig, p, f.slice(5, -4));
  else await optimizeFighterGlb(orig, p);
  console.log(f, (before / 1e6).toFixed(1), "MB →", ((await fs.stat(p)).size / 1e6).toFixed(2), "MB");
}
