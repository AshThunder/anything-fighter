import type { Move } from "./moves";

/**
 * Players' uploaded photos stay private: a forged (gen-*) fighter's photo.* is only kept inside its durable
 * bundle (and used server-side for the Aholo upload), never served publicly or listed.
 */
export const isPrivateFighterFile = (id: string, file: string) => id.startsWith("gen-") && /^photo\./i.test(file);

export type FighterSource = "placeholder" | "lux3d" | "mock";

export interface FighterDef {
  id: string;
  name: string;
  tagline: string;
  /** URL of the (rigged) base GLB. */
  modelUrl: string;
  /** Optional per-move animation GLBs (Lux3D retarget "separate" output). */
  animUrls?: Partial<Record<Move, string>>;
  /** Accent colour for HUD / roster card. */
  color: string;
  source: FighterSource;
  /** Optional preview image (input photo or Lux3D mascot image). */
  thumbUrl?: string;
  /** Aholo RenderCloud poster (public/posters/<id>/poster.png). */
  posterUrl?: string;
  /** Source object photo (self-generated for the starter roster, or a player photo after an explicit opt-in). */
  photoUrl?: string;
  /** Player opted in to share their original photo in the gallery. Never inferred for older forges. */
  photoPublic?: boolean;
  /** Gallery source-photo label: a real upload, or a credited stand-in. */
  photoKind?: "upload" | "example";
  /** Hidden after an uploader delete or a moderation takedown; omitted from public lists. */
  hidden?: boolean;
  /** Optional printable export links (STL / 3MF / USDZ). */
  exports?: Record<string, string>;
  createdAt?: number;
  /** Aholo / Manycore services that actually produced this fighter (AholoServiceKey[]). */
  services?: AholoServiceKey[];
}

/** Manycore stack: every Aholo service the forge can use, with the official SDK / API it goes through. */
export const AHOLO_SERVICES = {
  asset: { label: "Asset upload", via: "@manycore/aholo-sdk-asset" },
  concept: { label: "Lux3D multimodal→image", via: "@manycore/aholo-sdk-lux3d" },
  mesh: { label: "Lux3D image→3D", via: "@manycore/aholo-sdk-lux3d" },
  rig: { label: "Lux3D auto-rig", via: "@manycore/aholo-sdk-lux3d" },
  retarget: { label: "Lux3D retarget", via: "@manycore/aholo-sdk-lux3d" },
  poster: { label: "RenderCloud", via: "RenderCloud OpenAPI" },
  export: { label: "Lux3D multi-format export", via: "@manycore/aholo-sdk-lux3d" },
} as const;
export type AholoServiceKey = keyof typeof AHOLO_SERVICES;

/** Services used for a fighter: explicit list from the forge job, else inferred from its artefacts. */
export function fighterServices(f: FighterDef): AholoServiceKey[] {
  if (f.services?.length) return f.services;
  if (f.source !== "lux3d") return [];
  const s: AholoServiceKey[] = ["asset"];
  if (f.thumbUrl && /mascot|concept/i.test(f.thumbUrl)) s.push("concept");
  s.push("mesh");
  if (f.animUrls && Object.keys(f.animUrls).length) s.push("rig", "retarget");
  if (f.posterUrl) s.push("poster");
  if (f.exports && Object.keys(f.exports).length) s.push("export");
  return s;
}

/** Free rigged placeholders from three.js examples (MIT), stored in public/fighters/<id>/model.glb. */
/**
 * Fallback only (shown when fewer than 2 Lux3D fighters exist): RobotExpressive by Tomás Laulhé (Quaternius),
 * CC0, from the three.js examples. Other three.js sample rigs (Xbot, Soldier, Michelle) were removed because
 * their Mixamo-derived licensing is unclear.
 */
export const PLACEHOLDER_FIGHTERS: FighterDef[] = [
  {
    id: "robot",
    name: "Boltbox",
    tagline: "Has a punch clip. Loves to dance.",
    modelUrl: "/fighters/robot/model.glb",
    color: "#f27f0d",
    source: "placeholder",
  },
];

/** Starter roster forged with the full Lux3D pipeline (scripts/forge-fighter.mjs); shown first. */
export const STARTER_ROSTER_IDS = ["mug", "sneaker", "duck", "toaster", "cactus"];

export type ArenaKind = "stage" | "pano" | "splat";

/** Pipeline test forges made while debugging prod: shown in the gallery (?all=1) but not in the roster. */
export const GALLERY_ONLY_IDS = ["gen-mwekglv2-db32ab", "gen-mwel0i8j-076867", "gen-mwemw090-24ff0e"];

/** Hidden from the public gallery and roster without deleting artefacts. Restore by removing the id. */
export const UNLISTED_FIGHTER_IDS = ["gen-mwekglv2-db32ab"] as const;
