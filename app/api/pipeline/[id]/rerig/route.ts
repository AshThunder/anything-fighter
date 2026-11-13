import { NextResponse } from "next/server";
import { AholoError, rerigFreestyle, publicJob } from "@/lib/aholo";

export const maxDuration = 300;

/** Re-rig a finished freestyle (unrigged) fighter from its existing Lux3D mesh. Once per fighter. Poll GET /api/pipeline/<id>. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ job: publicJob(await rerigFreestyle(id)) });
  } catch (e) {
    const status = e instanceof AholoError && e.status ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
