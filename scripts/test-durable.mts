/**
 * Offline test for lib/durable.ts (Blob pack store) against a mocked Vercel Blob API (undici MockAgent):
 * no network, no credentials, no Aholo credits.  Run: npm run test:durable
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- undici MockAgent callback types */
import { MockAgent, setGlobalDispatcher } from "undici";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore123_fakefakefake";
const store = new Map<string, Buffer>();
const ops = { put: 0, get: 0 };
const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
const api = agent.get("https://vercel.com");
api.intercept({ path: (p: string) => p.startsWith("/api/blob"), method: "PUT" }).reply((o: any) => {
  ops.put++;
  const u0 = new URL("https://vercel.com" + o.path);
  const pathname = u0.searchParams.get("pathname")!;
  store.set(pathname, Buffer.from(o.body as any));
  const u = `https://teststore123.private.blob.vercel-storage.com/${pathname}`;
  return { statusCode: 200, data: JSON.stringify({ url: u, downloadUrl: u, pathname, contentType: "x", contentDisposition: "inline", etag: '"1"' }), responseOptions: { headers: { "content-type": "application/json" } } };
}).persist();
const st = agent.get("https://teststore123.private.blob.vercel-storage.com");
st.intercept({ path: () => true, method: "GET" }).reply((o: any) => {
  ops.get++;
  const b = store.get(new URL("https://x" + o.path).pathname.slice(1));
  return b ? { statusCode: 200, data: b, responseOptions: { headers: { "content-type": "application/octet-stream", "content-length": String(b.length), etag: '"1"' } } } : { statusCode: 404, data: "nf" };
}).persist();
const d = await import("../lib/durable.ts");
console.log("enabled", d.durableEnabled(), "ids0", await d.durableIds());
const files = new Map([["rigged.glb", Buffer.from("GLB...")], ["fighter.json", Buffer.from("{}")], ["rigged.orig.glb", Buffer.from("x")]]);
console.log("save", await d.saveDurablePack("gen-aaa-111111", files), "save2", await d.saveDurablePack("gen-bbb-222222", new Map([["statue.glb", Buffer.from("S")]])));
console.log("stored", [...store.keys()], "index", store.get("fighters/index.json")!.toString());
const p = await d.loadDurablePack("gen-aaa-111111");
console.log("pack files", p && [...p.keys()], "orig excluded", !p?.has("rigged.orig.glb"));
console.log("missing", await d.loadDurablePack("gen-zzz-000000"), "ops", ops);
const d2 = await import("../lib/durable.ts?cold=1");
console.log("cold ids", await d2.durableIds(), "cold pack", [...((await d2.loadDurablePack("gen-bbb-222222")) ?? new Map()).keys()], "ops", ops);
