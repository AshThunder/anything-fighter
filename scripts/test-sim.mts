/**
 * Deterministic checks for the fight sim (lib/game/sim.ts): strings, jump arc, crouch, highs/lows/overheads,
 * anti-air, crouch-block, special, super. Pure logic: no browser, no network, no credits.  Run: npm run test:sim
 */
import { ATTACKS, GRAVITY, JUMP_V, queueButton, queueJump, resetSim, sim, step, type FighterSim } from "../lib/game/sim.ts";

let fails = 0;
const ok = (c: boolean, msg: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${msg}`);
  if (!c) fails++;
};
const DT = 1 / 60;
function setup(gap = 1.2) {
  resetSim();
  sim.half = 5;
  sim.f[0].x = -gap / 2;
  sim.f[1].x = gap / 2;
  return sim.f as [FighterSim, FighterSim];
}
const run = (s: number, each?: (t: number) => void) => {
  const ev = [];
  for (let t = 0; t < s; t += DT) {
    each?.(t);
    ev.push(...step(DT, true));
  }
  return ev;
};
const hits = (ev: ReturnType<typeof step>, who: 0 | 1) => ev.filter((e) => e.kind === "hit" && e.attacker === who) as Extract<ReturnType<typeof step>[number], { kind: "hit" }>[];

// 1. P-P-K string
{
  const [a] = setup();
  const pressAt: Record<number, "punch" | "kick"> = { 0: "punch", 14: "punch", 30: "kick" };
  let frame = 0;
  run(1.4, () => {
    if (pressAt[frame]) queueButton(0, pressAt[frame]);
    frame++;
  });
  const seq = sim.moves.filter((m) => m.startsWith("0:")).join(",");
  ok(seq === "0:jab,0:cross,0:hook", `P-P-K string → ${seq}`);
  ok(sim.f[1].hp === 100 - 6 - Math.round(8 * 0.88) - Math.round(14 * 0.76), `string damage scales (cpu hp ${sim.f[1].hp})`);
  void a;
}
// 2. jump arc: lands, no infinite air time
{
  const [a] = setup(3);
  queueJump(0);
  let maxY = 0, airT = 0;
  run(1.5, () => {
    maxY = Math.max(maxY, a.y);
    if (a.y > 0) airT += DT;
  });
  ok(Math.abs(maxY - (JUMP_V * JUMP_V) / (2 * GRAVITY)) < 0.1 && airT > 0.6 && airT < 0.8 && a.y === 0 && a.state === "idle", `jump apex ${maxY.toFixed(2)} m, air ${airT.toFixed(2)} s, landed ${a.state}`);
  queueJump(0);
  run(0.2);
  queueJump(0); // second press in the air: no double jump
  let air2 = 0;
  run(1.2, () => (air2 += a.y > 0 ? DT : 0));
  ok(air2 < 0.7, `no double jump (air ${air2.toFixed(2)} s)`);
}
// 3. crouch: jab whiffs, low punch hits; jab hits standing
{
  const [a, b] = setup();
  b.wantCrouch = true;
  run(0.1);
  ok(b.state === "crouch" && b.crouch, `hold down → crouch (${b.state})`);
  queueButton(0, "punch");
  const ev = run(0.5, () => (b.wantCrouch = true));
  ok(hits(ev, 0).length === 0, "standing jab whiffs over a crouch");
  b.wantCrouch = false;
  run(0.2);
  queueButton(0, "punch");
  ok(hits(run(0.5), 0).length === 1, "jab hits a standing fighter");
  run(0.6);
  a.wantCrouch = true;
  queueButton(0, "punch");
  run(0.05, () => (a.wantCrouch = true));
  ok(a.atk === "low", `crouch + punch → low punch (${a.atk})`);
}
// 4. sweep: beats standing block, crouch-block stops it, jumping clears it
{
  const [a, b] = setup();
  b.wantBlock = true;
  run(0.1);
  a.wantCrouch = true;
  queueButton(0, "kick");
  let ev = run(0.7, () => { a.wantCrouch = true; b.wantBlock = true; });
  const h1 = hits(ev, 0)[0];
  ok(!!h1 && !h1.blocked && h1.tag === "knockdown", `sweep beats a standing block → ${h1?.tag}`);
  setup();
  sim.f[1].wantBlock = true;
  sim.f[1].wantCrouch = true;
  run(0.1);
  sim.f[0].wantCrouch = true;
  queueButton(0, "kick");
  ev = run(0.7, () => { sim.f[0].wantCrouch = true; sim.f[1].wantBlock = true; sim.f[1].wantCrouch = true; });
  ok(hits(ev, 0)[0]?.blocked === true, "crouch-block stops the sweep");
  setup();
  sim.f[0].wantCrouch = true;
  queueButton(0, "kick");
  run(0.06, () => (sim.f[0].wantCrouch = true));
  queueJump(1);
  ev = run(0.7, () => (sim.f[0].wantCrouch = true));
  ok(hits(ev, 0).length === 0, `jumping clears the sweep (peak ${ATTACKS.sweep.airReach} m reach)`);
}
// 5. air attack = overhead: beats crouch-block, standing block stops it
{
  setup(1.6);
  sim.f[1].wantBlock = true;
  sim.f[1].wantCrouch = true;
  queueJump(0);
  let ev = run(0.3, () => { sim.f[1].wantBlock = true; sim.f[1].wantCrouch = true; });
  queueButton(0, "kick");
  ev = ev.concat(run(0.8, () => { sim.f[1].wantBlock = true; sim.f[1].wantCrouch = true; }));
  const h = hits(ev, 0)[0];
  ok(sim.moves.includes("0:air") && !!h && !h.blocked, `jump-in kick (overhead) beats crouch-block (${h ? (h.blocked ? "blocked" : "hit") : "whiff"})`);
  setup(1.6);
  sim.f[1].wantBlock = true;
  queueJump(0);
  run(0.3, () => (sim.f[1].wantBlock = true));
  queueButton(0, "punch");
  ev = run(0.8, () => (sim.f[1].wantBlock = true));
  ok(hits(ev, 0)[0]?.blocked === true, "standing block stops the jump-in");
}
// 6. anti-air: kick an airborne fighter → knockdown; jab misses at the apex
{
  const [a, b] = setup(1.3);
  queueJump(1);
  run(0.18);
  queueButton(0, "kick");
  const ev = run(0.6);
  const h = hits(ev, 0)[0];
  ok(h?.tag === "antiair" && (b.state === "down" || b.state === "idle"), `anti-air kick → ${h?.tag}, cpu ${b.state}`);
  run(1.5);
  ok(b.y === 0, "knocked-down jumper lands");
  setup(1.3);
  queueJump(1);
  run(0.25);
  queueButton(0, "punch");
  ok(hits(run(0.4), 0).length === 0, "jab passes under a jump");
  void a;
}
// 7. special + super still work
{
  const [a, b] = setup(2.6);
  queueButton(0, "special");
  const ev = run(1.0);
  ok(sim.moves.includes("0:special") && hits(ev, 0).length === 1 && b.state === "down", "special dashes in and knocks down");
  setup(1.4);
  sim.f[0].meter = 100;
  queueButton(0, "super");
  const ev2 = run(2.5);
  ok(hits(ev2, 0).length === 3 && sim.f[0].meter < 100, `super lands 3 hits (${hits(ev2, 0).map((e) => e.dmg).join("+")})`);
  void a;
}
console.log(fails ? `\n${fails} FAILED` : "\nall sim checks passed");
process.exit(fails ? 1 : 0);
