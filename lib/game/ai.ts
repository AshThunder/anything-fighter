/**
 * CPU opponent. Drives sim.f[1] through the same inputs a player has (moveDir / wantBlock / buffered buttons),
 * so it works for any fighter: starters, forged rigged fighters and freestyle (procedural) meshes alike.
 *  easy   – slow reactions, single hits only (practice uses this and never attacks)
 *  normal – sometimes extends strings on hit, uses the special and the super
 *  hard   – reacts fast, finishes strings, punishes whiffs, parries now and then, supers when in range
 *  normal + hard also use the vertical axis: jump in with air attacks, jump over sweeps, crouch under jabs/crosses
 *  (then punish with a low punch), crouch-block lows, sweep, and anti-air jumpers with a kick.
 */
import { ATTACKS, METER_MAX, queueButton, queueJump, sim, trackDirection, type Button } from "./sim";

export type CpuLevel = "easy" | "normal" | "hard";
export const CPU_LEVELS: CpuLevel[] = ["easy", "normal", "hard"];

interface Tuning {
  react: number;
  think: [number, number];
  aggro: number;
  strings: number;
  special: number;
  super: number;
  punish: number;
  parry: number;
  /** vertical axis */
  jump: number;
  duck: number;
  antiair: number;
  low: number;
}
const TUNING: Record<CpuLevel, Tuning> = {
  easy: { react: 0.035, think: [0.32, 0.6], aggro: 0.5, strings: 0, special: 0, super: 0, punish: 0, parry: 0, jump: 0, duck: 0, antiair: 0, low: 0 },
  normal: { react: 0.07, think: [0.16, 0.38], aggro: 0.72, strings: 0.45, special: 0.12, super: 0.5, punish: 0.35, parry: 0.05, jump: 0.1, duck: 0.06, antiair: 0.35, low: 0.2 },
  hard: { react: 0.16, think: [0.07, 0.18], aggro: 0.9, strings: 0.95, special: 0.3, super: 0.9, punish: 0.9, parry: 0.35, jump: 0.18, duck: 0.16, antiair: 0.8, low: 0.35 },
};
const NEXT_IN_STRING: Partial<Record<string, Button>> = { jab: "punch", cross: "kick", kick: "punch" };

let think = 0;
let blockUntil = 0;
let cooldown = 0;
let clock = 0;
let crouchUntil = 0;
let aaArmed = true;

export function resetAI() {
  crouchUntil = 0;
  aaArmed = true;
  think = 0;
  blockUntil = 0;
  cooldown = 0.8;
  clock = 0;
}

export function runAI(dt: number, level: CpuLevel = "normal") {
  const T = TUNING[level];
  clock += dt;
  const me = sim.f[1];
  const foe = sim.f[0];
  cooldown -= dt;
  const dist = Math.abs(foe.x - me.x);
  const toward = (foe.x > me.x ? 1 : -1) as 1 | -1;
  const roll = (p: number) => Math.random() < p;

  // extend a string once per attack, the moment it hits (the sim buffers it into the cancel window)
  if (me.state === "attack" && me.atk && me.hitConfirm && me.aiChained !== me.seq) {
    me.aiChained = me.seq;
    if (me.meter >= METER_MAX && roll(T.super)) queueButton(1, "super");
    else if (NEXT_IN_STRING[me.atk] && roll(T.strings)) queueButton(1, NEXT_IN_STRING[me.atk]!);
    else if (me.atk === "hook" && roll(T.special * 0.5)) queueButton(1, "special");
  }

  // react to incoming attacks (hard sometimes blocks late on purpose = parry)
  const fa = foe.state === "attack" && foe.atk ? ATTACKS[foe.atk] : null;
  const foeStartup = !!fa && foe.stateT < fa.active[0];
  const grounded = me.y <= 0 && me.vy <= 0;
  if (fa && foeStartup && dist < fa.range + 0.4 && clock > blockUntil - 0.01 && clock > crouchUntil - 0.01 && grounded) {
    const untilActive = fa.active[0] - foe.stateT;
    if (fa.height === "high" && roll(T.duck)) crouchUntil = clock + 0.4; // duck under it, punish below
    else if (fa.height === "low" && roll(T.jump * 0.6)) queueJump(1); // hop the sweep
    else if (roll(T.parry) && untilActive < 0.1) blockUntil = clock + 0.25;
    else if (roll(T.react)) blockUntil = clock + 0.3 + Math.random() * 0.25;
    // guard the right way: crouch for lows (levels that know about crouching), stand for jump-ins
    if (blockUntil > clock && fa.height === "low" && T.duck > 0) crouchUntil = blockUntil;
  }
  me.wantBlock = clock < blockUntil;
  me.wantCrouch = clock < crouchUntil && !(fa && fa.height === "overhead");

  // anti-air: kick a jumping opponent on the way down (once per jump)
  const foeAir = foe.y > 0.05;
  if (!foeAir) aaArmed = true;
  else if (aaArmed && grounded && dist < 2 && foe.vy < 1.5) {
    aaArmed = false;
    if (roll(T.antiair)) {
      me.wantBlock = false;
      blockUntil = 0;
      me.wantCrouch = false;
      crouchUntil = 0;
      queueButton(1, "kick");
    }
  }
  // own jump-in: attack on the way down
  if (me.state === "jump" && !me.airAtk && dist < 1.8 && me.vy < 1) queueButton(1, roll(0.5) ? "kick" : "punch");

  // punish a whiffed attack in its recovery
  if (fa && foe.stateT > fa.active[1] && !foe.connected && me.state !== "attack" && cooldown <= 0 && roll(T.punish * 0.25)) {
    me.wantBlock = false;
    blockUntil = 0;
    if (dist < 1.45) queueButton(1, "punch");
    else if (dist < 3.4 && me.specialCd <= 0 && T.special > 0) queueButton(1, "special");
    cooldown = 0.25;
  }

  think -= dt;
  if (think > 0) {
    trackDirection(me);
    return;
  }
  think = T.think[0] + Math.random() * (T.think[1] - T.think[0]);

  if (me.wantBlock) {
    me.moveDir = 0;
    trackDirection(me);
    return;
  }
  if (me.meter >= METER_MAX && dist < 2.2 && roll(T.super * 0.6)) {
    queueButton(1, "super");
  } else if (dist > 1.8 && dist < 3.4 && me.specialCd <= 0 && roll(T.special)) {
    queueButton(1, "special");
  } else if (dist > 1.9 && dist < 3.1 && grounded && roll(T.jump)) {
    me.moveDir = toward; // jump in
    trackDirection(me);
    queueJump(1);
    return;
  } else if (dist > 1.35) {
    me.moveDir = roll(0.85) ? toward : 0;
  } else if (dist < 0.95 && roll(0.35)) {
    me.moveDir = (-toward) as 1 | -1;
  } else {
    me.moveDir = 0;
    if (cooldown <= 0 && roll(T.aggro)) {
      if (roll(T.low)) {
        crouchUntil = clock + 0.5; // low punch / sweep
        me.wantCrouch = true;
      }
      queueButton(1, dist < 1.15 && roll(0.65) ? "punch" : "kick");
      cooldown = 0.3 + Math.random() * (0.9 - T.aggro * 0.6);
    }
  }
  trackDirection(me);
}
