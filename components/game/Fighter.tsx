"use client";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { aimArm, rigFreestyle, type FreestyleArms } from "@/lib/game/freestyle-rig";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FighterDef } from "@/lib/fighters";
import { CLIP_CANDIDATES, LOOPING, MOVES, type Move } from "@/lib/moves";
import { ATTACKS, animFor, sim } from "@/lib/game/sim";

const TARGET_HEIGHT = 1.8;
const HIT_RED = new THREE.Color(0.55, 0.06, 0.02);
const tmpColor = new THREE.Color();

/** Extra Aholo retarget clips some fighters carry (starters: Punch_Cross + Hit_Knockback). */
const EXTRA = ["punch2", "hit2"] as const;
type Clip = Move | (typeof EXTRA)[number];
const EXTRA_CANDIDATES: Record<(typeof EXTRA)[number], string[]> = { punch2: ["Punch_Cross"], hit2: ["Hit_Knockback"] };

function findClip(clips: THREE.AnimationClip[], move: Clip): THREE.AnimationClip | undefined {
  const cands = (CLIP_CANDIDATES as Record<string, string[]>)[move] ?? EXTRA_CANDIDATES[move as (typeof EXTRA)[number]] ?? [];
  for (const cand of cands) {
    const exact = clips.find((c) => c.name === cand);
    if (exact) return exact;
  }
  for (const cand of cands) {
    const c = clips.find((x) => x.name.toLowerCase().includes(cand.toLowerCase()));
    if (c) return c;
  }
  return undefined;
}

/** Rigged GLB fighter driven by sim.f[index]. Uses clips when available, procedural motion otherwise. */
/**
 * Leg bones for the procedural crouch / jump tuck (Lux3D auto-rig uses Mixamo names). The bend direction is measured
 * on the bind pose instead of assumed: rotate each bone about its local X and keep the sign that moves the knee forward
 * (thigh) / the foot backward (shin), so it works whatever the rig's axis conventions are.
 */
interface Legs {
  up: THREE.Object3D[];
  knee: THREE.Object3D[];
  upSign: number;
  kneeSign: number;
  /** thigh + shin length, model units (× scale = metres) */
  len: number;
  saved: THREE.Quaternion[];
}
const AX = new THREE.Vector3(1, 0, 0);
const tmpQ = new THREE.Quaternion();
function findLegs(root: THREE.Object3D): Legs | null {
  const by = (suffix: string) => {
    let hit: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (!hit && (o as THREE.Bone).isBone && o.name.replace(/^.*[:_]/, "") === suffix) hit = o;
    });
    return hit as THREE.Object3D | null;
  };
  const lu = by("LeftUpLeg"), ru = by("RightUpLeg"), lk = by("LeftLeg"), rk = by("RightLeg"), lf = by("LeftFoot");
  if (!lu || !ru || !lk || !rk || !lf) return null;
  const w = (o: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    return o.getWorldPosition(new THREE.Vector3());
  };
  const test = (bone: THREE.Object3D, probe: THREE.Object3D) => {
    const before = w(probe);
    const q0 = bone.quaternion.clone();
    bone.quaternion.multiply(tmpQ.setFromAxisAngle(AX, 0.4));
    const after = w(probe);
    bone.quaternion.copy(q0);
    return after.z - before.z;
  };
  const upSign = test(lu, lk) >= 0 ? 1 : -1; // thigh: knee forward (+Z, the way fighters face)
  const kneeSign = test(lk, lf) <= 0 ? 1 : -1; // shin: foot backward
  const len = w(lu).distanceTo(w(lk)) + w(lk).distanceTo(w(lf));
  root.updateMatrixWorld(true);
  return { up: [lu, ru], knee: [lk, rk], upSign, kneeSign, len, saved: [lu, ru, lk, rk].map((b) => b.quaternion.clone()) };
}

