import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LUX3D_ANIMATION_MAP, LUX3D_RETARGET_IDS, MOVES, type Move } from "./moves";
import { STARTER_ROSTER_IDS, type FighterDef } from "./fighters";
import { optimizeFighterGlb, shrinkTextures, stripToAnimation, weldSimplify } from "./optimize";
import { bakePose } from "./pose";
import { ingestCreate, ingestGet, renderPoll, renderSubmit } from "./poster";
import {
  addGeneratedId,
  fighterDir,
  fighterFileExists,
  listFighterIds,
  loadJobRecord,
  readFighterFile,
  saveJobRecord,
  shippedFighterRoot,
  writeFighterFile,
} from "./store";

/**
 * Server-side wrapper for the Aholo Lux3D REST flow (see refs/openapi.en.yaml, refs/endpoints.txt).
 *
 *  photo ─► OUS upload ─► multimodal-to-image ("humanoid mascot", optional) ─► img-to-3d (G1/G1-Turbo)
 *        ─► humanoid auto-rig ─► animation retarget (separate GLBs) ─► multi-format export (optional STL/3MF/USDZ)
 *        ─► rehost every artefact to public/fighters/<id>/ (Aholo result URLs expire after 2h).
 *
 * The pipeline is poll-driven: each GET /api/pipeline/<id> calls advanceJob(), which checks the running
 * Aholo task and, when finished, rehosts outputs and starts the next stage. No long-lived background
 * work. On Vercel, job state and generated files live in the Runtime Cache (chunked if >2 MB) plus
 * /tmp; the baked-in starter roster is read from the deployment filesystem. See lib/store.ts.
 *
 * Mock mode (no AHOLO_API_KEY): stages are simulated (~2.5s each) and the final rig is a copy of the
 * placeholder robot so the whole UX can be built and demoed without spending credits.
 * The key is read only from process.env.AHOLO_API_KEY; it is never sent to the client.
 */

// ───────────────────────────── config ─────────────────────────────

export const AHOLO_BASE = process.env.AHOLO_API_BASE ?? "https://api.aholo.ai";
const P = "/global"; // Global region path prefix
const MESH_VERSION = (process.env.AHOLO_MESH_VERSION ?? "G1-Turbo") as "G1" | "G1-Turbo";
const MESH_FACES = Number(process.env.AHOLO_MESH_FACES ?? 60000); // 10k–300k; game-friendly default
const MOCK_STAGE_MS = 2500;

export function apiKey(): string | undefined {
  const k = process.env.AHOLO_API_KEY?.trim();
  return k ? k : undefined;
}
export const isMockMode = () => !apiKey();

/** Public URL for a rehosted file. Served through a route so files created after `next build` work. */
export const assetUrl = (id: string, file: string) => `/api/assets/${id}/${file}`;

// ───────────────────────────── low-level HTTP ─────────────────────────────

interface Envelope<T> {
  c?: string | null;
  m?: string | null;
  d?: T;
  f?: unknown;
}

export class AholoError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
  }
}

