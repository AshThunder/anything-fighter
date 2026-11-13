import { promises as fs } from "node:fs";
import path from "node:path";
import { readFighterFile } from "@/lib/store";
import { ARENA_ROOT, arenaWorldId } from "@/lib/arenas-server";
import { worldFileUrl } from "@/lib/world";
import { isPhotoBlocked } from "@/lib/photo-privacy";

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

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const parts = (await ctx.params).path;
  let buf: Buffer | null = null;
  let ext = "";
  let immutable = false;
  if (parts.length === 2 && SAFE_ID.test(parts[0]) && SAFE_FILE.test(parts[1]) && !BLOCKED(parts[1]) && !(await isPhotoBlocked(parts[0], parts[1]))) {
    buf = await readFighterFile(parts[0], parts[1]);
    ext = path.extname(parts[1]).toLowerCase();
    // a finished forged fighter's files never change (new forge = new id): let the CDN keep them for a year
    // photos are the exception: short/no-store cache so a takedown is immediate
    const isPhoto = /^photo\./i.test(parts[1]);
    immutable = parts[0].startsWith("gen-") && parts[1] !== "fighter.json" && !isPhoto;
  } else if (parts.length === 3 && parts[0] === "arenas" && SAFE_ID.test(parts[1]) && SAFE_FILE.test(parts[2]) && !BLOCKED(parts[2])) {
    try {
      buf = await fs.readFile(path.join(ARENA_ROOT, parts[1], parts[2]));
    } catch {
      buf = null;
    }
    ext = path.extname(parts[2]).toLowerCase();
    if (!buf && /^(world\.(spz|ply|sog)|pano\.(jpe?g|png|webp))$/.test(parts[2])) {
      // Finished Aholo world that isn't baked into the deployment: point at a freshly signed Aholo URL
      // (result URLs expire, multi-MB splats are too big to proxy through a function).
      const worldId = await arenaWorldId(parts[1]);
      const url = worldId ? await worldFileUrl(worldId, parts[2]) : null;
      if (!url) return new Response("Not found", { status: 404 });
      if (ext.startsWith(".p") && ext !== ".ply") {
        // panorama: stream it through so three.js TextureLoader gets same-origin bytes (no CORS surprises)
        const up = await fetch(url).catch(() => null);
        if (!up?.ok || !up.body) return new Response("Upstream error", { status: 502 });
        return new Response(up.body, {
          headers: { "Content-Type": up.headers.get("content-type") ?? TYPES[ext] ?? "image/jpeg", "Cache-Control": "public, max-age=600" },
        });
      }
      if (new URL(req.url).searchParams.has("proxy")) {
        // fallback for devices that can't fetch the Aholo CDN directly: stream the splat through our origin
        const up = await fetch(url).catch(() => null);
        if (!up?.ok || !up.body) return new Response("Upstream error", { status: 502 });
        const len = up.headers.get("content-length");
        return new Response(up.body, {
          headers: {
            "Content-Type": "application/octet-stream",
            ...(len ? { "Content-Length": len } : {}),
            "Cache-Control": "public, max-age=600",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return Response.redirect(url, 302);
    }
  } else if (parts.length === 3 && parts[0] === "posters" && SAFE_ID.test(parts[1]) && /^[\w-]+\.png$/.test(parts[2])) {
    try {
      buf = await fs.readFile(path.join(process.cwd(), "public", "posters", parts[1], parts[2]));
    } catch {
      buf = null;
    }
    ext = ".png";
  }
  if (!buf) return new Response("Not found", { status: 404 });
  const isPhoto = parts.length === 2 && /^photo\./i.test(parts[1]);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": isPhoto
        ? "private, no-store, max-age=0, must-revalidate"
        : immutable
          ? "public, max-age=31536000, s-maxage=31536000, immutable"
          : "public, max-age=3600",
      ...(isPhoto ? {} : { "Access-Control-Allow-Origin": "*" }),
    },
  });
}
