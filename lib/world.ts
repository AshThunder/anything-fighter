import "server-only";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { call, isMockMode, uploadAsset, worldClient } from "./aholo-sdk";
import { getRuntimeCache } from "./store";

/**
 * Aholo World API (SpatialGen generation + Aholo Reality reconstruction) as poll-driven arena jobs, via the
 * official @manycore/aholo-sdk-world client (generations.create / reconstructions.create / retrieve / list) and
 * @manycore/aholo-sdk-asset for uploads. world.waitFor is not used: each client poll does one retrieve.
 *   POST /global/world/v1/generations      {name, prompt, resources?[≤1 image]}            → {worldId}   (10 credits)
 *   POST /global/world/v1/reconstructions  {name, resources[video|≥20 images], taskQuality, scene} → {worldId}
 *   GET  /global/world/v1/{worldId}        → status PENDING/PREPROCESSING/RUNNING/SUCCEEDED/FAILED/CANCELED/TIMEOUT/REJECTED
 *   POST /global/world/v1/list             → paged list of my worlds (used to detect a busy queue)
 * There is no cancel endpoint. Free plan: 1 concurrent SpatialGen + 1 concurrent Reality task, so a stuck job
 * blocks everything queued behind it. We therefore (a) never create a new world job while one is in progress,
 * (b) cache status lookups, and (c) never rehost multi-MB splats into serverless storage: finished arenas are
 * served via /api/assets/arenas/<id>/<file>, which redirects to a freshly signed Aholo URL.
 *
 * Job records (small JSON) live in /tmp + Vercel Runtime Cache on Vercel, public/arenas/<id>/job.json locally.
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
  upAxis?: "Z" | "Y" | "-Y";
}

export const IN_PROGRESS = new Set(["PENDING", "PREPROCESSING", "RUNNING", "QUEUED"]);
export const isWorldFailed = (s?: string) => /FAIL|CANCEL|TIMEOUT|REJECT/i.test(s ?? "");
/** A world job RUNNING with no progress for this long is treated as stuck (UI stops waiting on it). */
export const STUCK_MS = 90 * 60 * 1000;

const onVercel = !!process.env.VERCEL;
export const SHIPPED_ARENA_ROOT = path.join(process.cwd(), "public", "arenas");
const JOB_ROOT = onVercel ? path.join("/tmp", "anything-fighter", "arenas") : SHIPPED_ARENA_ROOT;
const JOB_TTL = 7 * 24 * 3600;
const MOCK_MS = 12000;
const MOCK_SPLAT = "https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/bear/bear.3d71a266.sog";

const jobKey = (id: string) => `worldjob:${id}`;
const INDEX_KEY = "worldjobs:index";

async function saveJob(j: WorldJob) {
  j.updatedAt = Date.now();
  const json = JSON.stringify(j, null, 2);
  await fs.mkdir(path.join(JOB_ROOT, j.id), { recursive: true });
  await fs.writeFile(path.join(JOB_ROOT, j.id, "job.json"), json);
  const c = await getRuntimeCache();
  if (c) {
    await c.set(jobKey(j.id), json, { ttl: JOB_TTL, tags: ["worldjobs"], name: jobKey(j.id) });
    const cur = (await c.get(INDEX_KEY)) as string[] | undefined;
    const next = Array.from(new Set([...(Array.isArray(cur) ? cur : []), j.id])).slice(-50);
    await c.set(INDEX_KEY, next, { ttl: JOB_TTL, tags: ["worldjobs"], name: INDEX_KEY });
  }
}

export async function loadWorldJob(id: string): Promise<WorldJob | null> {
  if (!/^(room|world)-[a-z0-9-]+$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(JOB_ROOT, id, "job.json"), "utf8"));
  } catch {
    /* miss */
  }
  const c = await getRuntimeCache();
  const v = c ? await c.get(jobKey(id)) : null;
  return typeof v === "string" ? (JSON.parse(v) as WorldJob) : null;
}

