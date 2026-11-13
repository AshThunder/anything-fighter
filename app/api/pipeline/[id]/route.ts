import { NextResponse } from "next/server";
import { advanceJob, AholoError, jobToFighter } from "@/lib/aholo";
import { fighterFileProbe } from "@/lib/store";

export const maxDuration = 300;

/** Poll + advance a pipeline job by one step. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const job = await advanceJob(id);
    const fighter = job.stage === "done" ? jobToFighter(job) : null;
    // A finished fighter whose model was lost (evicted before durable storage) can't be fought: say so up front
    // instead of offering a button that lands on a fighter that can't load.
    const model = fighter?.modelUrl.match(/\/api\/assets\/[^/]+\/([^/?]+)$/)?.[1];
    const modelMissing = !!model && !(await fighterFileProbe(id, model));
    return NextResponse.json({ job, fighter, modelMissing });
  } catch (e) {
    const status = e instanceof AholoError && e.status ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
