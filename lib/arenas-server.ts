import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BUILTIN_ARENAS, type ArenaDef } from "./arenas";
import { splatPlacement } from "./splat-placement";
import { isWorldFailed, isWorldStuck, listWorldJobIds, loadWorldJob, worldDetail, type WorldDetail } from "./world";

export const ARENA_ROOT = path.join(process.cwd(), "public", "arenas");
export const arenaAsset = (id: string, file: string) => `/api/assets/arenas/${id}/${file}`;

const NAMES: Record<string, string> = {
  "kitchen-colosseum": "Kitchen Colosseum",
  "toy-shop": "Toy Shop at Midnight",
  "rooftop-dojo": "Rooftop Dojo at Sunset",
  "my-room": "My Room (scan)",
};

/** All world ids submitted for a shipped arena dir (world-id.txt, one per line, oldest first). */
export async function shippedWorldIds(id: string): Promise<string[]> {
  const raw = await fs.readFile(path.join(ARENA_ROOT, id, "world-id.txt"), "utf8").catch(() => "");
  return raw.split(/\s+/).filter((x) => /^[A-Za-z0-9]+$/.test(x));
}

async function statusNote(kind: string, d: WorldDetail | null, worldId: string): Promise<{ note: string; stuck: boolean; status?: string; progress?: number }> {
  if (!d) return { note: `${kind} status unknown (${worldId})`, stuck: false };
  const stuck = await isWorldStuck(d, worldId);
  const pct = Math.round((d.progress ?? 0) * 100);
  const what = d.status === "RUNNING" ? `generating ${pct}%` : "queued at Aholo";
  return {
    note: `${kind} ${stuck ? "stuck in Aholo's queue" : what} (${worldId})`,
    stuck,
    status: d.status,
    progress: d.progress,
  };
}

async function resolveShippedPending(id: string, ids: string[]): Promise<ArenaDef | null> {
  const reality = await fs.stat(path.join(ARENA_ROOT, id, "recon-log.json")).then(() => true, () => false);
  const kind = reality ? "Aholo Reality scan" : "Aholo SpatialGen world";
  const name = NAMES[id] ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const prompt = await fs
    .readFile(path.join(ARENA_ROOT, id, "gen-log.json"), "utf8")
    .then((s) => (JSON.parse(s) as { prompt?: string }).prompt)
    .catch(() => undefined);
  const details = await Promise.all(ids.map((w) => worldDetail(w)));
  const okIdx = details.findIndex((d) => d?.status === "SUCCEEDED");
  if (okIdx >= 0) {
    const d = details[okIdx]!;
    const worldId = ids[okIdx];
    const splat = d.assets?.splats?.urls?.spzPath ? "world.spz" : d.assets?.splats?.urls?.plyPath ? "world.ply" : undefined;
    const pano = d.assets?.imagery?.panoUrl ? "pano.jpg" : undefined;
    if (!splat && !pano) return null;
    const upAxis = d.assets?.semanticsMetadata?.upAxis === "Y" ? "Y" : "Z";
    const direct = d.assets?.splats?.urls?.spzPath ?? d.assets?.splats?.urls?.plyPath;
    const place = splat ? await splatPlacement(id, worldId, d.assets?.splats?.urls?.spzPath, upAxis, !reality) : null;
    return {
      id,
      name,
      prompt,
      worldId,
      source: reality ? "reality" : "spatialgen",
      upAxis,
      ...(place ?? {}),
      splatUrl: splat ? arenaAsset(id, splat) : undefined,
      // phones: direct CDN first (no redirect hop), then stream through our origin
      splatUrls: splat ? [...(direct ? [direct] : []), `${arenaAsset(id, splat)}?proxy=1`] : undefined,
      panoUrl: pano ? arenaAsset(id, pano) : undefined,
      cover: pano ? arenaAsset(id, pano) : undefined,
      note: kind,
    };
  }
  // Nothing finished: report the most advanced live job; drop the arena if every job failed.
  const alive = ids.map((w, i) => ({ w, d: details[i] })).filter((x) => !isWorldFailed(x.d?.status));
  if (!alive.length) return null;
  const best = alive.find((x) => x.d?.status === "RUNNING") ?? alive[0];
  const s = await statusNote(kind, best.d, best.w);
  return { id, name, prompt, source: reality ? "reality" : "spatialgen", worldId: best.w, pending: true, ...s };
}