type V3 = [number, number, number];
const GUARD: V3 = [0.22, -0.8, 0.55];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Arm targets for freestyle meshes (x = outward from the body, +z = toward the opponent, +y = up). */
function aimFreestyleArms(arms: FreestyleArms, f: (typeof sim.f)[number], clock: number, dt: number) {
  const t = f.stateT;
  const bob = Math.sin(clock * 2.6) * 0.06;
  let fast = false;
  for (const { side, bone } of arms.bones) {
    let d: V3 = [GUARD[0], GUARD[1] + bob, GUARD[2]];
    switch (f.state) {
      case "walk":
        d = [GUARD[0], GUARD[1], GUARD[2] + Math.sin(t * 11) * 0.35 * side];
        break;
      case "block":
        d = [-0.3, 0.5, 0.85]; // forearms crossed in front of the face
        break;
      case "jump":
        d = [0.65, 0.55, 0.35];
        break;
      case "attack": {
        const atk = f.atk ? ATTACKS[f.atk] : ATTACKS.jab;
        const sup = f.atk === "super";
        const seg = sup ? (t < 0.6 ? 0 : t < 0.9 ? 1 : 2) : -1;
        const segT = sup ? (seg === 0 ? t : seg === 1 ? t - 0.6 : t - 0.9) : t;
        const dur = sup ? (seg === 2 ? 0.55 : 0.32) : atk.dur;
        const u = Math.min(1, segT / dur);
        const thrust = u < 0.2 ? -Math.sin((u / 0.2) * Math.PI) * 0.25 : Math.sin(((u - 0.2) / 0.8) * Math.PI);
        const kickish = sup ? seg === 2 : atk.anim === "kick" && f.atk !== "hook";
        const lead: 1 | -1 = sup ? (seg === 1 ? -1 : 1) : f.atk === "cross" || f.atk === "rush" ? -1 : 1;
        fast = true;
        if (f.atk === "special") d = lerp3(GUARD, [0.12, 0.05, 1], Math.min(1, t / 0.18)); // both fists forward for the dash
        else if (f.atk === "hook") d = side === lead ? lerp3([1, 0.15, 0.05], [0.05, 0.1, 1], Math.max(0, thrust)) : GUARD;
        else if (kickish) d = [0.9, 0.15 + (f.atk === "air" ? 0.3 : 0), -0.3]; // arms out for balance
        else if (side === lead) d = lerp3(GUARD, f.atk === "low" ? [0.05, -0.35, 1] : [0.05, 0.12, 1], Math.max(0, thrust));
        else d = [-0.15, -0.1, 0.9]; // rear hand guards the chin
        break;
      }
      case "hit":
        d = [0.75, 0.45, -0.5];
        fast = true;
        break;
      case "down":
      case "ko":
        d = [0.95, 0.25, -0.1];
        break;
      case "victory":
        d = [0.3, 1, 0.1 + Math.sin(clock * 9 + side) * 0.25];
        break;
    }
    aimArm(bone, side, d, 1 - Math.exp(-dt * (fast ? 32 : 14)));
  }
}

