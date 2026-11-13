"use client";
/**
 * Browser upload to Aholo OUS, using a short-lived token minted by the official
 * @manycore/aholo-sdk-asset `getUploadToken()` on the server (so the API key never
 * reaches the browser). The transfer talks to OUS through the official
 * `OusHttpClient` from @manycore/aholo-sdk-core, with the same single/multipart
 * paths, 2-part concurrency, MD5, and status poll the SDK uses in Node.
 */
import { assertCmdOk, assertCmdSuccess, OusHttpClient, pollUntil, type CmdEnvelope } from "@manycore/aholo-sdk-core";
import { md5Blob } from "./md5-browser";

/** Official @manycore/aholo-sdk-asset UploadToken shape (do not import the Node package here). */
export interface UploadToken {
  ousToken: string;
  globalDomain: string;
  blockSize: number;
}

const OUS_STATUS_SUCCESS = 5;
const asCmd = <T>(body: unknown) => body as CmdEnvelope<T>;
const OUS_TERMINAL_FAILURE = new Set([6, 8]);
const PART_CONCURRENCY = 2;
const PART_TIMEOUT_MS = 120_000;

function parseLackBlocks(lackBlocks: string[]): Set<number> {
  const result = new Set<number>();
  for (const item of lackBlocks) {
    const dash = item.indexOf("-");
    if (dash !== -1) {
      const start = parseInt(item.slice(0, dash), 10);
      const end = parseInt(item.slice(dash + 1), 10);
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      result.add(parseInt(item, 10));
    }
  }
  return result;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i]!);
      }
    }),
  );
}

/** Upload one File/Blob straight to Aholo OUS. Returns the public asset URL. */
export async function uploadToOus(
  token: UploadToken,
  file: Blob,
  filename: string,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<string> {
  const ous = new OusHttpClient({ baseUrl: token.globalDomain, ousToken: token.ousToken, timeoutMs: 45_000 });
  const md5 = await md5Blob(file);
  const total = file.size;
  if (total <= token.blockSize) {
    const form = new FormData();
    form.append("md5", md5);
    form.append("file", file, filename);
    const body = await ous.request({ method: "POST", path: "/ous/api/v2/single/upload", rawBody: form });
    assertCmdOk(asCmd(body), "single upload");
    onProgress?.(total, total);
  } else {
    const blocks = Math.ceil(total / token.blockSize);
    const initBody = await ous.request({
      method: "POST",
      path: "/ous/api/v2/block/upload/init",
      query: { md5, blocks, size: total, name: filename },
    });
    const initData = assertCmdSuccess(asCmd<{ deduplicated?: boolean; lackBlocks?: string[] | null }>(initBody), "block upload init");
    if (!initData.deduplicated) {
      const all = Array.from({ length: blocks }, (_, index) => index);
      const lackSet = initData.lackBlocks != null ? parseLackBlocks(initData.lackBlocks) : null;
      const toUpload = lackSet != null ? all.filter((index) => lackSet.has(index + 1)) : all;
      let uploaded = 0;
      await runWithConcurrency(toUpload, PART_CONCURRENCY, async (index) => {
        const start = index * token.blockSize;
        const chunk = file.slice(start, start + token.blockSize);
        const form = new FormData();
        form.append("block", String(index + 1));
        form.append("file", chunk, `${filename}.part${index + 1}`);
        const partBody = await ous.request({
          method: "POST",
          path: "/ous/api/v2/block/upload/part",
          rawBody: form,
          timeoutMs: PART_TIMEOUT_MS,
        });
        assertCmdOk(asCmd(partBody), `block upload part ${index + 1}`);
        uploaded += chunk.size;
        onProgress?.(uploaded, total);
      });
    }
  }
  const statusData = await pollUntil({
    fn: async () => {
      const body = await ous.request({ method: "GET", path: "/ous/api/v2/upload/status" });
      return assertCmdSuccess(asCmd<{ status?: number; url?: string }>(body), "upload status");
    },
    isDone: (d) => d.status === OUS_STATUS_SUCCESS && typeof d.url === "string" && d.url.length > 0,
    isFailed: (d) => d.status !== undefined && OUS_TERMINAL_FAILURE.has(d.status),
    failMessage: (d) => `Upload failed (status=${d.status ?? "unknown"})`,
    poll: { intervalMs: 300, timeoutMs: 300_000 },
  });
  return statusData.url!;
}

export async function mintOusToken(): Promise<UploadToken | { mock: true }> {
  const res = await fetch("/api/room/token", { method: "POST" });
  const r = await res.json().catch(() => ({}));
  if (r.mock) return { mock: true };
  if (!r.token?.ousToken || !r.token?.globalDomain) {
    throw new Error(r.error || "Couldn't get an Aholo upload token.");
  }
  return r.token as UploadToken;
}
