/** Simple reactive AI for player 2. */
import { ATTACKS, sim } from "./sim";

let think = 0;
let blockUntil = 0;
let cooldown = 0;
let clock = 0;

export function resetAI() {
  think = 0;
  blockUntil = 0;
  cooldown = 0.8;
  clock = 0;
}

export function runAI(dt: number, level = 0.6) {
  clock += dt;
  const me = sim.f[1];
  const foe = sim.f[0];
  cooldown -= dt;
  const dist = Math.abs(foe.x - me.x);
  const toward = (foe.x > me.x ? 1 : -1) as 1 | -1;

  // react to incoming attacks
  const foeAttacking = (foe.state === "punch" || foe.state === "kick") && foe.stateT < ATTACKS[foe.state].active[0];
  if (foeAttacking && dist < 1.7 && clock > blockUntil - 0.01 && Math.random() < level * 0.08) {
    blockUntil = clock + 0.35 + Math.random() * 0.25;
  }
  me.wantBlock = clock < blockUntil;

  think -= dt;
  if (think > 0) return;
  think = 0.12 + Math.random() * (0.35 - level * 0.2);

  if (me.wantBlock) {
    me.moveDir = 0;
    return;
  }
  if (dist > 1.35) {
    me.moveDir = Math.random() < 0.85 ? toward : 0;
  } else if (dist < 0.95 && Math.random() < 0.35) {
    me.moveDir = (-toward) as 1 | -1;
  } else {
    me.moveDir = 0;
    if (cooldown <= 0 && Math.random() < 0.55 + level * 0.3) {
      me.queued = dist < 1.15 && Math.random() < 0.65 ? "punch" : "kick";
      cooldown = 0.35 + Math.random() * (0.9 - level * 0.5);
    }
  }
}
