"use client";
import { useEffect, useRef, useState } from "react";
import type { ArenaDef } from "@/lib/arenas";

interface WorldJobView {
  id: string;
  status: "UPLOADING" | "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  progress: number;
  mode: "live" | "mock";
  error?: string;
}

/**
 * "Fight in your room" — Aholo Reality 3DGS reconstruction from one short phone video (or ≥20 photos).
 * POST /api/room → poll GET /api/arenas/<id> → new arena appears in the picker.
 */
export function RoomScan({ live, onReady }: { live: boolean | null; onReady: (a: ArenaDef) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<WorldJobView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [t0, setT0] = useState(0);
  const [now, setNow] = useState(0);

  const video = files.length === 1 && /video|\.mov$|\.mp4$/i.test(files[0].type + files[0].name);
  const ok = video || files.length >= 20;

  const start = async () => {
    setBusy(true);
    setErr(null);
    setT0(Date.now());
    const fd = new FormData();
    fd.set("name", "Your Room");
    files.forEach((f) => fd.append("files", f, f.name));
    try {
      const res = await fetch("/api/room", { method: "POST", body: fd });
      const r = await res.json().catch(() => ({ error: "Upload failed, the server is busy. Please try again." }));
      if (r.error) {
        setErr(r.error);
        setBusy(false);
      } else setJob(r.job);
    } catch {
      setErr("Couldn't reach the server, check your connection and try again.");
      setBusy(false);
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
          // Don't hang the UI on Aholo's queue: stop polling, keep the job (it shows up as "generating" in the picker).
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
        setJob((j) => (j ? { ...j } : j)); // network blip: re-arm the timer and try again
      }
    }, job.mode === "mock" ? 1000 : 8000);
    return () => clearTimeout(t);
  }, [job, onReady]);

  return (
    <div className="rounded-2xl border border-line bg-panel p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold">🏠 Fight in your room</div>
          <div className="text-[11px] text-muted">
            Film a slow 10–20 s loop around your room → Aholo Reality turns it into a 3DGS arena.
          </div>
        </div>
        <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${live ? "bg-ok/15 text-ok" : "bg-gold/15 text-gold"}`}>
          {live ? "Reality API · Flash" : "mock: no key"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => ref.current?.click()} className="btn btn-ghost btn-sm">
          {files.length ? (video ? `🎥 ${files[0].name.slice(0, 18)}` : `🖼 ${files.length} photos`) : "🎥 Pick video / 20+ photos"}
        </button>
        <button
          disabled={!ok || busy}
          onClick={start}
          className="btn btn-volt btn-sm disabled:opacity-40"
        >
          {busy ? "Scanning…" : "Build arena"}
        </button>
        {job && (
          <span className="text-[11px] text-muted">
            {job.status === "SUCCEEDED"
              ? "✓ Arena ready"
              : job.status === "FAILED"
                ? "✗ Scan failed"
                : job.status === "RUNNING"
                  ? `Building ${Math.round((job.progress ?? 0) * 100)}%`
                  : job.status === "UPLOADING"
                    ? "Uploading…"
                    : "Queued at Aholo"}
            {t0 > 0 && now > t0 && job.status !== "SUCCEEDED" ? ` · ${Math.round((now - t0) / 1000)}s` : ""}
          </span>
        )}
      </div>
      {!ok && files.length > 0 && <p className="mt-1 text-[11px] text-gold">Need one video or at least 20 photos.</p>}
      {(err || job?.error) && (
        <p className="mt-1 text-[11px] text-danger" title={job?.error}>
          {err ?? "Aholo couldn't rebuild this scan. Try a slower, steadier 10–20 s loop with good light."}
        </p>
      )}
      <input
        ref={ref}
        type="file"
        accept="video/mp4,video/quicktime,image/*"
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />
    </div>
  );
}
