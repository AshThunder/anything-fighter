import { connection, NextResponse } from "next/server";
import { listGeneratedFighters } from "@/lib/aholo";
import { PLACEHOLDER_FIGHTERS } from "@/lib/fighters";

/** Lux3D fighters (starter roster first). three.js placeholders are only a fallback when < 2 real fighters exist. */
export async function GET(req: Request) {
  await connection(); // always read the disk at request time
  const all = new URL(req.url).searchParams.has("all");
  // test-* = pipeline test runs: gallery only (?all=1), not the roster
  const generated = (await listGeneratedFighters()).filter((f) => all || !f.id.startsWith("test-"));
  const fighters = generated.length >= 2 ? generated : [...generated, ...PLACEHOLDER_FIGHTERS];
  return NextResponse.json({ fighters });
}
