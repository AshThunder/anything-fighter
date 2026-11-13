/**
 * Auto-placement for generated 3DGS worlds (SpatialGen / Reality .spz).
 *
 * Reads only positions + opacity from the SPZ, then:
 *   1. floor  = densest height band in the lower part of the up axis (3DGS floors are a thick sheet of splats),
 *   2. walkable footprint = occupancy grid of splats near the floor, closed to fill holes,
 *      → largest axis-aligned rectangle of floor (handles L-shaped rooms),
 *   3. the camera looks down the rectangle's LONG axis (depth behind the fighters), fight line runs across it,
 *      looking toward the denser end wall (more to see),
 *   4. scale (game metres per splat unit) so the camera (up to ~12 m back on portrait phones) stays inside the room
 *      and the fight line is ≥ ~8 m wide; fighters stand ~3 m in front of the far wall.
 * Output plugs into ArenaDef.origin/scale/yaw (+ half = clamp for the fight line).
 */
import { gunzipSync } from "node:zlib";

export interface SplatPlacement {
  origin: [number, number, number];
  scale: number;
  yaw: number;
  /** half-width of the walkable fight line, game metres */
  half: number;
}

type Up = "Z" | "Y" | "-Y";

export function decodeSpzPositions(gz: Buffer): { pos: Float32Array; alpha: Uint8Array; n: number } {
  const d = gunzipSync(gz);
  const magic = d.readUInt32LE(0);
  if (magic !== 0x5053474e) throw new Error("not an SPZ file");
  const version = d.readUInt32LE(4);
  const n = d.readUInt32LE(8);
  const fb = d.readUInt8(13);
  const pos = new Float32Array(n * 3);
  let o = 16;
  if (version === 1) {
    for (let i = 0; i < n * 3; i++) pos[i] = halfToFloat(d.readUInt16LE(o + i * 2));
    o += n * 6;
  } else {
    const s = 1 / (1 << fb);
    for (let i = 0; i < n * 3; i++) {
      let v = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      pos[i] = v * s;
      o += 3;
    }
  }
  const alpha = new Uint8Array(d.buffer, d.byteOffset + o, n);
  return { pos, alpha, n };
}

function halfToFloat(h: number) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

function pct(a: Float32Array | number[], p: number) {
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))))];
}

/** Convert a splat point to (h0, h1, u): two horizontal axes + up, all in splat units. */
function basis(up: Up) {
  // h0/h1/u indices and sign of u
  if (up === "Z") return { h0: 0, h1: 1, u: 2, us: 1 };
  if (up === "Y") return { h0: 0, h1: 2, u: 1, us: 1 };
  return { h0: 0, h1: 2, u: 1, us: -1 };
}

