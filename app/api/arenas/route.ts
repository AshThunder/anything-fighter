import { connection, NextResponse } from "next/server";
import { BUILTIN_ARENAS } from "@/lib/arenas";
import { listArenas } from "@/lib/arenas-server";
import { createWorldGeneration, isWorldStuck, worldQueue, WorldQueueBusy } from "@/lib/world";

export const maxDuration = 30;

/** Arena catalogue + the account's Aholo world queue (so the UI can explain why a world isn't ready). */
export async function GET() {
  await connection();
  // Never fail the catalogue: if Aholo's world API is down, the built-ins (Neon Ring + sample splat) still play.
  const [arenas, q] = await Promise.all([
    listArenas().catch((e) => {
      console.error(`[arenas] list failed: ${e instanceof Error ? e.message : e}`);
      return BUILTIN_ARENAS;
    }),
    worldQueue().catch(() => null),
  ]);
  const queue =
    q === null
      ? null
      : await Promise.all(q.map(async (w) => ({
          worldId: w.worldId,
          name: w.name,
          status: w.status,
          progress: w.progress ?? 0,
          since: w.createTime,
          stuck: await isWorldStuck(w),
        })));
  return NextResponse.json({ arenas, queue });
}

/** SpatialGen: { name, prompt } → world generation job (poll GET /api/arenas/<id>). Refused while the queue is busy. */
export async function POST(req: Request) {
  const { name, prompt } = (await req.json().catch(() => ({}))) as { name?: string; prompt?: string };
  if (!prompt?.trim()) return NextResponse.json({ error: "Describe the arena first." }, { status: 400 });
  try {
    const job = await createWorldGeneration({ name: (name || prompt).slice(0, 40), prompt: prompt.slice(0, 600) });
    return NextResponse.json({ job });
  } catch (e) {
    if (e instanceof WorldQueueBusy) return NextResponse.json({ error: e.message, code: "WORLD_QUEUE_BUSY" }, { status: 409 });
    console.error(`[arenas] create failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Couldn't start the world right now. Try again later." }, { status: 500 });
  }
}