/** Ids of world jobs created through the app (runtime index on Vercel, job dirs locally). */
export async function listWorldJobIds(): Promise<string[]> {
  const ids = new Set<string>();
  try {
    for (const d of await fs.readdir(JOB_ROOT)) if (/^(room|world)-[a-z0-9-]+$/.test(d)) ids.add(d);
  } catch {
    /* none */
  }
  const c = await getRuntimeCache();
  const cur = c ? ((await c.get(INDEX_KEY)) as string[] | undefined) : undefined;
  if (Array.isArray(cur)) cur.forEach((x) => ids.add(x));
  return [...ids];
}

// ───────────────────────────── Aholo world status (cached) ─────────────────────────────

export interface WorldDetail {
  worldId?: string;
  name?: string;
  status?: string;
  progress?: number;
  createTime?: number;
  updateTime?: number;
  assets?: {
    imagery?: { panoUrl?: string };
    splats?: { urls?: { plyPath?: string; spzPath?: string; lodMetaPath?: string } };
    semanticsMetadata?: { upAxis?: "Y" | "Z" };
  };
}

const memo = new Map<string, { at: number; v: Promise<WorldDetail | null> }>();

/**
 * When we first saw a world RUNNING. Aholo's updateTime/createTime are the submission time, so a job that has
 * only just left the queue would otherwise look "stuck" immediately. Stored in Runtime Cache (+ per instance).
 */
const runSeen = new Map<string, number>();
async function runningSince(worldId: string): Promise<number> {
  const hit = runSeen.get(worldId);
  if (hit) return hit;
  const key = `worldrun:${worldId}`;
  const c = await getRuntimeCache();
  let t = c ? Number(await c.get(key).catch(() => 0)) || 0 : 0;
  if (!t) {
    t = Date.now();
    await c?.set(key, String(t), { ttl: JOB_TTL, name: key }).catch(() => {});
  }
  runSeen.set(worldId, t);
  return t;
}

/** RUNNING with 0% progress for STUCK_MS since we first saw it running. */
export async function isWorldStuck(d: WorldDetail | null | undefined, worldId = d?.worldId): Promise<boolean> {
  if (!d || !worldId || d.status !== "RUNNING" || (d.progress ?? 0) > 0) return false;
  return Date.now() - (await runningSince(worldId)) > STUCK_MS;
}

/** GET /global/world/v1/{id}, cached ~45 s per instance. Never throws (null = unknown). */
export function worldDetail(worldId: string, opts: { fresh?: boolean } = {}): Promise<WorldDetail | null> {
  if (isMockMode() || !/^[A-Za-z0-9]+$/.test(worldId)) return Promise.resolve(null);
  const hit = memo.get(worldId);
  const now = Date.now();
  if (hit && !opts.fresh && now - hit.at < 45_000) return hit.v;
  const v = Promise.race([
    call(() => worldClient().retrieve(worldId)) as Promise<WorldDetail>,
    new Promise<null>((r) => setTimeout(() => r(null), 8000)),
  ]).catch(() => null);
  memo.set(worldId, { at: now, v });
  return v;
}

/** Account-wide in-progress world jobs (PENDING/PREPROCESSING/RUNNING), cached ~45 s. null = unknown. */
let queueMemo: { at: number; v: Promise<WorldDetail[] | null> } | null = null;
export function worldQueue(): Promise<WorldDetail[] | null> {
  if (isMockMode()) return Promise.resolve([]);
  if (queueMemo && Date.now() - queueMemo.at < 45_000) return queueMemo.v;
  const v = Promise.race([
    call(() => worldClient().list({ pageNum: 0, pageSize: 50, statusList: ["PENDING", "PREPROCESSING", "RUNNING"] })).then((r) =>
      ((r.result ?? []) as WorldDetail[])
        .filter((w) => IN_PROGRESS.has(w.status ?? ""))
        .sort((a, b) => (a.createTime ?? 0) - (b.createTime ?? 0)),
    ),
    new Promise<null>((r) => setTimeout(() => r(null), 8000)),
  ]).catch(() => null);
  queueMemo = { at: Date.now(), v };
  return v;
}

