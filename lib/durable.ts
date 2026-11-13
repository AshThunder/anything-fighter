import "server-only";

/**
 * Durable storage for finished forged fighters: Vercel Blob (free on Hobby within its limits).
 *
 * Runtime Cache (lib/store.ts) is per-region, LRU-evicted and TTL'd, and /tmp is per-instance, so a forged
 * fighter's rigged GLB can vanish while its fighter.json is still listed (seen on prod 13 Nov 2026). When a
 * Blob store is connected (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID + Vercel OIDC), every finished live
 * fighter is also written to Blob as ONE pack file (`fighters/<id>.afp`: all optimised artefacts + fighter.json
 * + job.json, never *.orig.glb) plus one shared index (`fighters/index.json`). That is 2 Blob "advanced
 * operations" per forge, so the Hobby allowance (2,000/month) covers far more forges than the spend guard allows.
 * Reads go /tmp → Runtime Cache → Blob pack (unpacked into /tmp once per instance).
 *
 * Without credentials everything here is a no-op and the app behaves exactly as before. Blob errors never
 * break a forge or a page: they are logged and the cache/fs layers keep working.
 */

const PREFIX = "fighters/";
const INDEX = `${PREFIX}index.json`;
const MAGIC = "AFP1";
const TIMEOUT_MS = 20_000;
const access = () => (process.env.BLOB_ACCESS === "public" ? "public" : "private") as "public" | "private";

export const durableEnabled = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

const blob = () => import("@vercel/blob");

export type FighterPack = Map<string, Buffer>;

/** [MAGIC][u32 header length][header JSON {files:[{name,size}]}][file bytes…] */
export function encodePack(files: FighterPack): Buffer {
  const header = Buffer.from(JSON.stringify({ files: [...files].map(([name, b]) => ({ name, size: b.length })) }), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length);
  return Buffer.concat([Buffer.from(MAGIC), len, header, ...files.values()]);
}

export function decodePack(buf: Buffer): FighterPack | null {
  if (buf.length < 8 || buf.subarray(0, 4).toString() !== MAGIC) return null;
  const hl = buf.readUInt32LE(4);
  const header = JSON.parse(buf.subarray(8, 8 + hl).toString("utf8")) as { files: { name: string; size: number }[] };
  const out: FighterPack = new Map();
  let off = 8 + hl;
  for (const f of header.files) {
    out.set(f.name, Buffer.from(buf.subarray(off, off + f.size)));
    off += f.size;
  }
  return off === buf.length ? out : null;
}

async function readBlob(pathname: string, useCache = true): Promise<Buffer | null> {
  const { get } = await blob();
  const r = await get(pathname, { access: access(), useCache, abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return Buffer.from(await new Response(r.stream).arrayBuffer());
}

async function writeBlob(pathname: string, body: Buffer, contentType: string, cacheControlMaxAge: number) {
  const { put } = await blob();
  await put(pathname, body, {
    access: access(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge,
    abortSignal: AbortSignal.timeout(60_000),
  });
}

// ── index ──
let indexMemo: { at: number; ids: Promise<string[]> } | null = null;
const INDEX_MEMO_MS = 60_000;

async function fetchIndex(useCache: boolean): Promise<string[]> {
  try {
    const buf = await readBlob(INDEX, useCache);
    const ids = buf ? (JSON.parse(buf.toString("utf8")) as { ids?: unknown }).ids : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]+$/.test(x)) : [];
  } catch (e) {
    console.warn(`[durable] index read failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** Fighter ids with a durable pack (memoised per instance for a minute). */
export async function durableIds(): Promise<string[]> {
  if (!durableEnabled()) return [];
  if (!indexMemo || Date.now() - indexMemo.at > INDEX_MEMO_MS) indexMemo = { at: Date.now(), ids: fetchIndex(true) };
  return indexMemo.ids;
}

// ── packs ──
const packMemo = new Map<string, { at: number; pack: Promise<FighterPack | null> }>();
const MISS_MEMO_MS = 60_000;

/** Load (once per instance) a fighter's durable pack. Null when Blob is off, the pack is missing or unreadable. */
export async function loadDurablePack(id: string): Promise<FighterPack | null> {
  if (!durableEnabled() || !/^[a-z0-9-]+$/.test(id)) return null;
  const hit = packMemo.get(id);
  if (hit) {
    const p = await hit.pack;
    if (p || Date.now() - hit.at < MISS_MEMO_MS) return p;
  }
  const pack = (async () => {
    if (!(await durableIds()).includes(id)) return null;
    try {
      const buf = await readBlob(`${PREFIX}${id}.afp`);
      return buf ? decodePack(buf) : null;
    } catch (e) {
      console.warn(`[durable] pack read failed for ${id}: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  })();
  packMemo.set(id, { at: Date.now(), pack });
  return pack;
}

/** Write a finished fighter's pack + add it to the index. Returns false (never throws) on any Blob error. */
export async function saveDurablePack(id: string, files: FighterPack): Promise<boolean> {
  if (!durableEnabled()) return false;
  for (const name of files.keys()) if (name.includes(".orig.")) files.delete(name); // never persist raw 22 MB GLBs
  try {
    await writeBlob(`${PREFIX}${id}.afp`, encodePack(files), "application/octet-stream", 300);
    // read-modify-write with a fresh (uncached) read; a lost race is healed by the backfill in listGeneratedFighters
    const ids = await fetchIndex(false);
    if (!ids.includes(id)) {
      ids.push(id);
      await writeBlob(INDEX, Buffer.from(JSON.stringify({ ids }), "utf8"), "application/json", 60);
    }
    indexMemo = { at: Date.now(), ids: Promise.resolve(ids) };
    packMemo.set(id, { at: Date.now(), pack: Promise.resolve(files) });
    return true;
  } catch (e) {
    console.warn(`[durable] save failed for ${id}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
