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
 *   1. rotate by (camYaw - yaw) around the game up axis, 2. divide by `scale` (game metres per splat unit),
 *   3. change basis: upAxis "Z" (Aholo World output, Z-up RH) → (x, -z, y); "-Y" (OpenCV samples) → (x, -y, -z); "Y" → same,
 *   4. add `origin` (the splat-space point that sits at the arena floor centre).
 *
 * Never-black guarantees (Android black-arena bug, 13 Nov 2026): every await has a hard timeout, the viewer
 * canvas is watched for `webglcontextlost`, and a pixel watchdog samples the rendered frame after load; a blank
 * (background-only) frame, a lost context, a render exception or a timeout all call `onFail`, and the caller
 * swaps in the panorama or Neon Ring. While loading, the world's panorama shows as a CSS backdrop.
 */
import { useEffect, useRef, useState } from "react";
import { sim } from "@/lib/game/sim";

type Vec3 = [number, number, number];

const importStatic = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;

const ZERO: Vec3 = [0, 0, 0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reject if `p` hasn't settled within `ms` (the viewer's worker can hang silently on some GPUs/browsers). */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Phones/tablets: cap render resolution (fill rate + GPU memory are what kill mobile WebGL contexts). */
export function isMobileGPU() {
  if (typeof window === "undefined") return false;
  return !!window.matchMedia?.("(pointer: coarse)").matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

const VIEWER_IMPORT_MS = 15_000;
const ATTEMPT_MS = 30_000; // one parse+upload (5–6 MB SPZ on a slow cellular link)
const TOTAL_MS = 60_000; // whole load budget, all URLs and retries
// Pixel checks after the splat is added. The first sorted frame can take seconds on a slow phone; the pano poster
// stays up meanwhile, so be patient: fall back only after 3 blank samples in a row, ≥10 s in.
const WATCH_AT_MS = [1500, 3000, 5000, 7500, 10_000, 13_000, 16_000];

/** Sample the viewer canvas: blank = (almost) one flat colour, i.e. only the clear colour got drawn. */
function looksBlank(src: HTMLCanvasElement, probe: HTMLCanvasElement): boolean | null {
  try {
    const W = 24, H = 48;
    probe.width = W;
    probe.height = H;
    const c = probe.getContext("2d", { willReadFrequently: true });
    if (!c || !src.width || !src.height) return null;
    c.drawImage(src, 0, 0, W, H);
    const d = c.getImageData(0, 0, W, H).data;
    let sum = 0, sum2 = 0, bright = 0;
    const n = W * H;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      sum2 += l * l;
      if (l > 40) bright++;
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    return std < 2.5 && bright / n < 0.01;
  } catch {
    return null; // can't read back on this browser: don't guess
  }
}

export function AholoSplatLayer({
  urls,
  upAxis = "-Y",
  origin = ZERO,
  scale = 1,
  yaw = 0,
  poster,
  onFail,
}: {
  /** tried in order (direct CDN URL, then same-origin proxy); each gets a retry */
  urls: string[];
  upAxis?: "Z" | "-Y" | "Y";
  origin?: Vec3;
  scale?: number;
  yaw?: number;
  /** panorama shown as a CSS backdrop while the splat loads (so the arena is never black) */
  poster?: string;
  /** every URL failed / timed out, the context was lost, or nothing visible was drawn: caller swaps in a fallback */
  onFail?: (reason: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);
  const key = urls.join("|");

  useEffect(() => {
    let disposed = false;
    let failed = false;
    let loaded = false;
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let destroy: (() => void) | undefined;
    let viewerRef: { destroy(): void } | undefined;
    const teardown = () => {
      try {
        if (destroy) destroy();
        else viewerRef?.destroy();
      } catch {}
      destroy = undefined;
      viewerRef = undefined;
    };
    const fail = (reason: string) => {
      if (disposed || failed) return;
      failed = true;
      console.warn(`[aholo-viewer] falling back: ${reason}`);
      cancelAnimationFrame(raf);
      teardown();
      setState("failed");
      failRef.current?.(reason);
    };
    const deadline = Date.now() + TOTAL_MS;
    timers.push(setTimeout(() => !loaded && fail("load budget exceeded"), TOTAL_MS + 500));

    (async () => {
      // Load the viewer as an untouched static ES module (public/vendor, copied by `npm run vendor`).
      // Bundling it through Turbopack breaks its Blob-URL module workers ("Error at n.onerror" on parse).
      const A = (await withTimeout(importStatic("/vendor/aholo-viewer/index.js"), VIEWER_IMPORT_MS, "viewer import")) as typeof import("@manycore/aholo-viewer");
      const el = ref.current;
      if (!el || disposed || failed) return;
      const mobile = isMobileGPU();
      const viewer = A.createViewer("arena-splat", el, { alpha: false, antialiasing: false, preserveDrawingBuffer: true });
      viewerRef = viewer;
      const canvas = el.querySelector("canvas");
      if (canvas) canvas.dataset.gameLayer = "splat";
      const onLost = (e: Event) => {
        e.preventDefault();
        fail("webglcontextlost");
      };
      canvas?.addEventListener("webglcontextlost", onLost);
      const cam = new A.PerspectiveCamera(sim.cam.fov, el.clientWidth / Math.max(1, el.clientHeight), 0.05, 500);
      if (upAxis === "Z") cam.up.set(0, 0, 1);
      else if (upAxis === "-Y") cam.up.set(0, -1, 0);
      else cam.up.set(0, 1, 0);
      viewer.setCamera(cam);
      const dpr = window.devicePixelRatio || 1;
      A.setViewerConfig(viewer, {
        // pixelRatio is relative to the device ratio. Phones render at ≤1.25 px per CSS px: a 412×915 Android at
        // DPR 2.6 otherwise renders 1081×2401, next to a second (R3F) WebGL canvas — prime context-loss territory.
        pixelRatio: mobile ? Math.min(1, 1.25 / dpr) : Math.min(1, 2 / dpr),
        pipeline: {
          Background: {
            background: { active: A.BackgroundMode.BasicBackground, basic: { color: new A.Color(0.05, 0.043, 0.035) } },
            ground: { enabled: false },
          },
          Splatting: { enabled: true },
          TAA: { enabled: false },
        },
      });
      viewer.resize();
      // Each URL gets two attempts (mobile networks drop big fetches); absolute URLs because the loader
      // fetches from a Blob-URL worker where relative paths don't resolve.
      for (const url of key.split("|")) {
        const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
        const type =
          ext === "ply" ? A.SplatLoader.SplatFileType.PLY : ext === "spz" ? A.SplatLoader.SplatFileType.SPZ : A.SplatLoader.SplatFileType.SOG;
        for (let attempt = 0; attempt < 2 && !loaded && !disposed && !failed; attempt++) {
          const left = deadline - Date.now();
          if (left < 3000) break;
          try {
            const budget = Math.min(ATTEMPT_MS, left);
            const t0 = Date.now();
            const data = await withTimeout(
              A.SplatLoader.parseSplatData(type, new URL(url, window.location.href).href, A.SplatLoader.SplatPackType.Compressed),
              budget,
              "splat parse",
            );
            const splat = await withTimeout(A.SplatUtils.createSplat(data), Math.max(3000, budget - (Date.now() - t0)), "splat upload");
            if (disposed || failed) return;
            viewer.getScene().add(splat);
            loaded = true;
          } catch (e) {
            console.warn(`[aholo-viewer] splat load failed (${url}, attempt ${attempt + 1})`, e);
            await sleep(800 * (attempt + 1));
          }
        }
        if (loaded) break;
      }
      if (disposed || failed) return;
      if (!loaded) return fail("all splat URLs failed");
      // The portrait 3/4 camera orbits the fighters by sim.cam.yaw; rotating the world mapping by the same angle
      // keeps the backdrop exactly as tuned for the side-on view (the splat is only a backdrop: no depth sharing).
      let cy = 1, sy = 0;
      const map = (v: Vec3) => {
        const x = (v[0] * cy + v[2] * sy) / scale, y = v[1] / scale, z = (-v[0] * sy + v[2] * cy) / scale;
        const b: Vec3 = upAxis === "Z" ? [x, -z, y] : upAxis === "-Y" ? [x, -y, -z] : [x, y, z];
        return new A.Vector3(b[0] + origin[0], b[1] + origin[1], b[2] + origin[2]);
      };
      let frames = 0;
      const tick = () => {
        if (failed || disposed) return;
        try {
          const w = el.clientWidth, h = el.clientHeight;
          cam.aspect = w / Math.max(1, h);
          cam.fov = sim.cam.fov;
          cam.updateProjectionMatrix?.();
          cy = Math.cos(sim.cam.yaw - yaw);
          sy = Math.sin(sim.cam.yaw - yaw);
          const p = map(sim.cam.pos);
          cam.position.set(p.x, p.y, p.z);
          cam.lookAt(map(sim.cam.target));
          viewer.render();
          frames++;
        } catch (e) {
          return fail(`render threw: ${(e as Error)?.message ?? e}`);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      const onResize = () => viewer.resize();
      window.addEventListener("resize", onResize);
      destroy = () => {
        window.removeEventListener("resize", onResize);
        canvas?.removeEventListener("webglcontextlost", onLost);
        viewer.destroy();
      };
      // Watchdog: frames must actually tick, and the frame must show something besides the clear colour.
      // The splat stays hidden (pano poster visible) until the first sample proves it drew something.
      const probe = document.createElement("canvas");
      let blanks = 0;
      for (const at of WATCH_AT_MS)
        timers.push(
          setTimeout(() => {
            if (failed || disposed || !canvas) return;
            if (frames === 0) {
              if (!document.hidden) fail("no frames rendered");
              return;
            }
            const blank = looksBlank(canvas, probe);
            if (blank === false || blank === null) setState("ready");
            blanks = blank ? blanks + 1 : 0;
            if (blanks >= 3 && at >= 10_000) fail("splat drew nothing visible");
          }, at),
        );
    })().catch((e) => {
      console.warn("[aholo-viewer] viewer failed", e);
      fail(`viewer failed: ${(e as Error)?.message ?? e}`);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      teardown();
    };
  }, [key, upAxis, origin, scale, yaw]);

  return (
    <div className="absolute inset-0" data-game-layer="splat" data-splat-state={state}>
      {state !== "ready" && (
        <>
          <div className="absolute inset-0 bg-panel bg-cover bg-center" style={poster ? { backgroundImage: `url(${poster})` } : undefined} />
          {poster && <div className="absolute inset-0 bg-ink/50" />}
        </>
      )}
      <div ref={ref} className={`absolute inset-0 ${state === "ready" ? "" : "opacity-0"}`} />
      {state === "loading" && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] text-center font-arcade text-sm tracking-widest text-fg [text-shadow:0_2px_0_#000] animate-pulse">
          Loading arena…
        </div>
      )}
    </div>
  );
}
