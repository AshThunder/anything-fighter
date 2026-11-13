import { NextResponse } from "next/server";
import { createRoomScan, WorldQueueBusy } from "@/lib/world";

export const maxDuration = 60;

type Resource = { url: string; type: "video" | "image" };

/** Aholo Reality "Fight in your room": JSON { name, resources[{url,type}], cover? }.
 *  Files must already be on Aholo OUS (client uploads with a token from POST /api/room/token)
 *  so a 10–20 s video never has to pass through Vercel's ~4.5 MB body limit. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { name?: string; cover?: string; resources?: Resource[] }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Pick a video or at least 20 photos first." }, { status: 400 });
  }
  const resources = Array.isArray(body.resources) ? body.resources : [];
  const cover = typeof body.cover === "string" && /^https?:\/\//i.test(body.cover) ? body.cover : undefined;
  try {
    const job = await createRoomScan({
      name: String(body.name || "My Room").slice(0, 40),
      resources,
      cover,
    });
    if (job.status === "FAILED") {
      console.error(`[room] scan failed to start: ${job.error ?? "unknown"}`);
      return NextResponse.json(
        { error: "Couldn't start the room scan right now. Try again later, or fight in the built-in arenas." },
        { status: 400 },
      );
    }
    return NextResponse.json({ job });
  } catch (e) {
    if (e instanceof WorldQueueBusy) return NextResponse.json({ error: e.message, code: "WORLD_QUEUE_BUSY" }, { status: 409 });
    console.error(`[room] scan failed to start: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Couldn't start the room scan right now. Try again later, or fight in the built-in arenas." }, { status: 400 });
  }
}
