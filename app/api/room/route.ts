import { NextResponse } from "next/server";
import { createRoomScan } from "@/lib/world";

/** Aholo Reality "Fight in your room": multipart `files` = one .mp4/.mov or ≥20 photos. Poll GET /api/arenas/<id>. */
export async function POST(req: Request) {
  const fd = await req.formData();
  const files = fd.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "No files" }, { status: 400 });
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > 200 * 1024 * 1024) return NextResponse.json({ error: "Max 200 MB" }, { status: 413 });
  try {
    const job = await createRoomScan({
      name: String(fd.get("name") || "My Room").slice(0, 40),
      files: await Promise.all(files.map(async (f) => ({ buf: Buffer.from(await f.arrayBuffer()), filename: f.name.replace(/[^\w.-]/g, "_") }))),
    });
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
