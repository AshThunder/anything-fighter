// Robust bounds of a splat file (spz v2/v3 or binary ply) → percentiles per axis + suggested floor.
// Usage: node scripts/splat-bounds.mjs public/arenas/<id>/world.spz
import fs from "node:fs";
import zlib from "node:zlib";
const file = process.argv[2];
let pos; // Float32Array xyz
if (file.endsWith(".spz")) {
  const b = zlib.gunzipSync(fs.readFileSync(file));
  const magic = b.readUInt32LE(0), version = b.readUInt32LE(4), n = b.readUInt32LE(8), frac = b[13];
  if (magic !== 0x5053474e) throw new Error("not spz " + magic.toString(16));
  pos = new Float32Array(n * 3);
  if (version === 1) { for (let i = 0; i < n * 3; i++) pos[i] = b.readUInt16LE(16 + i * 2); /* half floats unsupported precisely */ }
  else {
    const s = 1 / (1 << frac);
    for (let i = 0; i < n * 3; i++) { const o = 16 + i * 3; let v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); if (v & 0x800000) v |= ~0xffffff; pos[i] = v * s; }
  }
  console.log({ version, n, frac });
} else {
  const buf = fs.readFileSync(file);
  const hEnd = buf.indexOf("end_header\n") + 11;
  const head = buf.slice(0, hEnd).toString();
  const n = +head.match(/element vertex (\d+)/)[1];
  const props = [...head.matchAll(/property (\w+) (\w+)/g)].map((m) => [m[1], m[2]]);
  const sz = { float: 4, double: 8, uchar: 1, int: 4, uint: 4, short: 2, ushort: 2 };
  const stride = props.reduce((a, [t]) => a + sz[t], 0);
  const off = (k) => props.slice(0, props.findIndex((p) => p[1] === k)).reduce((a, [t]) => a + sz[t], 0);
  const ox = off("x"), oy = off("y"), oz = off("z");
  pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const o = hEnd + i * stride; pos[i * 3] = buf.readFloatLE(o + ox); pos[i * 3 + 1] = buf.readFloatLE(o + oy); pos[i * 3 + 2] = buf.readFloatLE(o + oz); }
  console.log({ n });
}
const n = pos.length / 3;
for (const [ax, k] of [["x", 0], ["y", 1], ["z", 2]]) {
  const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = pos[i * 3 + k]; a.sort();
  const q = (p) => +a[Math.floor(p * (n - 1))].toFixed(3);
  console.log(ax, { p1: q(0.01), p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99) });
}
