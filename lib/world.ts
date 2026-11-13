import "server-only";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { aholoRaw as aholo, isMockMode, uploadAsset } from "./aholo";
import { ARENA_ROOT } from "./arenas-server";

/**
 * Aholo World API (SpatialGen generation + Aholo Reality reconstruction) as poll-driven arena jobs.
 *   POST /global/world/v1/generations      {name, prompt, resources?[≤1 image]}            → {worldId}   (10 credits)
 *   POST /global/world/v1/reconstructions  {name, resources[video|≥20 images], taskQuality, scene} → {worldId}
 *                                                                     (Flash/low 20 · normal 50 · high 80 credits)
 *   GET  /global/world/v1/{worldId}        → status PENDING/RUNNING/SUCCEEDED/FAILED, assets.splats.urls.{spzPath,plyPath},
 *                                            assets.imagery.panoUrl (SpatialGen), assets.semanticsMetadata.upAxis ("Z")
 * Free plan: SpatialGen 1 concurrent task, Reality 1 concurrent task.
 * Each GET /api/arenas/<id> advances the job; on success the splat (+pano) is rehosted to public/arenas/<id>/.
 */

export type WorldJobKind = "spatialgen" | "reality";
export interface WorldJob {
  id: string;
  kind: WorldJobKind;
  name: string;
  prompt?: string;
  mode: "live" | "mock";
  status: "UPLOADING" | "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progress: number;
  worldId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const MOCK_MS = 12000;
const jobFile = (id: string) => path.join(ARENA_ROOT, id, "job.json");
const saveJob = async (j: WorldJob) => {
  await fs.mkdir(path.join(ARENA_ROOT, j.id), { recursive: true });
  j.updatedAt = Date.now();
  await fs.writeFile(jobFile(j.id), JSON.stringify(j, null, 2));
};
export async function loadWorldJob(id: string): Promise<WorldJob | null> {
  if (!/^(room|world)-[a-z0-9-]+$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(jobFile(id), "utf8"));
  } catch {
    return null;
  }
}

const newId = (p: string) => `${p}-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;

/** SpatialGen: text (and optional reference image URL) → 3DGS world + panorama. */
export async function createWorldGeneration(input: { name: string; prompt: string; imageUrl?: string }): Promise<WorldJob> {
  const job: WorldJob = {
    id: newId("world"), kind: "spatialgen", name: input.name, prompt: input.prompt,
    mode: isMockMode() ? "mock" : "live", status: "PENDING", progress: 0, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (job.mode === "live") {
    const r = await aholo<{ worldId: string }>("POST", "/global/world/v1/generations", {
      name: input.name, prompt: input.prompt, ...(input.imageUrl ? { resources: [{ url: input.imageUrl, type: "image" }] } : {}),
    });
    job.worldId = r.worldId;
  }
  await saveJob(job);
  return job;
}

/**
 * Aholo Reality "Fight in your room": one phone video (.mp4/.mov) or ≥20 photos → 3DGS reconstruction.
 * Uses Flash quality (`low`, 20 credits) + scene "space" (indoor) by default.
 */
export async function createRoomScan(input: { name: string; files: { buf: Buffer; filename: string }[]; quality?: "low" | "normal" | "high" }): Promise<WorldJob> {
  const video = input.files.length === 1 && /\.(mp4|mov)$/i.test(input.files[0].filename);
  if (!video && input.files.length < 20) throw new Error("Need one room video (.mp4/.mov) or at least 20 photos.");
  const job: WorldJob = {
    id: newId("room"), kind: "reality", name: input.name, mode: isMockMode() ? "mock" : "live",
    status: "UPLOADING", progress: 0, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await saveJob(job);
  if (job.mode === "mock") {
    job.status = "PENDING";
    await saveJob(job);
    return job;
  }
  try {
    const urls: string[] = [];
    for (const f of input.files) urls.push(await uploadAsset(f.buf, f.filename));
    const r = await aholo<{ worldId: string }>("POST", "/global/world/v1/reconstructions", {
      name: input.name,
      resources: urls.map((url) => ({ url, type: video ? "video" : "image" })),
      taskQuality: input.quality ?? "low",
      scene: "space",
    });
    job.worldId = r.worldId;
    job.status = "PENDING";
  } catch (e) {
    job.status = "FAILED";
    job.error = e instanceof Error ? e.message : String(e);
  }
  await saveJob(job);
  return job;
}

interface WorldDetail {
  status?: string;
  progress?: number;
  assets?: {
    imagery?: { panoUrl?: string };
    splats?: { urls?: { plyPath?: string; spzPath?: string; lodMetaPath?: string } };
    semanticsMetadata?: { upAxis?: "Y" | "Z" };
  };
}

const locks = new Map<string, Promise<WorldJob>>();
export function advanceWorldJob(id: string): Promise<WorldJob> {
  const running = locks.get(id);
  if (running) return running;
  const p = advance(id).finally(() => locks.delete(id));
  locks.set(id, p);
  return p;
}

async function advance(id: string): Promise<WorldJob> {
  const job = await loadWorldJob(id);
  if (!job) throw new Error("job not found");
  if (job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "UPLOADING") return job;
  const dir = path.join(ARENA_ROOT, id);
  if (job.mode === "mock") {
    const t = (Date.now() - job.createdAt) / MOCK_MS;
    job.progress = Math.min(1, t);
    job.status = t >= 1 ? "SUCCEEDED" : "RUNNING";
    if (job.status === "SUCCEEDED") {
      // Mock arena = the official Aholo sample splat, clearly labelled.
      await fs.writeFile(path.join(dir, "arena.json"), JSON.stringify({
        id, name: `${job.name} (mock)`, source: job.kind, mock: true, upAxis: "-Y",
        splatUrl: "https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/bear/bear.3d71a266.sog",
      }, null, 2));
    }
    await saveJob(job);
    return job;
  }
  const d = await aholo<WorldDetail>("GET", `/global/world/v1/${job.worldId}`);
  job.progress = d.progress ?? job.progress;
  if (/FAIL|CANCEL/i.test(d.status ?? "")) {
    job.status = "FAILED";
    job.error = `World ${job.worldId} ${d.status}`;
  } else if (d.status === "SUCCEEDED") {
    const u = d.assets?.splats?.urls ?? {};
    if (u.spzPath) await rehost(u.spzPath, path.join(dir, "world.spz"));
    else if (u.plyPath) await rehost(u.plyPath, path.join(dir, "world.ply"));
    const pano = d.assets?.imagery?.panoUrl;
    if (pano) await rehost(pano, path.join(dir, "pano" + (path.extname(new URL(pano).pathname) || ".jpg")));
    await fs.writeFile(path.join(dir, "arena.json"), JSON.stringify({
      id, name: job.name, prompt: job.prompt, source: job.kind, worldId: job.worldId, upAxis: d.assets?.semanticsMetadata?.upAxis ?? "Z",
    }, null, 2));
    job.status = "SUCCEEDED";
    job.progress = 1;
  } else {
    job.status = d.status === "RUNNING" ? "RUNNING" : "PENDING";
  }
  await saveJob(job);
  return job;
}

async function rehost(url: string, dest: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}
