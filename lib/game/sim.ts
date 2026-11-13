/**
 * Fight simulation: plain mutable objects, updated once per frame inside a single useFrame loop.
 * React state is only touched on discrete events (hit, KO, phase change, callouts) via the Zustand store.
 *
 * Combat model (13 Nov 2026 gameplay package, built only on the Aholo Lux3D retargeted clips already in each
 * fighter: punch / kick (Melee_Hook) / punch2 (Punch_Cross) / hit2 (Hit_Knockback) / ko, plus procedural motion
 * for freestyle meshes; no new Aholo animation credits):
 *  - 150 ms input buffer; strings cancel on hit: P-P-K (jab → cross → hook finisher, knockdown) and K-P (kick → rush)
 *  - escalating string damage with combo damage scaling (each extra hit in a combo does 12% less, floor 40%)
 *  - signature special (back-forward + P, or SPECIAL): dash-strike with armour and knockdown
 *  - super meter (fills on hits dealt / taken / blocked / parried) → SUPER: slow-mo zoom, 3-hit rush, knockdown
 *  - parry (start blocking ≤120 ms before a hit lands), counter-hits (+20% on an opponent's startup), knockdowns
 */

export type FState = "idle" | "walk" | "block" | "crouch" | "jump" | "attack" | "hit" | "down" | "ko" | "victory";
export type AttackId = "jab" | "cross" | "hook" | "kick" | "rush" | "special" | "super" | "air" | "low" | "sweep";
/** where an attack hits: high whiffs over crouchers, low must be crouch-blocked, overhead (air) must be blocked standing */
export type AttackHeight = "high" | "mid" | "low" | "overhead";
export type Button = "punch" | "kick" | "special" | "super";
/** clip names an attack can play (Aholo retarget presets: Punch_Jab / Punch_Cross / Melee_Hook) */
export type AttackAnim = "punch" | "punch2" | "kick";

export interface HitSpec {
  t: number;
  dmg: number;
  knock: number;
  range: number;
}

export interface AttackSpec {
  dur: number;
  active: [number, number];
  range: number;
  dmg: number;
  stun: number;
  knock: number;
  anim: AttackAnim;
  heavy?: boolean;
  knockdown?: boolean;
  /** forward dash velocity (m/s) between t0 and t1 */
  dash?: [number, number, number];
  /** hits don't interrupt this attack until this time (damage still applies) */
  armor?: number;
  /** multi-hit attacks (super): timed hits instead of the single active window */
  hits?: HitSpec[];
  /** fraction of damage taken through a block */
  chip?: number;
  height?: AttackHeight;
  /** highest airborne opponent (feet height, m) a grounded attack still reaches: jump over anything lower */
  airReach?: number;
}