export function Fighter({ def, index }: { def: FighterDef; index: 0 | 1 }) {
  const animEntries = useMemo(
    () => {
      const urls = (def.animUrls ?? {}) as Record<string, string | undefined>;
      return ([...MOVES, ...EXTRA] as Clip[]).filter((m) => urls[m]).map((m) => [m, urls[m]!] as const);
    },
    [def],
  );
  const gltfs = useGLTF([def.modelUrl, ...animEntries.map((e) => e[1])]);
  const base = gltfs[0];

  const { root, scale, yOffset, materials, legs, arms } = useMemo(() => {
    const root = cloneSkinned(base.scene) as THREE.Object3D;
    const materials: THREE.MeshStandardMaterial[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const cloned = mats.map((mt) => {
          const c = mt.clone();
          if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial) materials.push(c as THREE.MeshStandardMaterial);
          return c;
        });
        m.material = Array.isArray(m.material) ? cloned : cloned[0];
      }
    });
    // unrigged T-pose Lux3D mesh: give it shoulders so the arms can hold a guard and throw punches
    const arms = rigFreestyle(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const h = Math.max(0.01, box.max.y - box.min.y);
    const scale = TARGET_HEIGHT / h;
    return { root, scale, yOffset: -box.min.y * scale, materials, legs: findLegs(root), arms };
  }, [base]);

  // Clip table: separate Lux3D anim GLBs take priority, then clips embedded in the base model.
  const { mixer, actions } = useMemo(() => {
    const mixer = new THREE.AnimationMixer(root);
    const actions: Partial<Record<Clip, THREE.AnimationAction>> = {};
    animEntries.forEach(([move], i) => {
      const clip = gltfs[i + 1].animations[0];
      if (clip) actions[move] = mixer.clipAction(clip.clone(), root);
    });
    for (const m of [...MOVES, ...EXTRA] as Clip[]) {
      if (actions[m]) continue;
      const c = findClip(base.animations, m);
      if (c) actions[m] = mixer.clipAction(c, root);
    }
    for (const m of [...MOVES, ...EXTRA] as Clip[]) {
      const a = actions[m];
      if (!a) continue;
      if (!(LOOPING as Record<string, boolean>)[m]) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
    }
    return { mixer, actions };
  }, [root, base, gltfs, animEntries]);

  useEffect(() => () => void mixer.stopAllAction(), [mixer]);

  const group = useRef<THREE.Group>(null);
  const fx = useRef<THREE.Group>(null);
  const current = useRef<{ key: string | null; action: THREE.AnimationAction | null }>({ key: null, action: null });
  const now = useRef(0);
  const lastX = useRef(0);
  const bend = useRef(0);
  const wasAir = useRef(false);
  const landT = useRef(9);
  const matBase = useMemo(
    () => materials.map((m) => ({ emissive: m.emissive?.clone() ?? new THREE.Color(0), intensity: m.emissiveIntensity ?? 1, color: m.color.clone() })),
    [materials],
  );

  useFrame((_, dt) => {
    const f = sim.f[index];
    const g = group.current;
    const p = fx.current;
    if (!g || !p) return;
    const slow = sim.fx.hitstop > 0 ? 0 : sim.fx.slowmo;

    // ── clip selection (crossfade whenever the wanted clip / attack changes) ──
    const want = animFor(f);
    if (current.current.key !== want.key) {
      let clip: Clip = want.clip;
      let speed = 1;
      if (clip === "punch2" && !actions.punch2) {
        clip = "punch"; // no Punch_Cross clip: a faster jab reads as the cross
        speed = 1.3;
      }
      if (clip === "hit2" && !actions.hit2) clip = actions.ko ? "ko" : "hit"; // knockdown: Hit_Knockback, else fall with the KO clip
      const strike = f.state === "attack";
      const fallback: Clip | null = f.state === "walk" || f.state === "block" ? "idle" : strike || f.state === "hit" || f.state === "down" || f.state === "ko" ? null : "idle";
      const next = actions[clip] ?? (fallback ? actions[fallback] : undefined) ?? (strike || f.state === "hit" || f.state === "down" || f.state === "ko" ? null : actions.idle) ?? null;
      const prev = current.current.action;
      if (next) {
        next.reset();
        next.timeScale = want.dur ? (next.getClip().duration / want.dur) * speed : 1;
        next.fadeIn(strike ? 0.06 : 0.1).play();
        if (prev && prev !== next) prev.fadeOut(strike ? 0.06 : 0.1);
        current.current.action = next;
      }
      // no clip for this move: the previous pose stays under the procedural layer
      current.current.key = want.key;
    }
    // undo last frame's leg bend before the mixer runs (bones without a playing track would otherwise accumulate it)
    if (legs) [...legs.up, ...legs.knee].forEach((b, i) => b.quaternion.copy(legs.saved[i]));
    mixer.update(dt * slow);
    // ── crouch / jump: knee bend on rigged bodies (any rig with Mixamo leg names), squash for everything ──
    const air = f.y > 0.001;
    if (wasAir.current && !air) landT.current = 0;
    wasAir.current = air;
    landT.current += dt * slow;
    const tuck = air ? THREE.MathUtils.clamp(0.75 - f.vy * 0.12, 0.25, 0.9) : 0; // legs pull up near the apex
    const landing = landT.current < 0.14 ? Math.sin((landT.current / 0.14) * Math.PI) * 0.6 : 0;
    const bendTarget = Math.max(f.crouch ? 1 : 0, tuck, landing);
    bend.current += (bendTarget - bend.current) * (1 - Math.exp(-dt * 22));
    const c = bend.current;
    if (legs) {
      [...legs.up, ...legs.knee].forEach((b, i) => legs.saved[i].copy(b.quaternion));
      if (c > 0.001) {
        const a = 0.8 * c;
        for (const b of legs.up) b.quaternion.multiply(tmpQ.setFromAxisAngle(AX, legs.upSign * a));
        for (const b of legs.knee) b.quaternion.multiply(tmpQ.setFromAxisAngle(AX, legs.kneeSign * a * 1.9));
      }
    }

    // ── placement ──
    g.position.set(f.x, f.y, 0);
    g.rotation.y = f.facing === 1 ? Math.PI / 2 : -Math.PI / 2;

    // ── procedural layer (always subtle; full "freestyle" body language when the model has no clips) ──
    const t = f.stateT;
    const has = (m: Move) => !!actions[m];
    // Freestyle = unrigged Lux3D mesh (auto-rig refused it): no skeleton, so the whole body acts.
    const free = !has("idle") && !has("punch") && !has("walk");
    const clock = (now.current += dt * slow);
    const vel = (f.x - lastX.current) / Math.max(1e-4, dt);
    lastX.current = f.x;
    const fwdVel = vel * f.facing; // >0 = moving toward the opponent
    let z = 0, y = 0, rx = 0, ry = 0, rz = 0, sy = 1, sxz = 1;
    if (free) {
      // breathing + idle sway so a static mesh never looks frozen
      const br = Math.sin(clock * 2.6 + index * 1.7);
      sy = 1 + br * 0.03;
      sxz = 1 - br * 0.015;
      y = (br * 0.5 + 0.5) * 0.02;
      rz = Math.sin(clock * 1.3 + index) * 0.035;
      rx = THREE.MathUtils.clamp(fwdVel * 0.06, -0.15, 0.2); // lean into movement
    }
    switch (f.state) {
      case "walk":
        if (!has("walk")) {
          const step = Math.sin(t * 11);
          y = Math.abs(step) * (free ? 0.09 : 0.06);
          if (free) {
            rz = step * 0.09; // waddle
            sy = 1 - Math.abs(Math.cos(t * 11)) * 0.05; // squash on each footfall
            sxz = 1 + Math.abs(Math.cos(t * 11)) * 0.025;
          }
        }
        break;
      case "attack": {
        const atk = f.atk ? ATTACKS[f.atk] : ATTACKS.jab;
        const sup = f.atk === "super";
        // super: three beats (jab, cross, hook) inside one attack
        const seg = sup ? (t < 0.6 ? 0 : t < 0.9 ? 1 : 2) : -1;
        const segT = sup ? (seg === 0 ? t : seg === 1 ? t - 0.6 : t - 0.9) : t;
        const segDur = sup ? (seg === 2 ? 0.55 : 0.32) : atk.dur;
        const family = sup ? (seg === 2 ? "kick" : "punch") : atk.anim === "kick" ? "kick" : "punch";
        const clipName = sup ? (seg === 0 ? "punch" : seg === 1 ? "punch2" : "kick") : atk.anim;
        const hasClip = clipName === "punch2" ? has("punch") || !!actions.punch2 : has(clipName as Move);
        const u = Math.min(1, segT / segDur);
        const k = Math.sin(u * Math.PI);
        if (family === "punch") {
          if (free) {
            const wind = u < 0.25 ? Math.sin((u / 0.25) * Math.PI) : 0; // anticipation
            const thrust = u >= 0.25 ? Math.sin(((u - 0.25) / 0.75) * Math.PI) : 0;
            const side = clipName === "punch2" ? -1 : 1; // the cross twists the other way
            z = thrust * 0.45 - wind * 0.1;
            ry = side * (-thrust * 0.6 + wind * 0.25);
            rx = thrust * 0.2 - wind * 0.08;
            sy = 1 - wind * 0.1 - thrust * 0.08; // squash, then stretch toward the target
            sxz = 1 + wind * 0.06 + thrust * 0.12;
          } else {
            z = k * (hasClip ? 0.12 : 0.32);
            ry = hasClip ? 0 : -k * 0.5;
            rx = k * 0.12;
          }
        } else {
          z = k * (hasClip ? 0.15 : 0.42);
          rx = hasClip ? k * 0.1 : -k * 0.35;
          y = hasClip ? 0 : k * 0.18;
          ry = hasClip ? 0 : free ? k * 1.4 : k * 0.9; // freestyle: big twisting strike
          if (free) {
            sy = 1 + k * 0.1 - (u < 0.15 ? Math.sin((u / 0.15) * Math.PI) * 0.12 : 0);
            sxz = 1 - k * 0.04;
          }
        }
        if (f.atk === "special") {
          // dash-strike: crouch, then a long forward lean with a spin for freestyle meshes
          const lunge = Math.sin(Math.min(1, t / 0.45) * Math.PI);
          z += lunge * 0.35;
          rx += lunge * 0.25;
          if (free) ry += Math.min(1, t / 0.5) * Math.PI * 2;
        }
        if (sup) {
          const charge = t < 0.4 ? Math.sin((t / 0.4) * Math.PI) : 0;
          y += charge * 0.12;
          sy *= 1 + charge * 0.08;
          if (free && seg === 2) ry += u * Math.PI * 2;
        }
        break;
      }
      case "down": {
        // knockdown: fall back, lie, get up (procedural on top of Hit_Knockback / KO clip, full body for freestyle)
        const fall = Math.min(1, t / 0.35);
        const rise = t > 0.7 ? Math.min(1, (t - 0.7) / 0.3) : 0;
        const lie = (1 - Math.pow(1 - fall, 3)) * (1 - rise);
        const clipped = has("ko") || !!actions.hit2;
        rx = -lie * (clipped ? 0.25 : Math.PI / 2.2);
        z = -lie * 0.35;
        y = Math.sin(fall * Math.PI) * 0.25 * (1 - rise);
        if (free) {
          sy = 1 - lie * 0.12;
          sxz = 1 + lie * 0.06;
        }
        break;
      }
      case "block":
        rx = -0.14;
        sy = has("block") ? 1 : 0.94;
        ry = has("block") ? 0 : 0.35;
        if (free) {
          sy = 0.88;
          sxz = 1.06;
          rz = Math.sin(clock * 30) * 0.012; // bracing tremble
        }
        break;
      case "hit": {
        const k = Math.max(0, 1 - t / 0.3);
        rx = -k * (free ? 0.5 : 0.35);
        z = -k * (free ? 0.22 : 0.12);
        rz = Math.sin(t * 50) * k * (free ? 0.12 : 0.05);
        if (free) {
          sy = 1 - k * 0.16; // squashed by the impact, springs back
          sxz = 1 + k * 0.09;
        }
        break;
      }
      case "ko":
        if (!has("ko")) {
          const k = Math.min(1, t / 0.7);
          rx = -(1 - Math.pow(1 - k, 3)) * (Math.PI / 2);
          y = Math.sin(k * Math.PI) * 0.35;
          if (free) {
            const land = t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.35) : 0;
            sy = 1 - land * 0.2; // splat + rebound on landing
            sxz = 1 + land * 0.1;
            rz = 0;
          }
        }
        break;
      case "victory":
        if (!has("victory")) {
          const hop = Math.abs(Math.sin(t * 6));
          y = hop * 0.35;
          ry = t * 4;
          if (free) {
            sy = 1 + (hop - 0.5) * 0.14; // stretch in the air, squash on landing
            sxz = 1 - (hop - 0.5) * 0.06;
          }
        }
        break;
    }
    // vertical layer on top of every state: crouch lowers the body (hips drop by the bent legs on rigs, squash otherwise)
    if (c > 0.001) {
      const groundBend = air ? 0 : c;
      const drop = legs ? legs.len * scale * (1 - Math.cos(0.8 * groundBend)) : 0;
      y -= drop;
      sy *= 1 - groundBend * (legs ? 0.05 : 0.24);
      sxz *= 1 + groundBend * (legs ? 0.02 : 0.1);
      rx += groundBend * 0.14;
    }
    if (air) {
      // stretch on the way up, tuck at the apex; freestyle meshes tumble a little
      sy *= 1 + THREE.MathUtils.clamp(f.vy * 0.015, -0.05, 0.08);
      sxz *= 1 - THREE.MathUtils.clamp(f.vy * 0.007, -0.03, 0.04);
      if (free && f.state === "jump") rx += Math.sin(Math.min(1, f.stateT / 0.7) * Math.PI) * -0.5;
    }
    if (landing > 0 && !legs) {
      sy *= 1 - landing * 0.2;
      sxz *= 1 + landing * 0.08;
    }
    if (arms) aimFreestyleArms(arms, f, clock, dt * slow);
    const s = 1 - Math.exp(-dt * 30);
    p.position.z += (z - p.position.z) * s;
    p.position.y += (y - p.position.y) * s;
    p.rotation.x += (rx - p.rotation.x) * s;
    p.rotation.y += (ry - p.rotation.y) * s;
    p.rotation.z += (rz - p.rotation.z) * (free ? s : 1);
    p.scale.y += (sy - p.scale.y) * s;
    p.scale.x += (sxz - p.scale.x) * s;
    p.scale.z += (sxz - p.scale.z) * s;

    // ── hit flash ──
    // Brief warm tint: multiply albedo toward red and add a little red emissive. Never raise emissiveIntensity
    // (textured emissive maps + bloom blew fighters out into white ghosts) and restore exactly when it ends.
    const fl = Math.min(1, f.flash);
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      const b = matBase[i];
      if (fl <= 0.001) {
        if (!m.color.equals(b.color)) m.color.copy(b.color);
        if (m.emissive && !m.emissive.equals(b.emissive)) m.emissive.copy(b.emissive);
        m.emissiveIntensity = b.intensity;
        continue;
      }
      m.color.copy(b.color).multiply(tmpColor.setRGB(1, 1 - 0.65 * fl, 1 - 0.7 * fl));
      if (m.emissive) {
        m.emissive.copy(b.emissive).lerp(HIT_RED, (m.emissiveMap ? 0.25 : 0.45) * fl);
        m.emissiveIntensity = b.intensity;
      }
    }
  });

  return (
    <group ref={group}>
      <group ref={fx}>
        <primitive object={root} scale={scale} position-y={yOffset} />
      </group>
    </group>
  );
}
