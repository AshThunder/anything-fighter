import { NextResponse } from "next/server";
import { applyFighterModeration, listReports } from "@/lib/moderation";
import { gallerySecret, verifyModerationSecret } from "@/lib/gallery-secret";

function secretFrom(req: Request, body?: { secret?: string }) {
  const header = req.headers.get("x-gallery-secret") ?? "";
  const query = new URL(req.url).searchParams.get("secret") ?? "";
  return body?.secret || header || query;
}

export async function GET(req: Request) {
  if (!gallerySecret()) return NextResponse.json({ error: "Moderation isn't set up on this server." }, { status: 503 });
  if (!verifyModerationSecret(secretFrom(req))) return NextResponse.json({ error: "Wrong secret." }, { status: 401 });
  return NextResponse.json({ reports: await listReports() });
}

export async function POST(req: Request) {
  if (!gallerySecret()) return NextResponse.json({ error: "Moderation isn't set up on this server." }, { status: 503 });
  let body: { secret?: string; action?: string; id?: string } = {};
  try {
    body = (await req.json()) as { secret?: string; action?: string; id?: string };
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!verifyModerationSecret(secretFrom(req, body))) return NextResponse.json({ error: "Wrong secret." }, { status: 401 });
  if (body.action !== "hide" && body.action !== "unpublish") {
    return NextResponse.json({ error: "Action must be hide or unpublish." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Missing fighter id." }, { status: 400 });
  const result = await applyFighterModeration(body.id, body.action);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, fighter: { id: result.fighter.id, hidden: result.fighter.hidden, photoPublic: result.fighter.photoPublic } });
}