export function fitSplat(gz: Buffer, up: Up = "Z"): SplatPlacement {
  const { pos, alpha, n } = decodeSpzPositions(gz);
  const { h0, h1, u, us } = basis(up);
  const H0: number[] = [], H1: number[] = [], U: number[] = [];
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 77) continue; // opacity > 0.3
    H0.push(pos[i * 3 + h0]);
    H1.push(pos[i * 3 + h1]);
    U.push(us * pos[i * 3 + u]);
  }
  const Uf = Float32Array.from(U);
  const uLo = pct(Uf, 0.5), uHi = pct(Uf, 99);
  // 1. floor: densest 5 cm band in the lowest 40 % of the height range
  const bin = 0.05, top = uLo + 0.4 * (uHi - uLo);
  const nb = Math.max(1, Math.ceil((top - uLo) / bin));
  const hist = new Array(nb).fill(0);
  for (const v of U) if (v >= uLo && v < top) hist[Math.floor((v - uLo) / bin)]++;
  let best = 0;
  for (let i = 1; i < nb; i++) if (hist[i] > hist[best] * 1.0) best = i;
  // the floor is the bottom of that dense band (first bin ≥ 50 % of the peak below it)
  let fb = best;
  while (fb > 0 && hist[fb - 1] > hist[best] * 0.5) fb--;
  const floor = uLo + (fb + 0.5) * bin;
  const ceil = uHi;
  // 2. floor occupancy grid
  const a0 = pct(Float32Array.from(H0), 1), b0 = pct(Float32Array.from(H0), 99);
  const a1 = pct(Float32Array.from(H1), 1), b1 = pct(Float32Array.from(H1), 99);
  const cell = Math.max(0.08, Math.max(b0 - a0, b1 - a1) / 160);
  const W = Math.ceil((b0 - a0) / cell) + 1, Hh = Math.ceil((b1 - a1) / cell) + 1;
  const occ = new Uint16Array(W * Hh);
  const wall = new Uint16Array(W * Hh);
  for (let i = 0; i < U.length; i++) {
    const x = Math.floor((H0[i] - a0) / cell), y = Math.floor((H1[i] - a1) / cell);
    if (x < 0 || y < 0 || x >= W || y >= Hh) continue;
    if (Math.abs(U[i] - floor) < 0.15) occ[y * W + x]++;
    else if (U[i] > floor + 0.3) wall[y * W + x]++;
  }
  let g: Uint8Array = Uint8Array.from(occ, (c) => (c >= 2 ? 1 : 0));
  const r = 2;
  g = morph(g, W, Hh, r, true); // close: dilate then erode
  g = morph(g, W, Hh, r, false);
  g = morph(g, W, Hh, 1, false); // shave the ragged rim
  const rect = maxRect(g, W, Hh); // [x0, y0, x1, y1] inclusive cells
  const [x0, y0, x1, y1] = rect ?? [0, 0, W - 1, Hh - 1];
  const len0 = (x1 - x0 + 1) * cell, len1 = (y1 - y0 + 1) * cell;
  // 3. long axis = camera view direction
  const alongH0 = len0 >= len1;
  const L = Math.max(len0, len1), Wd = Math.min(len0, len1);
  // which end wall is denser (look toward it)
  const endDensity = (end: "lo" | "hi") => {
    let s = 0;
    const span = 4; // cells beyond the rectangle edge
    for (let y = 0; y < Hh; y++)
      for (let x = 0; x < W; x++) {
        const inCross = alongH0 ? y >= y0 && y <= y1 : x >= x0 && x <= x1;
        if (!inCross) continue;
        const t = alongH0 ? x : y;
        const lo = alongH0 ? x0 : y0, hi = alongH0 ? x1 : y1;
        if (end === "lo" ? t >= lo - span && t <= lo + span : t >= hi - span && t <= hi + span) s += wall[y * W + x];
      }
    return s;
  };
  const towardHi = endDensity("hi") >= endDensity("lo");
  // 4. scale + placement
  const scale = clamp(Math.max(17 / L, 8.5 / Wd), 0.8, 4); // >4× blows sparse scans up into blur
  const back = 3 / scale; // fighters 3 game-m in front of the far wall
  const c0 = a0 + ((x0 + x1 + 1) / 2) * cell, c1 = a1 + ((y0 + y1 + 1) / 2) * cell;
  let o0 = c0, o1 = c1;
  if (alongH0) o0 = (towardHi ? a0 + (x1 + 1) * cell - back : a0 + x0 * cell + back);
  else o1 = (towardHi ? a1 + (y1 + 1) * cell - back : a1 + y0 * cell + back);
  // forward (look) direction in splat horizontal coords
  const f0 = alongH0 ? (towardHi ? 1 : -1) : 0, f1 = alongH0 ? 0 : towardHi ? 1 : -1;
  // see AholoSplatLayer: game -Z maps to splat (h0,h1) = (-sin(-yaw), cos(-yaw)) for Z-up → yaw = atan2(f0, f1)
  const yaw = up === "Z" ? Math.atan2(f0, f1) : Math.atan2(f0, -f1);
  const origin: [number, number, number] = [0, 0, 0];
  origin[h0] = round(o0);
  origin[h1] = round(o1);
  origin[u] = round(us * floor);
  void ceil;
  return { origin, scale: round(scale), yaw: round(yaw), half: round(clamp((Wd * scale) / 2 - 0.9, 2.5, 5)) };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function morph(g: Uint8Array, W: number, H: number, r: number, dilate: boolean): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let dy = -r; dy <= r && (dilate ? !v : v); dy++)
        for (let dx = -r; dx <= r; dx++) {
          const X = x + dx, Y = y + dy;
          const c = X < 0 || Y < 0 || X >= W || Y >= H ? 0 : g[Y * W + X];
          if (dilate && c) { v = 1; break; }
          if (!dilate && !c) { v = 0; break; }
        }
      out[y * W + x] = v;
    }
  return out;
}

/** Largest all-ones axis-aligned rectangle (histogram-stack method). */
function maxRect(g: Uint8Array, W: number, H: number): [number, number, number, number] | null {
  const h = new Array(W).fill(0);
  let bestA = 0, best: [number, number, number, number] | null = null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) h[x] = g[y * W + x] ? h[x] + 1 : 0;
    const st: number[] = [];
    for (let x = 0; x <= W; x++) {
      const cur = x === W ? 0 : h[x];
      while (st.length && h[st[st.length - 1]] >= cur) {
        const top = st.pop()!;
        const height = h[top];
        const left = st.length ? st[st.length - 1] + 1 : 0;
        const area = height * (x - left);
        if (area > bestA && height > 0) {
          bestA = area;
          best = [left, y - height + 1, x - 1, y];
        }
      }
      st.push(x);
    }
  }
  return best;
}
