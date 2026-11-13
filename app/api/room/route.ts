import { NextResponse } from "next/server";
import { createRoomScan, WorldQueueBusy } from "@/lib/world";

export const maxDuration = 120;

/** Aholo Reality "Fight in your room": multipart `files` = one .mp4/.mov or ≥20 photos. Poll GET /api/arenas/<id>. */
export async function POST(req: Request) {
  const fd = await req.formData();
  const files = fd.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "Pick a video or at least 20 photos first." }, { status: 400 });
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > 200 * 1024 * 1024) return NextResponse.json({ error: "That's too big (max 200 MB). Try a shorter video." }, { status: 413 });
  try {
    const job = await createRoomScan({
      name: String(fd.get("name") || "My Room").slice(0, 40),
      files: await Promise.all(files.map(async (f) => ({ buf: Buffer.from(await f.arrayBuffer()), filename: f.name.replace(/[^\w.-]/g, "_") }))),
    });
    return NextResponse.json({ job });
  } catch (e) {
    if (e instanceof WorldQueueBusy) return NextResponse.json({ error: e.message, code: "WORLD_QUEUE_BUSY" }, { status: 409 });
    console.error(`[room] scan failed to start: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Couldn't start the room scan right now. Try again later, or fight in the built-in arenas." }, { status: 400 });
  }
}
