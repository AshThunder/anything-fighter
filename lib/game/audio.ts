/**
 * All sound is synthesised at runtime with the Web Audio API — no sample files, so there is nothing to
 * license (effectively CC0 / original work). SFX: punch, kick, block, whoosh, KO boom, announcer stingers.
 * Music: a small procedural 4-bar loop (kick/snare/hat + bass + arp) at 128 BPM.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let musicTimer: number | null = null;
let muted = typeof window !== "undefined" && window.localStorage?.getItem("af-muted") === "1";

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.32;
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.9;
    sfxGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture (click / key) to unlock audio on mobile. */
export function unlockAudio() {
  ac();
}
export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  window.localStorage?.setItem("af-muted", m ? "1" : "0");
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
}

function noise(t: number, dur: number, f: number, q: number, gain: number, type: BiquadFilterType = "bandpass", out = sfxGain) {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const flt = c.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt).connect(g).connect(out!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}
function tone(t: number, dur: number, f0: number, f1: number, gain: number, type: OscillatorType = "sine", out = sfxGain) {
  const c = ctx!;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export type Sfx = "whoosh" | "punch" | "kick" | "block" | "ko" | "ready" | "fight" | "victory" | "click" | "vs";
export function sfx(kind: Sfx, intensity = 1) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + 0.005;
  const v = Math.min(1.5, intensity);
  switch (kind) {
    case "whoosh":
      noise(t, 0.16, 1400, 0.8, 0.25 * v, "bandpass");
      break;
    case "punch":
      tone(t, 0.12, 180, 55, 0.9 * v);
      noise(t, 0.07, 2500, 1.2, 0.6 * v);
      break;
    case "kick":
      tone(t, 0.22, 140, 38, 1.1 * v);
      noise(t, 0.12, 900, 0.9, 0.7 * v, "lowpass");
      noise(t + 0.01, 0.08, 3800, 1.5, 0.35 * v);
      break;
    case "block":
      tone(t, 0.09, 1250, 900, 0.25, "square");
      noise(t, 0.05, 5000, 3, 0.35);
      break;
    case "ko":
      tone(t, 1.1, 90, 28, 1.2);
      noise(t, 0.9, 300, 0.6, 0.8, "lowpass");
      tone(t + 0.05, 0.6, 660, 110, 0.18, "sawtooth");
      break;
    case "ready":
      tone(t, 0.18, 440, 440, 0.25, "square");
      break;
    case "fight":
      [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.05, 0.35, f, f, 0.22, "sawtooth"));
      noise(t, 0.4, 1800, 0.6, 0.4);
      break;
    case "victory":
      [392, 523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.11, 0.5, f, f * 1.01, 0.2, "triangle"));
      break;
    case "vs":
      noise(t, 0.35, 600, 0.7, 0.5, "lowpass");
      tone(t, 0.6, 110, 40, 1.0);
      [196, 294, 392].forEach((f) => tone(t + 0.02, 0.5, f, f * 0.98, 0.12, "sawtooth"));
      break;
    case "click":
      tone(t, 0.04, 1800, 1200, 0.12, "square");
      break;
  }
}

// ── music ──
const BPM = 128;
const STEP = 60 / BPM / 4; // 16th
const BASS = [36, 36, 48, 36, 39, 39, 51, 39, 41, 41, 53, 41, 34, 34, 46, 43]; // per beat (MIDI), 4 bars × 4 beats
const ARP = [0, 3, 7, 12, 7, 3, 10, 7];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function startMusic() {
  const c = ac();
  if (!c || musicTimer !== null) return;
  let next = c.currentTime + 0.1;
  let stepIdx = 0;
  const schedule = () => {
    while (next < c.currentTime + 0.25) {
      const s = stepIdx % 64;
      const beat = Math.floor(s / 4);
      const t = next;
      if (s % 4 === 0) tone(t, 0.18, 120, 40, 0.8, "sine", musicGain); // kick
      if (s % 8 === 4) noise(t, 0.14, 1800, 0.7, 0.45, "bandpass", musicGain); // snare
      if (s % 2 === 1) noise(t, 0.03, 8000, 1, 0.12, "highpass", musicGain); // hat
      if (s % 2 === 0) tone(t, STEP * 1.8, mtof(BASS[beat]), mtof(BASS[beat]), 0.28, "sawtooth", musicGain);
      if (s % 2 === 0) {
        const root = BASS[beat] + 36;
        const n = root + ARP[(s / 2) % ARP.length];
        tone(t, STEP * 1.2, mtof(n), mtof(n), 0.05, "square", musicGain);
      }
      next += STEP;
      stepIdx++;
    }
  };
  schedule();
  musicTimer = window.setInterval(schedule, 60);
}
export function stopMusic() {
  if (musicTimer !== null) window.clearInterval(musicTimer);
  musicTimer = null;
}
export function duckMusic(on: boolean) {
  if (musicGain && ctx) musicGain.gain.setTargetAtTime(on ? 0.1 : 0.32, ctx.currentTime, 0.1);
}
