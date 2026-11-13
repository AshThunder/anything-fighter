// Aholo Reality: 3DGS reconstruction from a short room video → public/arenas/<id>/
// node --env-file=.env.local scripts/reconstruct-room.mjs <video.mp4> [id] [low|normal|high]
// Resumable: the worldId is persisted to public/arenas/<id>/world-id.txt and reused (no second paid create).
import { promises as fs } from "node:fs";
import path from "node:path";
import { api, download, makeLog, sleep, upload } from "./aholo-cli.mjs";

const [video, id = "my-room", quality = "low"] = process.argv.slice(2);
const dir = path.join(process.cwd(), "public", "arenas", id);
await fs.mkdir(dir, { recursive: true });
const idFile = path.join(dir, "world-id.txt");
const ids = (await fs.readFile(idFile, "utf8").catch(() => "")).split(/\s+/).filter(Boolean);
const resubmit = !ids.length || process.env.RESUBMIT === "1";
const { log, save, step } = makeLog(path.join(dir, `recon-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`), { id, quality, ids: [...ids] });
const T = `[${id}] `;
if (resubmit) {
  // No cancel endpoint exists, so a resubmit is an extra job; all ids are watched and the first SUCCEEDED wins.
  const buf = await fs.readFile(video);
  const url = await step(`upload video (${(buf.length / 1e6).toFixed(1)} MB, OUS block upload)`, () => upload(buf, "room.mp4"), T);
  const w = await step("reconstruction create", async (e) => {
    e.taskId = (await api("POST", "/global/world/v1/reconstructions", {
      name: "Fight in your room", resources: [{ url, type: "video" }], taskQuality: quality, scene: "space" })).worldId;
    return e.taskId;
  }, T);
  ids.push(w);
  await fs.writeFile(idFile, ids.join("\n"));
}
log.worldIds = ids;
const detail = await step("reconstruction (poll to SUCCEEDED)", async (e) => {
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
        console.log(`${T}${w} ${k} (upd ${new Date(d.updateTime).toTimeString().slice(0, 8)}) @${((Date.now() - t0) / 1000).toFixed(0)}s ${new Date().toTimeString().slice(0, 8)}`);
        last[w] = k;
        (e.statusChanges ??= []).push({ worldId: w, at: new Date().toISOString(), status: d.status, progress: d.progress, updateTime: d.updateTime });
        await save();
      }
      if (d.status === "SUCCEEDED") { log.worldId = w; return d; }
      if (/FAIL|CANCEL|TIMEOUT|REJECT/i.test(d.status ?? "")) { dead.add(w); (e.errors ??= []).push(JSON.stringify(d).slice(0, 600)); await save(); }
    }
    if (dead.size === ids.length) throw new Error(`all reconstruction jobs failed: ${e.errors.join(" | ")}`);
    if (Date.now() - t0 > 8 * 3600 * 1000) throw new Error("timeout (8h)");
    await sleep(15000);
  }
}, T);
const worldId = log.worldId;
log.detail = detail;
await step("download/rehost", async (e) => {
  const u = detail.assets?.splats?.urls ?? {};
  e.files = {};
  if (u.spzPath) e.files.spz = await download(u.spzPath, path.join(dir, "world.spz"));
  else if (u.plyPath) e.files.ply = await download(u.plyPath, path.join(dir, "world.ply"));
  if (detail.cover) e.files.cover = await download(detail.cover, path.join(dir, "cover.jpg")).catch(() => 0);
}, T);
await fs.writeFile(path.join(dir, "arena.json"), JSON.stringify({ id, name: "Your Room (Aholo Reality scan)", worldId, upAxis: detail.assets?.semanticsMetadata?.upAxis, source: "reality" }, null, 2));
log.finishedAt = new Date().toISOString();
await save();