export const ATTACKS: Record<AttackId, AttackSpec> = {
  jab: { dur: 0.32, active: [0.09, 0.18], range: 1.4, dmg: 6, stun: 0.4, knock: 0.45, anim: "punch", height: "high", airReach: 0.35 },
  cross: { dur: 0.36, active: [0.1, 0.2], range: 1.5, dmg: 8, stun: 0.44, knock: 0.6, anim: "punch2", height: "high", airReach: 0.45 },
  hook: { dur: 0.58, active: [0.2, 0.32], range: 1.7, dmg: 14, stun: 0.5, knock: 2.4, anim: "kick", heavy: true, knockdown: true, airReach: 1.1 },
  kick: { dur: 0.62, active: [0.28, 0.4], range: 1.7, dmg: 12, stun: 0.46, knock: 1.4, anim: "kick", heavy: true, airReach: 0.95 },
  rush: { dur: 0.38, active: [0.1, 0.22], range: 1.55, dmg: 9, stun: 0.42, knock: 1.6, anim: "punch2", dash: [0.02, 0.14, 2.5], airReach: 0.3 },
  /** jumping attack (punch or kick in the air): overhead, once per jump */
  air: { dur: 0.42, active: [0.06, 0.34], range: 1.6, dmg: 9, stun: 0.45, knock: 0.8, anim: "kick", height: "overhead" },
  /** crouching punch: fast low poke */
  low: { dur: 0.3, active: [0.08, 0.16], range: 1.35, dmg: 5, stun: 0.36, knock: 0.3, anim: "punch", height: "low", airReach: 0.1 },
  /** crouching kick: sweep, knocks down */
  sweep: { dur: 0.56, active: [0.16, 0.28], range: 1.65, dmg: 10, stun: 0.5, knock: 0.9, anim: "kick", heavy: true, knockdown: true, height: "low", airReach: 0.1 },
  special: {
    dur: 0.72,
    active: [0.2, 0.42],
    range: 1.55,
    dmg: 15,
    stun: 0.5,
    knock: 3.2,
    anim: "kick",
    heavy: true,
    knockdown: true,
    dash: [0.08, 0.38, 8.5],
    armor: 0.42,
    chip: 0.25,
    airReach: 0.5,
  },
  super: {
    dur: 1.5,
    active: [0.45, 1.15],
    range: 2.2,
    dmg: 0,
    stun: 0.6,
    knock: 0,
    anim: "punch",
    heavy: true,
    knockdown: true,
    dash: [0.15, 0.4, 9],
    armor: 1.5,
    chip: 0.3,
    airReach: 1.3,
    hits: [
      { t: 0.45, dmg: 10, knock: 0.4, range: 2.2 },
      { t: 0.75, dmg: 10, knock: 0.5, range: 2.2 },
      { t: 1.1, dmg: 18, knock: 3.6, range: 2.4 },
    ],
  },
};

/** string table: (current attack, button) → next attack, when cancelling on hit */
const CHAINS: Partial<Record<AttackId, Partial<Record<Button, AttackId>>>> = {
  jab: { punch: "cross" },
  cross: { kick: "hook" },
  kick: { punch: "rush" },
  low: { kick: "sweep" },
};

export const ARENA_HALF = 5;
export const MIN_SEP = 1.0;
export const BUFFER_S = 0.15;
export const PARRY_WIN = 0.12;
export const DOWN_S = 1.0;
export const METER_MAX = 100;
const WALK = 2.3;
/** jump: ~0.7 s arc, ~1.1 m apex, fixed horizontal speed chosen at take-off (no air control, no double jump) */
export const JUMP_V = 6.4;
export const GRAVITY = 18;
const JUMP_VX = 2.6;
const BLOCK_WALK = 0.8;

export interface FighterSim {
  x: number;
  /** feet height above the floor (m) and vertical speed */
  y: number;
  vy: number;
  /** horizontal speed locked at take-off */
  jvx: number;
  /** lowered hurtbox this frame (crouch, crouch-block, low attacks) */
  crouch: boolean;
  /** intent: hold down */
  wantCrouch: boolean;
  /** sim clock of the last jump press (buffered like buttons) */
  jumpReq: number;
  /** air attack already used this jump */
  airAtk: boolean;
  facing: 1 | -1;
  state: FState;
  stateT: number;
  hp: number;
  /** current attack (state === "attack") */
  atk: AttackId | null;
  /** increments on every new attack / hit reaction (animation restart key) */
  seq: number;
  /** attack already connected this swing (single-hit attacks) */
  connected: boolean;
  /** the current attack hit cleanly (not blocked/parried): strings may cancel */
  hitConfirm: boolean;
  /** next timed hit of a multi-hit attack */
  hitIdx: number;
  /** knockback velocity */
  kv: number;
  /** emissive flash timer */
  flash: number;
  /** dash trail intensity (special / super) */
  trail: number;
  /** hit-stun length of the current "hit" state */
  stunFor: number;
  /** invulnerable for this long (getting up) */
  invuln: number;
  specialCd: number;
  meter: number;
  /** intent from input / AI */
  moveDir: -1 | 0 | 1;
  wantBlock: boolean;
  /** buffered button press */
  buf: { btn: Button; t: number } | null;
  /** consecutive hits taken (for damage scaling / combo counter) */
  combo: number;
  /** sim clock when block was last pressed (parry window) */
  blockAt: number;
  prevBlock: boolean;
  /** relative-direction edge times for back-forward + P */
  backAt: number;
  fwdAt: number;
  prevRel: number;
  /** AI: seq of the attack it already tried to extend */
  aiChained: number;
}

