"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, useGLTF } from "@react-three/drei";
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FighterDef } from "@/lib/fighters";
import { CLIP_CANDIDATES } from "@/lib/moves";
import { StudioEnv } from "@/components/game/StudioEnv";

function Model({ def, x, dir, spin = false }: { def: FighterDef; x: number; dir: 1 | -1; spin?: boolean }) {
  const idleUrl = def.animUrls?.idle;
  const [g, ig] = useGLTF([def.modelUrl, idleUrl ?? def.modelUrl]);
  const { root, scale, y, mixer } = useMemo(() => {
    const root = cloneSkinned(g.scene);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const h = Math.max(0.01, box.max.y - box.min.y);
    const scale = 1.7 / h;
    const mixer = new THREE.AnimationMixer(root);
    const clip = (idleUrl ? ig.animations[0] : undefined) ??
      CLIP_CANDIDATES.idle.map((n) => g.animations.find((c) => c.name.toLowerCase().includes(n.toLowerCase()))).find(Boolean) ??
      g.animations[0];
    if (clip) mixer.clipAction(clip).play();
    return { root, scale, y: -box.min.y * scale, mixer };
  }, [g, ig, idleUrl]);
  const ref = useRef<THREE.Group>(null);
  useFrame((s, dt) => {
    mixer.update(dt);
    if (ref.current) ref.current.rotation.y = spin ? s.clock.elapsedTime * 0.7 : dir * 0.6 + Math.sin(s.clock.elapsedTime * 0.6) * 0.15;
  });
  return (
    <group ref={ref} position-x={x}>
      <primitive object={root} scale={scale} position-y={y} />
    </group>
  );
}

/** Keep both fighters in frame on tall/narrow (phone) canvases: back the camera off as the aspect shrinks. */
function FitCamera({ solo }: { solo: boolean }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const want = solo ? 0.75 : 1.25;
  useLayoutEffect(() => {
    const z = 4.6 * Math.max(1, want / aspect);
    camera.position.set(0, 1.15 + (z - 4.6) * 0.06, z);
    camera.lookAt(0, 0.9, 0);
  }, [camera, aspect, want]);
  return null;
}

export default function VersusPreview({ a, b, solo = false }: { a?: FighterDef; b?: FighterDef; solo?: boolean }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 1.3, 4.6], fov: 38 }} gl={{ antialias: true, alpha: true }}>
      <FitCamera solo={solo} />
      <StudioEnv />
      <hemisphereLight args={["#ffe8cc", "#1a1410", 1.1]} />
      <directionalLight position={[2, 5, 3]} intensity={2} />
      <pointLight position={[-2.5, 1.5, 1.5]} color="#f27f0d" intensity={8} />
      <pointLight position={[2.5, 1.5, 1.5]} color="#38bdf8" intensity={8} />
      <Suspense fallback={null}>
        {a && <Model key={`a-${a.id}`} def={a} x={solo ? 0 : -1.05} dir={1} spin={solo} />}
        {b && <Model key={`b-${b.id}`} def={b} x={1.05} dir={-1} />}
      </Suspense>
      <ContactShadows position-y={0} opacity={0.6} scale={8} blur={2.2} far={3} />
    </Canvas>
  );
}
