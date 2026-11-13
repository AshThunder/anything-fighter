import "server-only";
import { aholoRaw } from "./aholo";
import { BACKDROP, buildPosterUsda } from "./poster-usda";

/**
 * Aholo RenderCloud KO poster for a freshly forged fighter (same recipe as scripts/render-poster.mjs):
 *   posed GLB (OUS url) ─► mesh-upload-process task (ingest → meshId) ─► USDA scene (fighter + studio backdrop
 *   + key/rim lights) ─► offline render job (operationId, ~10 s) ─► resultUrl PNG.
 * RenderCloud docs describe {success,data,errorMsg}; the live gateway uses the Lux3D {c,m,d} envelope.
 * Both are unwrapped here.
 */

type Any = Record<string, unknown> | string | number | null | undefined;

function unwrap(r: Any): Any {
  if (r && typeof r === "object" && "success" in r) {
    if (r.success === false) throw new Error(`RenderCloud: ${String(r.errorMsg ?? "error")}`);
    return r.data as Any;
  }
  return r;
}

export async function ingestCreate(meshUrl: string): Promise<string> {
  const cr = unwrap(await aholoRaw<Any>("POST", "/global/rendercloud/v1/mesh-upload-process/task/create", { originMeshUrl: meshUrl, fastUpload: false }));
  const id = cr && typeof cr === "object" ? (cr.taskId ?? cr.taskid ?? cr.data ?? cr.id) : cr;
  if (id === undefined || id === null || id === "") throw new Error(`RenderCloud ingest: no task id (${JSON.stringify(cr).slice(0, 160)})`);
  return String(id);
}

/** → meshId when done, null while running. Throws on failure. */
export async function ingestGet(taskId: string): Promise<string | null> {
  const d = unwrap(await aholoRaw<Any>("GET", `/global/rendercloud/v1/mesh-upload-process/task/get?taskid=${encodeURIComponent(taskId)}`)) as {
    status?: number;
    outputs?: { content?: string }[];
  } | null;
  if (d?.status === 3) {
    const meshId = d.outputs?.[0]?.content;
    if (!meshId) throw new Error("RenderCloud ingest: no mesh id");
    return meshId;
  }
  if (d?.status === 4 || d?.status === 6) throw new Error(`RenderCloud ingest failed (${JSON.stringify(d).slice(0, 200)})`);
  return null;
}

export async function renderSubmit(meshId: string, fighterId: string): Promise<string> {
  const usda = buildPosterUsda({ meshId, width: 1080, height: 1350, yawDeg: -25, key: 60, rim: 1200, gi: 0.35, camDist: 4200, camHeight: 1000, extras: [BACKDROP] });
  const r = unwrap(
    await aholoRaw<Any>("POST", "/global/rendercloud/v1/jobs", {
      requestId: `af-${fighterId}-${Date.now()}`,
      usdContent: Buffer.from(usda, "utf8").toString("base64"),
    }),
  ) as { operationId?: string } | null;
  if (!r?.operationId) throw new Error(`RenderCloud submit: ${JSON.stringify(r).slice(0, 200)}`);
  return r.operationId;
}

/** → result PNG url when done, null while rendering. Throws on failure. */
export async function renderPoll(operationId: string): Promise<string | null> {
  const d = unwrap(await aholoRaw<Any>("POST", "/global/rendercloud/v1/jobs", { operationId })) as {
    done?: boolean;
    result?: { resultUrl?: string };
    error?: unknown;
  } | null;
  if (d?.done && d.result?.resultUrl) return d.result.resultUrl;
  if (d?.done) throw new Error(`RenderCloud render failed: ${JSON.stringify(d.error).slice(0, 200)}`);
  return null;
}
