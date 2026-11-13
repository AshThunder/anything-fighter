import { NextResponse } from "next/server";
import { AholoError, retryJob, publicJob } from "@/lib/aholo";

export const maxDuration = 300;

/** Restart the failed stage of a pipeline job (max 3 retries). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ job: publicJob(await retryJob(id)) });
  } catch (e) {
    const status = e instanceof AholoError && e.status ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
