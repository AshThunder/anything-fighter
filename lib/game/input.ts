/**
 * Keyboard + on-screen touch input. Edge-triggered attacks are queued into the sim.
 *  1P (vs CPU / practice): A/D or ←/→ move · J/Z punch · K/X kick · L/C/S/Shift/↓ block
 *  2P local:  P1 = A/D move · F punch · G kick · S block
 *             P2 = ←/→ move · K or Numpad1 punch · L or Numpad2 kick · ↓ or Numpad0 block
 */
import { sim } from "./sim";
import { sfx, unlockAudio } from "./audio";

type Map = { left: string[]; right: string[]; punch: string[]; kick: string[]; block: string[] };
const SOLO: Map = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  punch: ["KeyJ", "KeyZ"],
  kick: ["KeyK", "KeyX"],
  block: ["KeyL", "KeyC", "ShiftLeft", "ShiftRight", "KeyS", "ArrowDown"],
};
const P1_2P: Map = { left: ["KeyA"], right: ["KeyD"], punch: ["KeyF"], kick: ["KeyG"], block: ["KeyS"] };
const P2_2P: Map = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  punch: ["KeyK", "Numpad1"],
  kick: ["KeyL", "Numpad2"],
  block: ["ArrowDown", "Numpad0"],
};

const held = new Set<string>();
let attached = false;
let twoPlayer = false;

export function setTwoPlayer(on: boolean) {
  twoPlayer = on;
}
const maps = (): [Map, Map | null] => (twoPlayer ? [P1_2P, P2_2P] : [SOLO, null]);

export function attachInput() {
  if (attached || typeof window === "undefined") return () => {};
  attached = true;
  const down = (e: KeyboardEvent) => {
    unlockAudio();
    if (e.repeat) return;
    held.add(e.code);
    const [a, b] = maps();
    [a, b].forEach((m, i) => {
      if (!m) return;
      if (m.punch.includes(e.code)) press("punch", i as 0 | 1);
      if (m.kick.includes(e.code)) press("kick", i as 0 | 1);
    });
    const all = [a, b].flatMap((m) => (m ? [...m.left, ...m.right, ...m.punch, ...m.kick, ...m.block] : []));
    if ([...all, "Space"].includes(e.code)) e.preventDefault();
  };
  const up = (e: KeyboardEvent) => held.delete(e.code);
  const blur = () => held.clear();
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    attached = false;
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}

export function press(a: "punch" | "kick", who: 0 | 1 = 0) {
  const f = sim.f[who];
  if (f.state === "idle" || f.state === "walk" || f.state === "block") sfx("whoosh", a === "kick" ? 1.2 : 0.8);
  f.queued = a;
}
/** For touch buttons (player 1) */
export function setHeld(code: "left" | "right" | "block", on: boolean) {
  const k = code === "left" ? "TouchLeft" : code === "right" ? "TouchRight" : "TouchBlock";
  if (on) held.add(k);
  else held.delete(k);
}

function readFor(idx: 0 | 1, m: Map) {
  const p = sim.f[idx];
  const l = m.left.some((k) => held.has(k)) || (idx === 0 && held.has("TouchLeft"));
  const r = m.right.some((k) => held.has(k)) || (idx === 0 && held.has("TouchRight"));
  p.moveDir = l === r ? 0 : l ? -1 : 1;
  p.wantBlock = m.block.some((k) => held.has(k)) || (idx === 0 && held.has("TouchBlock"));
}

export function readPlayerInput() {
  const [a, b] = maps();
  readFor(0, a);
  if (b) readFor(1, b);
}
