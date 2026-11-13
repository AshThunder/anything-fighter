"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { sim } from "@/lib/game/sim";

const SPARKS_PER_HIT = 14;
const MAX = 8 * SPARKS_PER_HIT;
const dummy = new THREE.Object3D();

/** Instanced hit sparks (bright, un-tonemapped → picked up by bloom). */
export function HitSparks() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dirs = useMemo(
    () =>
      Array.from({ length: SPARKS_PER_HIT }, (_, i) => {
        const a = (i / SPARKS_PER_HIT) * Math.PI * 2 + Math.random() * 0.4;
        return new THREE.Vector3(Math.cos(a), Math.sin(a), (Math.random() - 0.5) * 0.6).normalize();
      }),
    [],
  );
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    let n = 0;
    for (const s of sim.fx.sparks) {
      const k = s.t / 0.5;
      const spread = (s.heavy ? 1.1 : 0.7) * (1 - Math.pow(1 - k, 3));
      for (const d of dirs) {
        if (n >= MAX) break;
        dummy.position.set(s.x + d.x * spread, s.y + d.y * spread, d.z * spread);
        dummy.scale.setScalar((1 - k) * (s.heavy ? 0.05 : 0.035));
        dummy.updateMatrix();
        m.setMatrixAt(n++, dummy.matrix);
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color={[5, 2, 0.4]} toneMapped={false} />
    </instancedMesh>
  );
}

const look = new THREE.Vector3();

/** Side-on fighting-game camera: frames both fighters, adds shake. Publishes pose for the splat layer. */
export function CameraRig() {
  const { camera } = useThree();
  const smoothed = useRef({ x: 0, d: 5.5 });
  useFrame((_, dt) => {
    const [a, b] = sim.f;
    const mid = (a.x + b.x) / 2;
    const sep = Math.abs(a.x - b.x);
    const targetD = THREE.MathUtils.clamp(4.4 + sep * 0.9, 5.6, 10);
    const k = 1 - Math.exp(-dt * 4);
    smoothed.current.x += (mid - smoothed.current.x) * k;
    smoothed.current.d += (targetD - smoothed.current.d) * k;
    const sh = sim.fx.shake * sim.fx.shake * 0.12;
    const jx = (Math.random() - 0.5) * sh;
    const jy = (Math.random() - 0.5) * sh;
    camera.position.set(smoothed.current.x + jx, 1.45 + jy, smoothed.current.d);
    look.set(smoothed.current.x, 0.95, 0);
    camera.lookAt(look);
    sim.cam.pos = [camera.position.x, camera.position.y, camera.position.z];
    sim.cam.target = [look.x, look.y, look.z];
  });
  return null;
}
