import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { durableEnabled, loadDurablePack, saveDurablePack } from "./durable";
import { readFighterFile, writeFighterFile, getRuntimeCache } from "./store";
import type { FighterDef } from "./fighters";
import { STARTER_ROSTER_IDS } from "./fighters";

export type Report = {
  id: string;
  fighterId: string;
  fighterName?: string;
  reason: string;
  email?: string;
  at: number;
  status: "open" | "hidden" | "unpublished";
};

const REPORTS_BLOB = "moderation/reports.json";
const REPORTS_FS = path.join(process.cwd(), ".data", "moderation", "reports.json");
const CACHE_KEY = "moderation:reports";

async function readReports(): Promise<Report[]> {
  try {
    if (durableEnabled()) {
      const { get } = await import("@vercel/blob");
      const r = await get(REPORTS_BLOB, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(15_000) });
      if (r?.statusCode === 200 && r.stream) {
        const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
        const parsed = JSON.parse(buf.toString("utf8")) as { reports?: Report[] };
        if (Array.isArray(parsed.reports)) return parsed.reports;
      }
    }
  } catch (e) {
    console.warn(`[moderation] blob read failed: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const cache = await getRuntimeCache();
    const hit = cache ? await cache.get(CACHE_KEY) : null;
    if (hit && typeof hit === "object" && Array.isArray((hit as { reports?: unknown }).reports)) {
      return (hit as { reports: Report[] }).reports;
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = await fs.readFile(REPORTS_FS, "utf8");
    const parsed = JSON.parse(raw) as { reports?: Report[] };
    if (Array.isArray(parsed.reports)) return parsed.reports;
  } catch {
    /* no file yet */
  }
  return [];
}

async function writeReports(reports: Report[]): Promise<void> {
  const body = Buffer.from(JSON.stringify({ reports }, null, 2), "utf8");
  try {
    if (durableEnabled()) {
      const { put } = await import("@vercel/blob");
      await put(REPORTS_BLOB, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(20_000),
      });
    }
  } catch (e) {
    console.warn(`[moderation] blob write failed: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const cache = await getRuntimeCache();
    if (cache) await cache.set(CACHE_KEY, { reports }, { ttl: 7 * 24 * 60 * 60, name: CACHE_KEY });
  } catch {
    /* ignore */
  }
  try {
    await fs.mkdir(path.dirname(REPORTS_FS), { recursive: true });
    await fs.writeFile(REPORTS_FS, body);
  } catch (e) {
    console.warn(`[moderation] fs write failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function listReports(): Promise<Report[]> {
  const reports = await readReports();
  return reports.sort((a, b) => b.at - a.at);
}

export async function addReport(input: { fighterId: string; fighterName?: string; reason: string; email?: string }): Promise<Report> {
  const reports = await readReports();
  const rec: Report = {
    id: `rep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    fighterId: input.fighterId,
    fighterName: input.fighterName,
    reason: input.reason.slice(0, 500),
    email: input.email?.slice(0, 120) || undefined,
    at: Date.now(),
    status: "open",
  };
  reports.push(rec);
  await writeReports(reports.slice(-200));
  return rec;
}

async function patchDurableFighter(id: string, fighter: FighterDef): Promise<void> {
  if (!durableEnabled()) return;
  try {
    const pack = await loadDurablePack(id);
    if (!pack) return;
    pack.set("fighter.json", Buffer.from(JSON.stringify(fighter, null, 2), "utf8"));
    await saveDurablePack(id, pack);
  } catch (e) {
    console.warn(`[moderation] durable patch failed for ${id}: ${e instanceof Error ? e.message : e}`);
  }
}

export async function loadFighterDef(id: string): Promise<FighterDef | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const raw = await readFighterFile(id, "fighter.json");
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString("utf8")) as FighterDef;
  } catch {
    return null;
  }
}

export async function applyFighterModeration(
  id: string,
  action: "hide" | "unpublish",
): Promise<{ ok: true; fighter: FighterDef } | { ok: false; error: string }> {
  if (STARTER_ROSTER_IDS.includes(id) || id === "robot") {
    return { ok: false, error: "Starter roster fighters can't be hidden or unpublished from here." };
  }
  const fighter = await loadFighterDef(id);
  if (!fighter) return { ok: false, error: "Fighter not found." };
  if (action === "hide") {
    fighter.hidden = true;
    fighter.photoPublic = false;
    delete fighter.photoUrl;
  } else {
    fighter.photoPublic = false;
    delete fighter.photoUrl;
  }
  const buf = Buffer.from(JSON.stringify(fighter, null, 2), "utf8");
  await writeFighterFile(id, "fighter.json", buf);
  await patchDurableFighter(id, fighter);
  const reports = await readReports();
  let changed = false;
  for (const r of reports) {
    if (r.fighterId === id && r.status === "open") {
      r.status = action === "hide" ? "hidden" : "unpublished";
      changed = true;
    }
  }
  if (changed) await writeReports(reports);
  return { ok: true, fighter };
}
