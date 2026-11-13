// Shared helpers for CLI scripts (never prints the API key). Run scripts with: node --env-file=.env.local …
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const KEY = process.env.AHOLO_API_KEY;
if (!KEY) throw new Error("AHOLO_API_KEY missing");
export const BASE = "https://api.aholo.ai";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(method, p, body, { raw = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(BASE + p, {
        method,
        headers: { Authorization: KEY, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // network blip: GETs are idempotent, so retry them (never blindly re-POST a paid create)
      if (method === "GET" && attempt < 40) { await sleep(15000); continue; }
      throw e;
    }
    if (method === "GET" && r.status >= 500 && attempt < 40) { await sleep(15000); continue; }
    const t = await r.text();
    let j;
    try { j = JSON.parse(t); } catch { throw new Error(`${p} → ${r.status} ${t.slice(0, 300)}`); }
    const busy = r.status === 429 || (j && "c" in j && /11001|rate|concurr/i.test(`${j.c} ${j.m}`));
    if (busy && attempt < 60) { await sleep(15000); continue; }
    if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
    if (raw) return j;
    if (j && "c" in j && j.c !== "0") throw new Error(`${p} → c=${j.c} m=${j.m}`);
    return j && "c" in j ? j.d : j;
  }
}

export function makeLog(file, base = {}) {
  const log = { ...base, startedAt: new Date().toISOString(), steps: [] };
  const save = () => fs.writeFile(file, JSON.stringify(log, null, 2));
  async function step(name, fn, tag = "") {
    const t0 = Date.now();
    console.log(`${tag}▶ ${name}`);
    const entry = { name, startedAt: new Date(t0).toISOString() };
    log.steps.push(entry);
    try {
      const res = await fn(entry);
      entry.ms = Date.now() - t0;
      console.log(`${tag}  ✓ ${name} ${(entry.ms / 1000).toFixed(1)}s ${entry.taskId ?? ""}`);
      await save();
      return res;
    } catch (e) {
      entry.ms = Date.now() - t0;
      entry.error = String(e.message ?? e);
      console.log(`${tag}  ✗ ${name}: ${entry.error}`);
      await save();
      throw e;
    }
  }
  return { log, save, step };
}

export async function pollLux(taskid, entry, every = 8000, maxMs = 25 * 60 * 1000) {
  const t0 = Date.now();
  entry.taskId = String(taskid);
  for (;;) {
    const d = await api("GET", `/global/lux3d/v1/generate/task/get?taskid=${taskid}`);
    if (d.status === 3) return d.outputs ?? [];
    if (d.status === 4 || d.status === 6) throw new Error(`task ${taskid} status ${d.status}: ${JSON.stringify(d.outputs).slice(0, 400)}`);
    if (Date.now() - t0 > maxMs) throw new Error(`task ${taskid} timed out`);
    await sleep(every);
  }
}

export async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${dest} ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return buf.length;
}

export async function upload(buf, filename) {
  const tok = await api("GET", "/global/asset/v1/token");
  if (buf.length > tok.blockSize) return blockUpload(tok, buf, filename);
  const form = new FormData();
  form.set("md5", createHash("md5").update(buf).digest("hex"));
  form.set("file", new Blob([buf], { type: "application/octet-stream" }), filename);
  const up = await (await fetch(`${tok.globalDomain}/ous/api/v2/single/upload`, { method: "POST", headers: { "ous-token-v2": tok.ousToken }, body: form })).json();
  if (up.c !== "0") throw new Error(`upload ${JSON.stringify(up).slice(0, 300)}`);
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    const st = await (await fetch(`${tok.globalDomain}/ous/api/v2/upload/status`, { headers: { "ous-token-v2": tok.ousToken } })).json();
    if (st.d?.status === 5 && st.d.url) return st.d.url;
    if ([6, 8].includes(st.d?.status)) throw new Error(`upload status ${JSON.stringify(st).slice(0, 300)}`);
  }
  throw new Error("upload timeout");
}

async function waitStatus(tok) {
  for (let i = 0; i < 1200; i++) {
    await sleep(500);
    const st = await (await fetch(`${tok.globalDomain}/ous/api/v2/upload/status`, { headers: { "ous-token-v2": tok.ousToken } })).json();
    if (st.d?.status === 5 && st.d.url) return st.d.url;
    if ([6, 8].includes(st.d?.status)) throw new Error(`upload status ${JSON.stringify(st).slice(0, 300)}`);
  }
  throw new Error("upload timeout");
}

/** OUS multipart upload for files > blockSize (init → parts (≤2 concurrent) → status). */
export async function blockUpload(tok, buf, filename) {
  const md5 = createHash("md5").update(buf).digest("hex");
  const bs = tok.blockSize;
  const blocks = Math.ceil(buf.length / bs);
  const q = new URLSearchParams({ md5, blocks: String(blocks), size: String(buf.length), name: filename });
  const init = await (await fetch(`${tok.globalDomain}/ous/api/v2/block/upload/init?${q}`, { method: "POST", headers: { "ous-token-v2": tok.ousToken } })).json();
  if (init.c !== "0") throw new Error(`block init ${JSON.stringify(init).slice(0, 300)}`);
  // Deduplicated (same md5 already stored) → no parts needed.
  const lack = init.d?.deduplicated ? [] : (init.d?.lackBlocks ?? Array.from({ length: blocks }, (_, i) => i + 1));
  const queue = [...lack];
  const worker = async () => {
    while (queue.length) {
      const b = queue.shift();
      const form = new FormData();
      form.set("block", String(b));
      form.set("file", new Blob([buf.subarray((b - 1) * bs, b * bs)], { type: "application/octet-stream" }), filename);
      const r = await (await fetch(`${tok.globalDomain}/ous/api/v2/block/upload/part`, { method: "POST", headers: { "ous-token-v2": tok.ousToken }, body: form })).json();
      if (r.c !== "0") throw new Error(`part ${b} ${JSON.stringify(r).slice(0, 200)}`);
    }
  };
  await Promise.all([worker(), worker()]);
  return waitStatus(tok);
}
