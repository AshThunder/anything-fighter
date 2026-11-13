import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { durableIds, loadDurablePack } from "./durable";

/**
 * Job + generated-fighter storage that works both locally and on Vercel.
 *
 * - Local (`next dev` / `next start`): the existing `public/fighters/<id>/` tree.
 * - Vercel: starter-roster files are read from the read-only deployment filesystem.
 *   New jobs and generated artefacts are written to `/tmp` (same-instance hot cache)
 *   and to the per-region Vercel Runtime Cache so state survives across serverless
 *   invocations. Runtime Cache items are capped at 2 MB, so larger files (rigged
 *   meshes) are split into base64 chunks. The cache is free, ephemeral (LRU, TTL)
 *   and is not a durable database — fine for a hackathon preview, not long-term
 *   storage. No paid Blob / Redis / Postgres store is required.
 * - Durable tier (optional, lib/durable.ts): when a Vercel Blob store is connected, finished live fighters are
 *   also saved as one Blob pack each and read back here after the cache has evicted them.
 */

const onVercel = !!process.env.VERCEL;

/** Writable root for newly forged fighters. */
export const fighterFsRoot = () =>
  onVercel ? path.join("/tmp", "anything-fighter", "fighters") : path.join(process.cwd(), "public", "fighters");

/** Roster files shipped with the deployment (read-only on Vercel). */
export const shippedFighterRoot = () => path.join(process.cwd(), "public", "fighters");

export const fighterDir = (id: string) => path.join(fighterFsRoot(), id);

const CACHE_TTL_JOB = 6 * 60 * 60; // 6 hours for in-progress jobs
const CACHE_TTL_DONE = 7 * 24 * 60 * 60; // 7 days for finished fighters
/** Raw bytes per chunk; base64-encoded payload stays under the 2 MB Runtime Cache item limit. */
const CHUNK = 1_200_000;

type RuntimeCache = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown, opts?: { ttl?: number; tags?: string[]; name?: string }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

const cachePromises = new Map<string, Promise<RuntimeCache | null>>();

export async function getRuntimeCache(namespace = "anything-fighter"): Promise<RuntimeCache | null> {
  if (!onVercel) return null;
  let p = cachePromises.get(namespace);
  if (!p) {
    p = import("@vercel/functions")
      .then((m) => m.getCache({ namespace }) as RuntimeCache)
      .catch(() => null);
    cachePromises.set(namespace, p);
  }
  return p;
}

const jobKey = (id: string) => `job:${id}`;
const fileKey = (id: string, file: string) => `file:${id}:${file}`;
const indexKey = () => "fighters:index";

type B64 = { enc: "b64"; data: string };
const isB64 = (v: unknown): v is B64 =>
  !!v && typeof v === "object" && (v as B64).enc === "b64" && typeof (v as B64).data === "string";

async function writeThroughFs(id: string, file: string, buf: Buffer) {
  const dir = fighterDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), buf);
}

export async function writeFighterFile(id: string, file: string, buf: Buffer, ttl = CACHE_TTL_DONE): Promise<void> {
  await writeThroughFs(id, file, buf);
  const cache = await getRuntimeCache();
  if (!cache) return;
  const tags = [`fighter:${id}`, "fighters"];
  const key = fileKey(id, file);
  if (buf.length <= CHUNK) {
    await cache.set(key, { enc: "b64", data: buf.toString("base64") } satisfies B64, { ttl, tags, name: key });
    return;
  }
  const n = Math.ceil(buf.length / CHUNK);
  await cache.set(`${key}:meta`, { chunks: n, size: buf.length }, { ttl, tags, name: `${key}:meta` });
  for (let i = 0; i < n; i++) {
    const slice = buf.subarray(i * CHUNK, (i + 1) * CHUNK);
    await cache.set(
      `${key}:${i}`,
      { enc: "b64", data: Buffer.from(slice).toString("base64") } satisfies B64,
      { ttl, tags, name: `${key}:${i}` },
    );
  }
}

const fsRoots = () => (fighterFsRoot() === shippedFighterRoot() ? [fighterFsRoot()] : [fighterFsRoot(), shippedFighterRoot()]);

async function readFs(id: string, file: string): Promise<Buffer | null> {
  for (const root of fsRoots()) {
    try {
      return await fs.readFile(path.join(root, id, file));
    } catch {
      /* miss */
    }
  }
  return null;
}

/** Durable Blob pack (if connected): unpack every file into the writable fs root once, return the one asked for. */
async function readDurable(id: string, file: string): Promise<Buffer | null> {
  const pack = await loadDurablePack(id);
  const buf = pack?.get(file);
  if (!pack || !buf) return null;
  await Promise.all([...pack].map(([f, b]) => writeThroughFs(id, f, b).catch(() => {})));
  return buf;
}

