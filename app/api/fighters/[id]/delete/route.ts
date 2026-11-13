import { NextResponse } from "next/server";
import { applyFighterModeration } from "@/lib/moderation";
import { gallerySecret, verifyDeleteToken } from "@/lib/gallery-secret";

const SAFE_ID = /^[a-z0-9-]+$/;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!gallerySecret()) return NextResponse.json({ error: "Deletion isn't set up on this server." }, { status: 503 });
  const { id } = await ctx.params;
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  let token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    const body = (await req.json()) as { token?: string };
    if (body.token) token = body.token;
  } catch {
    /* query token is enough */
  }
  if (!verifyDeleteToken(id, token)) return NextResponse.json({ error: "That delete link is invalid." }, { status: 403 });
  const result = await applyFighterModeration(id, "hide");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
