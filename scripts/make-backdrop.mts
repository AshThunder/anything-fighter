// Dark studio "cyclorama" (floor + 3 walls, inward-facing) as a RenderCloud backdrop mesh, so the default sky HDR is hidden.
import { Document, NodeIO } from "@gltf-transform/core";
const doc = new Document();
const buf = doc.createBuffer();
const W = 12, D = 12, H = 7; // metres (glTF Y-up); fighter stands at origin
const quads: { p: number[][]; c: [number, number, number, number] }[] = [];
const floorC: [number, number, number, number] = [0.09, 0.075, 0.06, 1];
const wallC: [number, number, number, number] = [0.05, 0.04, 0.035, 1];
// floor (normal +Y)
quads.push({ p: [[-W / 2, 0, -D / 2], [-W / 2, 0, D / 2], [W / 2, 0, D / 2], [W / 2, 0, -D / 2]], c: floorC });
// (no ceiling / front wall: let RenderCloud's environment light fill the fighter from above and the camera side)
if (process.env.CLOSED) quads.push({ p: [[-W / 2, H, -D / 2], [W / 2, H, -D / 2], [W / 2, H, D / 2], [-W / 2, H, D / 2]], c: wallC });
// back wall z=-D/2 (normal +Z)
quads.push({ p: [[-W / 2, 0, -D / 2], [W / 2, 0, -D / 2], [W / 2, H, -D / 2], [-W / 2, H, -D / 2]], c: wallC });
if (process.env.CLOSED) quads.push({ p: [[W / 2, 0, D / 2], [-W / 2, 0, D / 2], [-W / 2, H, D / 2], [W / 2, H, D / 2]], c: wallC });
// left x=-W/2 (normal +X)
quads.push({ p: [[-W / 2, 0, D / 2], [-W / 2, 0, -D / 2], [-W / 2, H, -D / 2], [-W / 2, H, D / 2]], c: wallC });
// right x=+W/2 (normal -X)
quads.push({ p: [[W / 2, 0, -D / 2], [W / 2, 0, D / 2], [W / 2, H, D / 2], [W / 2, H, -D / 2]], c: wallC });
const scene = doc.createScene();
const mesh = doc.createMesh("Backdrop");
for (const [i, q] of quads.entries()) {
  const mat = doc.createMaterial(`m${i}`).setBaseColorFactor(q.c).setRoughnessFactor(0.85).setMetallicFactor(0);
  const pos = new Float32Array(q.p.flat());
  const a = q.p[0], b = q.p[1], c = q.p[2];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n);
  const nor = new Float32Array([0, 1, 2, 3].flatMap(() => n.map((x) => x / l)));
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(nor).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buf))
    .setMaterial(mat);
  mesh.addPrimitive(prim);
}
scene.addChild(doc.createNode("Backdrop").setMesh(mesh));
await new NodeIO().write(process.argv[2] ?? "public/posters/backdrop.glb", doc);
console.log("ok");
