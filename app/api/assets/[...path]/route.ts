import { promises as fs } from "node:fs";
import path from "node:path";
import { readFighterFile } from "@/lib/store";
import { ARENA_ROOT } from "@/lib/arenas-server";

const TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".stl": "model/stl",
  ".3mf": "model/3mf",
  ".usdz": "model/vnd.usdz+zip",
  ".json": "application/json",
  ".spz": "application/octet-stream",
  ".ply": "application/octet-stream",
  ".sog": "application/octet-stream",
  ".mp4": "video/mp4",
};
const SAFE_ID = /^[a-z0-9-]+$/;
const SAFE_FILE = /^[\w-]+(\.[\w-]+)*$/;
const BLOCKED = (f: string) => f === "job.json" || f.endsWith("-log.json") || f.includes(".orig.");

/**
 * Serves generated assets written after `next build`:
 *   /api/assets/<fighterId>/<file>         → public/fighters/<id>/<file>
 *   /api/assets/arenas/<arenaId>/<file>    → public/arenas/<id>/<file>
 *   /api/assets/posters/<fighterId>/<x>.png → public/posters/<id>/<x>.png (RenderCloud)
 */
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const parts = (await ctx.params).path;
  let buf: Buffer | null = null;
  let ext = "";
  if (parts.length === 2 && SAFE_ID.test(parts[0]) && SAFE_FILE.test(parts[1]) && !BLOCKED(parts[1])) {
    buf = await readFighterFile(parts[0], parts[1]);
    ext = path.extname(parts[1]).toLowerCase();
  } else if (parts.length === 3 && parts[0] === "arenas" && SAFE_ID.test(parts[1]) && SAFE_FILE.test(parts[2]) && !BLOCKED(parts[2])) {
    try {
      buf = await fs.readFile(path.join(ARENA_ROOT, parts[1], parts[2]));
    } catch {
      buf = null;
    }
    ext = path.extname(parts[2]).toLowerCase();
  } else if (parts.length === 3 && parts[0] === "posters" && SAFE_ID.test(parts[1]) && /^[\w-]+\.png$/.test(parts[2])) {
    try {
      buf = await fs.readFile(path.join(process.cwd(), "public", "posters", parts[1], parts[2]));
    } catch {
      buf = null;
    }
    ext = ".png";
  }
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
