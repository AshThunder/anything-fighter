// Full Lux3D fighter pipeline from a self-generated source photo (no web photos):
// text→photo (multimodal-to-image) → mascot (img+prompt) → img-to-3d G1-Turbo → auto-rig → retarget 10 presets → rehost + optimise.
// node --env-file=.env.local scripts/forge-fighter.mjs <rosterId>    (or "all" — runs the 5 in parallel, ≤5 concurrent Lux3D tasks)
import { promises as fs } from "node:fs";
import path from "node:path";
import { api, download, makeLog, pollLux } from "./aholo-cli.mjs";
import { optimizeFighterGlb, stripToAnimation } from "../lib/optimize.ts";

export const ROSTER = [
  { id: "mug", name: "Mug Shot", color: "#f59e0b", tagline: "Fully caffeinated. Zero chill.",
    object: "a classic glossy white ceramic coffee mug with a bold orange stripe, steam rising" },
  { id: "sneaker", name: "Sole Survivor", color: "#38bdf8", tagline: "Laces up. Lights out.",
    object: "a chunky white-and-sky-blue running sneaker with thick sole" },
  { id: "duck", name: "Quack Attack", color: "#facc15", tagline: "Bath-time is over.",
    object: "a classic yellow rubber bath duck with an orange beak" },
  { id: "toaster", name: "Toast Master", color: "#ef4444", tagline: "Pops up. Knocks down.",
    object: "a retro chrome and red two-slot kitchen toaster with two slices of toast sticking out" },
  { id: "cactus", name: "Prickly Pete", color: "#22c55e", tagline: "Hugs not recommended.",
    object: "a saguaro-style green cactus in a terracotta pot" },
];

const RETARGET = {
  Idle_Loop: "idle", Walk_Loop: "walk", Punch_Jab: "punch", Melee_Hook: "kick", Sword_Block: "block",
  Hit_Chest: "hit", Death01: "ko", Dance_Loop: "victory", Punch_Cross: "punch2", Hit_Knockback: "hit2",
};
const MASCOT_PROMPT =
  "Turn the main object in this image into a full-body humanoid fighting-game character: two arms, two legs, a head, " +
  "standing upright in a T-pose, facing the camera, full body visible, keep the object's original colours, materials and " +
  "recognisable shape as the body/costume, plain light-grey studio background, no text.";

async function forge(spec) {
  const T = `[${spec.id}] `;
  const dir = path.join(process.cwd(), "public", "fighters", spec.id);
  await fs.mkdir(dir, { recursive: true });
  const logFile = path.join(dir, "forge-log.json");
  // Resume support: reuse task IDs from a previous run (no new credits spent for finished steps).
  const prev = {};
  try { for (const st of JSON.parse(await fs.readFile(logFile, "utf8")).steps ?? []) if (st.taskId) prev[st.name] = st.taskId; } catch {}
  const { log, save, step: rawStep } = makeLog(logFile, { id: spec.id, object: spec.object, resumed: Object.keys(prev).length > 0 });
  const step = (name, fn, tag) => rawStep(name, (e) => fn(e, prev[name]), tag);
  const task = async (e, reuse, create, every) => pollLux(reuse ?? (await create()), e, every);
  const photoUrl = await step("source photo (multimodal-to-image, text only)", async (e, r) => {
    e.prompt = `Studio product photo of ${spec.object}, single object centred, full object visible, plain white background, soft even lighting, photorealistic, no text, no people.`;
    const out = await task(e, r, () => api("POST", "/global/lux3d/v1/generate/multimodal-to-image/task/create", { prompt: e.prompt }), 5000);
    await download(out[0].content, path.join(dir, "photo.png"));
    return out[0].content;
  }, T);
  const mascotUrl = await step("mascot (multimodal-to-image, img+prompt)", async (e, r) => {
    const out = await task(e, r, () => api("POST", "/global/lux3d/v1/generate/multimodal-to-image/task/create", { img: photoUrl, prompt: MASCOT_PROMPT }), 5000);
    await download(out[0].content, path.join(dir, "mascot.png"));
    return out[0].content;
  }, T);
  const meshUrl = await step("img-to-3d G1-Turbo", async (e, r) => {
    const out = await task(e, r, () => api("POST", "/global/lux3d/v1/generate/img-to-3d/task/create", {
      img: mascotUrl, version: "G1-Turbo", faceCount: 60000, outputFormat: ["glb"], enablePbr: true, aiPredictSize: true }));
    return out.map((o) => o.content).find((u) => u && /\.glb/i.test(u)) ?? out[0].content;
  }, T);
  const rigUrl = await step("humanoid auto-rig", async (e, r) => {
    const out = await task(e, r, () => api("POST", "/global/lux3d/v1/animations/rig/task/create", { modelUrl: meshUrl }));
    const c = out[0]?.content;
    if (!c || c.trim().startsWith("{")) throw new Error(`rig failed: ${c}`);
    await download(c, path.join(dir, "rigged.orig.glb"));
    return c;
  }, T);
  const animUrls = {};
  await step("retarget 10 presets (separate, in place)", async (e, r) => {
    const out = await task(e, r, () => api("POST", "/global/lux3d/v1/animations/retarget/task/create", {
      rigModelUrl: rigUrl, animationIds: Object.keys(RETARGET), animationOutputMode: "separate", outFormat: "glb", animateInPlace: true }));
    const parsed = JSON.parse(out[0].content);
    e.actions = parsed.actions.map((a) => ({ id: a.animation_id, status: a.status, error: a.error }));
    await Promise.all(parsed.actions.filter((a) => a.status === "success" && a.animationGlbUrl).map(async (a) => {
      const mv = RETARGET[a.animation_id];
      const orig = path.join(dir, `anim-${mv}.orig.glb`);
      for (let i = 0; ; i++) { try { await download(a.animationGlbUrl, orig); break; } catch (err) { if (i >= 3) throw err; } }
      await stripToAnimation(orig, path.join(dir, `anim-${mv}.glb`), mv);
      animUrls[mv] = `/api/assets/${spec.id}/anim-${mv}.glb`;
    }));
  }, T);
  await step("optimise fighter GLB", async (e) => {
    await optimizeFighterGlb(path.join(dir, "rigged.orig.glb"), path.join(dir, "rigged.glb"));
    e.bytes = (await fs.stat(path.join(dir, "rigged.glb"))).size;
  }, T);
  const fighter = {
    id: spec.id, name: spec.name, tagline: spec.tagline, color: spec.color, source: "lux3d",
    modelUrl: `/api/assets/${spec.id}/rigged.glb`, animUrls, thumbUrl: `/api/assets/${spec.id}/mascot.png`,
    photoUrl: `/api/assets/${spec.id}/photo.png`, createdAt: Date.now(),
  };
  await fs.writeFile(path.join(dir, "fighter.json"), JSON.stringify(fighter, null, 2));
  log.finishedAt = new Date().toISOString();
  log.totalMs = Date.parse(log.finishedAt) - Date.parse(log.startedAt);
  await save();
  console.log(`${T}DONE ${(log.totalMs / 1000).toFixed(0)}s`);
}

const arg = process.argv[2]; // roster id, comma list, or "all"
const list = arg === "all" ? ROSTER : ROSTER.filter((r) => arg.split(",").includes(r.id));
const res = await Promise.allSettled(list.map(forge));
res.forEach((r, i) => r.status === "rejected" && console.log(`[${list[i].id}] FAILED ${r.reason?.message ?? r.reason}`));
