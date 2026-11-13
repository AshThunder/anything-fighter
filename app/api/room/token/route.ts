import { NextResponse } from "next/server";
import { getUploadToken, isMockMode } from "@/lib/aholo-sdk";

export const maxDuration = 30;

/** Mint a short-lived Aholo OUS upload token via the official asset SDK. The API key stays on the server. */
export async function POST() {
  if (isMockMode()) return NextResponse.json({ mock: true });
  try {
    const token = await getUploadToken();
    return NextResponse.json({
      token: { ousToken: token.ousToken, globalDomain: token.globalDomain, blockSize: token.blockSize },
    });
  } catch (e) {
    console.error(`[room] token failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Couldn't start an Aholo upload right now. Try again in a minute." }, { status: 500 });
  }
}
