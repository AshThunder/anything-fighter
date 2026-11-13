import type { Move } from "./moves";

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
  /** Source object photo (self-generated for the starter roster). */
  photoUrl?: string;
  /** Optional printable export links (STL / 3MF / USDZ). */
  exports?: Record<string, string>;
  createdAt?: number;
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
export const GALLERY_ONLY_IDS = ["gen-mwekglv2-db32ab", "gen-mwel0i8j-076867"];
