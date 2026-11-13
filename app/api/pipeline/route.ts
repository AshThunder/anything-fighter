import { connection, NextResponse } from "next/server";
import { createJob, isMockMode, STAGE_LABEL, publicJob } from "@/lib/aholo";
import { deleteToken } from "@/lib/gallery-secret";
import { checkForgeLimit, clientIp, consumeForgeSlot, FORGE_LIMIT_FALLBACK } from "@/lib/forge-limit";

export const maxDuration = 300;

const MAX_BYTES = 8 * 1024 * 1024;

/** POST multipart: photo (File), name, mascot ("1"/"0"), exportPrint ("1"/"0"), prompt (optional), sharePhoto / photoAttestation / faceClear ("1" to publish the original photo). */
export async function POST(req: Request) {
  const form = await req.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) return NextResponse.json({ error: "Pick a photo first." }, { status: 400 });
  if (photo.size > MAX_BYTES) return NextResponse.json({ error: "That photo is too large (max 8 MB)." }, { status: 413 });
  const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";

  let forceMock = false;
  // Live forges spend Aholo credits (~35 each). Cap them before starting a job.
  if (!isMockMode()) {
    const ip = clientIp(req);
    const prior = await checkForgeLimit(ip);
    if (!prior.ok) {
      if (FORGE_LIMIT_FALLBACK === "mock") {
        forceMock = true;
      } else {
        return NextResponse.json(
          {
            error: prior.message,
            code: "FORGE_LIMIT",
            reason: prior.reason,
            ipLimit: prior.ipLimit,
            globalLimit: prior.globalLimit,
            fallback: "roster",
          },
          { status: 429 },
        );
      }
    } else {
      const slot = await consumeForgeSlot(ip);
      if (!slot.ok) {
        if (FORGE_LIMIT_FALLBACK === "mock") {
          forceMock = true;
        } else {
          return NextResponse.json(
            {
              error: slot.message,
              code: "FORGE_LIMIT",
              reason: slot.reason,
              ipLimit: slot.ipLimit,
              globalLimit: slot.globalLimit,
              fallback: "roster",
            },
            { status: 429 },
          );
        }
      }
    }
  }

  try {
    const photoPublic =
      form.get("sharePhoto") === "1" && form.get("photoAttestation") === "1" && form.get("faceClear") === "1";
    const job = await createJob({
      name: String(form.get("name") ?? ""),
      photo: Buffer.from(await photo.arrayBuffer()),
      photoExt: ext,
      mascot: form.get("mascot") !== "0",
      exportPrint: form.get("exportPrint") === "1",
      prompt: (form.get("prompt") as string | null) ?? undefined,
      photoPublic,
      forceMock,
    });
    const token = deleteToken(job.id);
    return NextResponse.json({ job: publicJob(job), labels: STAGE_LABEL, ...(token ? { deleteToken: token } : {}) });
  } catch (e) {
    console.error(`[pipeline] forge failed to start: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "The forge couldn't start right now. Try again in a minute, or fight with the roster." }, { status: 500 });
  }
}

export async function GET() {
  await connection();
  return NextResponse.json({ mode: isMockMode() ? "mock" : "live", labels: STAGE_LABEL });
}
