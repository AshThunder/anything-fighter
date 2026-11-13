import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BUILTIN_ARENAS, type ArenaDef } from "./arenas";

export const ARENA_ROOT = path.join(process.cwd(), "public", "arenas");
export const arenaAsset = (id: string, file: string) => `/api/assets/arenas/${id}/${file}`;

/** Built-ins + every finished SpatialGen / Reality arena in public/arenas/<id>/arena.json. */
export async function listArenas(): Promise<ArenaDef[]> {
  const out: ArenaDef[] = [];
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(ARENA_ROOT);
  } catch {}
  for (const id of dirs.filter((d) => /^[a-z0-9-]+$/.test(d))) {
    if (id === "my-room-demo-input") continue;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(ARENA_ROOT, id, "arena.json"), "utf8"));
      const files = await fs.readdir(path.join(ARENA_ROOT, id));
      const splat = ["world.spz", "world.ply", "world.sog"].find((f) => files.includes(f));
      const pano = files.find((f) => /^pano\.(jpe?g|png|webp)$/.test(f));
      out.push({
        id,
        name: meta.name ?? id,
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
        note: (meta.source === "reality" ? "Aholo Reality 3DGS scan" : "Aholo SpatialGen world") + (meta.mock ? " (mock: no API key)" : ""),
      });
    } catch {
      // not finished: if a script submitted a world job (world-id.txt), show it as "generating"
      const worldId = (await fs.readFile(path.join(ARENA_ROOT, id, "world-id.txt"), "utf8").catch(() => "")).trim();
      if (worldId) {
        const reality = await fs.stat(path.join(ARENA_ROOT, id, "recon-log.json")).then(() => true, () => false);
        const name = id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        out.push({ id, name, source: reality ? "reality" : "spatialgen", worldId, pending: true, note: `${reality ? "Aholo Reality scan" : "Aholo SpatialGen world"} still generating (${worldId})` });
      }
    }
  }
  const rank = (a: ArenaDef) => (a.pending ? 10 : 0) + (a.source === "spatialgen" ? 0 : a.source === "reality" ? 1 : 2);
  // The Aholo Viewer sample splat is only a fallback until at least one generated/scanned world exists.
  return [BUILTIN_ARENAS[0], ...out.sort((a, b) => rank(a) - rank(b)), ...(out.some((a) => a.splatUrl && !a.pending) ? [] : BUILTIN_ARENAS.slice(1))];
}
