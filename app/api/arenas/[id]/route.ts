import { connection, NextResponse } from "next/server";
import { listArenas } from "@/lib/arenas-server";
import { advanceWorldJob, STUCK_MS } from "@/lib/world";

/** Poll + advance a SpatialGen / Reality arena job; returns the finished arena when ready. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  try {
    const job = await advanceWorldJob(id);
    const arena = job.status === "SUCCEEDED" ? (await listArenas()).find((a) => a.id === id) : undefined;
    const stuck = job.status !== "SUCCEEDED" && job.status !== "FAILED" && (job.progress ?? 0) === 0 && Date.now() - job.createdAt > STUCK_MS;
    return NextResponse.json({ job, arena, stuck });
  } catch (e) {
    console.error(`[arenas] poll ${id} failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "This arena job can't be found any more. Fight in the built-in arenas meanwhile." }, { status: 404 });
  }
}
