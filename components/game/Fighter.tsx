"use client";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FighterDef } from "@/lib/fighters";
import { CLIP_CANDIDATES, LOOPING, MOVES, type Move } from "@/lib/moves";
import { ATTACKS, sim } from "@/lib/game/sim";

const TARGET_HEIGHT = 1.8;
const tmpColor = new THREE.Color();

function findClip(clips: THREE.AnimationClip[], move: Move): THREE.AnimationClip | undefined {
  for (const cand of CLIP_CANDIDATES[move]) {
    const exact = clips.find((c) => c.name === cand);
    if (exact) return exact;
  }
  for (const cand of CLIP_CANDIDATES[move]) {
    const c = clips.find((x) => x.name.toLowerCase().includes(cand.toLowerCase()));
    if (c) return c;
  }
  return undefined;
}

/** Rigged GLB fighter driven by sim.f[index]. Uses clips when available, procedural motion otherwise. */
export function Fighter({ def, index }: { def: FighterDef; index: 0 | 1 }) {
  const animEntries = useMemo(
    () => MOVES.filter((m) => def.animUrls?.[m]).map((m) => [m, def.animUrls![m]!] as const),
    [def],
  );
  const gltfs = useGLTF([def.modelUrl, ...animEntries.map((e) => e[1])]);
  const base = gltfs[0];

  const { root, scale, yOffset, materials } = useMemo(() => {
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
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const h = Math.max(0.01, box.max.y - box.min.y);
    const scale = TARGET_HEIGHT / h;
    return { root, scale, yOffset: -box.min.y * scale, materials };
  }, [base]);

  // Clip table: separate Lux3D anim GLBs take priority, then clips embedded in the base model.
  const { mixer, actions } = useMemo(() => {
    const mixer = new THREE.AnimationMixer(root);
    const actions: Partial<Record<Move, THREE.AnimationAction>> = {};
    animEntries.forEach(([move], i) => {
      const clip = gltfs[i + 1].animations[0];
      if (clip) actions[move] = mixer.clipAction(clip.clone(), root);
    });
    for (const m of MOVES) {
      if (actions[m]) continue;
      const c = findClip(base.animations, m);
      if (c) actions[m] = mixer.clipAction(c, root);
    }
    for (const m of MOVES) {
      const a = actions[m];
      if (!a) continue;
      if (!LOOPING[m]) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
    }
    return { mixer, actions };
  }, [root, base, gltfs, animEntries]);

  useEffect(() => () => void mixer.stopAllAction(), [mixer]);

  const group = useRef<THREE.Group>(null);
  const fx = useRef<THREE.Group>(null);
  const current = useRef<{ move: Move | null; action: THREE.AnimationAction | null }>({ move: null, action: null });
  const now = useRef(0);
  const lastX = useRef(0);
  const baseEmissive = useMemo(() => materials.map((m) => m.emissive?.clone() ?? new THREE.Color(0)), [materials]);

  useFrame((_, dt) => {
    const f = sim.f[index];
    const g = group.current;
    const p = fx.current;
    if (!g || !p) return;
    const slow = sim.fx.hitstop > 0 ? 0 : sim.fx.slowmo;

    // ── clip selection (crossfade on state change) ──
    const move: Move = f.state;
    if (current.current.move !== move) {
      const fallback: Move = move === "walk" || move === "block" ? "idle" : move;
      const next = actions[move] ?? (move === "hit" || move === "ko" || move === "punch" || move === "kick" ? undefined : actions[fallback]) ?? actions.idle ?? null;
      const prev = current.current.action;
      if (next && next !== prev) {
        next.reset();
        if (move === "punch" || move === "kick") next.timeScale = next.getClip().duration / ATTACKS[move].dur;
        else next.timeScale = 1;
        next.fadeIn(0.08).play();
        prev?.fadeOut(0.08);
        current.current.action = next;
      }
      current.current.move = move;
    }
    mixer.update(dt * slow);

    // ── placement ──
    g.position.set(f.x, 0, 0);
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
      case "punch": {
        const u = Math.min(1, t / ATTACKS.punch.dur);
        const k = Math.sin(u * Math.PI);
        if (free) {
          const wind = u < 0.25 ? Math.sin((u / 0.25) * Math.PI) : 0; // anticipation
          const thrust = u >= 0.25 ? Math.sin(((u - 0.25) / 0.75) * Math.PI) : 0;
          z = thrust * 0.45 - wind * 0.1;
          ry = -thrust * 0.6 + wind * 0.25;
          rx = thrust * 0.2 - wind * 0.08;
          sy = 1 - wind * 0.1 - thrust * 0.08; // squash, then stretch toward the target
          sxz = 1 + wind * 0.06 + thrust * 0.12;
        } else {
          z = k * (has("punch") ? 0.12 : 0.32);
          ry = has("punch") ? 0 : -k * 0.5;
          rx = k * 0.12;
        }
        break;
      }
      case "kick": {
        const u = Math.min(1, t / ATTACKS.kick.dur);
        const k = Math.sin(u * Math.PI);
        z = k * (has("kick") ? 0.15 : 0.42);
        rx = has("kick") ? k * 0.1 : -k * 0.35;
        y = has("kick") ? 0 : k * 0.18;
        ry = has("kick") ? 0 : free ? k * 1.4 : k * 0.9; // freestyle: big twisting strike
        if (free) {
          sy = 1 + k * 0.1 - (u < 0.15 ? Math.sin((u / 0.15) * Math.PI) * 0.12 : 0);
          sxz = 1 - k * 0.04;
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
    const fl = f.flash;
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (!m.emissive) continue;
      tmpColor.copy(baseEmissive[i]).lerp(new THREE.Color(1, 0.35, 0.1), fl);
      m.emissive.copy(tmpColor);
      m.emissiveIntensity = fl > 0 ? 1 + fl * 2 : 1;
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
