"use client";
import { create } from "zustand";
import type { FighterDef } from "../fighters";
import type { ArenaKind } from "../fighters";
import type { ArenaDef } from "../arenas";
import type { CpuLevel } from "./ai";

/** loading → vs (VS splash, skipped in practice) → intro (ROUND 1, 3-2-1) → fight → ko → victory */
export type Phase = "loading" | "vs" | "intro" | "fight" | "ko" | "victory";
/** cpu = 1P vs CPU · 2p = local versus · practice = CPU never attacks, HP refills (used while a fighter forges) */
export type GameMode = "cpu" | "2p" | "practice";

export interface ArenaSpec {
  kind: ArenaKind;
  /** pano: equirect image URL; splat: .sog/.ply/.spz URL */
  url?: string;
  name?: string;
  /** splat placement: see ArenaDef (upAxis, origin in splat space, game metres per splat unit, yaw) */
  upAxis?: ArenaDef["upAxis"];
  origin?: [number, number, number];
  scale?: number;
  yaw?: number;
  /** splat: URLs to try in order (direct signed Aholo URL, then same-origin proxy) */
  urls?: string[];
  /** splat: walkable half-width of the fight line (game metres) */
  half?: number;
  /** splat: panorama to fall back to if the splat can't load on this device */
  fallbackPano?: string;
}

interface GameStore {
  phase: Phase;
  fighters: [FighterDef, FighterDef] | null;
  arena: ArenaSpec;
  hp: [number, number];
  winner: 0 | 1 | null;
  lastHit: { id: number; who: 0 | 1; dmg: number; blocked: boolean; heavy: boolean } | null;
  hits: [number, number];
  mode: GameMode;
  /** consecutive clean hits by the same attacker (for the combo counter) */
  combo: { who: 0 | 1; n: number; id: number } | null;
  /** CPU difficulty (vs CPU); practice always plays easy and never attacks */
  level: CpuLevel;
  /** big centre-screen callouts: SPECIAL / SUPER / PARRY / COUNTER / KNOCKDOWN */
  callout: { id: number; who: 0 | 1; text: string; kind: "special" | "super" | "parry" | "counter" | "armor" | "knockdown" | "antiair" } | null;
  setLevel: (l: CpuLevel) => void;
  notify: (who: 0 | 1, kind: NonNullable<GameStore["callout"]>["kind"]) => void;
  setMode: (m: GameMode) => void;
  setup: (f: [FighterDef, FighterDef], arena: ArenaSpec) => void;
  setPhase: (p: Phase) => void;
  applyHit: (defender: 0 | 1, hp: number, dmg: number, blocked: boolean, heavy: boolean) => void;
  setWinner: (w: 0 | 1) => void;
  rematch: () => void;
}

let hitId = 0;
let lastHitAt = 0;

export const useGame = create<GameStore>((set) => ({
  phase: "loading",
  fighters: null,
  arena: { kind: "stage" },
  hp: [100, 100],
  winner: null,
  lastHit: null,
  hits: [0, 0],
  mode: "cpu",
  combo: null,
  level: "normal",
  callout: null,
  setLevel: (level) => set({ level }),
  notify: (who, kind) =>
    set({
      callout: {
        id: ++hitId,
        who,
        kind,
        text: { special: "Special!", super: "SUPER!", parry: "Parry!", counter: "Counter!", armor: "Armor!", knockdown: "Knockdown!", antiair: "Anti-air!" }[kind],
      },
    }),
  setMode: (mode) => set({ mode }),
  setup: (fighters, arena) => set({ fighters, arena, phase: "loading", hp: [100, 100], winner: null, hits: [0, 0], combo: null, lastHit: null, callout: null }),
  setPhase: (phase) => set({ phase }),
  applyHit: (defender, hpVal, dmg, blocked, heavy) =>
    set((s) => {
      const hp: [number, number] = [...s.hp];
      hp[defender] = hpVal;
      const hits: [number, number] = [...s.hits];
      const attacker = (defender === 0 ? 1 : 0) as 0 | 1;
      if (!blocked) hits[attacker]++;
      const now = performance.now();
      const prev = s.combo;
      const combo = blocked
        ? null
        : prev && prev.who === attacker && now - lastHitAt < 1300
          ? { who: attacker, n: prev.n + 1, id: hitId + 1 }
          : { who: attacker, n: 1, id: hitId + 1 };
      lastHitAt = now;
      return { hp, hits, combo, lastHit: { id: ++hitId, who: defender, dmg, blocked, heavy } };
    }),
  setWinner: (winner) => set({ winner }),
  rematch: () => set({ phase: "intro", hp: [100, 100], winner: null, hits: [0, 0], lastHit: null, combo: null, callout: null }),
}));
