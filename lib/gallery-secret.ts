import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Server-only. Used to sign uploader delete links and to unlock the moderation queue. Never expose to the client. */
export const gallerySecret = () => process.env.GALLERY_SECRET?.trim() ?? "";

export function deleteToken(id: string): string | null {
  const s = gallerySecret();
  if (!s) return null;
  return createHmac("sha256", s).update(`delete:${id}`).digest("hex");
}

export function verifyDeleteToken(id: string, token: string): boolean {
  const expected = deleteToken(id);
  if (!expected || !token || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
  } catch {
    return false;
  }
}

export function verifyModerationSecret(given: string): boolean {
  const s = gallerySecret();
  if (!s || !given || given.length !== s.length) return false;
  try {
    return timingSafeEqual(Buffer.from(s, "utf8"), Buffer.from(given, "utf8"));
  } catch {
    return false;
  }
}