export async function readFighterFile(id: string, file: string): Promise<Buffer | null> {
  const local = await readFs(id, file);
  if (local) return local;
  const fromCache = await readCachedFile(id, file);
  if (fromCache) return fromCache;
  return readDurable(id, file);
}

async function readCachedFile(id: string, file: string): Promise<Buffer | null> {
  const cache = await getRuntimeCache();
  if (!cache) return null;
  const key = fileKey(id, file);
  const one = await cache.get(key);
  if (isB64(one)) {
    const buf = Buffer.from(one.data, "base64");
    await writeThroughFs(id, file, buf).catch(() => {});
    return buf;
  }
  const meta = (await cache.get(`${key}:meta`)) as { chunks?: number } | undefined;
  if (!meta?.chunks) return null;
  const parts: Buffer[] = [];
  for (let i = 0; i < meta.chunks; i++) {
    const part = await cache.get(`${key}:${i}`);
    if (!isB64(part)) return null;
    parts.push(Buffer.from(part.data, "base64"));
  }
  const buf = Buffer.concat(parts);
  await writeThroughFs(id, file, buf).catch(() => {});
  return buf;
}

export async function fighterFileExists(id: string, file: string): Promise<boolean> {
  return (await readFighterFile(id, file)) !== null;
}

/**
 * Cheap "is this file still there?" check for roster listing (no multi-MB reads): fs stat, then the Runtime
 * Cache entry (single item, or the chunk meta + last chunk), then the durable index.
 */
export async function fighterFileProbe(id: string, file: string): Promise<boolean> {
  for (const root of fsRoots()) {
    if (await fs.stat(path.join(root, id, file)).then(() => true, () => false)) return true;
  }
  const cache = await getRuntimeCache();
  if (cache) {
    const key = fileKey(id, file);
    const meta = (await cache.get(`${key}:meta`).catch(() => undefined)) as { chunks?: number } | undefined;
    if (meta?.chunks && isB64(await cache.get(`${key}:${meta.chunks - 1}`).catch(() => undefined))) return true;
    if (!meta && isB64(await cache.get(key).catch(() => undefined))) return true;
  }
  return (await loadDurablePack(id))?.has(file) ?? false;
}

export async function saveJobRecord(id: string, stage: string, json: string): Promise<void> {
  const ttl = stage === "done" ? CACHE_TTL_DONE : CACHE_TTL_JOB;
  await writeThroughFs(id, "job.json", Buffer.from(json, "utf8"));
  const cache = await getRuntimeCache();
  if (cache) {
    await cache.set(jobKey(id), json, { ttl, tags: [`fighter:${id}`, "jobs"], name: jobKey(id) });
  }
}

export async function loadJobRecord(id: string): Promise<string | null> {
  const buf = await readFs(id, "job.json");
  if (buf) return buf.toString("utf8");
  const cache = await getRuntimeCache();
  const v = cache ? await cache.get(jobKey(id)) : undefined;
  if (typeof v === "string") {
    await writeThroughFs(id, "job.json", Buffer.from(v, "utf8")).catch(() => {});
    return v;
  }
  // finished fighters whose cache entry was evicted: the durable pack carries the final job record
  return (await readDurable(id, "job.json"))?.toString("utf8") ?? null;
}

export async function addGeneratedId(id: string): Promise<void> {
  const cache = await getRuntimeCache();
  if (!cache) return;
  const cur = (await cache.get(indexKey())) as string[] | undefined;
  const next = Array.from(new Set([...(Array.isArray(cur) ? cur : []), id]));
  await cache.set(indexKey(), next, { ttl: CACHE_TTL_DONE, tags: ["fighters"], name: "fighters:index" });
}

export async function listFighterIds(): Promise<string[]> {
  const ids = new Set<string>();
  const roots = fighterFsRoot() === shippedFighterRoot() ? [fighterFsRoot()] : [shippedFighterRoot(), fighterFsRoot()];
  for (const root of roots) {
    try {
      for (const e of await fs.readdir(root)) {
        if (/^[a-z0-9-]+$/.test(e)) ids.add(e);
      }
    } catch {
      /* empty */
    }
  }
  const cache = await getRuntimeCache();
  if (cache) {
    const cur = (await cache.get(indexKey())) as string[] | undefined;
    if (Array.isArray(cur)) cur.forEach((x) => ids.add(x));
  }
  (await durableIds()).forEach((x) => ids.add(x));
  return [...ids];
}

export const JOB_TTL_SECONDS = CACHE_TTL_JOB;
export const DONE_TTL_SECONDS = CACHE_TTL_DONE;
