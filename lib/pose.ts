/**
 * Bake one frame of a Lux3D retarget GLB (full mesh + skin + clip, i.e. anim-*.orig.glb) into a static,
 * unskinned, posed GLB (feet at y=0, centred, height = targetH m). Used for RenderCloud posters (its mesh
 * ingest has no skinning/animation) and as a LuxReal upload.
 */
import { NodeIO, type Node } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";

type M = number[];
const mul = (a: M, b: M): M => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const xf = (m: M, v: number[], w: number) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);

export async function bakePose(src: string, out: string, frac = 0.5, targetH = 1.8) {
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const anim = root.listAnimations()[0];
if (anim) {
  let tMax = 0;
  for (const s of anim.listSamplers()) tMax = Math.max(tMax, s.getInput()!.getMax([0])[0]);
  const t = tMax * frac;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode()!;
    const s = ch.getSampler()!;
    const inp = s.getInput()!.getArray()!, outA = s.getOutput()!.getArray()!;
    const n = s.getOutput()!.getElementSize();
    let i = 0;
    while (i < inp.length - 2 && inp[i + 1] < t) i++;
    const a = Math.min(1, Math.max(0, (t - inp[i]) / Math.max(1e-6, inp[i + 1] - inp[i])));
    const v = Array.from({ length: n }, (_, k) => outA[i * n + k] * (1 - a) + outA[Math.min(i + 1, inp.length - 1) * n + k] * a);
    const path = ch.getTargetPath();
    if (path === "rotation") {
      const l = Math.hypot(...v);
      node.setRotation(v.map((x) => x / l) as [number, number, number, number]);
    } else if (path === "translation") node.setTranslation(v as [number, number, number]);
    else if (path === "scale") node.setScale(v as [number, number, number]);
  }
}
const scene = root.listScenes()[0];
const baked: Node[] = [];
for (const node of root.listNodes()) {
  const skin = node.getSkin();
  const mesh = node.getMesh();
  if (!skin || !mesh) continue;
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices()!;
  const jm = joints.map((j, i) => mul(j.getWorldMatrix() as M, Array.from(ibm.getElement(i, []))));
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute("POSITION")!, N = prim.getAttribute("NORMAL");
    const J = prim.getAttribute("JOINTS_0")!, W = prim.getAttribute("WEIGHTS_0")!;
    const pos = new Float32Array(P.getCount() * 3), nor = N ? new Float32Array(N.getCount() * 3) : null;
    const p: number[] = [], nn: number[] = [], j: number[] = [], w: number[] = [];
    for (let v = 0; v < P.getCount(); v++) {
      P.getElement(v, p); J.getElement(v, j); W.getElement(v, w);
      const acc = [0, 0, 0], accN = [0, 0, 0];
      if (N) N.getElement(v, nn);
      for (let k = 0; k < 4; k++) {
        if (!w[k]) continue;
        const r = xf(jm[j[k]], p, 1);
        acc[0] += r[0] * w[k]; acc[1] += r[1] * w[k]; acc[2] += r[2] * w[k];
        if (N) { const rn = xf(jm[j[k]], nn, 0); accN[0] += rn[0] * w[k]; accN[1] += rn[1] * w[k]; accN[2] += rn[2] * w[k]; }
      }
      pos.set(acc, v * 3);
      if (nor) { const l = Math.hypot(...accN) || 1; nor.set(accN.map((x) => x / l), v * 3); }
    }
    prim.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(P.getBuffer()));
    if (N && nor) prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(nor).setBuffer(N.getBuffer()));
    prim.setAttribute("JOINTS_0", null);
    prim.setAttribute("WEIGHTS_0", null);
  }
  const fresh = doc.createNode(node.getName() || "posed").setMesh(mesh);
  baked.push(fresh);
  node.setMesh(null).setSkin(null);
}
for (const a of root.listAnimations()) a.dispose();
for (const s of root.listSkins()) s.dispose();
for (const c of scene.listChildren()) scene.removeChild(c);
for (const b of baked) scene.addChild(b);
await doc.transform(prune());
// normalise: feet on y=0, centred in x/z, height = TARGET_H metres (default 1.8)
{
  const H = targetH;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const m of root.listMeshes()) for (const pr of m.listPrimitives()) { const P = pr.getAttribute("POSITION")!; const a = P.getMin([]), b = P.getMax([]); mn = mn.map((x, i) => Math.min(x, a[i])); mx = mx.map((x, i) => Math.max(x, b[i])); }
  const k = H / (mx[1] - mn[1]), cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  const seen = new Set();
  for (const m of root.listMeshes()) for (const pr of m.listPrimitives()) {
    const P = pr.getAttribute("POSITION")!;
    if (seen.has(P)) continue; seen.add(P);
    const arr = P.getArray()!;
    for (let i = 0; i < arr.length; i += 3) { arr[i] = (arr[i] - cx) * k; arr[i + 1] = (arr[i + 1] - mn[1]) * k; arr[i + 2] = (arr[i + 2] - cz) * k; }
    P.setArray(arr);
  }
}
// report bounds
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (const m of root.listMeshes()) for (const pr of m.listPrimitives()) { const P = pr.getAttribute("POSITION")!; const a = P.getMin([]), b = P.getMax([]); min = min.map((x, i) => Math.min(x, a[i])); max = max.map((x, i) => Math.max(x, b[i])); }
await io.write(out, doc);
return { min, max };
}
