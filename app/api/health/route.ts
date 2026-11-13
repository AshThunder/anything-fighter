import { NextResponse } from "next/server";
import { durableEnabled, durableIds, probeDurable } from "@/lib/durable";

/**
 * Storage health: is the durable Blob store connected, how many forged fighters it holds, and (with ?probe=1)
 * a write + read-back of a tiny dummy bundle. No Aholo calls, no secrets in the response.
 */
export async function GET(req: Request) {
  const enabled = durableEnabled();
  const probe = enabled && new URL(req.url).searchParams.has("probe") ? await probeDurable() : undefined;
  return NextResponse.json(
    { durable: enabled ? "blob" : "off", fighters: enabled ? (await durableIds()).length : 0, ...(probe ? { probe } : {}) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
