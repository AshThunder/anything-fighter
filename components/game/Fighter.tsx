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

    // ── procedural layer (always subtle; stronger when no dedicated clip exists) ──
    const t = f.stateT;
    const has = (m: Move) => !!actions[m];
    let z = 0, y = 0, rx = 0, ry = 0, rz = 0, sy = 1;
    switch (f.state) {
      case "walk":
        if (!has("walk")) y = Math.abs(Math.sin(t * 10)) * 0.06;
        break;
      case "punch": {
        const k = Math.sin(Math.min(1, t / ATTACKS.punch.dur) * Math.PI);
        z = k * (has("punch") ? 0.12 : 0.32);
        ry = has("punch") ? 0 : -k * 0.5;
        rx = k * 0.12;
        break;
      }
      case "kick": {
        const k = Math.sin(Math.min(1, t / ATTACKS.kick.dur) * Math.PI);
        z = k * (has("kick") ? 0.15 : 0.42);
        rx = has("kick") ? k * 0.1 : -k * 0.35;
        y = has("kick") ? 0 : k * 0.18;
        ry = has("kick") ? 0 : k * 0.9;
        break;
      }
      case "block":
        rx = -0.14;
        sy = has("block") ? 1 : 0.94;
        ry = has("block") ? 0 : 0.35;
        break;
      case "hit": {
        const k = Math.max(0, 1 - t / 0.3);
        rx = -k * 0.35;
        z = -k * 0.12;
        rz = Math.sin(t * 50) * k * 0.05;
        break;
      }
      case "ko":
        if (!has("ko")) {
          const k = Math.min(1, t / 0.7);
          rx = -(1 - Math.pow(1 - k, 3)) * (Math.PI / 2);
          y = Math.sin(k * Math.PI) * 0.35;
        }
        break;
      case "victory":
        if (!has("victory")) {
          y = Math.abs(Math.sin(t * 6)) * 0.35;
          ry = t * 4;
        }
        break;
    }
    const s = 1 - Math.exp(-dt * 30);
    p.position.z += (z - p.position.z) * s;
    p.position.y += (y - p.position.y) * s;
    p.rotation.x += (rx - p.rotation.x) * s;
    p.rotation.y += (ry - p.rotation.y) * s;
    p.rotation.z = rz;
    p.scale.y += (sy - p.scale.y) * s;

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
