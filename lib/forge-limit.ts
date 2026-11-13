import "server-only";
import { createHash } from "node:crypto";
import { getRuntimeCache } from "./store";

/**
 * Server-side spend guard for POST /api/pipeline.
 *
 * Caps live (credit-spending) forges at:
 *   - FORGE_IP_DAILY_LIMIT     (default 2) per client IP per Africa/Lagos day
 *   - FORGE_GLOBAL_DAILY_LIMIT (default 15) across all IPs per day
 *
 * Counters live in Vercel Runtime Cache when available (shared across instances
 * in a region). Otherwise they fall back to an in-memory Map, which is
 * per-instance only and resets on cold start — acceptable for local dev, and
 * called out as a limitation on Vercel if the cache API is missing.
 *
 * IPs are hashed before storage. Limits do not apply in mock mode (no API key).
 * When a cap is hit the forge falls back to a labelled mock run (FORGE_LIMIT_FALLBACK, default "mock").
 */

export const IP_DAILY_LIMIT = Number(process.env.FORGE_IP_DAILY_LIMIT ?? 2);
export const GLOBAL_DAILY_LIMIT = Number(process.env.FORGE_GLOBAL_DAILY_LIMIT ?? 15);
export type ForgeLimitFallback = "block" | "mock";
/**
 * What happens once a cap is hit. Default `mock` (changed 13 Nov 2026 for judging): the forge still runs end to
 * end as a clearly labelled demo forge (no credits), so a judge never hits a dead end. `block` = HTTP 429 and
 * "try the roster".
 */
export const FORGE_LIMIT_FALLBACK: ForgeLimitFallback = process.env.FORGE_LIMIT_FALLBACK === "block" ? "block" : "mock";

const LIMIT_MESSAGE = "Forge limit reached, try the roster";

/** Calendar date in Africa/Lagos (UTC+1, no DST). */
export function lagosDayKey(now = Date.now()): string {
  return new Date(now + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown";
}

function ipHash(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

const mem = new Map<string, { day: string; n: number }>();

function memGet(key: string, day: string): number {
  const v = mem.get(key);
  return !v || v.day !== day ? 0 : v.n;
}
function memAdd(key: string, day: string): number {
  const n = memGet(key, day) + 1;
  mem.set(key, { day, n });
  return n;
}

function ttlRemainingSeconds(day: string, now = Date.now()): number {
  const end = Date.parse(`${day}T23:59:59.000+01:00`) + 1000;
  return Math.max(60, Math.ceil((end - now) / 1000));
}

function limits() {
  return {
    ipLimit: Number.isFinite(IP_DAILY_LIMIT) && IP_DAILY_LIMIT >= 0 ? IP_DAILY_LIMIT : 2,
    globalLimit: Number.isFinite(GLOBAL_DAILY_LIMIT) && GLOBAL_DAILY_LIMIT >= 0 ? GLOBAL_DAILY_LIMIT : 15,
  };
}

export type ForgeLimitOk = { ok: true; ipUsed: number; globalUsed: number; ipLimit: number; globalLimit: number };
export type ForgeLimitHit = {
  ok: false;
  reason: "ip" | "global";
  message: string;
  ipUsed: number;
  globalUsed: number;
  ipLimit: number;
  globalLimit: number;
};
export type ForgeLimitResult = ForgeLimitOk | ForgeLimitHit;

async function readCounts(ip: string, day: string): Promise<{ ipUsed: number; globalUsed: number; cache: Awaited<ReturnType<typeof getRuntimeCache>> }> {
  const ipK = `forge:${day}:ip:${ipHash(ip)}`;
  const gK = `forge:${day}:global`;
  const c = await getRuntimeCache("anything-fighter-limits");
  if (c) {
    return {
      ipUsed: Number((await c.get(ipK)) ?? 0) || 0,
      globalUsed: Number((await c.get(gK)) ?? 0) || 0,
      cache: c,
    };
  }
  return { ipUsed: memGet(ipK, day), globalUsed: memGet(gK, day), cache: null };
}

export async function checkForgeLimit(ip: string): Promise<ForgeLimitResult> {
  const { ipLimit, globalLimit } = limits();
  const day = lagosDayKey();
  const { ipUsed, globalUsed } = await readCounts(ip, day);
  if (ipUsed >= ipLimit) {
    return { ok: false, reason: "ip", message: LIMIT_MESSAGE, ipUsed, globalUsed, ipLimit, globalLimit };
  }
  if (globalUsed >= globalLimit) {
    return { ok: false, reason: "global", message: LIMIT_MESSAGE, ipUsed, globalUsed, ipLimit, globalLimit };
  }
  return { ok: true, ipUsed, globalUsed, ipLimit, globalLimit };
}

/** Reserve one live-forge slot. Returns a hit if the cap is already (or thereby) reached. */
export async function consumeForgeSlot(ip: string): Promise<ForgeLimitResult> {
  const prior = await checkForgeLimit(ip);
  if (!prior.ok) return prior;
  const day = lagosDayKey();
  const ipK = `forge:${day}:ip:${ipHash(ip)}`;
  const gK = `forge:${day}:global`;
  const ttl = ttlRemainingSeconds(day);
  const { cache } = await readCounts(ip, day);
  let ipUsed: number;
  let globalUsed: number;
  if (cache) {
    ipUsed = (Number((await cache.get(ipK)) ?? 0) || 0) + 1;
    globalUsed = (Number((await cache.get(gK)) ?? 0) || 0) + 1;
    await Promise.all([
      cache.set(ipK, ipUsed, { ttl, tags: ["forge-limits"], name: ipK }),
      cache.set(gK, globalUsed, { ttl, tags: ["forge-limits"], name: gK }),
    ]);
  } else {
    ipUsed = memAdd(ipK, day);
    globalUsed = memAdd(gK, day);
  }
  const { ipLimit, globalLimit } = limits();
  if (ipUsed > ipLimit) {
    return { ok: false, reason: "ip", message: LIMIT_MESSAGE, ipUsed, globalUsed, ipLimit, globalLimit };
  }
  if (globalUsed > globalLimit) {
    return { ok: false, reason: "global", message: LIMIT_MESSAGE, ipUsed, globalUsed, ipLimit, globalLimit };
  }
  return { ok: true, ipUsed, globalUsed, ipLimit, globalLimit };
}
