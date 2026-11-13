/**
 * Fight clip recorder: composites the WebGL canvas(es) + a minimal HUD into a 2D canvas each frame and
 * records it with MediaRecorder (MP4/H.264 when the browser supports it — X accepts MP4 — else WebM).
 * Recording starts when a round starts and stops ~2.5 s after the KO, so the clip ends on the victory pose.
 */
import { useGame } from "./store";

let rec: MediaRecorder | null = null;
let chunks: Blob[] = [];
let raf = 0;
let comp: HTMLCanvasElement | null = null;
let lastClip: { url: string; type: string; ext: string } | null = null;
const listeners = new Set<() => void>();

export const getClip = () => lastClip;
export const onClip = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

function pickType() {
  const c = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return c.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const s = useGame.getState();
  if (!s.fighters) return;
  const pad = w * 0.03, bw = w * 0.38, bh = h * 0.028;
  ctx.font = `700 ${Math.round(h * 0.026)}px system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  for (const i of [0, 1] as const) {
    const x = i === 0 ? pad : w - pad - bw;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, pad + h * 0.035, bw, bh);
    const hp = Math.max(0, s.hp[i]) / 100;
    ctx.fillStyle = hp > 0.3 ? "#f59e0b" : "#ef4444";
    if (i === 0) ctx.fillRect(x, pad + h * 0.035, bw * hp, bh);
    else ctx.fillRect(x + bw * (1 - hp), pad + h * 0.035, bw * hp, bh);
    ctx.fillStyle = "#fff7ed";
    ctx.textAlign = i === 0 ? "left" : "right";
    ctx.fillText(s.fighters[i].name.toUpperCase(), i === 0 ? x : x + bw, pad + h * 0.03);
  }
  if (s.phase === "ko" || s.phase === "victory") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 italic ${Math.round(h * (s.phase === "ko" ? 0.22 : 0.08))}px system-ui, sans-serif`;
    ctx.fillStyle = "#f27f0d";
    ctx.shadowColor = "rgba(242,127,13,0.8)";
    ctx.shadowBlur = 30;
    const w0 = s.winner !== null ? s.fighters[s.winner].name : "";
    ctx.fillText(s.phase === "ko" ? "K.O." : `${w0} wins!`, w / 2, s.phase === "ko" ? h / 2 : h * 0.8);
    ctx.shadowBlur = 0;
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = `600 ${Math.round(h * 0.022)}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,237,213,0.75)";
  ctx.fillText("ANYTHING FIGHTER · made with Aholo Lux3D", w - pad, h - pad);
}

/** Start recording the given canvases (bottom → top). Safe to call repeatedly. */
export function startClip(sources: () => HTMLCanvasElement[]) {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return;
  stopClip(true);
  const first = sources()[0];
  if (!first) return;
  const scale = Math.min(1, 1280 / first.width);
  comp = document.createElement("canvas");
  comp.width = Math.round(first.width * scale) & ~1;
  comp.height = Math.round(first.height * scale) & ~1;
  const ctx = comp.getContext("2d")!;
  const tick = () => {
    ctx.fillStyle = "#0d0b09";
    ctx.fillRect(0, 0, comp!.width, comp!.height);
    for (const c of sources()) ctx.drawImage(c, 0, 0, comp!.width, comp!.height);
    drawHud(ctx, comp!.width, comp!.height);
    raf = requestAnimationFrame(tick);
  };
  tick();
  const type = pickType();
  try {
    rec = new MediaRecorder(comp.captureStream(30), { mimeType: type || undefined, videoBitsPerSecond: 5_000_000 });
  } catch {
    rec = null;
    return;
  }
  chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    cancelAnimationFrame(raf);
    if (!chunks.length) return;
    const t = rec?.mimeType || type || "video/webm";
    if (lastClip) URL.revokeObjectURL(lastClip.url);
    lastClip = { url: URL.createObjectURL(new Blob(chunks, { type: t })), type: t, ext: t.includes("mp4") ? "mp4" : "webm" };
    listeners.forEach((l) => l());
  };
  rec.start(1000);
}

export function stopClip(discard = false) {
  if (!rec) return;
  if (discard) {
    rec.ondataavailable = null;
    rec.onstop = null;
    cancelAnimationFrame(raf);
  }
  if (rec.state !== "inactive") rec.stop();
  rec = null;
}

/** One-frame KO card (PNG data URL): game frame + HUD + optional RenderCloud poster panel. */
export async function snapshotCard(sources: HTMLCanvasElement[], posterUrl?: string): Promise<string> {
  const W = 1600, H = 900;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0d0b09";
  ctx.fillRect(0, 0, W, H);
  const gw = posterUrl ? W * 0.68 : W;
  for (const s of sources) {
    // cover-crop the game frame into the left panel
    const sr = s.width / s.height, dr = gw / H;
    const sw = sr > dr ? s.height * dr : s.width, sh = sr > dr ? s.height : s.width / dr;
    ctx.drawImage(s, (s.width - sw) / 2, (s.height - sh) / 2, sw, sh, 0, 0, gw, H);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, gw, H);
  ctx.clip();
  drawHud(ctx, gw, H);
  ctx.restore();
  if (posterUrl) {
    const img = await new Promise<HTMLImageElement | null>((res) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = posterUrl;
    });
    if (img) {
      const pw = W - gw, ph = (pw / img.width) * img.height;
      ctx.drawImage(img, gw, (H - ph) / 2, pw, ph);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(gw, H - 44, pw, 44);
      ctx.fillStyle = "#fed7aa";
      ctx.font = "600 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Poster rendered with Aholo RenderCloud", gw + pw / 2, H - 22);
    }
  }
  return c.toDataURL("image/png");
}
