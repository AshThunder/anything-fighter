/**
 * Fight simulation: plain mutable objects, updated once per frame inside a single useFrame loop.
 * React state is only touched on discrete events (hit, KO, phase change) via the Zustand store.
 */
import type { Move } from "../moves";

export type FState = "idle" | "walk" | "punch" | "kick" | "block" | "hit" | "ko" | "victory";

export interface AttackSpec {
  dur: number;
  active: [number, number];
  range: number;
  dmg: number;
  stun: number;
  knock: number;
}

export const ATTACKS: Record<"punch" | "kick", AttackSpec> = {
  punch: { dur: 0.38, active: [0.12, 0.22], range: 1.4, dmg: 7, stun: 0.3, knock: 0.6 },
  kick: { dur: 0.62, active: [0.28, 0.4], range: 1.7, dmg: 13, stun: 0.45, knock: 1.5 },
};

export const ARENA_HALF = 5;
export const MIN_SEP = 1.0;
const WALK = 2.3;
const BLOCK_WALK = 0.8;

export interface FighterSim {
  x: number;
  facing: 1 | -1;
  state: FState;
  stateT: number;
  hp: number;
  /** attack already connected this swing */
  connected: boolean;
  /** knockback velocity */
  kv: number;
  /** emissive flash timer */
  flash: number;
  /** intent from input / AI */
  moveDir: -1 | 0 | 1;
  wantBlock: boolean;
  queued: "punch" | "kick" | null;
  combo: number;
}

export const newFighter = (x: number, facing: 1 | -1): FighterSim => ({
  x,
  facing,
  state: "idle",
  stateT: 0,
  hp: 100,
  connected: false,
  kv: 0,
  flash: 0,
  moveDir: 0,
  wantBlock: false,
  queued: null,
  combo: 0,
});

export interface FxState {
  shake: number;
  hitstop: number;
  slowmo: number;
  sparks: { x: number; y: number; t: number; heavy: boolean }[];
}

export const sim = {
  f: [newFighter(-1.6, 1), newFighter(1.6, -1)] as [FighterSim, FighterSim],
  fx: { shake: 0, hitstop: 0, slowmo: 1, sparks: [] } as FxState,
  time: 60,
  /** camera state shared with the Aholo Viewer splat layer */
  cam: { pos: [0, 1.6, 5] as [number, number, number], target: [0, 1.1, 0] as [number, number, number], fov: 40 },
};

export function resetSim() {
  sim.f = [newFighter(-1.6, 1), newFighter(1.6, -1)];
  sim.fx = { shake: 0, hitstop: 0, slowmo: 1, sparks: [] };
  sim.time = 60;
}

const busy = (s: FState) => s === "punch" || s === "kick" || s === "hit" || s === "ko" || s === "victory";

function setState(f: FighterSim, s: FState) {
  if (f.state === s) return;
  f.state = s;
  f.stateT = 0;
  f.connected = false;
}

export interface HitEvent {
  attacker: 0 | 1;
  defender: 0 | 1;
  dmg: number;
  blocked: boolean;
  heavy: boolean;
}

/** Advance the fight. Returns hit events for this step (to push into React/HUD). */
export function step(dt: number, fighting: boolean): HitEvent[] {
  const events: HitEvent[] = [];
  const fx = sim.fx;
  fx.shake = Math.max(0, fx.shake - dt * 2.5);
  if (fx.hitstop > 0) {
    fx.hitstop -= dt;
    return events; // freeze frames
  }
  const sdt = dt * fx.slowmo;
  for (const s of fx.sparks) s.t += sdt;
  fx.sparks = fx.sparks.filter((s) => s.t < 0.5);

  const [a, b] = sim.f;
  for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
    const me = sim.f[i];
    const foe = sim.f[i === 0 ? 1 : 0];
    me.stateT += sdt;
    me.flash = Math.max(0, me.flash - sdt * 6);
    me.facing = foe.x >= me.x ? 1 : -1;

    if (me.state === "ko" || me.state === "victory") continue;

    if (fighting && !busy(me.state)) {
      if (me.queued) {
        setState(me, me.queued);
        me.queued = null;
      } else if (me.wantBlock) setState(me, "block");
      else if (me.moveDir !== 0) setState(me, "walk");
      else setState(me, "idle");
    }
    // finish timed states
    if ((me.state === "punch" || me.state === "kick") && me.stateT >= ATTACKS[me.state].dur) setState(me, "idle");
    if (me.state === "hit" && me.stateT >= (me.combo > 0 ? 0.32 : 0.3)) setState(me, "idle");

    // movement
    let v = 0;
    if (fighting && (me.state === "walk" || me.state === "block")) v = me.moveDir * (me.state === "block" ? BLOCK_WALK : WALK);
    me.x += (v + me.kv) * sdt;
    me.kv *= Math.pow(0.002, sdt);
    me.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, me.x));

    // attacks
    if ((me.state === "punch" || me.state === "kick") && !me.connected) {
      const atk = ATTACKS[me.state];
      if (me.stateT >= atk.active[0] && me.stateT <= atk.active[1]) {
        const dist = Math.abs(foe.x - me.x);
        if (dist <= atk.range && foe.state !== "ko") {
          me.connected = true;
          const blocked = foe.state === "block";
          const dmg = blocked ? Math.ceil(atk.dmg * 0.15) : atk.dmg;
          foe.hp = Math.max(0, foe.hp - dmg);
          foe.kv = me.facing * (blocked ? atk.knock * 0.4 : atk.knock) * 2;
          foe.flash = 1;
          const heavy = me.state === "kick";
          if (!blocked) {
            foe.combo = foe.state === "hit" ? foe.combo + 1 : 0;
            setState(foe, foe.hp <= 0 ? "ko" : "hit");
            fx.hitstop = heavy ? 0.09 : 0.05;
            fx.shake = Math.min(1, fx.shake + (heavy ? 0.7 : 0.35));
          } else {
            fx.shake = Math.min(1, fx.shake + 0.12);
          }
          fx.sparks.push({ x: (me.x + foe.x) / 2 + me.facing * 0.15, y: heavy ? 1.15 : 1.35, t: 0, heavy });
          events.push({ attacker: i, defender: i === 0 ? 1 : 0, dmg, blocked, heavy });
        }
      }
    }
  }
  // push apart
  const sep = b.x - a.x;
  if (Math.abs(sep) < MIN_SEP) {
    const push = (MIN_SEP - Math.abs(sep)) / 2;
    const s = Math.sign(sep) || 1;
    a.x -= push * s;
    b.x += push * s;
  }
  if (fighting) sim.time = Math.max(0, sim.time - sdt);
  return events;
}

/** Map sim state → animation move. */
export const stateToMove = (s: FState): Move => s;
