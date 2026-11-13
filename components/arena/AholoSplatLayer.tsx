"use client";
/**
 * Aholo Viewer (@manycore/aholo-viewer) 3DGS backdrop.
 *
 * Findings (v1.14.0): the viewer is its own WebGL engine (own canvas/context, own scene graph and math
 * classes; no dependency on three.js). It cannot render *into* the R3F/three WebGLRenderer, so it can't be a
 * child of <Canvas>. Integration = two stacked canvases: Aholo Viewer underneath, transparent R3F canvas on top,
 * with the Aholo camera synced every frame from sim.cam (written by CameraRig). Limitation: no shared depth
 * buffer → fighters always draw over the splats (fine for a backdrop arena; occluders in front of the fighters
 * would need mesh proxies in R3F).
 *
 * Coordinate mapping (game = three.js Y-up metres → splat space):
 *   1. rotate by -yaw around the game up axis, 2. divide by `scale` (game metres per splat unit),
 *   3. change basis: upAxis "Z" (Aholo World output, Z-up RH) → (x, -z, y); "-Y" (OpenCV samples) → (x, -y, -z); "Y" → same,
 *   4. add `origin` (the splat-space point that sits at the arena floor centre).
 */
import { useEffect, useRef, useState } from "react";
import { sim } from "@/lib/game/sim";

type Vec3 = [number, number, number];

const importStatic = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;

const ZERO: Vec3 = [0, 0, 0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AholoSplatLayer({
  urls,
  upAxis = "-Y",
  origin = ZERO,
  scale = 1,
  yaw = 0,
  onFail,
}: {
  /** tried in order (direct CDN URL, then same-origin proxy); each gets a retry */
  urls: string[];
  upAxis?: "Z" | "-Y" | "Y";
  origin?: Vec3;
  scale?: number;
  yaw?: number;
  /** every URL failed (or the viewer can't start on this device): caller swaps in a fallback backdrop */
  onFail?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);
  const key = urls.join("|");

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let destroy: (() => void) | undefined;
    (async () => {
      // Load the viewer as an untouched static ES module (public/vendor, copied by `npm run vendor`).
      // Bundling it through Turbopack breaks its Blob-URL module workers ("Error at n.onerror" on parse).
      const A = (await importStatic("/vendor/aholo-viewer/index.js")) as typeof import("@manycore/aholo-viewer");
      const el = ref.current;
      if (!el || disposed) return;
      const viewer = A.createViewer("arena-splat", el, { alpha: false, antialiasing: false });
      const cam = new A.PerspectiveCamera(sim.cam.fov, el.clientWidth / Math.max(1, el.clientHeight), 0.05, 500);
      if (upAxis === "Z") cam.up.set(0, 0, 1);
      else if (upAxis === "-Y") cam.up.set(0, -1, 0);
      else cam.up.set(0, 1, 0);
      viewer.setCamera(cam);
      A.setViewerConfig(viewer, {
        pipeline: {
          Background: {
            background: { active: A.BackgroundMode.BasicBackground, basic: { color: new A.Color(0.05, 0.043, 0.035) } },
            ground: { enabled: false },
          },
          Splatting: { enabled: true },
          TAA: { enabled: false },
        },
      });
      // Each URL gets two attempts (mobile networks drop big fetches); absolute URLs because the loader
      // fetches from a Blob-URL worker where relative paths don't resolve.
      let loaded = false;
      for (const url of key.split("|")) {
        const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
        const type =
          ext === "ply" ? A.SplatLoader.SplatFileType.PLY : ext === "spz" ? A.SplatLoader.SplatFileType.SPZ : A.SplatLoader.SplatFileType.SOG;
        for (let attempt = 0; attempt < 2 && !loaded && !disposed; attempt++) {
          try {
            const data = await A.SplatLoader.parseSplatData(type, new URL(url, window.location.href).href, A.SplatLoader.SplatPackType.Compressed);
            const splat = await A.SplatUtils.createSplat(data);
            if (disposed) return;
            viewer.getScene().add(splat);
            loaded = true;
          } catch (e) {
            console.warn(`[aholo-viewer] splat load failed (${url}, attempt ${attempt + 1})`, e);
            await sleep(800 * (attempt + 1));
          }
        }
        if (loaded) break;
      }
      if (disposed) return;
      setLoading(false);
      if (!loaded) {
        viewer.destroy();
        failRef.current?.();
        return;
      }
      const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
      const map = (v: Vec3) => {
        const x = (v[0] * cy + v[2] * sy) / scale, y = v[1] / scale, z = (-v[0] * sy + v[2] * cy) / scale;
        const b: Vec3 = upAxis === "Z" ? [x, -z, y] : upAxis === "-Y" ? [x, -y, -z] : [x, y, z];
        return new A.Vector3(b[0] + origin[0], b[1] + origin[1], b[2] + origin[2]);
      };
      const tick = () => {
        const w = el.clientWidth, h = el.clientHeight;
        cam.aspect = w / Math.max(1, h);
        cam.fov = sim.cam.fov;
        cam.updateProjectionMatrix?.();
        const p = map(sim.cam.pos);
        cam.position.set(p.x, p.y, p.z);
        cam.lookAt(map(sim.cam.target));
        viewer.render();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      const onResize = () => viewer.resize();
      window.addEventListener("resize", onResize);
      destroy = () => {
        window.removeEventListener("resize", onResize);
        viewer.destroy();
      };
    })().catch((e) => {
      console.warn("[aholo-viewer] viewer failed", e);
      if (!disposed) {
        setLoading(false);
        failRef.current?.();
      }
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      destroy?.();
    };
  }, [key, upAxis, origin, scale, yaw]);

  return (
    <div className="absolute inset-0">
      <div ref={ref} className="absolute inset-0" />
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center font-arcade text-xs tracking-widest text-orange-200/60 animate-pulse">
          Loading arena…
        </div>
      )}
    </div>
  );
}
