"use client";
/**
 * Arena abstraction. Every arena renders inside the R3F canvas EXCEPT the 3DGS splat arena, whose
 * pixels come from a separate Aholo Viewer canvas layered *behind* a transparent R3F canvas
 * (see AholoSplatLayer.tsx and README "Aholo Viewer + R3F").
 *
 *  kind: "stage" → built-in neon ring (placeholder)
 *  kind: "pano"  → SpatialGen world panorama (assets.imagery.panoUrl) as an equirect dome + floor
 *  kind: "splat" → Aholo Viewer 3DGS layer (SpatialGen splats / Aholo Reality room scan) + shadow-catcher floor
 */
import { useTexture } from "@react-three/drei";
import { Suspense } from "react";
import * as THREE from "three";
import type { ArenaSpec } from "@/lib/game/store";

export function Arena({ spec }: { spec: ArenaSpec }) {
  if (spec.kind === "pano" && spec.url) {
    return (
      <Suspense fallback={<StageArena />}>
        <PanoArena url={spec.url} />
      </Suspense>
    );
  }
  if (spec.kind === "splat") return <SplatFloor />;
  return <StageArena />;
}

const RING_POSTS: [number, number][] = [
  [-5.6, -2.2],
  [5.6, -2.2],
  [-5.6, 2.2],
  [5.6, 2.2],
];

export function StageArena() {
  return (
    <group>
      <color attach="background" args={["#0d0b09"]} />
      <fog attach="fog" args={["#0d0b09", 9, 26]} />
      {/* floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial color="#17130f" roughness={0.9} />
      </mesh>
      {/* ring platform */}
      <mesh position-y={-0.05} receiveShadow>
        <boxGeometry args={[11.6, 0.1, 4.8]} />
        <meshStandardMaterial color="#2a231c" roughness={0.6} metalness={0.1} />
      </mesh>
      <gridHelper args={[11.6, 24, "#3a3228", "#241e18"]} position-y={0.002} scale={[1, 1, 4.8 / 11.6]} />
      {/* neon edges */}
      {[-2.4, 2.4].map((z) => (
        <mesh key={z} position={[0, 0.02, z]}>
          <boxGeometry args={[11.6, 0.04, 0.05]} />
          <meshBasicMaterial color={[3.2, 1.3, 0.1]} toneMapped={false} />
        </mesh>
      ))}
      {RING_POSTS.map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0, z]}>
          <mesh position-y={0.7} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 1.4, 12]} />
            <meshStandardMaterial color="#3a3228" />
          </mesh>
          <mesh position-y={1.42}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial color={[3.2, 1.3, 0.1]} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* ropes */}
      {[0.6, 1.05].map((y) => (
        <mesh key={y} position={[0, y, -2.2]}>
          <boxGeometry args={[11.2, 0.03, 0.03]} />
          <meshStandardMaterial color="#f27f0d" emissive="#f27f0d" emissiveIntensity={0.6} />
        </mesh>
      ))}
      {/* backdrop monoliths */}
      {[-9, -4.5, 0, 4.5, 9].map((x, i) => (
        <mesh key={x} position={[x, 3 + (i % 2) * 1.2, -9]}>
          <boxGeometry args={[2.2, 6 + (i % 2) * 2.4, 0.4]} />
          <meshStandardMaterial color="#1d1813" emissive="#f27f0d" emissiveIntensity={0.04 + (i % 3) * 0.03} />
        </mesh>
      ))}
    </group>
  );
}

function PanoArena({ url }: { url: string }) {
  const tex = useTexture(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return (
    <group>
      <primitive attach="background" object={tex} />
      <primitive attach="environment" object={tex} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[7, 64]} />
        <shadowMaterial opacity={0.45} />
      </mesh>
    </group>
  );
}

/** Transparent shadow catcher so fighters stay grounded over the splat layer. */
function SplatFloor() {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[7, 64]} />
      <shadowMaterial opacity={0.5} />
    </mesh>
  );
}