/** Built-ins + finished/pending SpatialGen & Reality arenas (shipped dirs + jobs created in the app). */
export async function listArenas(): Promise<ArenaDef[]> {
  const out: ArenaDef[] = [];
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(ARENA_ROOT);
  } catch {}
  await Promise.all(
    dirs
      .filter((d) => /^[a-z0-9-]+$/.test(d) && d !== "my-room-demo-input" && !/^(room|world)-/.test(d))
      .map(async (id) => {
        try {
          // Baked arena: splat/pano committed into public/arenas/<id>/ with arena.json
          const meta = JSON.parse(await fs.readFile(path.join(ARENA_ROOT, id, "arena.json"), "utf8"));
          const files = await fs.readdir(path.join(ARENA_ROOT, id));
          const splat = ["world.spz", "world.ply", "world.sog"].find((f) => files.includes(f));
          const pano = files.find((f) => /^pano\.(jpe?g|png|webp)$/.test(f));
          out.push({
            id,
            name: meta.name ?? NAMES[id] ?? id,
            source: meta.source === "reality" ? "reality" : "spatialgen",
            prompt: meta.prompt,
            worldId: meta.worldId,
            upAxis: meta.upAxis === "Y" ? "Y" : meta.upAxis === "-Y" ? "-Y" : "Z",
            origin: meta.origin,
            scale: meta.scale,
            yaw: meta.yaw,
            splatUrl: splat ? arenaAsset(id, splat) : meta.splatUrl,
            panoUrl: pano ? arenaAsset(id, pano) : undefined,
            cover: files.includes("cover.jpg") ? arenaAsset(id, "cover.jpg") : pano ? arenaAsset(id, pano) : undefined,
            note: meta.source === "reality" ? "Aholo Reality 3DGS scan" : "Aholo SpatialGen world",
          });
        } catch {
          const ids = await shippedWorldIds(id);
          if (!ids.length) return;
          const a = await resolveShippedPending(id, ids);
          if (a) out.push(a);
        }
      }),
  );
  // Arenas created from the app (SpatialGen prompt / room scan).
  for (const jid of await listWorldJobIds()) {
    const j = await loadWorldJob(jid).catch(() => null);
    if (!j || j.status === "FAILED" || j.status === "UPLOADING") continue;
    const kind = j.kind === "reality" ? "Aholo Reality scan" : "Aholo SpatialGen world";
    if (j.status === "SUCCEEDED") {
      out.push({
        id: j.id,
        name: j.mode === "mock" ? `${j.name} (mock)` : j.name,
        prompt: j.prompt,
        worldId: j.worldId,
        source: j.kind,
        upAxis: j.upAxis ?? "Z",
        splatUrl: arenaAsset(j.id, j.mode === "mock" ? "world.sog" : "world.spz"),
        panoUrl: j.mode === "live" && j.kind === "spatialgen" ? arenaAsset(j.id, "pano.jpg") : undefined,
        note: kind + (j.mode === "mock" ? " (mock: no API key)" : ""),
      });
    } else {
      out.push({ id: j.id, name: j.name, source: j.kind, worldId: j.worldId, pending: true, status: j.status, progress: j.progress, note: `${kind} ${j.status.toLowerCase()}` });
    }
  }
  const rank = (a: ArenaDef) => (a.pending ? 10 : 0) + (a.source === "spatialgen" ? 0 : a.source === "reality" ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  // Neon Ring first, then finished worlds, then the official Aholo Viewer sample splat. The sample is always
  // listed (it no longer drops out once a generated world is ready, a regression from 31af7df): it's the
  // reliable 3DGS fallback if Aholo's signed world URLs ever stop resolving.
  return [BUILTIN_ARENAS[0], ...out.filter((a) => !a.pending), ...BUILTIN_ARENAS.slice(1), ...out.filter((a) => a.pending)];
}

/** Resolve the Aholo world id behind an arena id (shipped dir or app-created job). */
export async function arenaWorldId(id: string): Promise<string | null> {
  if (/^(room|world)-/.test(id)) {
    const j = await loadWorldJob(id);
    if (!j || j.status !== "SUCCEEDED") return null;
    return j.mode === "mock" ? "mock" : (j.worldId ?? null);
  }
  const ids = await shippedWorldIds(id);
  const details = await Promise.all(ids.map((w) => worldDetail(w)));
  const i = details.findIndex((d) => d?.status === "SUCCEEDED");
  return i >= 0 ? ids[i] : null;
}