export const newFighter = (x: number, facing: 1 | -1): FighterSim => ({
  x,
  y: 0,
  vy: 0,
  jvx: 0,
  crouch: false,
  wantCrouch: false,
  jumpReq: -9,
  airAtk: false,
  facing,
  state: "idle",
  stateT: 0,
  hp: 100,
  atk: null,
  seq: 0,
  connected: false,
  hitConfirm: false,
  hitIdx: 0,
  kv: 0,
  flash: 0,
  trail: 0,
  stunFor: 0.3,
  invuln: 0,
  specialCd: 0,
  meter: 0,
  moveDir: 0,
  wantBlock: false,
  buf: null,
  combo: 0,
  blockAt: -9,
  prevBlock: false,
  backAt: -9,
  fwdAt: -9,
  prevRel: 0,
  aiChained: -1,
});

export interface Spark {
  x: number;
  y: number;
  t: number;
  heavy: boolean;
  big?: boolean;
}

export interface FxState {
  shake: number;
  hitstop: number;
  slowmo: number;
  /** super cinematic: extra slow-mo time left, camera zoom (0..1), white flash (0..1) */
  superSlow: number;
  zoom: number;
  sparks: Spark[];
}

export const sim = {
  f: [newFighter(-1.6, 1), newFighter(1.6, -1)] as [FighterSim, FighterSim],
  fx: { shake: 0, hitstop: 0, slowmo: 1, superSlow: 0, zoom: 0, sparks: [] } as FxState,
  time: 60,
  /** last moves started, "<who>:<attack>" (debug / regression: window.__sim.moves) */
  moves: [] as string[],
  /** monotonic sim clock (input buffer, parry window, motion inputs); paused during hit-stop */
  clock: 0,
  /** half-width of the walkable fight line (per arena: generated worlds can be narrower) */
  half: ARENA_HALF,
  /** starting distance from centre (CameraRig sets 1.05 in portrait so the opening frame isn't tiny) */
  startHalf: 1.6,
  /** camera state shared with the Aholo Viewer splat layer */
  cam: {
    pos: [0, 1.6, 5] as [number, number, number],
    target: [0, 1.1, 0] as [number, number, number],
    fov: 40,
    /** portrait 3/4 camera yaw (rad); the splat layer un-rotates it so the tuned backdrop stays in view */
    yaw: 0,
  },
};

export function resetSim() {
  sim.f = [newFighter(-sim.startHalf, 1), newFighter(sim.startHalf, -1)];
  sim.fx = { shake: 0, hitstop: 0, slowmo: 1, superSlow: 0, zoom: 0, sparks: [] };
  sim.time = 60;
  sim.moves = [];
}

/** Queue a button press (keyboard, touch, AI). Back-forward + punch becomes the special. */
export function queueButton(who: 0 | 1, btn: Button) {
  const f = sim.f[who];
  let b = btn;
  if (b === "punch" && f.fwdAt > f.backAt && f.fwdAt - f.backAt < 0.3 && sim.clock - f.fwdAt < 0.22) b = "special";
  f.buf = { btn: b, t: sim.clock };
}

/** Jump press (keyboard up / W, touch JUMP / d-pad up, AI). */
export function queueJump(who: 0 | 1) {
  sim.f[who].jumpReq = sim.clock;
}

/** Called by input/AI each frame with the held direction, to detect back-forward motions. */
export function trackDirection(f: FighterSim) {
  const rel = f.moveDir * f.facing; // +1 = toward the opponent
  if (rel !== f.prevRel) {
    if (rel === -1) f.backAt = sim.clock;
    if (rel === 1) f.fwdAt = sim.clock;
    f.prevRel = rel;
  }
}

