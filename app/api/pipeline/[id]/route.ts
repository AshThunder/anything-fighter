import { NextResponse } from "next/server";
import { advanceJob, AholoError, jobToFighter } from "@/lib/aholo";

export const maxDuration = 300;

/** Poll + advance a pipeline job by one step. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const job = await advanceJob(id);
    return NextResponse.json({ job, fighter: job.stage === "done" ? jobToFighter(job) : null });
  } catch (e) {
    const status = e instanceof AholoError && e.status ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
