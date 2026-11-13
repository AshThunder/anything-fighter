// One real end-to-end Lux3D run: photo → OUS upload → mascot image → img-to-3d (Turbo) → auto-rig → retarget (Idle + Punch)
// Run: node --env-file=.env.local scripts/e2e-test.mjs <photo.jpg> [id]
// Never prints the API key. Writes public/fighters/<id>/ + e2e-log.json with per-step latency.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const KEY = process.env.AHOLO_API_KEY;
if (!KEY) throw new Error("AHOLO_API_KEY missing");
const BASE = "https://api.aholo.ai";
const photoPath = process.argv[2];
const ID = process.argv[3] ?? "test-1";
const DIR = path.join(process.cwd(), "public", "fighters", ID);
await fs.mkdir(DIR, { recursive: true });
const log = { id: ID, startedAt: new Date().toISOString(), steps: [] };
const save = () => fs.writeFile(path.join(DIR, "e2e-log.json"), JSON.stringify(log, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { Authorization: KEY, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(`${p} → ${r.status} ${t.slice(0, 300)}`); }
  if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  if ("c" in j && j.c !== "0") throw new Error(`${p} → c=${j.c} m=${j.m}`);
  return "c" in j ? j.d : j;
}

async function step(name, fn) {
  const t0 = Date.now();
  console.log(`▶ ${name}`);
  const entry = { name, startedAt: new Date(t0).toISOString() };
  log.steps.push(entry);
  try {
    const res = await fn(entry);
    entry.ms = Date.now() - t0;
    console.log(`  ✓ ${name} ${(entry.ms / 1000).toFixed(1)}s`);
    await save();
    return res;
  } catch (e) {
    entry.ms = Date.now() - t0;
    entry.error = String(e.message ?? e);
    console.log(`  ✗ ${name}: ${entry.error}`);
    await save();
    throw e;
  }
}

async function poll(taskid, entry, every = 10000, maxMs = 20 * 60 * 1000) {
  const t0 = Date.now();
  entry.taskId = taskid;
  entry.polls = [];
  for (;;) {
    const d = await api("GET", `/global/lux3d/v1/generate/task/get?taskid=${taskid}`);
    entry.polls.push({ t: Date.now() - t0, status: d.status });
    if (d.status === 3) return d.outputs ?? [];
    if (d.status === 4 || d.status === 6) throw new Error(`task ${taskid} status ${d.status}: ${JSON.stringify(d.outputs).slice(0, 400)}`);
    if (Date.now() - t0 > maxMs) throw new Error(`task ${taskid} timed out`);
    await sleep(every);
  }
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${file} ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(path.join(DIR, file), buf);
  return { file, bytes: buf.length };
}

// 1. upload
const buf = await fs.readFile(photoPath);
await fs.writeFile(path.join(DIR, "photo.jpg"), buf);
const photoUrl = await step("upload (OUS)", async (e) => {
  const tok = await api("GET", "/global/asset/v1/token");
  e.blockSize = tok.blockSize;
  e.globalDomain = tok.globalDomain;
  const form = new FormData();
  form.set("md5", createHash("md5").update(buf).digest("hex"));
  form.set("file", new Blob([buf], { type: "application/octet-stream" }), "photo.jpg");
  const up = await (await fetch(`${tok.globalDomain}/ous/api/v2/single/upload`, { method: "POST", headers: { "ous-token-v2": tok.ousToken }, body: form })).json();
  if (up.c !== "0") throw new Error(`upload ${JSON.stringify(up)}`);
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    const st = await (await fetch(`${tok.globalDomain}/ous/api/v2/upload/status`, { headers: { "ous-token-v2": tok.ousToken } })).json();
    if (st.d?.status === 5 && st.d.url) return (e.url = st.d.url);
    if ([6, 8].includes(st.d?.status)) throw new Error(`upload status ${JSON.stringify(st)}`);
  }
  throw new Error("upload timeout");
});

// 2. mascot image (object → humanoid fighter concept)
const PROMPT =
  "Turn the main object in this image into a full-body humanoid fighting-game character: two arms, two legs, a head, " +
  "standing upright in a T-pose, facing the camera, full body visible, keep the object's original colours, materials and " +
  "recognisable shape as the body/costume, plain light-grey studio background, no text.";
const mascotUrl = await step("multimodal-to-image (mascot)", async (e) => {
  const id = await api("POST", "/global/lux3d/v1/generate/multimodal-to-image/task/create", { img: photoUrl, prompt: PROMPT });
  const out = await poll(id, e, 5000);
  e.output = out.map((o) => o.content);
  await download(out[0].content, "mascot.png");
  return out[0].content;
});

// 3. image → 3D (G1-Turbo, GLB, PBR)
const meshUrl = await step("img-to-3d G1-Turbo", async (e) => {
  const id = await api("POST", "/global/lux3d/v1/generate/img-to-3d/task/create", {
    img: mascotUrl, version: "G1-Turbo", faceCount: 60000, outputFormat: ["glb"], enablePbr: true, aiPredictSize: true,
  });
  const out = await poll(id, e);
  e.output = out.map((o) => o.content);
  const glb = out.map((o) => o.content).find((u) => u && /\.glb/i.test(u)) ?? out[0].content;
  e.download = await download(glb, "mesh.glb");
  return glb;
});

// 4. humanoid auto-rig
const rigUrl = await step("humanoid auto-rig", async (e) => {
  const id = await api("POST", "/global/lux3d/v1/animations/rig/task/create", { modelUrl: meshUrl });
  const out = await poll(id, e);
  e.output = out.map((o) => o.content);
  const c = out[0]?.content;
  if (!c || c.trim().startsWith("{")) throw new Error(`rig failed: ${c}`);
  e.download = await download(c, "rigged.glb");
  return c;
});

// 5. retarget Idle + Punch (separate GLBs, in place)
await step("animation retarget (Idle_Loop, Punch_Jab)", async (e) => {
  const id = await api("POST", "/global/lux3d/v1/animations/retarget/task/create", {
    rigModelUrl: rigUrl, animationIds: ["Idle_Loop", "Punch_Jab"], animationOutputMode: "separate", outFormat: "glb", animateInPlace: true,
  });
  const out = await poll(id, e);
  e.output = out.map((o) => o.content);
  const parsed = JSON.parse(out[0].content);
  e.actions = parsed.actions;
  const map = { Idle_Loop: "idle", Punch_Jab: "punch" };
  for (const a of parsed.actions ?? []) {
    if (a.status === "success" && a.animationGlbUrl) await download(a.animationGlbUrl, `anim-${map[a.animation_id]}.glb`);
  }
});

const fighter = {
  id: ID,
  name: "Hydro Hydrant",
  tagline: "Forged by Aholo Lux3D (real E2E test)",
  modelUrl: `/api/assets/${ID}/rigged.glb`,
  animUrls: { idle: `/api/assets/${ID}/anim-idle.glb`, punch: `/api/assets/${ID}/anim-punch.glb` },
  thumbUrl: `/api/assets/${ID}/mascot.png`,
  color: "#ef4444",
  source: "lux3d",
  createdAt: Date.now(),
};
await fs.writeFile(path.join(DIR, "fighter.json"), JSON.stringify(fighter, null, 2));
log.finishedAt = new Date().toISOString();
log.totalMs = log.steps.reduce((s, x) => s + (x.ms ?? 0), 0);
await save();
console.log("DONE total", (log.totalMs / 1000).toFixed(1), "s");
