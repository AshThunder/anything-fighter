"use client";
import { useEffect, useRef, useState } from "react";
import type { ArenaDef } from "@/lib/arenas";
import { mintOusToken, uploadToOus } from "@/lib/ous-browser";

interface WorldJobView {
  id: string;
  status: "UPLOADING" | "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progress: number;
  mode: "live" | "mock";
  error?: string;
}

const MAX_BYTES = 200 * 1024 * 1024;
const MIN_SEC = 8;
const MAX_SEC = 30;

async function videoMeta(file: File): Promise<{ duration: number; poster: Blob | null }> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error("Couldn't read that video."));
    });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    const t = duration > 0 ? Math.min(1, duration / 2) : 0;
    if (t > 0) {
      v.currentTime = t;
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        setTimeout(res, 1500);
      });
    }
    let poster: Blob | null = null;
    if (v.videoWidth > 0) {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      poster = await new Promise((r) => c.toBlob((b) => r(b), "image/jpeg", 0.85));
    }
    return { duration, poster };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function prettySize(n: number) {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * "Fight in your room" — Aholo Reality 3DGS reconstruction from one short phone video (or ≥20 photos).
 * Files go straight to Aholo OUS with a token from POST /api/room/token; POST /api/room only sends asset URLs.
 * Then poll GET /api/arenas/<id> until the new arena appears in the picker.
 */
export function RoomScan({ live, onReady }: { live: boolean | null; onReady: (a: ArenaDef) => void }) {
  const videoRef = useRef<HTMLInputElement>(null);
  const recordRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<WorldJobView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [t0, setT0] = useState(0);
  const [now, setNow] = useState(0);

  const video = files.length === 1 && /video|\.mov$|\.mp4$|\.webm$/i.test(files[0].type + " " + files[0].name);
  const ok = (video || files.length >= 20) && files.reduce((s, f) => s + f.size, 0) <= MAX_BYTES;

  const pickVideo = (list: FileList | null) => {
    const f = list?.[0];
    setErr(null);
    setHint(null);
    setJob(null);
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setFiles([]);
      setErr("That's too big (max 200 MB). Try a shorter 10–20 s clip.");
      return;
    }
    setFiles([f]);
    videoMeta(f)
      .then(({ duration }) => {
        if (duration && (duration < MIN_SEC || duration > MAX_SEC)) {
          setHint(
            duration < MIN_SEC
              ? `That clip is only ${Math.round(duration)} s. Aholo Reality works best with a slow 10–20 s loop around the room.`
              : `That clip is ${Math.round(duration)} s. A 10–20 s loop is enough and uses fewer credits.`,
          );
        }
      })
      .catch(() => {});
  };

  const pickPhotos = (list: FileList | null) => {
    const next = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name));
    setErr(null);
    setHint(null);
    setJob(null);
    setFiles(next);
    if (next.length > 0 && next.length < 20) setHint(`Aholo Reality needs at least 20 photos (you picked ${next.length}).`);
  };

  const start = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    setT0(Date.now());
    setNow(Date.now());
    try {
      const isVideo = video;
      let cover: string | undefined;
      let resources: { url: string; type: "video" | "image" }[] = [];
      if (live) {
        setPhase("Getting an Aholo upload token…");
        if (isVideo) {
          const poster = (await videoMeta(files[0]!).catch(() => ({ duration: 0, poster: null }))).poster;
          const tok = await mintOusToken();
          if ("mock" in tok) {
            // pipeline flipped to mock mid-flight
          } else {
            if (poster) {
              setPhase("Uploading a cover still to Aholo…");
              cover = await uploadToOus(tok, poster, "room-cover.jpg");
            }
            const videoTok = poster ? await mintOusToken() : tok;
            if (!("mock" in videoTok)) {
              setPhase(`Uploading ${prettySize(files[0]!.size)} to Aholo OUS…`);
              const url = await uploadToOus(videoTok, files[0]!, files[0]!.name.replace(/[^\w.-]/g, "_"), (u, t) => {
                setPhase(`Uploading to Aholo OUS… ${Math.min(99, Math.round((u / t) * 100))}%`);
              });
              resources = [{ url, type: "video" }];
            }
          }
        } else {
          for (let i = 0; i < files.length; i++) {
            const tok = await mintOusToken();
            if ("mock" in tok) break;
            setPhase(`Uploading photo ${i + 1} of ${files.length} to Aholo OUS…`);
            const url = await uploadToOus(tok, files[i]!, files[i]!.name.replace(/[^\w.-]/g, "_") || `photo-${i + 1}.jpg`);
            resources.push({ url, type: "image" });
            if (i === 0) cover = url;
          }
        }
      }
      setPhase("Starting Aholo Reality…");
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Your Room", resources, cover }),
      });
      const r = await res.json().catch(() => ({ error: "Couldn't start the scan. Please try again." }));
      if (r.error) {
        setErr(r.error);
        setBusy(false);
        setPhase("");
      } else {
        setJob(r.job);
        setPhase("");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't reach Aholo. Check your connection and try again.");
      setBusy(false);
      setPhase("");
    }
  };

  useEffect(() => {
    if (!job || job.status === "SUCCEEDED" || job.status === "FAILED") return;
    const t = setTimeout(async () => {
      setNow(Date.now());
      try {
        const r = await fetch(`/api/arenas/${job.id}`, { cache: "no-store" }).then((x) => x.json());
        if (r.error) {
          setErr(r.error);
          setBusy(false);
          return;
        }
        if (r.stuck) {
          setErr("Aholo's world queue is stuck right now. Your scan stays queued and will appear in the arena list when it finishes.");
          setBusy(false);
          return;
        }
        setJob({ ...r.job });
        if (r.arena) {
          setBusy(false);
          onReady(r.arena);
        }
        if (r.job.status === "FAILED") setBusy(false);
      } catch {
        setJob((j) => (j ? { ...j } : j));
      }
    }, job.mode === "mock" ? 1000 : 8000);
    return () => clearTimeout(t);
  }, [job, onReady]);

  const selected = files.length
    ? video
      ? `${files[0]!.name} · ${prettySize(files[0]!.size)}`
      : `${files.length} photos · ${prettySize(files.reduce((s, f) => s + f.size, 0))}`
    : null;

  return (
    <div className="rounded-2xl border border-line bg-panel p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-sm font-bold">🏠 Fight in your room</div>
          <div className="text-[11px] text-muted">
            Film a slow 10–20 s loop around your room. Aholo Reality rebuilds it as a playable 3DGS arena (Flash, 20 credits).
          </div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${live ? "bg-ok/15 text-ok" : "bg-gold/15 text-gold"}`}>
          {live ? "Reality API · Flash" : "mock: no key"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => recordRef.current?.click()} className="btn btn-ghost btn-sm" disabled={busy}>
          Record a loop
        </button>
        <button type="button" onClick={() => videoRef.current?.click()} className="btn btn-ghost btn-sm" disabled={busy}>
          Choose a video
        </button>
        <button type="button" onClick={() => photosRef.current?.click()} className="btn btn-ghost btn-sm" disabled={busy}>
          Choose 20+ photos
        </button>
        <button
          type="button"
          disabled={!ok || busy}
          onClick={start}
          className="btn btn-primary btn-sm disabled:opacity-40"
        >
          {busy ? (phase || "Scanning…") : "Build arena"}
        </button>
      </div>

      {!selected && !busy && (
        <p className="mt-2 text-[11px] text-muted">Pick a video or 20+ photos first — Build arena stays off until you do.</p>
      )}
      {selected && <p className="mt-2 text-[11px] text-fg">Selected: {selected}</p>}
      {hint && <p className="mt-1 text-[11px] text-gold">{hint}</p>}
      {job && (
        <p className="mt-1 text-[11px] text-muted">
          {job.status === "SUCCEEDED"
            ? "✓ Arena ready — it's selected in the stage list."
            : job.status === "FAILED"
              ? "✗ Scan failed"
              : job.status === "RUNNING"
                ? `Aholo Reality is building the 3DGS… ${Math.round((job.progress ?? 0) * 100)}%`
                : "Queued at Aholo Reality"}
          {t0 > 0 && now > t0 && job.status !== "SUCCEEDED" ? ` · ${Math.round((now - t0) / 1000)}s` : ""}
        </p>
      )}
      {(err || job?.error) && (
        <p className="mt-1 text-[11px] text-danger" title={job?.error}>
          {err ?? "Aholo couldn't rebuild this scan. Try a slower, steadier 10–20 s loop with good light."}
        </p>
      )}

      <input
        ref={recordRef}
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          pickVideo(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        className="hidden"
        onChange={(e) => {
          pickVideo(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={photosRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          pickPhotos(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
