// SpatialGen: generate arenas sequentially (free plan = 1 concurrent SpatialGen task), rehost splat + pano to public/arenas/<id>/
// node --env-file=.env.local scripts/gen-worlds.mjs
import { promises as fs } from "node:fs";
import path from "node:path";
import { api, download, makeLog, sleep } from "./aholo-cli.mjs";

const ARENAS = [
  { id: "kitchen-colosseum", name: "Kitchen Colosseum", indoor: true,
    prompt: "An abandoned industrial restaurant kitchen turned into a fighting colosseum: a wide open empty floor in the centre, stainless steel counters and stacked pots around the edges, hanging pans, warm tungsten lights, cinematic, game arena" },
  { id: "toy-shop", name: "Toy Shop at Midnight", indoor: true,
    prompt: "A large old toy shop at midnight, wide open empty wooden floor in the centre, tall shelves of colourful toys, plush animals, model trains along the walls, moonlight through big windows mixed with warm lamp glow, magical, game arena" },
  { id: "rooftop-dojo", name: "Rooftop Dojo at Sunset", indoor: false,
    prompt: "A martial arts dojo platform on a city rooftop at sunset, open empty wooden floor in the centre, low railings, paper lanterns, distant skyscraper skyline, golden orange sky, cinematic, game arena" },
];
const only = process.argv[2];
await Promise.all(ARENAS.filter((x) => !only || x.id === only).map(async (a) => {
  const dir = path.join(process.cwd(), "public", "arenas", a.id);
  await fs.mkdir(dir, { recursive: true });
  const { log, save, step } = makeLog(path.join(dir, "gen-log.json"), { id: a.id, prompt: a.prompt });
  try {
    // Resume: world-id.txt holds every world id submitted for this arena (one per line, oldest first).
    // RESUBMIT=1 creates one more job (there is no cancel endpoint). We watch all of them; the first SUCCEEDED wins.
    const idFile = path.join(dir, "world-id.txt");
    const ids = (await fs.readFile(idFile, "utf8").catch(() => "")).split(/\s+/).filter(Boolean);
    if (!ids.length || process.env.RESUBMIT === "1") {
      const id = await step("world generation create", async (e) => {
        const w = (await api("POST", "/global/world/v1/generations", { name: a.name, prompt: a.prompt })).worldId;
        e.taskId = w;
        return w;
      }, `[${a.id}] `);
      ids.push(id);
      await fs.writeFile(idFile, ids.join("\n"));
    }
    log.worldIds = ids;
    const detail = await step("world generation (poll to SUCCEEDED)", async (e) => {
      e.taskIds = ids;
      const t0 = Date.now();
      const last = {};
      const dead = new Set();
      for (;;) {
        for (const w of ids) {
          if (dead.has(w)) continue;
          const d = await api("GET", `/global/world/v1/${w}`);
          const k = `${d.status} ${d.progress}`;
          if (k !== last[w]) {
            console.log(`[${a.id}] ${w} ${k} (upd ${new Date(d.updateTime).toTimeString().slice(0, 8)}) @${((Date.now() - t0) / 1000).toFixed(0)}s ${new Date().toTimeString().slice(0, 8)}`);
            last[w] = k;
            (e.statusChanges ??= []).push({ worldId: w, at: new Date().toISOString(), status: d.status, progress: d.progress, updateTime: d.updateTime });
            await save();
          }
          if (d.status === "SUCCEEDED") { log.worldId = w; return d; }
          if (/FAIL|CANCEL|TIMEOUT|REJECT/i.test(d.status ?? "")) { dead.add(w); (e.errors ??= []).push(JSON.stringify(d).slice(0, 600)); await save(); }
        }
        if (dead.size === ids.length) throw new Error(`all world jobs failed: ${e.errors.join(" | ")}`);
        if (Date.now() - t0 > 8 * 3600 * 1000) throw new Error("timeout (8h)");
        await sleep(15000);
      }
    }, `[${a.id}] `);
    const worldId = log.worldId;
    log.detail = detail;
    await step("download/rehost", async (e) => {
      const u = detail.assets?.splats?.urls ?? {};
      e.files = {};
      if (detail.assets?.imagery?.panoUrl) e.files.pano = await download(detail.assets.imagery.panoUrl, path.join(dir, "pano" + (path.extname(new URL(detail.assets.imagery.panoUrl).pathname) || ".jpg")));
      if (u.spzPath) e.files.spz = await download(u.spzPath, path.join(dir, "world.spz"));
      if (u.lodMetaPath) e.files.lodMeta = await download(u.lodMetaPath, path.join(dir, "lod-meta.json"));
      if (!u.spzPath && u.plyPath) e.files.ply = await download(u.plyPath, path.join(dir, "world.ply"));
      if (detail.cover) e.files.cover = await download(detail.cover, path.join(dir, "cover.jpg")).catch(() => 0);
    }, `[${a.id}] `);
    await fs.writeFile(path.join(dir, "arena.json"), JSON.stringify({ id: a.id, name: a.name, prompt: a.prompt, worldId, upAxis: detail.assets?.semanticsMetadata?.upAxis, indoor: a.indoor }, null, 2));
  } catch (e) { console.log(`[${a.id}] FAILED ${e.message}`); }
  log.finishedAt = new Date().toISOString();
  await save();
}));
