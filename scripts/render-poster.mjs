// RenderCloud fighter poster: posed GLB → OUS upload → mesh-upload-process → USDA scene → offline render job → PNG
// node --env-file=.env.local scripts/render-poster.mjs <fighterId> [posed.glb] [WxH]
import { promises as fs } from "node:fs";
import path from "node:path";
import { api, download, makeLog, sleep, upload } from "./aholo-cli.mjs";
import { BACKDROP, buildPosterUsda } from "../lib/poster-usda.ts";

const [id, glbArg, res = "1080x1350"] = process.argv.slice(2);
const dir = path.join(process.cwd(), "public", "posters", id);
await fs.mkdir(dir, { recursive: true });
const glb = glbArg ?? path.join(dir, "posed.glb");
const [W, H] = res.split("x").map(Number);
const T = `[poster ${id}] `;
const logFile = path.join(dir, "render-log.json");
let prev = {};
try { prev = JSON.parse(await fs.readFile(logFile, "utf8")); } catch {}
const { log, save, step } = makeLog(logFile, { id, res, meshId: prev.meshId });

// RenderCloud results use {success,data,errorMsg}
async function rc(method, p, body) {
  const j = await api(method, p, body, { raw: true });
  // Docs say {success,data,errorMsg}; the live gateway returns the Lux3D-style {c,m,d} envelope.
  if (j && j.success === false) throw new Error(`${p}: ${j.errorMsg}`);
  if (j && "c" in j) { if (j.c !== "0") throw new Error(`${p}: c=${j.c} ${j.m}`); return j.d; }
  return "success" in j ? j.data : j;
}

let meshId = prev.meshId;
if (!meshId || process.env.REUPLOAD) {
  const url = process.env.MESH_TASK ? null : await step("upload posed GLB (OUS)", async () => upload(await fs.readFile(glb), "posed.glb"), T);
  meshId = await step("mesh-upload-process", async (e) => {
    const cr = process.env.MESH_TASK ?? (await rc("POST", "/global/rendercloud/v1/mesh-upload-process/task/create", { originMeshUrl: url, fastUpload: process.env.FAST === "1" }));
    e.createResponse = cr;
    const taskid = typeof cr === "object" && cr ? (cr.taskId ?? cr.taskid ?? cr.data ?? cr.id) : cr;
    console.log(T + "create →", JSON.stringify(cr).slice(0, 200));
    e.taskId = String(taskid);
    for (let i = 0; i < 240; i++) {
      const d = await rc("GET", `/global/rendercloud/v1/mesh-upload-process/task/get?taskid=${taskid}`);
      if (i === 0) console.log(T + "get →", JSON.stringify(d).slice(0, 300));
      if (d.status === 3) { e.outputs = d.outputs; return d.outputs?.[0]?.content; } // [1] = JSON bbox in mm (Z-up, centred)
      if (d.status === 4) throw new Error(`mesh ingest failed ${JSON.stringify(d).slice(0, 300)}`);
      await sleep(5000);
    }
    throw new Error("mesh ingest timeout");
  }, T);
  log.meshId = meshId;
  await save();
}

const num = (k, d) => (process.env[k] !== undefined ? Number(process.env[k]) : d);
let splat;
if (process.env.SPLAT_ID) splat = { id: process.env.SPLAT_ID, matrix: process.env.SPLAT_MATRIX ?? "((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1))" };
const usda = buildPosterUsda({
  meshId, width: W, height: H, yawDeg: num("YAW_DEG", -25), key: num("KEY", 60), rim: num("RIM", 1200), gi: num("GI", 0.35),
  camDist: num("CAM_D", 4200), camHeight: num("CAM_H", 1000), splat,
  extras: process.env.NO_BACKDROP ? [] : [BACKDROP],
});
await fs.writeFile(path.join(dir, "scene.usda"), usda);
const tag = process.env.TAG ?? "v1";
const result = await step(`offline render ${W}x${H} (${tag})`, async (e) => {
  const sub = await api("POST", "/global/rendercloud/v1/jobs", { requestId: `af-${id}-${Date.now()}`, usdContent: Buffer.from(usda, "utf8").toString("base64") }, { raw: true });
  const op = sub.operationId;
  if (!op) throw new Error(`submit ${JSON.stringify(sub).slice(0, 300)}`);
  e.taskId = op;
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const d = await api("POST", "/global/rendercloud/v1/jobs", { operationId: op }, { raw: true });
    if (d.done && d.result?.resultUrl) return d.result.resultUrl;
    if (d.done) throw new Error(`render failed ${JSON.stringify(d.error).slice(0, 400)}`);
  }
  throw new Error("render timeout");
}, T);
await download(result, path.join(dir, `render-${tag}.png`));
log.finishedAt = new Date().toISOString();
await save();
console.log(`${T}saved render-${tag}.png`);
