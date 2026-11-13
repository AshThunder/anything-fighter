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

/**
 * Side-on fighting-game camera: tracks the fighters' midpoint and zooms with their separation so BOTH stay
 * full-body in frame at any aspect ratio (portrait phones get a wider vertical FOV and a distance computed
 * from the horizontal FOV). Adds shake. Publishes pose + fov for the Aholo Viewer splat layer.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const smoothed = useRef({ x: 0, d: 6, init: false });
  useFrame((_, dt) => {
    const [a, b] = sim.f;
    const aspect = size.width / Math.max(1, size.height);
    const vfov = aspect < 0.8 ? 50 : aspect < 1.25 ? 45 : 40;
    if (camera.fov !== vfov) {
      camera.fov = vfov;
      camera.updateProjectionMatrix();
    }
    const tanV = Math.tan(THREE.MathUtils.degToRad(vfov / 2));
    const tanH = tanV * aspect;
    const mid = (a.x + b.x) / 2;
    const sep = Math.abs(a.x - b.x);
    const halfW = sep / 2 + 1.15; // fighter half-width + lunge/arm margin
    const dW = halfW / tanH;
    const dH = 1.3 / tanV; // ~2.6 m of vertical view minimum (full body + headroom)
    const targetD = THREE.MathUtils.clamp(Math.max(dW, dH, 5.2), 5.2, 16);
    const k = smoothed.current.init ? 1 - Math.exp(-dt * 4) : 1;
    smoothed.current.init = true;
    smoothed.current.x += (mid - smoothed.current.x) * k;
    // zoom out fast, in slowly, so a sudden step back never clips anyone
    const kd = targetD > smoothed.current.d ? Math.max(k, 1 - Math.exp(-dt * 10)) : k * 0.6;
    smoothed.current.d += (targetD - smoothed.current.d) * kd;
    const d = smoothed.current.d;
    const sh = sim.fx.shake * sim.fx.shake * 0.12;
    const jx = (Math.random() - 0.5) * sh;
    const jy = (Math.random() - 0.5) * sh;
    // slightly higher, looking a bit down, when far away (portrait) so the floor reads
    const camY = 1.35 + d * 0.06;
    camera.position.set(smoothed.current.x + jx, camY + jy, d);
    look.set(smoothed.current.x, 0.9, 0);
    camera.lookAt(look);
    sim.cam.pos = [camera.position.x, camera.position.y, camera.position.z];
    sim.cam.target = [look.x, look.y, look.z];
    sim.cam.fov = vfov;
  });
  return null;
}