const free = (s: FState) => s === "idle" || s === "walk" || s === "block" || s === "crouch";
const grounded = (f: FighterSim) => f.y <= 0 && f.vy <= 0;

function setState(f: FighterSim, s: FState) {
  if (f.state === s) return;
  f.state = s;
  f.stateT = 0;
  f.connected = false;
}

function startAttack(f: FighterSim, id: AttackId) {
  f.state = "attack";
  f.atk = id;
  f.stateT = 0;
  f.seq++;
  f.connected = false;
  f.hitConfirm = false;
  f.hitIdx = 0;
  sim.moves.push(`${sim.f.indexOf(f)}:${id}`);
  if (sim.moves.length > 400) sim.moves.shift();
  if (id === "special") f.specialCd = 1.1;
  if (id === "special" || id === "super") f.trail = 1;
}

export type SimEvent =
  | { kind: "hit"; attacker: 0 | 1; defender: 0 | 1; dmg: number; blocked: boolean; heavy: boolean; tag?: "parry" | "counter" | "armor" | "knockdown" | "antiair" }
  | { kind: "move"; who: 0 | 1; move: "special" | "super" };

/** Back-compat alias (GameScene used HitEvent before the gameplay package). */
export type HitEvent = Extract<SimEvent, { kind: "hit" }>;

/** Can `f` cancel its current attack into another one right now? (only after a clean hit) */
const canCancel = (f: FighterSim) => f.state === "attack" && f.hitConfirm && f.atk !== "super" && f.stateT >= ATTACKS[f.atk!].active[1] - 0.04;

function consumeBuffer(i: 0 | 1, events: SimEvent[]) {
  const me = sim.f[i];
  const b = me.buf;
  if (!b) return;
  // a press made after the hit landed waits for the cancel window (strings feel reliable on phones)
  if (me.state === "attack" && me.hitConfirm && me.atk !== "super") b.t = Math.max(b.t, sim.clock - BUFFER_S * 0.5);
  if (sim.clock - b.t > BUFFER_S) {
    me.buf = null;
    return;
  }
  const isFree = free(me.state);
  let next: AttackId | null = null;
  if (me.state === "jump") {
    if ((b.btn === "punch" || b.btn === "kick") && !me.airAtk) {
      next = "air";
      me.airAtk = true;
    } else return; // specials / supers are ground-only: keep buffered for the landing
  } else if (!grounded(me)) {
    return;
  } else if (b.btn === "super") {
    if (me.meter >= METER_MAX && (isFree || canCancel(me))) next = "super";
  } else if (b.btn === "special") {
    if (me.specialCd <= 0 && (isFree || canCancel(me))) next = "special";
  } else if (isFree) {
    if (me.wantCrouch) next = b.btn === "punch" ? "low" : "sweep";
    else next = b.btn === "punch" ? "jab" : "kick";
  } else if (canCancel(me)) {
    next = CHAINS[me.atk!]?.[b.btn] ?? null;
  }
  if (!next) return;
  me.buf = null;
  if (next === "super") {
    me.meter = 0;
    sim.fx.superSlow = 0.55;
    sim.fx.zoom = 1;
    sim.fx.shake = Math.min(1, sim.fx.shake + 0.4);
    sim.fx.sparks.push({ x: me.x, y: 1.2, t: 0, heavy: true, big: true });
  }
  startAttack(me, next);
  if (next === "special" || next === "super") events.push({ kind: "move", who: i, move: next });
}

