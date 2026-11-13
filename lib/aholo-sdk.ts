import "server-only";
import { createAssetClient, type AssetClient } from "@manycore/aholo-sdk-asset";
import { AholoError as SdkAholoError, BusinessError, createGatewayClient, RateLimitError, type AholoClientConfig, type AholoGatewayClient } from "@manycore/aholo-sdk-core";
import { createLux3dClient, type Lux3dClient } from "@manycore/aholo-sdk-lux3d";
import { createWorldClient, type WorldClient } from "@manycore/aholo-sdk-world";

/**
 * The one place the app talks to Aholo / Manycore, through the official TypeScript SDKs
 * (https://labs.aholo.ai/api-docs/en/sdk/typescript):
 *   @manycore/aholo-sdk-asset  → OUS upload (single + multipart handled by the SDK)
 *   @manycore/aholo-sdk-lux3d  → multimodal-to-image, image-to-four-view, img-to-3d, auto-rig, retarget, export, tasks
 *   @manycore/aholo-sdk-world  → SpatialGen generations, Aholo Reality reconstructions, world detail / list
 *   @manycore/aholo-sdk-core   → gateway client used for RenderCloud, which has no SDK (raw OpenAPI routes, see lib/poster.ts)
 *
 * Server-only: the key comes from process.env.AHOLO_API_KEY and never reaches the browser. No key → mock mode.
 * Long blocking `waitFor` helpers are deliberately NOT used inside requests: the pipeline is poll-driven
 * (create once, then one `tasks.retrieve` / `world.retrieve` per client poll), so every serverless call stays short.
 */

export const AHOLO_BASE = process.env.AHOLO_API_BASE ?? "https://api.aholo.ai";

export function apiKey(): string | undefined {
  const k = process.env.AHOLO_API_KEY?.trim();
  return k ? k : undefined;
}
export const isMockMode = () => !apiKey();

/** App-level error (keeps the HTTP-ish status the routes and the retry logic rely on). */
export class AholoError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
  }
}

function config(): AholoClientConfig {
  const key = apiKey();
  if (!key) throw new AholoError("AHOLO_API_KEY is not set", "NO_KEY");
  // region "com" = global gateway (/global/... paths); baseUrl overridable for tests.
  return { apiKey: key, region: "com", baseUrl: AHOLO_BASE, timeoutMs: 45_000, userAgent: "anything-fighter" };
}

let clients: { key: string; lux3d: Lux3dClient; world: WorldClient; asset: AssetClient; gateway: AholoGatewayClient } | null = null;
function sdk() {
  const c = config();
  if (!clients || clients.key !== c.apiKey) {
    clients = { key: c.apiKey!, lux3d: createLux3dClient(c), world: createWorldClient(c), asset: createAssetClient(c), gateway: createGatewayClient(c) };
  }
  return clients;
}
export const lux3dClient = () => sdk().lux3d;
export const worldClient = () => sdk().world;
export const assetClient = () => sdk().asset;
/** Authenticated gateway transport from @manycore/aholo-sdk-core (for RenderCloud's OpenAPI routes only). */
export const gatewayClient = () => sdk().gateway;

/** Map SDK errors (AuthenticationError / RateLimitError / BusinessError / network) onto AholoError. */
export function toAholoError(e: unknown): AholoError {
  if (e instanceof AholoError) return e;
  if (e instanceof SdkAholoError) {
    const code = (e instanceof BusinessError ? e.cmdCode : undefined) ?? e.bizCode ?? e.status;
    const status = e instanceof RateLimitError ? 429 : e.statusCode;
    const msg = e.bizCode && !e.message.includes(e.bizCode) ? `${e.message} (${e.bizCode})` : e.message;
    return new AholoError(msg, code, status);
  }
  const msg = e instanceof Error ? e.message : String(e);
  // fetch failures / SDK request timeouts are transient: retried automatically on the next poll
  if (/timed out|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket|network/i.test(msg)) return new AholoError(`Network: ${msg}`, "NETWORK", 503);
  return new AholoError(msg);
}

/** Run one SDK call and normalise its errors. */
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toAholoError(e);
  }
}

/** Upload a buffer via @manycore/aholo-sdk-asset and return its public URL. */
export const uploadAsset = (buf: Buffer, filename: string) => call(async () => (await assetClient().uploadBuffer(buf, { filename })).url);

/** Short-lived OUS token from the official asset SDK (API key stays on the server). */
export const getUploadToken = () => call(() => assetClient().getUploadToken());
