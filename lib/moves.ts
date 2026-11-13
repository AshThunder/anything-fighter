/**
 * Game moves and their mapping to Lux3D humanoid-retarget preset animation IDs.
 * Preset IDs come from `lux3d_HumanoidAnimationRetargetRequest.animationIds` in refs/openapi.en.yaml
 * (85 presets, max 10 per retarget task). There is NO kick preset in the list, so "kick" maps to the
 * heavy `Melee_Hook` strike (see README / report notes).
 */
export const MOVES = ["idle", "walk", "punch", "kick", "block", "hit", "ko", "victory"] as const;
export type Move = (typeof MOVES)[number];

/** Primary Lux3D preset per move (order = request order). */
export const LUX3D_ANIMATION_MAP: Record<Move, string> = {
  idle: "Idle_Loop",
  walk: "Walk_Loop",
  punch: "Punch_Jab",
  kick: "Melee_Hook", // no kick preset exists; heavy hook used as the "kick"/heavy button
  block: "Sword_Block",
  hit: "Hit_Chest",
  ko: "Death01",
  victory: "Dance_Loop",
};

/** Extra presets that fit in the 10-animation budget (alt hit + combo finisher). */
export const LUX3D_EXTRA_ANIMATIONS = ["Punch_Cross", "Hit_Knockback"] as const;

/** All IDs we send to the retarget endpoint (must be 1–10 distinct, case-sensitive). */
export const LUX3D_RETARGET_IDS: string[] = [
  ...Object.values(LUX3D_ANIMATION_MAP),
  ...LUX3D_EXTRA_ANIMATIONS,
];

/**
 * Clip-name candidates used to resolve a move to an AnimationClip in any GLB
 * (Lux3D retarget output, three.js sample rigs, Mixamo-style names). Case-insensitive substring match.
 */
export const CLIP_CANDIDATES: Record<Move, string[]> = {
  idle: ["Idle_Loop", "idle", "Idle"],
  walk: ["Walk_Loop", "walk", "Walking", "Run"],
  punch: ["Punch_Jab", "Punch_Cross", "punch"],
  kick: ["Melee_Hook", "kick"],
  block: ["Sword_Block", "Idle_Shield_Loop", "block"],
  hit: ["Hit_Chest", "Hit_Head", "hit"],
  ko: ["Death01", "Death", "death"],
  victory: ["Dance_Loop", "Dance", "SambaDance", "ThumbsUp", "agree"],
};

export const LOOPING: Record<Move, boolean> = {
  idle: true,
  walk: true,
  punch: false,
  kick: false,
  block: true,
  hit: false,
  ko: false,
  victory: true,
};