function resolveHit(i: 0 | 1, h: { dmg: number; knock: number; heavy: boolean; knockdown: boolean; stun: number; chip: number; height?: AttackHeight }, events: SimEvent[]) {
  const me = sim.f[i];
  const foe = sim.f[i === 0 ? 1 : 0];
  const fx = sim.fx;
  const defender = (i === 0 ? 1 : 0) as 0 | 1;
  me.connected = true;
  // airborne fighters can't block; lows beat a standing guard, overheads (jump-ins) beat a crouching one
  const blocked = foe.state === "block" && grounded(foe) && !(h.height === "low" && !foe.crouch) && !(h.height === "overhead" && foe.crouch);
  const parry = blocked && sim.clock - foe.blockAt <= PARRY_WIN && me.atk !== "super";
  const sparkX = (me.x + foe.x) / 2 + me.facing * 0.15;
  if (parry) {
    // attacker is thrown off balance; defender gains meter
    me.state = "hit";
    me.stateT = 0;
    me.seq++;
    me.stunFor = 0.55;
    me.kv = -me.facing * 1.2;
    foe.meter = Math.min(METER_MAX, foe.meter + 15);
    fx.hitstop = 0.12;
    fx.shake = Math.min(1, fx.shake + 0.3);
    fx.sparks.push({ x: sparkX, y: 1.3, t: 0, heavy: true });
    events.push({ kind: "hit", attacker: i, defender, dmg: 0, blocked: true, heavy: false, tag: "parry" });
    return;
  }
  if (blocked) {
    const dmg = Math.ceil(h.dmg * h.chip);
    foe.hp = Math.max(0, foe.hp - dmg);
    foe.kv = me.facing * h.knock * 0.8;
    foe.flash = 0.5;
    me.meter = Math.min(METER_MAX, me.meter + 2);
    foe.meter = Math.min(METER_MAX, foe.meter + 3);
    fx.shake = Math.min(1, fx.shake + 0.12);
    fx.sparks.push({ x: sparkX, y: 1.3, t: 0, heavy: false });
    if (foe.hp <= 0) setState(foe, "ko");
    events.push({ kind: "hit", attacker: i, defender, dmg, blocked: true, heavy: h.heavy });
    return;
  }
  const counter = foe.state === "attack" && foe.atk !== null && foe.stateT < ATTACKS[foe.atk].active[0];
  const armored = foe.state === "attack" && foe.atk !== null && (ATTACKS[foe.atk].armor ?? 0) >= foe.stateT;
  const scale = Math.max(0.4, 1 - 0.12 * (foe.state === "hit" || foe.state === "down" ? foe.combo + 1 : 0));
  const dmg = Math.max(1, Math.round(h.dmg * scale * (counter && !armored ? 1.2 : 1)));
  foe.hp = Math.max(0, foe.hp - dmg);
  foe.flash = 1;
  me.hitConfirm = true;
  me.meter = Math.min(METER_MAX, me.meter + dmg * 0.9);
  foe.meter = Math.min(METER_MAX, foe.meter + dmg * 0.5);
  const airborne = !grounded(foe);
  let tag: "counter" | "armor" | "knockdown" | "antiair" | undefined = counter ? "counter" : undefined;
  if (armored && foe.hp > 0) {
    tag = "armor"; // absorbs the hit: damage, flash, no interruption
  } else {
    foe.kv = me.facing * h.knock * 2;
    foe.combo = foe.state === "hit" || foe.state === "down" ? foe.combo + 1 : 0;
    foe.atk = null;
    foe.buf = null;
    if (foe.hp <= 0) setState(foe, "ko");
    else {
      // anti-air: any clean hit on an airborne fighter knocks it out of the sky (pops up a little: room for juggles later)
      const kd = h.knockdown || airborne;
      foe.state = kd ? "down" : "hit";
      foe.stateT = 0;
      foe.seq++;
      foe.connected = false;
      foe.stunFor = h.stun;
      if (airborne) {
        foe.vy = Math.max(foe.vy, 2.6);
        foe.jvx = 0;
        tag = "antiair";
      } else if (kd) tag = "knockdown";
    }
  }
  fx.hitstop = h.heavy ? 0.09 : 0.05;
  fx.shake = Math.min(1, fx.shake + (h.heavy ? 0.7 : 0.35));
  fx.sparks.push({ x: sparkX, y: h.heavy ? 1.15 : 1.35, t: 0, heavy: h.heavy, big: me.atk === "super" || me.atk === "special" });
  events.push({ kind: "hit", attacker: i, defender, dmg, blocked: false, heavy: h.heavy, tag });
}