async function aholo<T>(method: "GET" | "POST", pathname: string, body?: unknown): Promise<T> {
  const key = apiKey();
  if (!key) throw new AholoError("AHOLO_API_KEY is not set", "NO_KEY");
  const res = await fetch(AHOLO_BASE + pathname, {
    method,
    headers: {
      Authorization: key, // NOTE: no "Bearer" prefix per Aholo docs
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AholoError(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`, undefined, res.status);
  }
  if (!res.ok) {
    const j = json as { code?: string; message?: string; m?: string; c?: string };
    throw new AholoError(j.message ?? j.m ?? `HTTP ${res.status}`, j.code ?? j.c, res.status);
  }
  // Lux3D endpoints use {c,m,d}; world/asset may return the object directly.
  const env = json as Envelope<T>;
  if (env && typeof env === "object" && "c" in env) {
    if (env.c !== "0" && env.c !== null) throw new AholoError(env.m || `Aholo error ${env.c}`, env.c ?? undefined);
    return env.d as T;
  }
  return json as T;
}

// ───────────────────────────── asset upload (OUS) ─────────────────────────────

interface UploadToken {
  ousToken: string;
  globalDomain: string;
  blockSize: number;
}

/** Upload a file via OUS (single upload ≤ blockSize, else multipart) and return its public URL. */
export async function uploadAsset(buf: Buffer, filename: string): Promise<string> {
  const tok = await aholo<UploadToken>("GET", `${P}/asset/v1/token`);
  const md5 = createHash("md5").update(buf).digest("hex");
  const H = { "ous-token-v2": tok.ousToken };
  if (buf.length <= tok.blockSize) {
    const form = new FormData();
    form.set("md5", md5);
    form.set("file", new Blob([new Uint8Array(buf)], { type: "application/octet-stream" }), filename);
    const up = (await (await fetch(`${tok.globalDomain}/ous/api/v2/single/upload`, { method: "POST", headers: H, body: form })).json()) as Envelope<unknown>;
    if (up.c !== "0") throw new AholoError(`OUS upload failed: ${up.m}`, up.c ?? undefined);
  } else {
    // Multipart: init (query params) → parts (≤2 concurrent per file) → status.
    const bs = tok.blockSize;
    const blocks = Math.ceil(buf.length / bs);
    const q = new URLSearchParams({ md5, blocks: String(blocks), size: String(buf.length), name: filename });
    const init = (await (await fetch(`${tok.globalDomain}/ous/api/v2/block/upload/init?${q}`, { method: "POST", headers: H })).json()) as Envelope<{ lackBlocks?: number[]; deduplicated?: boolean }>;
    if (init.c !== "0") throw new AholoError(`OUS block init failed: ${init.m}`, init.c ?? undefined);
    // Deduplicated (same md5 already stored) → no parts needed.
    const queue = init.d?.deduplicated ? [] : [...(init.d?.lackBlocks ?? Array.from({ length: blocks }, (_, i) => i + 1))];
    const worker = async () => {
      for (let b = queue.shift(); b !== undefined; b = queue.shift()) {
        const form = new FormData();
        form.set("block", String(b));
        form.set("file", new Blob([new Uint8Array(buf.subarray((b - 1) * bs, b * bs))], { type: "application/octet-stream" }), filename);
        const r = (await (await fetch(`${tok.globalDomain}/ous/api/v2/block/upload/part`, { method: "POST", headers: H, body: form })).json()) as Envelope<unknown>;
        if (r.c !== "0") throw new AholoError(`OUS part ${b} failed: ${r.m}`, r.c ?? undefined);
      }
    };
    await Promise.all([worker(), worker()]);
  }
  // Status is bound to the token (status 5 = success, 6/8 = failed).
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    const sj = (await (await fetch(`${tok.globalDomain}/ous/api/v2/upload/status`, { headers: H })).json()) as Envelope<{ status: number; url?: string }>;
    const s = sj.d?.status;
    if (s === 5 && sj.d?.url) return sj.d.url;
    if (s === 6 || s === 8) throw new AholoError(`OUS upload status ${s}`);
  }
  throw new AholoError("OUS upload timed out");
}

/** Raw gateway call for sibling modules (world / rendercloud). */
export const aholoRaw = aholo;

// ───────────────────────────── Lux3D task endpoints ─────────────────────────────

const L = `${P}/lux3d/v1`;
type TaskId = number;

export const lux3d = {
  multimodalToImage: (b: { img?: string; prompt?: string }) =>
    aholo<TaskId>("POST", `${L}/generate/multimodal-to-image/task/create`, b),
  imageToFourView: (b: { img?: string; prompt?: string }) =>
    aholo<TaskId>("POST", `${L}/generate/image-to-four-view/task/create`, b),
  imgTo3d: (b: {
    img?: string;
    imgs?: string[];
    version: "G1" | "G1-Turbo";
    faceCount?: number;
    outputFormat?: ("zip" | "glb" | "ply")[];
    enablePbr?: boolean;
    aiPredictSize?: boolean;
    /** Model height in mm (Lux3D skill docs); takes priority over aiPredictSize. */
    customSize?: number;
  }) => aholo<TaskId>("POST", `${L}/generate/img-to-3d/task/create`, b),
  textTo3d: (b: {
    prompt: string;
    style?: "photorealistic" | "cartoon" | "anime" | "hand_painted" | "cyberpunk" | "fantasy" | "glass";
    img?: string;
    version: "G1" | "G1-Turbo";
    faceCount?: number;
    outputFormat?: ("zip" | "glb" | "ply")[];
    enablePbr?: boolean;
  }) => aholo<TaskId>("POST", `${L}/generate/text-to-3d/task/create`, b),
  materialTransfer: (b: { img: string; meshUrl: string; outputFormat?: string[] }) =>
    aholo<TaskId>("POST", `${L}/generate/material-transfer/task/create`, { version: "v3.0-standard", ...b }),
  autoRig: (b: { modelUrl: string }) => aholo<TaskId>("POST", `${L}/animations/rig/task/create`, b),
  retarget: (b: {
    rigModelUrl: string;
    animationIds: string[];
    animationOutputMode: "separate" | "combined";
    outFormat: "glb" | "fbx";
    animateInPlace?: boolean;
  }) => aholo<TaskId>("POST", `${L}/animations/retarget/task/create`, b),
  multiFormatExport: (b: { modelUrl: string; outputFormat: ("usdz" | "obj_zip" | "fbx_zip" | "stl" | "3mf")[] }) =>
    aholo<TaskId>("POST", `${L}/multi-format-export/task/create`, b),
  getTask: (taskid: TaskId) =>
    aholo<{ taskId: number; status: number; outputs?: { content: string | null }[] }>(
      "GET",
      `${L}/generate/task/get?taskid=${taskid}`,
    ),
};

/** Status codes: 0 init, 1 running, 3 success, 4 failed, 6 cancelled. */
export const TASK_DONE = 3;
const TASK_FAILED = new Set([4, 6]);

// ───────────────────────────── job state machine ─────────────────────────────

export const STAGES = ["upload", "mascot", "mesh", "rig", "retarget", "poster", "export", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  upload: "Uploading photo",
  mascot: "Lux3D: turning it into a fighter (image)",
  mesh: "Lux3D: image → 3D mesh + PBR",
  rig: "Lux3D: humanoid auto-rig",
  retarget: "Lux3D: retargeting fight moves",
  poster: "RenderCloud: KO poster",
  export: "Lux3D: printable export (STL/3MF/USDZ)",
  done: "Ready to fight",
};

export interface Job {
  id: string;
  name: string;
  mode: "live" | "mock";
  stage: Stage;
  stageStartedAt: number;
  createdAt: number;
  error?: string;
  /** consecutive transient failures (network / 5xx / 429) — retried automatically on the next poll */
  transient?: number;
  retries?: number;
  taskId?: number;
  options: { mascot: boolean; exportPrint: boolean; prompt?: string };
  /** Remote (Aholo, expiring) URLs. */
  remote: { photo?: string; mascot?: string; mesh?: string; rigged?: string };
  /** Rehosted local files (relative to fighter dir). */
  files: { photo?: string; mascot?: string; mesh?: string; rigged?: string; statue?: string; posed?: string; poster?: string; anims: Partial<Record<Move, string>>; exports: Record<string, string> };
  /** Lux3D auto-rig refused the mesh (RIG_ELIGIBILITY_FAILED): the fighter uses the unrigged mesh + procedural moves. */
  rigless?: boolean;
  /** One automatic re-rig attempt on a 1.8 m normalised copy of the mesh after RIG_ELIGIBILITY_FAILED. */
  rigRescue?: boolean;
  /** Re-rig of a finished freestyle fighter (existing mesh only): attempt 1 = 1.8 m normalised, 2 = + weld/simplify. */
  rerig?: { attempt: number };
  /** RenderCloud poster sub-state: mesh ingest task id, then render operation id. */
  poster?: { phase: "ingest" | "render"; id: string; fails?: number };
  /** Retarget actions still to download + strip (processed one per poll so a 60s Hobby function can finish). */
  pendingAnims?: { move: Move; url: string }[];
  log: string[];
}

async function saveJob(job: Job) {
  await saveJobRecord(job.id, job.stage, JSON.stringify(job, null, 2));
}

export async function loadJob(id: string): Promise<Job | null> {
  if (!/^gen-[a-z0-9-]+$/.test(id)) return null;
  const raw = await loadJobRecord(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Job;
  } catch {
    return null;
  }
}

const MASCOT_PROMPT = (extra?: string) =>
  [
    "Turn the main object in this image into a full-body humanoid fighting-game character:",
    "two arms, two legs, a head, standing upright in a T-pose, facing the camera, full body visible,",
    "keep the object's original colours, materials and recognisable shape as the body/costume,",
    "plain light-grey studio background, no text.",
    extra ?? "",
  ].join(" ");

export async function createJob(input: {
  name: string;
  photo: Buffer;
  photoExt: string;
  mascot?: boolean;
  exportPrint?: boolean;
  prompt?: string;
  /** Force mock mode even if AHOLO_API_KEY is set (spend-guard fallback). */
  forceMock?: boolean;
}): Promise<Job> {
  const id = `gen-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const job: Job = {
    id,
    name: input.name.slice(0, 32) || "Mystery Fighter",
    mode: input.forceMock || isMockMode() ? "mock" : "live",
    stage: "upload",
    stageStartedAt: Date.now(),
    createdAt: Date.now(),
    options: { mascot: input.mascot ?? true, exportPrint: input.exportPrint ?? false, prompt: input.prompt },
    remote: {},
    files: { anims: {}, exports: {} },
    log: [],
  };
  const photoFile = `photo.${input.photoExt}`;
  await writeFighterFile(id, photoFile, input.photo);
  job.files.photo = photoFile;
  if (job.mode === "mock") job.log.push("[upload] mock mode (no credits spent)");
  await saveJob(job);
  // Upload synchronously in live mode (small file), then kick off the first generation stage.
  return advanceJob(id);
}

/** Per-instance advance locks with expiry, so a crashed/hung request can't wedge a job on a warm instance. */
const lockMap = new Map<string, number>();
const LOCK_MS = 150_000;
const locks = {
  has: (id: string) => (lockMap.get(id) ?? 0) > Date.now(),
  add: (id: string) => void lockMap.set(id, Date.now() + LOCK_MS),
  delete: (id: string) => void lockMap.delete(id),
};

/** Advance a job by at most one transition. Safe to call on every poll. */
export async function advanceJob(id: string): Promise<Job> {
  const job = await loadJob(id);
  if (!job) throw new AholoError("Job not found", "NOT_FOUND", 404);
  if (locks.has(id) || job.stage === "done") return job;
  if (job.error) {
    // Jobs that died on an ineligible rig before the fallback existed: finish them freestyle (no credits).
    if (!canRiglessFallback(job, job.error)) return job;
    locks.add(id);
    try {
      await finishRigless(job, job.error);
    } catch (e) {
      job.log.push(`[rig] freestyle fallback failed: ${e instanceof Error ? e.message : e}`);
      job.rigless = false;
    } finally {
      await saveJob(job);
      locks.delete(id);
    }
    return job;
  }
  locks.add(id);
  try {
    if (job.mode === "mock") await advanceMock(job);
    else await advanceLive(job);
    job.transient = 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (job.rerig && job.stage === "rig" && RIG_INELIGIBLE.test(msg)) {
      // Re-rig of an existing freestyle fighter: one more variant, then back to freestyle (no new poster/mesh credits).
      try {
        if (job.rerig.attempt < 2) {
          job.log.push(`[rerig] attempt ${job.rerig.attempt} refused (${msg.slice(0, 100)})`);
          await startRerig(job, 2);
        } else {
          job.log.push(`[rerig] attempt 2 refused too (${msg.slice(0, 100)}); staying freestyle`);
          job.rigless = true;
          job.error = undefined;
          await finish(job);
        }
        return job;
      } catch (e2) {
        job.log.push(`[rerig] failed: ${e2 instanceof Error ? e2.message : e2}; staying freestyle`);
        job.rigless = true;
        job.error = undefined;
        await finish(job);
        return job;
      }
    }
    if (canRiglessFallback(job, msg) && !job.rigRescue) {
      try {
        await rescueRig(job, msg);
        return job;
      } catch (e2) {
        job.log.push(`[rig] re-rig attempt failed to start: ${e2 instanceof Error ? e2.message : e2}`);
      }
    }
    if (canRiglessFallback(job, msg)) {
      try {
        await finishRigless(job, msg);
        return job;
      } catch (e2) {
        job.log.push(`[rig] freestyle fallback failed: ${e2 instanceof Error ? e2.message : e2}`);
        job.rigless = false;
      }
    }
    const transient =
      (e instanceof AholoError && (e.status === 429 || (e.status ?? 0) >= 500)) ||
      (e instanceof TypeError && /fetch|network|terminated|socket/i.test(msg)) ||
      /ECONNRESET|ETIMEDOUT|terminated|rate limit|concurrency/i.test(msg);
    job.transient = (job.transient ?? 0) + 1;
    if (transient && job.transient <= 10) {
      job.log.push(`[${job.stage}] transient error (${job.transient}/10), will retry: ${msg}`);
    } else {
      job.error = msg;
      job.log.push(`[${job.stage}] ERROR ${job.error}`);
    }
  } finally {
    await saveJob(job);
    locks.delete(id);
  }
  return job;
}

/**
 * User-triggered retry after a hard failure: clears the error and restarts the failed stage
 * (re-creates its Aholo task — costs that stage's credits again). Earlier finished stages are kept.
 */
export async function retryJob(id: string): Promise<Job> {
  const job = await loadJob(id);
  if (!job) throw new AholoError("Job not found", "NOT_FOUND", 404);
  if (!job.error) return job;
  if ((job.retries ?? 0) >= 3) throw new AholoError("Retry limit reached (3) — try another photo", "RETRY_LIMIT", 429);
  job.retries = (job.retries ?? 0) + 1;
  job.log.push(`[${job.stage}] retry #${job.retries}`);
  job.error = undefined;
  job.transient = 0;
  try {
    if (job.mode === "live" && job.stage !== "upload") await startStage(job, job.stage);
  } catch (e) {
    job.error = e instanceof Error ? e.message : String(e);
  }
  await saveJob(job);
  return job;
}

function enter(job: Job, stage: Stage, taskId?: number) {
  job.stage = stage;
  job.stageStartedAt = Date.now();
  job.taskId = taskId;
  job.log.push(`[${stage}] start${taskId ? ` task ${taskId}` : ""}`);
}

async function startStage(job: Job, stage: Stage) {
  switch (stage) {
    case "mascot": {
      if (!job.options.mascot) return startStage(job, "mesh");
      const t = await lux3d.multimodalToImage({ img: job.remote.photo, prompt: MASCOT_PROMPT(job.options.prompt) });
      return enter(job, "mascot", t);
    }
    case "mesh": {
      const img = job.remote.mascot ?? job.remote.photo!;
      const base = { img, version: MESH_VERSION, faceCount: MESH_FACES, outputFormat: ["glb"] as "glb"[], enablePbr: true };
      // aiPredictSize scales the humanoid to the *object's* real size (a 30 cm sneaker-man), which the humanoid
      // auto-rig then tends to reject (RIG_ELIGIBILITY_FAILED). Ask for a 1.8 m character instead.
      let t: number;
      try {
        t = await lux3d.imgTo3d({ ...base, aiPredictSize: false, customSize: 1800 });
      } catch (e) {
        if (!(e instanceof AholoError) || (e.status ?? 0) >= 500) throw e;
        job.log.push(`[mesh] customSize rejected (${e.message}), retrying without it`);
        t = await lux3d.imgTo3d({ ...base, aiPredictSize: false });
      }
      return enter(job, "mesh", t);
    }
    case "rig": {
      const t = await lux3d.autoRig({ modelUrl: job.remote.mesh! });
      return enter(job, "rig", t);
    }
    case "retarget": {
      const t = await lux3d.retarget({
        rigModelUrl: job.remote.rigged!,
        animationIds: LUX3D_RETARGET_IDS,
        animationOutputMode: "separate", // one GLB per action → robust clip mapping
        outFormat: "glb",
        animateInPlace: true, // the game drives root motion itself
      });
      return enter(job, "retarget", t);
    }
    case "poster": {
      if (job.mode !== "live" || !job.files.posed || process.env.POSTER_STAGE === "off") return startStage(job, "export");
      try {
        const buf = await readFighterFile(job.id, job.files.posed);
        if (!buf) throw new Error("posed mesh missing");
        const url = await uploadAsset(buf, "posed.glb");
        const id = await ingestCreate(url);
        enter(job, "poster");
        job.poster = { phase: "ingest", id };
        job.log.push(`[poster] RenderCloud ingest task ${id}`);
        return;
      } catch (e) {
        job.log.push(`[poster] skipped: ${e instanceof Error ? e.message : e}`);
        return startStage(job, "export");
      }
    }
    case "export": {
      if (!job.options.exportPrint) return finish(job);
      const t = await lux3d.multiFormatExport({ modelUrl: job.remote.mesh!, outputFormat: ["stl", "3mf", "usdz"] });
      return enter(job, "export", t);
    }
    default:
      return finish(job);
  }
}

async function advanceLive(job: Job) {
  if (job.stage === "upload") {
    const buf = await readFighterFile(job.id, job.files.photo!);
    if (!buf) throw new AholoError("Photo missing from job store", "NO_PHOTO");
    job.remote.photo = await uploadAsset(buf, job.files.photo!);
    job.log.push(`[upload] ${job.remote.photo}`);
    return startStage(job, "mascot");
  }
  if (job.stage === "retarget" && (job.pendingAnims?.length ?? 0) > 0) {
    return processPendingAnims(job);
  }
  if (job.stage === "poster") return advancePoster(job);
  if (!job.taskId) throw new AholoError(`No task for stage ${job.stage}`);
  const t = await lux3d.getTask(job.taskId);
  if (TASK_FAILED.has(t.status)) {
    throw new AholoError(`Task ${job.taskId} ${t.status === 6 ? "cancelled" : "failed"}: ${firstContent(t.outputs) ?? ""}`);
  }
  if (t.status !== TASK_DONE) return; // keep polling (client polls every ~3s; docs suggest 10–15s server-side)
  const out = (t.outputs ?? []).map((o) => o.content).filter((c): c is string => !!c && c !== "NOT_REQUESTED");

  switch (job.stage) {
    case "mascot": {
      job.remote.mascot = out[0];
      job.files.mascot = await rehost(job.id, out[0], "mascot.png");
      return startStage(job, "mesh");
    }
    case "mesh": {
      const glb = out.find((u) => /\.glb(\?|$)/i.test(u)) ?? out[0];
      job.remote.mesh = glb;
      job.files.mesh = await rehost(job.id, glb, "mesh.glb");
      return startStage(job, "rig");
    }
    case "rig": {
      const c = out[0];
      if (!c || c.trim().startsWith("{")) throw new AholoError(`Auto-rig failed: ${c}`);
      job.remote.rigged = c;
      // Lux3D rig = Mixamo-named skeleton (52 joints) + 2×PNG textures (~22 MB) → WebP 1024 (~3 MB).
      // Download + optimize in /tmp; only the slim GLB is persisted (Runtime Cache item limit is 2 MB, so it's chunked).
      const rawPath = await downloadToTmp(job.id, c, "rigged.orig.glb");
      const outPath = path.join(fighterDir(job.id), "rigged.glb");
      await fs.mkdir(fighterDir(job.id), { recursive: true });
      await optimizeFighterGlb(rawPath, outPath);
      await writeFighterFile(job.id, "rigged.glb", await fs.readFile(outPath));
      await fs.unlink(rawPath).catch(() => {});
      job.files.rigged = "rigged.glb";
      return startStage(job, "retarget");
    }
    case "retarget": {
      // content is a JSON string: {"actions":[{"animation_id","status","animationGlbUrl"|"fbxUrl"|"error"}]}
      const parsed = JSON.parse(out[0] ?? "{}") as {
        actions?: { animation_id: string; status: string; animationGlbUrl?: string; error?: { message?: string } }[];
      };
      const byPreset = new Map((parsed.actions ?? []).map((a) => [a.animation_id, a]));
      const pending: { move: Move; url: string }[] = [];
      for (const move of MOVES) {
        const a = byPreset.get(LUX3D_ANIMATION_MAP[move]);
        if (a?.status === "success" && a.animationGlbUrl) pending.push({ move, url: a.animationGlbUrl });
        else job.log.push(`[retarget] ${move} (${LUX3D_ANIMATION_MAP[move]}) missing: ${a?.error?.message ?? "not returned"}`);
      }
      job.pendingAnims = pending;
      job.taskId = undefined;
      return processPendingAnims(job);
    }
    case "export": {
      // Order: ZIP, GLB, USDZ, OBJ ZIP, FBX ZIP, STL, 3MF (unrequested = NOT_REQUESTED)
      const raw = (t.outputs ?? []).map((o) => o.content);
      const pick: [string, number, string][] = [["usdz", 2, "model.usdz"], ["stl", 5, "model.stl"], ["3mf", 6, "model.3mf"]];
      for (const [k, i, f] of pick) {
        const u = raw[i];
        if (u && u !== "NOT_REQUESTED") job.files.exports[k] = await rehost(job.id, u, f);
      }
      return finish(job);
    }
  }
}

/** Download + strip one remaining retarget clip per poll (each raw GLB is ~22 MB). */
async function processPendingAnims(job: Job) {
  const next = job.pendingAnims?.[0];
  if (!next) {
    job.pendingAnims = undefined;
    return startStage(job, "poster");
  }
  const rawPath = await downloadToTmp(job.id, next.url, `anim-${next.move}.orig.glb`);
  const outName = `anim-${next.move}.glb`;
  const outPath = path.join(fighterDir(job.id), outName);
  await fs.mkdir(fighterDir(job.id), { recursive: true });
  if (!job.files.posed && (next.move === POSTER_MOVE || job.pendingAnims!.length === 1)) await bakePosed(job, rawPath);
  await stripToAnimation(rawPath, outPath, next.move);
  await writeFighterFile(job.id, outName, await fs.readFile(outPath));
  await fs.unlink(rawPath).catch(() => {});
  job.files.anims[next.move] = outName;
  job.pendingAnims = job.pendingAnims!.slice(1);
  const left = job.pendingAnims.length;
  job.log.push(`[retarget] ${next.move} ready` + (left ? `, ${left} left` : ", all clips ready"));
  if (!left) {
    job.pendingAnims = undefined;
    return startStage(job, "poster");
  }
}

/** Poster pose: mid-jab frame of the retargeted punch clip. */
const POSTER_MOVE: Move = "punch";
const POSTER_TIMEOUT_MS = 8 * 60 * 1000;

/** Bake a static, unskinned 1.8 m pose for RenderCloud (its mesh ingest has no skinning). Never throws. */
async function bakePosed(job: Job, srcGlb: string) {
  try {
    const baked = path.join("/tmp", `af-${job.id}-posed.raw.glb`);
    const out = path.join("/tmp", `af-${job.id}-posed.glb`);
    await bakePose(srcGlb, baked, 0.5, 1.8);
    await shrinkTextures(baked, out, 1024);
    await writeFighterFile(job.id, "posed.glb", await fs.readFile(out));
    await Promise.all([fs.unlink(baked), fs.unlink(out)].map((p) => p.catch(() => {})));
    job.files.posed = "posed.glb";
  } catch (e) {
    job.log.push(`[poster] pose bake failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** RenderCloud poster: ingest → render → download. Optional: any failure skips straight to export/finish. */
async function advancePoster(job: Job) {
  const p = job.poster;
  try {
    if (!p) throw new Error("no poster task");
    if (Date.now() - job.stageStartedAt > POSTER_TIMEOUT_MS) throw new Error("timed out");
    if (p.phase === "ingest") {
      const meshId = await ingestGet(p.id);
      if (!meshId) return;
      const op = await renderSubmit(meshId, job.id);
      job.poster = { phase: "render", id: op };
      job.log.push(`[poster] mesh ${meshId} ingested, render ${op}`);
      return;
    }
    const url = await renderPoll(p.id);
    if (!url) return;
    const png = await fetchToBuffer(url, "poster.png");
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    await writeFighterFile(job.id, "poster.jpg", Buffer.from(jpg));
    job.files.poster = "poster.jpg";
    job.poster = undefined;
    job.log.push("[poster] RenderCloud poster ready");
    return startStage(job, "export");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const transient = e instanceof AholoError && (e.status === 429 || (e.status ?? 0) >= 500);
    if (p && transient && (p.fails ?? 0) < 3) {
      p.fails = (p.fails ?? 0) + 1;
      job.log.push(`[poster] transient error ${p.fails}/3: ${msg}`);
      return;
    }
    job.log.push(`[poster] skipped: ${msg}`);
    job.poster = undefined;
    return startStage(job, "export");
  }
}

const RIG_INELIGIBLE = /RIG_ELIGIBILITY|eligibility/i;

/**
 * Give a finished freestyle fighter another shot at a real skeleton, reusing its existing Lux3D mesh (no new
 * concept/mesh credits): rig a 1.8 m normalised copy; if refused, a welded + simplified copy; else stay freestyle.
 * Allowed once per job.
 */
export async function rerigFreestyle(id: string): Promise<Job> {
  const job = await loadJob(id);
  if (!job) throw new AholoError("Job not found", "NOT_FOUND", 404);
  if (job.mode !== "live" || job.stage !== "done" || !job.rigless || !job.files.mesh) throw new AholoError("Only finished freestyle fighters can be re-rigged", "NOT_FREESTYLE", 409);
  if (job.rerig) throw new AholoError("This fighter was already re-rigged once", "RERIG_DONE", 409);
  if (locks.has(id)) throw new AholoError("Busy, try again shortly", "BUSY", 409);
  locks.add(id);
  try {
    job.rerig = { attempt: 1 };
    job.rigless = undefined;
    job.rigRescue = true;
    await startRerig(job, 1);
  } catch (e) {
    job.rigless = true;
    job.stage = "done";
    job.log.push(`[rerig] could not start: ${e instanceof Error ? e.message : e}`);
  } finally {
    await saveJob(job);
    locks.delete(id);
  }
  return job;
}

async function startRerig(job: Job, attempt: 1 | 2) {
  const raw = await readFighterFile(job.id, job.files.mesh!);
  if (!raw) throw new AholoError("Mesh missing from job store");
  const base = path.join("/tmp", `af-${job.id}-rerig${attempt}`);
  await fs.writeFile(`${base}.in.glb`, raw);
  await bakePose(`${base}.in.glb`, `${base}.norm.glb`, 0.5, 1.8);
  if (attempt === 2) await weldSimplify(`${base}.norm.glb`, `${base}.norm.glb`, 0.5);
  await shrinkTextures(`${base}.norm.glb`, `${base}.glb`, 1024);
  const url = await uploadAsset(await fs.readFile(`${base}.glb`), `mesh-rerig${attempt}.glb`);
  await Promise.all(["in", "norm", ""].map((x) => fs.unlink(`${base}${x ? "." + x : ""}.glb`).catch(() => {})));
  const t = await lux3d.autoRig({ modelUrl: url });
  job.rerig = { attempt };
  job.error = undefined;
  job.transient = 0;
  job.log.push(`[rerig] attempt ${attempt}: ${attempt === 1 ? "1.8 m normalised mesh" : "1.8 m + welded/simplified mesh"}`);
  enter(job, "rig", t);
}

/** Re-rig once: normalise the Lux3D mesh to a 1.8 m, feet-on-floor, centred character, re-upload, rig again. */
async function rescueRig(job: Job, reason: string) {
  job.rigRescue = true;
  const raw = await readFighterFile(job.id, job.files.mesh!);
  if (!raw) throw new AholoError("Mesh missing from job store");
  const inPath = path.join("/tmp", `af-${job.id}-rescue.in.glb`);
  const norm = path.join("/tmp", `af-${job.id}-rescue.norm.glb`);
  const out = path.join("/tmp", `af-${job.id}-rescue.glb`);
  await fs.writeFile(inPath, raw);
  await bakePose(inPath, norm, 0.5, 1.8); // no skin → only normalises size/placement
  await shrinkTextures(norm, out, 1024);
  const url = await uploadAsset(await fs.readFile(out), "mesh-1p8m.glb");
  await Promise.all([inPath, norm, out].map((p) => fs.unlink(p).catch(() => {})));
  job.log.push(`[rig] Lux3D rig refused the mesh (${reason.slice(0, 100)}); retrying on a 1.8 m normalised copy`);
  const t = await lux3d.autoRig({ modelUrl: url });
  job.error = undefined;
  job.transient = 0;
  enter(job, "rig", t);
}

function canRiglessFallback(job: Job, msg: string) {
  return job.mode === "live" && job.stage === "rig" && !!job.files.mesh && job.rigless === undefined && RIG_INELIGIBLE.test(msg);
}

/**
 * Lux3D's humanoid auto-rig rejects some meshes (RIG_ELIGIBILITY_FAILED: proportions/pose it can't map to a
 * skeleton). Instead of a dead end, ship the textured Lux3D mesh as a "freestyle" fighter: the game already
 * animates unrigged models procedurally (lunges, spins, hops). No extra credits.
 */
async function finishRigless(job: Job, reason: string) {
  job.rigless = true; // marks the attempt (also prevents loops if optimisation throws)
  const raw = await readFighterFile(job.id, job.files.mesh!);
  if (!raw) throw new AholoError("Mesh missing from job store");
  await fs.mkdir(fighterDir(job.id), { recursive: true });
  const inPath = path.join("/tmp", `af-${job.id}-mesh.in.glb`);
  const outPath = path.join(fighterDir(job.id), "statue.glb");
  await fs.writeFile(inPath, raw);
  await optimizeFighterGlb(inPath, outPath);
  await writeFighterFile(job.id, "statue.glb", await fs.readFile(outPath));
  job.files.statue = "statue.glb";
  job.error = undefined;
  job.transient = 0;
  job.log.push(`[rig] Lux3D rig refused this shape (${reason.slice(0, 120)}), fighting freestyle with the unrigged mesh`);
  await bakePosed(job, inPath);
  await fs.unlink(inPath).catch(() => {});
  if (job.files.posed) await startStage(job, "poster");
  else await finish(job);
}

async function advanceMock(job: Job) {
  if (Date.now() - job.stageStartedAt < MOCK_STAGE_MS) return;
  const order: Stage[] = ["upload", "mascot", "mesh", "rig", "retarget", "poster", "export", "done"];
  const next = order[order.indexOf(job.stage) + 1];
  if (job.stage === "rig") {
    // pretend the rig came back: reuse the placeholder robot (has real clips)
    const src = path.join(shippedFighterRoot(), "robot", "model.glb");
    const buf = await fs.readFile(src);
    await writeFighterFile(job.id, "rigged.glb", buf);
    job.files.rigged = "rigged.glb";
  }
  if (next === "done") return finish(job);
  enter(job, next);
  job.log.push(`[mock] simulated ${next}`);
}

async function finish(job: Job) {
  // Concurrent polls on different instances can race on pendingAnims; re-collect every clip that made it to the store.
  for (const m of MOVES) {
    if (!job.files.anims[m] && (await fighterFileExists(job.id, `anim-${m}.glb`))) job.files.anims[m] = `anim-${m}.glb`;
  }
  enter(job, "done");
  const fighter = jobToFighter(job);
  await writeFighterFile(job.id, "fighter.json", Buffer.from(JSON.stringify(fighter, null, 2), "utf8"));
  await addGeneratedId(job.id);
}

const COLORS = ["#f27f0d", "#38bdf8", "#a3e635", "#f472b6", "#facc15", "#c084fc"];

export function jobToFighter(job: Job): FighterDef {
  const id = job.id;
  const anims: Partial<Record<Move, string>> = {};
  for (const [m, f] of Object.entries(job.files.anims)) anims[m as Move] = assetUrl(id, f!);
  const exports: Record<string, string> = {};
  for (const [k, f] of Object.entries(job.files.exports)) exports[k] = assetUrl(id, f);
  return {
    id,
    name: job.name,
    tagline:
      job.mode === "mock" ? "Mock pipeline fighter (no API key yet)" : job.rigless ? "Lux3D mesh, too wild to rig: fights freestyle" : "Forged by Aholo Lux3D",
    modelUrl: assetUrl(id, job.files.rigged ?? job.files.statue ?? job.files.mesh ?? "rigged.glb"),
    animUrls: Object.keys(anims).length ? anims : undefined,
    exports: Object.keys(exports).length ? exports : undefined,
    thumbUrl: job.files.mascot ? assetUrl(id, job.files.mascot) : job.files.photo ? assetUrl(id, job.files.photo) : undefined,
    photoUrl: job.files.photo ? assetUrl(id, job.files.photo) : undefined,
    posterUrl: job.files.poster ? assetUrl(id, job.files.poster) : undefined,
    color: COLORS[parseInt(id.slice(-2), 16) % COLORS.length],
    source: job.mode === "mock" ? "mock" : "lux3d",
    createdAt: job.createdAt,
  };
}

/** All finished generated fighters (deployment filesystem + Runtime Cache index). */
export async function listGeneratedFighters(): Promise<FighterDef[]> {
  const entries = await listFighterIds();
  const out: FighterDef[] = [];
  for (const e of entries) {
    try {
      const raw = await readFighterFile(e, "fighter.json");
      if (!raw) continue;
      const f: FighterDef = JSON.parse(raw.toString("utf8"));
      const poster = path.join(process.cwd(), "public", "posters", e, "poster.png");
      if (!f.posterUrl && (await fs.stat(poster).catch(() => null))) f.posterUrl = `/api/assets/posters/${e}/poster.png`;
      f.thumbUrl = (await ensureThumb(e, f.thumbUrl)) ?? f.thumbUrl;
      out.push(f);
    } catch {
      /* unfinished job */
    }
  }
  // Starter roster first (fixed order), then user-forged fighters newest first, then test runs.
  const rank = (f: FighterDef) => {
    const i = STARTER_ROSTER_IDS.indexOf(f.id);
    return i >= 0 ? i : f.id.startsWith("test-") ? 1000 : 100;
  };
  return out.sort((a, b) => rank(a) - rank(b) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// ───────────────────────────── helpers ─────────────────────────────

/** Roster cards only need ~320px: make (once) a small WebP next to the 400–500 KB concept PNG. */
async function ensureThumb(id: string, src?: string): Promise<string | undefined> {
  if (await fighterFileExists(id, "thumb.webp")) return assetUrl(id, "thumb.webp");
  const file = src?.match(/\/api\/assets\/[^/]+\/([^/?]+\.(?:png|jpe?g))$/)?.[1];
  if (!file) return undefined;
  try {
    const srcBuf = await readFighterFile(id, file);
    if (!srcBuf) return undefined;
    const sharp = (await import("sharp")).default;
    const thumb = await sharp(srcBuf).resize(320, 320, { fit: "cover", position: "top" }).webp({ quality: 78 }).toBuffer();
    await writeFighterFile(id, "thumb.webp", Buffer.from(thumb));
    return assetUrl(id, "thumb.webp");
  } catch {
    return undefined;
  }
}

/** Persist a remote artefact in the job store (photos, mascots, printable exports — not 22 MB orig GLBs). */
async function rehost(id: string, url: string, file: string): Promise<string> {
  const buf = await fetchToBuffer(url, file);
  await writeFighterFile(id, file, buf);
  return file;
}

/** Download a large Aholo result to /tmp only (do not put 22 MB orig GLBs in Runtime Cache). */
async function downloadToTmp(id: string, url: string, file: string): Promise<string> {
  const buf = await fetchToBuffer(url, file);
  const dest = path.join("/tmp", `af-${id}-${file}`);
  await fs.writeFile(dest, buf);
  return dest;
}

/** Download with a hard timeout; timeouts/5xx surface as transient errors and are retried on the next poll. */
async function fetchToBuffer(url: string, file: string): Promise<Buffer> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(100_000) });
    if (!res.ok) throw new AholoError(`Download failed ${res.status} for ${file}`, undefined, res.status >= 500 ? res.status : undefined);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof AholoError) throw e;
    throw new AholoError(`Download timed out / network error for ${file}: ${e instanceof Error ? e.message : e}`, "NETWORK", 503);
  }
}

function firstContent(outputs?: { content: string | null }[]) {
  return outputs?.[0]?.content ?? undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
