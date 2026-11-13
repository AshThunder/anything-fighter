import { connection, NextResponse } from "next/server";
import { listArenas } from "@/lib/arenas-server";
import { createWorldGeneration, STUCK_MS, worldQueue, WorldQueueBusy } from "@/lib/world";

export const maxDuration = 30;

/** Arena catalogue + the account's Aholo world queue (so the UI can explain why a world isn't ready). */
export async function GET() {
  await connection();
  const [arenas, q] = await Promise.all([listArenas(), worldQueue()]);
  const queue =
    q === null
      ? null
      : q.map((w) => ({
          worldId: w.worldId,
          name: w.name,
          status: w.status,
          progress: w.progress ?? 0,
          since: w.createTime,
          stuck: w.status === "RUNNING" && (w.progress ?? 0) === 0 && Date.now() - (w.updateTime ?? w.createTime ?? Date.now()) > STUCK_MS,
        }));
  return NextResponse.json({ arenas, queue });
}

/** SpatialGen: { name, prompt } → world generation job (poll GET /api/arenas/<id>). Refused while the queue is busy. */
export async function POST(req: Request) {
  const { name, prompt } = (await req.json().catch(() => ({}))) as { name?: string; prompt?: string };
  if (!prompt?.trim()) return NextResponse.json({ error: "prompt required" }, { status: 400 });
  try {
    const job = await createWorldGeneration({ name: (name || prompt).slice(0, 40), prompt: prompt.slice(0, 600) });
    return NextResponse.json({ job });
  } catch (e) {
    if (e instanceof WorldQueueBusy) return NextResponse.json({ error: e.message, code: "WORLD_QUEUE_BUSY" }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
