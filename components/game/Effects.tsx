"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { sim } from "@/lib/game/sim";
import { useGame } from "@/lib/game/store";

const SPARKS_PER_HIT = 14;
const MAX = 12 * SPARKS_PER_HIT;
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
      const k = s.t / (s.big ? 0.7 : 0.5);
      const spread = (s.big ? 1.9 : s.heavy ? 1.1 : 0.7) * (1 - Math.pow(1 - k, 3));
      for (const d of dirs) {
        if (n >= MAX) break;
        dummy.position.set(s.x + d.x * spread, s.y + d.y * spread, d.z * spread);
        dummy.scale.setScalar((1 - k) * (s.big ? 0.085 : s.heavy ? 0.05 : 0.035));
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

const TRAIL_GHOSTS = 6;

/**
 * Dash trail for the special / super: afterimages of the fighter's silhouette band in the fighter's own colour
 * (FighterDef.color, picked per forged Lux3D fighter), additive so the bloom pass makes them glow.
 */
export function DashTrails() {
  const fighters = useGame((s) => s.fighters);
  const groups = useRef<(THREE.Group | null)[]>([null, null]);
  const hist = useRef<number[][]>([[], []]);
  useFrame(() => {
    for (let i = 0; i < 2; i++) {
      const f = sim.f[i];
      const h = hist.current[i];
      h.unshift(f.x);
      if (h.length > TRAIL_GHOSTS * 2) h.length = TRAIL_GHOSTS * 2;
      const g = groups.current[i];
      if (!g) continue;
      g.children.forEach((c, j) => {
        const m = c as THREE.Mesh;
        const x = h[Math.min(h.length - 1, (j + 1) * 2)] ?? f.x;
        m.position.set(x, 0.95, -0.05);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = f.trail * 0.45 * (1 - j / TRAIL_GHOSTS);
        m.visible = f.trail > 0.02 && Math.abs(x - f.x) > 0.05;
      });
    }
  });
  if (!fighters) return null;
  return (
    <>
      {[0, 1].map((i) => (
        <group key={i} ref={(g) => void (groups.current[i] = g)}>
          {Array.from({ length: TRAIL_GHOSTS }, (_, j) => (
            <mesh key={j} visible={false}>
              <capsuleGeometry args={[0.28, 1.1, 4, 8]} />
              <meshBasicMaterial
                color={new THREE.Color(fighters[i].color).multiplyScalar(2.2)}
                transparent
                opacity={0}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

const look = new THREE.Vector3();

/** Portrait yaw: phones get a 3/4 view so the fight line is foreshortened and fighters can fill ~35–45% of the height. */
const PORTRAIT_YAW = THREE.MathUtils.degToRad(48);
/** Clear space beside each fighter's centre (body + guard + hit lean); the lunge happens inside the gap. */
const MARGIN_PORTRAIT = 0.6;
const MARGIN_WIDE = 1.15;

/**
 * Smallest camera distance (to the fighters' midpoint, along the view axis) at which both silhouettes fit the
 * horizontal FOV, plus the view rotation that centres them. With the 3/4 yaw the near fighter (P1) spans a wider
 * angle than the far one, so the frame is aimed a little toward P1 instead of at the midpoint.
 */
function fitYawed(s: number, m: number, cos: number, sin: number, halfH: number, lo: number, hi: number) {
  const lat = s * cos + m;
  const span = (d: number) => Math.atan(lat / Math.max(0.05, d - s * sin)) + Math.atan(lat / (d + s * sin));
  let a = lo, b = hi;
  if (span(a) > 2 * halfH) {
    for (let i = 0; i < 24; i++) {
      const c = (a + b) / 2;
      if (span(c) > 2 * halfH) a = c;
      else b = c;
    }
    a = b;
  }
  const off = (Math.atan(lat / Math.max(0.05, a - s * sin)) - Math.atan(lat / (a + s * sin))) / 2;
  return { d: a, off };
}

/**
 * Fighting-game camera: tracks the fighters and zooms with their separation so BOTH stay full-body in frame at
 * any aspect ratio. Landscape = classic side-on. Portrait phones (aspect < 0.8) swing to a 3/4 view (up to 48°
 * at 9:20) from P1's side: a side-on camera at a 0.45 aspect only sees ~1.8 m of width at the size where a
 * 1.8 m fighter is 45% of the screen, so the fight line has to recede into the scene. Portrait rounds also
 * start closer (sim.startHalf). Adds shake. Publishes pose + fov for the Aholo Viewer splat layer.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const smoothed = useRef({ x: 0, d: 6, yaw: 0, off: 0, init: false });
  useFrame((_, dt) => {
    const [a, b] = sim.f;
    const aspect = size.width / Math.max(1, size.height);
    const portrait = aspect < 0.8;
    sim.startHalf = portrait ? 0.95 : 1.6;
    const vfov = aspect < 0.8 ? 50 : aspect < 1.25 ? 45 : 40;
    if (camera.fov !== vfov) {
      camera.fov = vfov;
      camera.updateProjectionMatrix();
    }
    const tanV = Math.tan(THREE.MathUtils.degToRad(vfov / 2));
    const tanH = tanV * aspect;
    const yaw = PORTRAIT_YAW * THREE.MathUtils.clamp((0.8 - aspect) / 0.33, 0, 1);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const mid = (a.x + b.x) / 2;
    const s = Math.abs(a.x - b.x) / 2;
    const m = portrait ? MARGIN_PORTRAIT : MARGIN_WIDE;
    const minD = portrait ? 3.2 : 5.2;
    const fit = fitYawed(s, m, cos, sin, Math.atan(tanH) * 0.97, minD, 16);
    const dH = (portrait ? 1.12 : 1.3) / tanV + s * sin; // near fighter full body + headroom
    // SUPER cinematic: push in on the fighters while sim.fx.zoom is up
    const targetD = THREE.MathUtils.clamp(Math.max(fit.d, dH, minD), minD, 16) * (1 - 0.32 * sim.fx.zoom);
    const k = smoothed.current.init ? 1 - Math.exp(-dt * 6) : 1;
    if (!smoothed.current.init) smoothed.current.d = targetD;
    smoothed.current.init = true;
    smoothed.current.x += (mid - smoothed.current.x) * k;
    smoothed.current.yaw += (yaw - smoothed.current.yaw) * k;
    smoothed.current.off += (fit.off - smoothed.current.off) * k;
    // zoom out fast, in slowly, so a sudden step back never clips anyone
    const kd = targetD > smoothed.current.d ? Math.max(k, 1 - Math.exp(-dt * 12)) : k * 0.5;
    smoothed.current.d += (targetD - smoothed.current.d) * kd;
    const d = smoothed.current.d;
    const sh = sim.fx.shake * sim.fx.shake * 0.12;
    const jx = (Math.random() - 0.5) * sh;
    const jy = (Math.random() - 0.5) * sh;
    // slightly higher, looking a bit down, when far away so the floor reads
    const camY = (portrait ? 1.25 : 1.35) + d * 0.06;
    const cy = smoothed.current.yaw;
    // camera on P1's (−x) side when yawed, so the player's fighter is the near one
    const px = smoothed.current.x - Math.sin(cy) * d, pz = Math.cos(cy) * d;
    camera.position.set(px + jx, camY + jy, pz);
    // aim `off` radians toward P1 (to the left on screen) around the camera's vertical axis
    const dir = cy - smoothed.current.off; // heading like cy (0 = looking down −z; +angle turns right)
    const ty = portrait ? 0.92 : 0.9;
    look.set(px + Math.sin(dir) * d, ty, pz - Math.cos(dir) * d);
    camera.lookAt(look);
    sim.cam.pos = [camera.position.x, camera.position.y, camera.position.z];
    sim.cam.target = [look.x, look.y, look.z];
    sim.cam.fov = vfov;
    sim.cam.yaw = cy;
  });
  return null;
}