export class WorldQueueBusy extends Error {
  constructor(public queue: WorldDetail[]) {
    super(
      `Aholo's world queue is busy (${queue.length} job${queue.length === 1 ? "" : "s"} already waiting). ` +
        "The account runs one world job at a time and jobs can't be cancelled, so a new one would only wait behind them. " +
        "Fight in the built-in arenas meanwhile.",
    );
  }
}

/** Refuse to create another world job while the account queue is non-empty (no cancel endpoint exists). */
async function assertQueueFree() {
  if (process.env.WORLD_QUEUE_GUARD === "off") return;
  const q = await worldQueue();
  if (q === null) throw new Error("Couldn't reach Aholo to check the world queue. Try again in a minute.");
  if (q.length) throw new WorldQueueBusy(q);
}

// ───────────────────────────── create ─────────────────────────────

const newId = (p: string) => `${p}-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;

/** SpatialGen: text (and optional reference image URL) → 3DGS world + panorama. */
export async function createWorldGeneration(input: { name: string; prompt: string; imageUrl?: string }): Promise<WorldJob> {
  const job: WorldJob = {
    id: newId("world"), kind: "spatialgen", name: input.name, prompt: input.prompt,
    mode: isMockMode() ? "mock" : "live", status: "PENDING", progress: 0, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (job.mode === "live") {
    await assertQueueFree();
    const r = await call(() =>
      worldClient().generations.create({
        name: input.name, prompt: input.prompt, ...(input.imageUrl ? { resources: [{ url: input.imageUrl, type: "image" as const }] } : {}),
      }),
    );
    job.worldId = r.worldId;
    queueMemo = null;
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
  if (job.mode === "mock") {
    job.status = "PENDING";
    await saveJob(job);
    return job;
  }
  await assertQueueFree(); // before uploading anything
  await saveJob(job);
  try {
    const urls: string[] = [];
    for (const f of input.files) urls.push(await uploadAsset(f.buf, f.filename));
    const r = await call(() =>
      worldClient().reconstructions.create({
        name: input.name,
        resources: urls.map((url) => ({ url, type: video ? ("video" as const) : ("image" as const) })),
        taskQuality: input.quality ?? "low",
        scene: "space",
      }),
    );
    job.worldId = r.worldId;
    job.status = "PENDING";
    queueMemo = null;
  } catch (e) {
    job.status = "FAILED";
    job.error = e instanceof Error ? e.message : String(e);
  }
  await saveJob(job);
  return job;
}

// ───────────────────────────── advance ─────────────────────────────

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
  if (job.mode === "mock") {
    const t = (Date.now() - job.createdAt) / MOCK_MS;
    job.progress = Math.min(1, t);
    job.status = t >= 1 ? "SUCCEEDED" : "RUNNING";
    if (job.status === "SUCCEEDED") job.upAxis = "-Y";
    await saveJob(job);
    return job;
  }
  const d = await worldDetail(job.worldId!);
  if (!d) return job; // Aholo slow/unreachable: keep the old state, try again next poll
  job.progress = d.progress ?? job.progress;
  if (isWorldFailed(d.status)) {
    job.status = "FAILED";
    job.error = `World ${job.worldId} ${d.status}`;
  } else if (d.status === "SUCCEEDED") {
    job.status = "SUCCEEDED";
    job.progress = 1;
    job.upAxis = d.assets?.semanticsMetadata?.upAxis ?? "Z";
  } else {
    job.status = d.status === "RUNNING" ? "RUNNING" : "PENDING";
  }
  await saveJob(job);
  return job;
}

/** Fresh (signed) Aholo URL for a finished world's splat or panorama. */
export async function worldFileUrl(worldId: string, file: string): Promise<string | null> {
  if (worldId === "mock") return file.startsWith("world.") ? MOCK_SPLAT : null;
  const d = await worldDetail(worldId);
  if (!d || d.status !== "SUCCEEDED") return null;
  const u = d.assets?.splats?.urls ?? {};
  if (file === "world.spz") return u.spzPath ?? null;
  if (file === "world.ply") return u.plyPath ?? null;
  if (/^pano\./.test(file)) return d.assets?.imagery?.panoUrl ?? null;
  return null;
}
