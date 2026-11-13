import { NextResponse } from "next/server";
import { addReport, loadFighterDef } from "@/lib/moderation";

const SAFE_ID = /^[a-z0-9-]+$/;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!SAFE_ID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  let body: { reason?: string; email?: string } = {};
  try {
    body = (await req.json()) as { reason?: string; email?: string };
  } catch {
    return NextResponse.json({ error: "Tell us what's wrong with this card." }, { status: 400 });
  }
  const reason = (body.reason ?? "").trim();
  if (reason.length < 4) return NextResponse.json({ error: "Please add a short reason (at least a few words)." }, { status: 400 });
  const fighter = await loadFighterDef(id);
  if (!fighter) return NextResponse.json({ error: "That fighter isn't in the gallery." }, { status: 404 });
  const email = (body.email ?? "").trim();
  await addReport({ fighterId: id, fighterName: fighter.name, reason, email: email || undefined });
  return NextResponse.json({ ok: true });
}
