"use client";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * Offline image-based lighting (no HDR download): Lux3D meshes ship metallic-roughness PBR textures
 * (metallicFactor 1 × texture), which look flat/dark or blown-out without an environment map.
 */
export function StudioEnv({ intensity = 0.55 }: { intensity?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const prev = scene.environment;
    if (!prev) {
      scene.environment = env;
      scene.environmentIntensity = intensity;
    }
    return () => {
      if (scene.environment === env) scene.environment = prev;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}