/** Advance the fight. Returns events for this step (to push into React/HUD). */
export function step(dt: number, fighting: boolean): SimEvent[] {
  const events: SimEvent[] = [];
  const fx = sim.fx;
  fx.shake = Math.max(0, fx.shake - dt * 2.5);
  fx.zoom = Math.max(0, fx.zoom - dt * (fx.superSlow > 0 ? 0 : 0.9));
  if (fx.hitstop > 0) {
    fx.hitstop -= dt;
    return events; // freeze frames
  }
  sim.clock += dt;
  if (fx.superSlow > 0) fx.superSlow = Math.max(0, fx.superSlow - dt);
  const sdt = dt * fx.slowmo * (fx.superSlow > 0 ? 0.45 : 1);
  for (const s of fx.sparks) s.t += sdt;
  fx.sparks = fx.sparks.filter((s) => s.t < (s.big ? 0.7 : 0.5));

  const [a, b] = sim.f;
  for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
    const me = sim.f[i];
    const foe = sim.f[i === 0 ? 1 : 0];
    me.stateT += sdt;
    me.flash = Math.max(0, me.flash - sdt * 6);
    me.trail = Math.max(0, me.trail - sdt * (me.state === "attack" && (me.atk === "special" || me.atk === "super") ? 0.4 : 3));
    me.invuln = Math.max(0, me.invuln - sdt);
    me.specialCd = Math.max(0, me.specialCd - sdt);
    if (me.state !== "attack") me.facing = foe.x >= me.x ? 1 : -1;
    if (me.wantBlock && !me.prevBlock) me.blockAt = sim.clock;
    me.prevBlock = me.wantBlock;

    // vertical axis: gravity for everyone off the floor (jumps, anti-air pops, KO'd mid-air)
    if (me.y > 0 || me.vy > 0) {
      me.vy -= GRAVITY * sdt;
      me.y += me.vy * sdt;
      if (me.y <= 0) {
        me.y = 0;
        me.vy = 0;
        me.jvx = 0;
        if (me.state === "jump" || (me.state === "attack" && me.atk === "air")) {
          me.atk = null;
          setState(me, "idle");
        }
      }
    }

    if (me.state === "ko" || me.state === "victory") {
      me.crouch = false;
      continue;
    }

    if (fighting) consumeBuffer(i, events);
    if (fighting && free(me.state) && grounded(me) && sim.clock - me.jumpReq <= BUFFER_S) {
      me.jumpReq = -9;
      me.vy = JUMP_V;
      me.y = 0.001;
      me.jvx = me.moveDir * JUMP_VX;
      me.airAtk = false;
      me.wantBlock = false;
      setState(me, "jump");
    }
    if (fighting && free(me.state)) {
      if (me.wantBlock) setState(me, "block");
      else if (me.wantCrouch) setState(me, "crouch");
      else if (me.moveDir !== 0) setState(me, "walk");
      else setState(me, "idle");
    }
    // finish timed states
    if (me.state === "attack" && me.stateT >= ATTACKS[me.atk!].dur) {
      me.atk = null;
      setState(me, grounded(me) ? "idle" : "jump");
    }
    me.crouch = grounded(me) && ((free(me.state) && me.wantCrouch) || (me.state === "attack" && (me.atk === "low" || me.atk === "sweep")));
    if (me.state === "hit" && me.stateT >= me.stunFor) {
      me.combo = 0;
      setState(me, "idle");
    }
    if (me.state === "down" && me.stateT >= DOWN_S) {
      me.combo = 0;
      me.invuln = 0.4;
      setState(me, "idle");
    }

    // movement
    let v = 0;
    if (fighting && (me.state === "walk" || me.state === "block") && !me.crouch) v = me.moveDir * (me.state === "block" ? BLOCK_WALK : WALK);
    if (me.state === "jump" || (me.state === "attack" && me.atk === "air")) v = me.jvx;
    if (me.state === "attack") {
      const d = ATTACKS[me.atk!].dash;
      const gap = Math.abs(foe.x - me.x);
      if (d && me.stateT >= d[0] && me.stateT <= d[1] && gap > MIN_SEP + 0.05) v = me.facing * d[2];
    }
    me.x += (v + me.kv) * sdt;
    me.kv *= Math.pow(0.002, sdt);
    me.x = Math.max(-sim.half, Math.min(sim.half, me.x));

    // attacks
    if (me.state === "attack" && me.atk) {
      const atk = ATTACKS[me.atk];
      const dist = Math.abs(foe.x - me.x);
      const hittable = foe.state !== "ko" && foe.state !== "down" && foe.invuln <= 0;
      // vertical: grounded attacks only reach so high (jump over them); highs whiff over a crouch
      const airborneAttacker = !grounded(me);
      const reach = airborneAttacker || foe.y <= (atk.airReach ?? 0.4);
      const touches = reach && !(atk.height === "high" && foe.crouch);
      if (atk.hits) {
        const h = atk.hits[me.hitIdx];
        if (h && me.stateT >= h.t) {
          me.hitIdx++;
          const last = me.hitIdx === atk.hits.length;
          // the super tracks its target: once the rush starts, the remaining hits land on a down opponent too
          if (dist <= h.range && touches && (hittable || (foe.state === "down" && !last) || (foe.state === "hit" && foe.hp > 0))) {
            if (foe.state === "down") {
              foe.state = "hit";
              foe.stateT = 0;
            }
            resolveHit(i, { dmg: h.dmg, knock: h.knock, heavy: true, knockdown: last, stun: 0.6, chip: atk.chip ?? 0.15, height: atk.height }, events);
            fx.sparks.push({ x: (me.x + foe.x) / 2, y: 1.25, t: 0, heavy: true, big: true });
          }
        }
      } else if (!me.connected && me.stateT >= atk.active[0] && me.stateT <= atk.active[1] && dist <= atk.range && hittable && touches) {
        resolveHit(i, { dmg: atk.dmg, knock: atk.knock, heavy: !!atk.heavy, knockdown: !!atk.knockdown, stun: atk.stun, chip: atk.chip ?? 0.15, height: atk.height }, events);
      }
    }
  }
  // push apart
  const sep = b.x - a.x;
  // a high enough jump passes over the opponent (crossing up); on the ground bodies push apart
  if (Math.abs(sep) < MIN_SEP && Math.abs(a.y - b.y) < 0.8) {
    const push = (MIN_SEP - Math.abs(sep)) / 2;
    const s = Math.sign(sep) || 1;
    a.x -= push * s;
    b.x += push * s;
  }
  if (fighting) sim.time = Math.max(0, sim.time - sdt);
  return events;
}

/** Which clip a fighter should be playing now (Fighter.tsx). `key` changes whenever the clip must restart. */
export function animFor(f: FighterSim): { clip: "idle" | "walk" | "block" | "hit" | "hit2" | "ko" | "victory" | AttackAnim; key: string; dur?: number } {
  if (f.state === "attack" && f.atk) {
    const spec = ATTACKS[f.atk];
    if (f.atk === "super") {
      const seg = f.stateT < 0.6 ? 0 : f.stateT < 0.9 ? 1 : 2;
      const clip: AttackAnim = seg === 0 ? "punch" : seg === 1 ? "punch2" : "kick";
      return { clip, key: `${f.seq}:${seg}`, dur: seg === 2 ? 0.55 : 0.32 };
    }
    return { clip: spec.anim, key: `${f.seq}`, dur: spec.dur };
  }
  if (f.state === "hit") return { clip: "hit", key: `hit:${f.seq}` };
  if (f.state === "down") return { clip: "hit2", key: `down:${f.seq}`, dur: 0.7 };
  if (f.state === "crouch") return { clip: "idle", key: "crouch" };
  if (f.state === "jump") return { clip: "idle", key: "jump" };
  const st = f.state === "attack" ? "idle" : f.state;
  return { clip: st, key: st };
}
