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
    const r = await fetch("/api/room", { method: "POST", body: fd }).then((x) => x.json());
    if (r.error) {
      setErr(r.error);
      setBusy(false);
    } else setJob(r.job);
  };

  useEffect(() => {
    if (!job || job.status === "SUCCEEDED" || job.status === "FAILED") return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/arenas/${job.id}`).then((x) => x.json());
      setNow(Date.now());
      if (r.error) return setErr(r.error);
      setJob(r.job);
      if (r.arena) {
        setBusy(false);
        onReady(r.arena);
      }
      if (r.job.status === "FAILED") setBusy(false);
    }, job.mode === "mock" ? 1000 : 8000);
    return () => clearTimeout(t);
  }, [job, onReady]);

  return (
    <div className="rounded-2xl border border-sky-300/20 bg-sky-400/[0.04] p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold">🏠 Fight in your room</div>
          <div className="text-[11px] text-orange-200/55">
            Film a slow 10–20 s loop around your room → Aholo Reality turns it into a 3DGS arena.
          </div>
        </div>
        <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${live ? "bg-lime-400/15 text-lime-300" : "bg-yellow-400/15 text-yellow-300"}`}>
          {live ? "Reality API · Flash" : "mock: no key"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => ref.current?.click()} className="rounded-lg border border-orange-300/25 px-2.5 py-1.5 text-xs hover:bg-white/5">
          {files.length ? (video ? `🎥 ${files[0].name.slice(0, 18)}` : `🖼 ${files.length} photos`) : "🎥 Pick video / 20+ photos"}
        </button>
        <button
          disabled={!ok || busy}
          onClick={start}
          className="rounded-lg bg-sky-400 px-3 py-1.5 font-display text-xs font-bold text-black disabled:opacity-40"
        >
          {busy ? "Scanning…" : "Build arena"}
        </button>
        {job && (
          <span className="text-[11px] text-orange-200/60">
            {job.status === "SUCCEEDED" ? "✓ Arena ready" : job.status === "FAILED" ? "✗ failed" : `${job.status.toLowerCase()} ${Math.round((job.progress ?? 0) * 100)}%`}
            {t0 > 0 && now > t0 && job.status !== "SUCCEEDED" ? ` · ${Math.round((now - t0) / 1000)}s` : ""}
          </span>
        )}
      </div>
      {!ok && files.length > 0 && <p className="mt-1 text-[11px] text-yellow-300/80">Need one video or at least 20 photos.</p>}
      {(err || job?.error) && <p className="mt-1 text-[11px] text-red-400">{err ?? job?.error}</p>}
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
