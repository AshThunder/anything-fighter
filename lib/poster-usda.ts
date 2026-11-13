/**
 * RenderCloud OpenUSD (USDA) scene for a fighter poster. RenderCloud conventions: Z-up, 1 unit = 1 mm,
 * USD row-vector matrices (translation in the 4th row). Mesh ingest (mesh-upload-process) converts a
 * metres/Y-up GLB into mm/Z-up and centres its bbox on the origin, so a 1.8 m fighter spans z = −900…900.
 */
export interface PosterScene {
  meshId: string;
  width?: number;
  height?: number;
  /** fighter yaw in degrees (negative = turn to camera-left) */
  yawDeg?: number;
  /** half the fighter height in mm (lift so feet touch z=0) */
  lift?: number;
  key?: number;
  rim?: number;
  gi?: number;
  rimA?: [number, number, number];
  rimB?: [number, number, number];
  camDist?: number;
  camHeight?: number;
  /** extra static meshes (e.g. the studio backdrop box), each an ingested mesh id + USD matrix */
  extras?: { id: string; matrix: string }[];
  /** optional 3DGS backdrop (ingested splat id) + its placement matrix rows */
  splat?: { id: string; matrix: string };
}

const f = (n: number) => Number(n.toFixed(5));
type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V): V => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** USD row-vector matrix for a prim at `pos` whose local −Z (light emission / camera view) points at `target` (Z-up). */
export function lookAt(pos: V, target: V): string {
  const z = norm(sub(pos, target));
  const x = norm(cross([0, 0, 1], z));
  const y = cross(z, x);
  const r = (v: number[]) => `(${v.map(f).join(", ")})`;
  return `(${r([...x, 0])}, ${r([...y, 0])}, ${r([...z, 0])}, ${r([...pos, 1])})`;
}

export function buildPosterUsda(s: PosterScene): string {
  const W = s.width ?? 1080, H = s.height ?? 1350;
  const yaw = ((s.yawDeg ?? -25) * Math.PI) / 180;
  const c = f(Math.cos(yaw)), sn = f(Math.sin(yaw));
  const lift = s.lift ?? 900;
  const camD = s.camDist ?? 4200, camH = s.camHeight ?? 1000;
  const [ra, rb] = [s.rimA ?? [1, 0.45, 0.05], s.rimB ?? [0.2, 0.6, 1]];
  const gi = s.gi ?? 0.35;
  return `#usda 1.0
(
    defaultPrim = "World"
)

def Xform "World"
{
    def Xform "Fighter"
    {
        matrix4d xformOp:transform = ((${c}, ${sn}, 0, 0), (${-sn}, ${c}, 0, 0), (0, 0, 1, 0), (0, 0, ${lift}, 1))
        uniform token[] xformOpOrder = ["xformOp:transform"]
        def Mesh "Geom" (
            payload = @manycore:/mesh/${s.meshId}@</mesh>
        ) {}
    }
${(s.extras ?? [])
  .map(
    (e, i) => `    def Xform "Extra${i}"
    {
        matrix4d xformOp:transform = ${e.matrix}
        uniform token[] xformOpOrder = ["xformOp:transform"]
        def Mesh "Geom" (
            payload = @manycore:/mesh/${e.id}@</mesh>
        ) {}
    }
`,
  )
  .join("")}${
  s.splat
    ? `    def Xform "Arena"
    {
        matrix4d xformOp:transform = ${s.splat.matrix}
        uniform token[] xformOpOrder = ["xformOp:transform"]
        def ParticleField3DGaussianSplat "Splat" (
            payload = @manycore:/mesh/${s.splat.id}@</GaussianSplatData>
        ) {}
    }
`
    : ""
}    def Xform "Cameras"
    {
        def Camera "MainCamera"
        {
            float2 clippingRange = (10, 200000)
            float focalLength = 50
            float fStop = 0
            float horizontalAperture = 24
            float verticalAperture = ${f((24 * H) / W)}
            token projection = "perspective"
            matrix4d xformOp:transform = ((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, ${-camD}, ${camH}, 1))
            uniform token[] xformOpOrder = ["xformOp:transform"]
        }
    }
    def Xform "Lights"
    {
        def RectLight "Key"
        {
            float inputs:width = 1500
            float inputs:height = 1500
            color3f inputs:color = (1, 0.92, 0.85)
            float inputs:intensity = ${s.key ?? 60}
            matrix4d xformOp:transform = ${lookAt([2200, -2600, 2600], [0, 0, 1100])}
            uniform token[] xformOpOrder = ["xformOp:transform"]
        }
        def SphereLight "RimA"
        {
            float inputs:radius = 150
            color3f inputs:color = (${ra.join(", ")})
            float inputs:intensity = ${s.rim ?? 1200}
            matrix4d xformOp:transform = ((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (-1600, 1000, 2000, 1))
            uniform token[] xformOpOrder = ["xformOp:transform"]
        }
        def SphereLight "RimB"
        {
            float inputs:radius = 150
            color3f inputs:color = (${rb.join(", ")})
            float inputs:intensity = ${s.rim ?? 1200}
            matrix4d xformOp:transform = ((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (1600, 1000, 1600, 1))
            uniform token[] xformOpOrder = ["xformOp:transform"]
        }
    }
}

def Scope "Render"
{
    def RenderSettings "MainRenderSettings"
    {
        rel camera = </World/Cameras/MainCamera>
        int2 resolution = (${W}, ${H})
        custom float3 manycore:environment:giIntensity = (${gi}, ${gi}, ${gi})
    }
}
`;
}

/** Studio backdrop box (scripts/make-backdrop.mts: 12×12×7 m). Its ingest kept metre units, so scale ×1000 and lift. */
export const BACKDROP = { id: "Y3EKWZBVAJASIPTULE888888", matrix: "((1000, 0, 0, 0), (0, 1000, 0, 0), (0, 0, 1000, 0), (0, 0, 3500, 1))" };
