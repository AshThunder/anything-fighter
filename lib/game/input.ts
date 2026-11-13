/**
 * Keyboard + on-screen touch input. Button presses go into the sim's 150 ms input buffer.
 *  1P (vs CPU / practice): A/D or ←/→ move · W/↑/Space jump · S/↓ crouch · J/Z punch · K/X kick · L/C/Shift block · U/V special · I/B super
 *  2P local:  P1 = A/D move · W jump · S crouch · F punch · G kick · H block · R special · T super
 *             P2 = ←/→ move · ↑ jump · ↓ crouch · K or Numpad1 punch · L or Numpad2 kick · M or Numpad0 block · O or Numpad3 special · P or Numpad6 super
 *  Crouch + punch = low punch, crouch + kick = sweep, crouch + block = crouch-block (stops lows), punch/kick in the air = jump attack.
 *  Special also comes out of back-forward + punch (e.g. A then D then J when facing right).
 */
import { queueButton, queueJump, sim, trackDirection, type Button } from "./sim";
import { sfx, unlockAudio } from "./audio";

type Map = { left: string[]; right: string[]; up: string[]; down: string[]; punch: string[]; kick: string[]; block: string[]; special: string[]; super: string[] };
const SOLO: Map = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  up: ["KeyW", "ArrowUp", "Space"],
  down: ["KeyS", "ArrowDown"],
  punch: ["KeyJ", "KeyZ"],
  kick: ["KeyK", "KeyX"],
  block: ["KeyL", "KeyC", "ShiftLeft", "ShiftRight"],
  special: ["KeyU", "KeyV"],
  super: ["KeyI", "KeyB"],
};
const P1_2P: Map = { left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"], punch: ["KeyF"], kick: ["KeyG"], block: ["KeyH"], special: ["KeyR"], super: ["KeyT"] };
const P2_2P: Map = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  punch: ["KeyK", "Numpad1"],
  kick: ["KeyL", "Numpad2"],
  block: ["KeyM", "Numpad0"],
  special: ["KeyO", "Numpad3"],
  super: ["KeyP", "Numpad6"],
};
const BUTTONS: Button[] = ["punch", "kick", "special", "super"];

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
      for (const btn of BUTTONS) if (m[btn].includes(e.code)) press(btn, i as 0 | 1);
      if (m.up.includes(e.code)) jump(i as 0 | 1);
    });
    const all = [a, b].flatMap((m) => (m ? Object.values(m).flat() : []));
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

export function press(a: Button, who: 0 | 1 = 0) {
  const f = sim.f[who];
  if (f.state === "idle" || f.state === "walk" || f.state === "block") sfx("whoosh", a === "kick" ? 1.2 : a === "punch" ? 0.8 : 1.5);
  queueButton(who, a);
}
export function jump(who: 0 | 1 = 0) {
  unlockAudio();
  const f = sim.f[who];
  if ((f.state === "idle" || f.state === "walk" || f.state === "block" || f.state === "crouch") && f.y <= 0) sfx("whoosh", 0.6);
  queueJump(who);
}
/** For touch buttons (player 1) */
export function setHeld(code: "left" | "right" | "block" | "down", on: boolean) {
  const k = code === "left" ? "TouchLeft" : code === "right" ? "TouchRight" : code === "down" ? "TouchDown" : "TouchBlock";
  if (on) held.add(k);
  else held.delete(k);
}

function readFor(idx: 0 | 1, m: Map) {
  const p = sim.f[idx];
  const l = m.left.some((k) => held.has(k)) || (idx === 0 && held.has("TouchLeft"));
  const r = m.right.some((k) => held.has(k)) || (idx === 0 && held.has("TouchRight"));
  p.moveDir = l === r ? 0 : l ? -1 : 1;
  p.wantBlock = m.block.some((k) => held.has(k)) || (idx === 0 && held.has("TouchBlock"));
  p.wantCrouch = m.down.some((k) => held.has(k)) || (idx === 0 && held.has("TouchDown"));
  trackDirection(p);
}

export function readPlayerInput() {
  const [a, b] = maps();
  readFor(0, a);
  if (b) readFor(1, b);
}
