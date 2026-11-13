import { connection, NextResponse } from "next/server";
import { listArenas } from "@/lib/arenas-server";
import { createWorldGeneration } from "@/lib/world";

export async function GET() {
  await connection();
  return NextResponse.json({ arenas: await listArenas() });
}

/** SpatialGen: { name, prompt } → world generation job (poll GET /api/arenas/<id>). */
export async function POST(req: Request) {
  const { name, prompt } = (await req.json().catch(() => ({}))) as { name?: string; prompt?: string };
  if (!prompt?.trim()) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  try {
    const job = await createWorldGeneration({ name: (name || prompt).slice(0, 40), prompt: prompt.slice(0, 600) });
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
