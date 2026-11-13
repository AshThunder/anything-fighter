import { connection, NextResponse } from "next/server";
import { isMockMode, listGeneratedFighters } from "@/lib/aholo";
import { GALLERY_ONLY_IDS, PLACEHOLDER_FIGHTERS } from "@/lib/fighters";

/** Lux3D fighters (starter roster first). three.js placeholders are only a fallback when < 2 real fighters exist. */
export async function GET(req: Request) {
  await connection(); // always read the disk at request time
  const all = new URL(req.url).searchParams.has("all");
  // test-* = pipeline test runs: gallery only (?all=1), not the roster
  // mock = demo forges (no key locally, or the spend-guard fallback on a live deployment): roster only when the
  // whole app is in mock mode; /fight and the forge page still find them via ?all=1
  const live = !isMockMode();
  const generated = (await listGeneratedFighters()).filter(
    (f) => all || (!f.id.startsWith("test-") && !GALLERY_ONLY_IDS.includes(f.id) && !(live && f.source === "mock")),
  );
  const fighters = generated.length >= 2 ? generated : [...generated, ...PLACEHOLDER_FIGHTERS];
  return NextResponse.json({ fighters });
}
