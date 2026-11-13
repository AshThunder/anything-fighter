import "server-only";
import { readFighterFile } from "./store";
import { isPrivateFighterFile } from "./fighters";

/**
 * Serve a player's original photo only when that fighter has an explicit photoPublic flag
 * set at forge time. Older forges and hidden fighters stay blocked (fail closed).
 */
export async function isPhotoBlocked(id: string, file: string): Promise<boolean> {
  if (!isPrivateFighterFile(id, file)) return false;
  const raw = await readFighterFile(id, "fighter.json");
  if (!raw) return true;
  try {
    const f = JSON.parse(raw.toString("utf8")) as { photoPublic?: boolean; hidden?: boolean };
    return f.photoPublic !== true || f.hidden === true;
  } catch {
    return true;
  }
}
