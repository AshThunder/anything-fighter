import "server-only";
import { waitUntil } from "@vercel/functions";
import { SPLAT_PLACEMENT } from "./arenas";
import { fitSplat, type SplatPlacement } from "./splat-fit";
import { getRuntimeCache } from "./store";

const mem = new Map<string, SplatPlacement | Promise<SplatPlacement | null>>();

/**
 * Placement for a generated world: hand-tuned override (lib/arenas SPLAT_PLACEMENT) → cached auto-fit
 * (lib/splat-fit, keyed by worldId) → computed now with a short time budget (keeps going in the background
 * via waitUntil and caches, so the next /api/arenas call has it).
 */
export async function splatPlacement(arenaId: string, worldId: string | undefined, spzUrl: string | undefined, upAxis: "Z" | "Y" | "-Y"): Promise<SplatPlacement | null> {
  if (SPLAT_PLACEMENT[arenaId]) return SPLAT_PLACEMENT[arenaId];
  if (!worldId || !spzUrl || !/\.spz(\?|$)/.test(spzUrl)) return null;
  const key = `splatfit:v1:${worldId}`;
  const hit = mem.get(key);
  if (hit && !(hit instanceof Promise)) return hit;
  let p = hit as Promise<SplatPlacement | null> | undefined;
  if (!p) {
    p = (async () => {
      const cache = await getRuntimeCache();
      const cached = (await cache?.get(key).catch(() => null)) as SplatPlacement | null | undefined;
      if (cached?.origin) return cached;
      const r = await fetch(spzUrl, { signal: AbortSignal.timeout(45_000) });
      if (!r.ok) throw new Error(`spz ${r.status}`);
      const fit = fitSplat(Buffer.from(await r.arrayBuffer()), upAxis);
      await cache?.set(key, fit, { ttl: 30 * 86400, name: key }).catch(() => {});
      return fit;
    })()
      .then((v) => {
        if (v) mem.set(key, v);
        else mem.delete(key);
        return v;
      })
      .catch((e) => {
        console.warn("[splat-fit]", worldId, e);
        mem.delete(key);
        return null;
      });
    mem.set(key, p);
    try {
      waitUntil(p);
    } catch {}
  }
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
}
