/**
 * Zero-credit "arms" for freestyle fighters. Lux3D meshes that Aholo's auto-rig refused come as a static T-pose.
 * At load we detect that pose (arms out sideways), bake every mesh into the model's space, and turn them into
 * SkinnedMeshes driven by a tiny 3-bone skeleton (root + one bone per shoulder) with smooth weights from the
 * lateral distance. Fighter.tsx then aims each arm procedurally: guard down-forward, jab/cross forward, block up,
 * victory raised, so the body never reads as a T-pose. Nothing is uploaded or generated.
 */
import * as THREE from "three";

export interface FreestyleArms {
  /** +1 = model +X side, -1 = -X side */
  bones: { side: 1 | -1; bone: THREE.Bone }[];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function rigFreestyle(root: THREE.Object3D): FreestyleArms | null {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  let hasBones = false;
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone || (o as THREE.SkinnedMesh).isSkinnedMesh) hasBones = true;
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (hasBones || !meshes.length) return null;
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  // positions in root space
  const geos = meshes.map((m) => {
    const g = (m.geometry as THREE.BufferGeometry).clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    return g;
  });
  const box = new THREE.Box3();
  for (const g of geos) {
    g.computeBoundingBox();
    box.union(g.boundingBox!);
  }
  const H = box.max.y - box.min.y;
  const W = box.max.x - box.min.x;
  const cx = (box.max.x + box.min.x) / 2;
  if (H <= 0 || W < 0.7 * H) return null; // not arms-out: leave the mesh alone
  // chest half-width (band under the arms) and the arm line height (centroid of the outer third)
  let torso = 0, armY = 0, armN = 0;
  const v = new THREE.Vector3();
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const hy = (v.y - box.min.y) / H;
      const ax = Math.abs(v.x - cx);
      if (hy > 0.5 && hy < 0.64) torso = Math.max(torso, ax);
      if (ax > 0.32 * W) {
        armY += v.y;
        armN++;
      }
    }
  }
  if (!armN || torso <= 0 || torso > 0.35 * W) return null;
  armY /= armN;
  const pivot = torso * 0.92;
  const rootBone = new THREE.Bone();
  const bones: FreestyleArms["bones"] = [];
  for (const side of [1, -1] as const) {
    const b = new THREE.Bone();
    b.position.set(cx + side * pivot, armY, 0);
    rootBone.add(b);
    bones.push({ side, bone: b });
  }
  root.add(rootBone);
  rootBone.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([rootBone, bones[0].bone, bones[1].bone]);
  meshes.forEach((m, k) => {
    const g = geos[k];
    const p = g.attributes.position as THREE.BufferAttribute;
    const idx = new Uint16Array(p.count * 4);
    const wts = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const dx = v.x - cx;
      const w = smooth(torso * 0.7, torso * 1.25, Math.abs(dx)) * smooth(armY - 0.26 * H, armY - 0.12 * H, v.y);
      idx[i * 4] = dx >= 0 ? 1 : 2;
      idx[i * 4 + 1] = 0;
      wts[i * 4] = w;
      wts[i * 4 + 1] = 1 - w;
    }
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wts, 4));
    const sm = new THREE.SkinnedMesh(g, m.material);
    sm.name = m.name;
    sm.castShadow = m.castShadow;
    sm.frustumCulled = false;
    root.add(sm);
    sm.updateMatrixWorld(true);
    sm.bind(skeleton);
    m.parent?.remove(m);
  });
  // start in the guard (arms down-forward) so not even the first frame shows the T-pose
  for (const { side, bone } of bones) aimArm(bone, side, [0.22, -0.8, 0.55], 1);
  root.updateMatrixWorld(true);
  return { bones };
}

const REST = new THREE.Vector3();
const DIR = new THREE.Vector3();
const Q = new THREE.Quaternion();
/** Aim one arm (rest = pointing along ±X) toward `dir` (model space: +Z = toward the opponent, +Y up), smoothed. */
export function aimArm(bone: THREE.Bone, side: 1 | -1, dir: [number, number, number], k: number) {
  REST.set(side, 0, 0);
  DIR.set(dir[0] * side, dir[1], dir[2]).normalize();
  Q.setFromUnitVectors(REST, DIR);
  bone.quaternion.slerp(Q, k);
}
