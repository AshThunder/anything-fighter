"use client";
/**
 * Live "create your fighter" screen: polls the Lux3D pipeline job (each poll advances it server-side) and,
 * while you wait (~4 min live), lets you spar against a roster fighter in practice mode.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { PoweredBy } from "@/components/ui/PoweredBy";
import type { AholoServiceKey } from "@/lib/fighters";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Hud } from "@/components/game/Hud";
import { useGame } from "@/lib/game/store";
import type { FighterDef } from "@/lib/fighters";
import { BUILTIN_ARENAS } from "@/lib/arenas";

const GameScene = dynamic(() => import("@/components/game/GameScene"), { ssr: false });

type Stage = "upload" | "mascot" | "mesh" | "rig" | "retarget" | "poster" | "export" | "done";
const STAGE_SERVICE: Record<Stage, AholoServiceKey> = {
  done: "retarget",
  upload: "asset",
  mascot: "concept",
  mesh: "mesh",
  rig: "rig",
  retarget: "retarget",
  poster: "poster",
  export: "export",
};

const STAGES: { key: Stage; label: string; tool: string; eta: number }[] = [
  { key: "upload", label: "Photo upload", tool: "Aholo Asset (OUS)", eta: 5 },
  { key: "mascot", label: "Fighter concept", tool: "Lux3D multimodal image", eta: 40 },
  { key: "mesh", label: "3D mesh + PBR", tool: "Lux3D image→3D Turbo", eta: 65 },
  { key: "rig", label: "Skeleton", tool: "Lux3D humanoid auto-rig", eta: 80 },
  { key: "retarget", label: "10 fight moves", tool: "Lux3D animation retarget", eta: 35 },
  { key: "poster", label: "KO poster", tool: "Aholo RenderCloud", eta: 45 },
  { key: "export", label: "Print files", tool: "Lux3D STL/3MF/USDZ", eta: 30 },
];
const TIPS = [
  "Punch (J) is fast, kick (K) is slow but hits hard.",
  "Hold L or Shift to block — blocked hits do almost nothing.",
  "Chain hits within ~1 s for a combo counter.",
  "Your object is being re-imagined as a humanoid so it can be rigged.",
  "Lux3D retargets 10 Mixamo-style moves onto your fighter's new skeleton.",
  "RenderCloud path-traces a KO poster of your fighter mid-punch.",
];

interface JobView {
  id: string;
  name: string;
  stage: Stage;
  error?: string;
  mode: "live" | "mock";
  createdAt: number;
  stageStartedAt: number;
  options: { exportPrint: boolean };
  files: { photo?: string; mascot?: string };
  log: string[];
  retries?: number;
  rigless?: boolean;
}

export default function ForgeClient() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobView | null>(null);
  const [fighter, setFighter] = useState<FighterDef | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [practice, setPractice] = useState(false);
  const [tip, setTip] = useState(0);
  const fails = useRef(0);
  const setup = useGame((s) => s.setup);
  const setMode = useGame((s) => s.setMode);
  const ready = useGame((s) => !!s.fighters);

  const [loop, setLoop] = useState(0); // bump to restart polling (after a manual retry)
  const [lost, setLost] = useState(false);

  /**
   * Poll loop. Each GET advances the job server-side, so polling must never silently stop: the old version
   * scheduled the next poll from a useEffect keyed on `job`, so a single failed fetch (phone network blip,
   * tab backgrounded) left `job` unchanged and polling died with "Failed to fetch (retrying…)" forever.
   * Now the loop reschedules itself after every attempt (with backoff), resumes immediately when the tab
   * becomes visible / the network comes back, and aborts requests that hang.
   */
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    };
    async function tick() {
      if (stopped || inflight) return;
      inflight = true;
      let next = 3500;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 75_000);
        const r = await fetch(`/api/pipeline/${id}`, { cache: "no-store", signal: ctrl.signal }).finally(() => clearTimeout(to));
        const text = await r.text();
        let j: { job?: JobView; fighter?: FighterDef | null; error?: string };
        try {
          j = JSON.parse(text);
        } catch {
          throw new Error(`server busy (HTTP ${r.status})`);
        }
        if (r.status === 404) {
          setLost(true);
          setErr(j.error ?? "Job not found");
          stopped = true;
          return;
        }
        if (!r.ok || j.error || !j.job) throw new Error(j.error ?? `HTTP ${r.status}`);
        fails.current = 0;
        setErr(null);
        setJob(j.job);
        if (j.fighter) {
          setFighter(j.fighter);
          stopped = true;
          return;
        }
        if (j.job.error) {
          stopped = true;
          return;
        }
        next = j.job.mode === "mock" ? 900 : 3500;
      } catch (e) {
        fails.current++;
        const msg = e instanceof Error ? e.message : String(e);
        const net = /failed to fetch|network|load failed|abort/i.test(msg);
        setErr(net ? "Connection hiccup, reconnecting… (your fighter keeps forging at Aholo)" : `${msg} (retrying…)`);
        next = Math.min(15_000, 2500 * 2 ** Math.min(fails.current, 3));
      } finally {
        inflight = false;
      }
      schedule(next);
    }
    const wake = () => {
      if (document.visibilityState === "visible" && !stopped) schedule(0);
    };
    schedule(0);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [id, loop]);

  useEffect(() => {
    const i = setInterval(() => {
      setNow(Date.now());
      setTip((t) => t + 1);
    }, 4000);
    return () => clearInterval(i);
  }, []);

  const startPractice = async () => {
    const { fighters } = await fetch("/api/fighters").then((r) => r.json());
    const list = (fighters as FighterDef[]).filter((f) => f.id !== id);
    const a = list[Math.floor(Math.random() * list.length)];
    const b = list.find((f) => f.id !== a.id) ?? list[0];
    setMode("practice");
    setup([a, b], { kind: "stage", name: BUILTIN_ARENAS[0].name });
    setPractice(true);
  };

  const retry = async () => {
    try {
      const r = await fetch(`/api/pipeline/${id}/retry`, { method: "POST" }).then((x) => x.json());
      if (r.error) setErr(r.error);
      else {
        setErr(null);
        setJob(r.job);
        setLoop((n) => n + 1);
      }
    } catch {
      setErr("Couldn't reach the server, check your connection and try again.");
    }
  };

  const stages = STAGES.filter((s) => s.key !== "export" || job?.options.exportPrint);
  const idx = job ? (job.stage === "done" ? stages.length : stages.findIndex((s) => s.key === job.stage)) : -1;
  const remaining = job && idx >= 0 && idx < stages.length ? stages.slice(idx).reduce((a, s) => a + s.eta, 0) - Math.max(0, (now - job.stageStartedAt) / 1000) : 0;
  const elapsed = job ? Math.round((now - job.createdAt) / 1000) : 0;
  const stageAge = job ? Math.max(0, (now - job.stageStartedAt) / 1000) : 0;
  const curEta = idx >= 0 && idx < stages.length ? stages[idx].eta : 0;
  const slow = !!job && !fighter && !job.error && job.mode === "live" && curEta > 0 && stageAge > Math.max(180, curEta * 4);
  const asset = (f?: string) => (f && id ? `/api/assets/${id}/${f}` : undefined);

  return (
    <main className="relative min-h-dvh bg-[#0d0b09] text-orange-50">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(242,127,13,0.16),transparent_60%)]" />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-5 px-5 py-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="font-arcade text-lg leading-none tracking-tight">
            ANYTHING<span className="text-orange-500">FIGHTER</span>
          </Link>
          <Link href="/gallery" className="text-xs text-orange-200/60 hover:text-orange-50">
            Gallery →
          </Link>
        </header>

        <section className="grid gap-5 md:grid-cols-[260px_1fr]">
          <div className="flex gap-3 md:flex-col">
            {[asset(job?.files.photo), asset(job?.files.mascot)].map((src, i) => (
              <div key={i} className="relative aspect-square w-1/2 overflow-hidden rounded-2xl border border-orange-300/15 bg-black/40 md:w-full">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={i ? "fighter concept" : "your photo"} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-orange-200/40">{i ? "concept art incoming…" : "…"}</div>
                )}
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-orange-100/70">
                  {i ? "Lux3D concept" : "Your photo"}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-orange-300/15 bg-[#1a1511]/80 p-5" data-forge>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="font-display text-3xl font-black italic">
                {fighter ? `${fighter.name} is ready!` : job?.error ? "Forge hit a snag" : `Forging ${job?.name ?? "your fighter"}…`}
              </h1>
              <span className="text-xs text-orange-200/60">
                {job?.mode === "mock" ? "mock pipeline (no API key)" : "live Aholo Lux3D"} · {elapsed}s
                {!fighter && !job?.error && remaining > 0 ? ` · ~${Math.ceil(remaining / 60)} min left` : ""}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/50">
              <div
                className={`h-full rounded-full transition-[width] duration-700 ${job?.error ? "bg-red-500" : "bg-gradient-to-r from-orange-500 to-yellow-400"}`}
                style={{ width: `${fighter ? 100 : Math.max(4, (Math.max(0, idx) / stages.length) * 100)}%` }}
              />
            </div>
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {stages.map((s, i) => {
                const done = i < idx || !!fighter;
                const active = i === idx && !job?.error && !fighter;
                const failed = i === idx && !!job?.error;
                return (
                  <li
                    key={s.key}
                    className={`rounded-xl border px-2.5 py-2 text-[11px] ${
                      failed ? "border-red-500/50 bg-red-500/10" : done ? "border-lime-400/30 bg-lime-400/5" : active ? "border-orange-400/60 bg-orange-500/10" : "border-orange-300/10 opacity-50"
                    }`}
                  >
                    <div className="font-display font-bold">
                      {failed ? "✗ " : done ? "✓ " : active ? <span className="inline-block animate-pulse">● </span> : ""}
                      {s.label}
                    </div>
                    <div className="text-orange-200/50">{s.tool}</div>
                  </li>
                );
              })}
            </ol>
            {job?.mode === "live" &&
              (fighter ? (
                <PoweredBy fighter={fighter} />
              ) : (
                <PoweredBy
                  keys={stages.slice(0, Math.max(0, idx) + 1).map((s) => STAGE_SERVICE[s.key])}
                  active={job.error ? undefined : STAGE_SERVICE[stages[idx]?.key ?? "upload"]}
                />
              ))}
            {job?.error && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm">
                <span className="flex-1 text-red-300">{job.error}</span>
                <button onClick={retry} className="rounded-lg bg-orange-500 px-4 py-1.5 font-display font-bold text-black" data-action="retry">
                  Retry stage {job.retries ? `(${job.retries}/3)` : ""}
                </button>
                <Link href="/" className="rounded-lg border border-orange-300/30 px-4 py-1.5 font-display">
                  Try another photo
                </Link>
              </div>
            )}
            {err && !job?.error && <p className="text-xs text-yellow-300/80">{err}</p>}
            {lost && (
              <p className="text-sm text-orange-100/70">
                This forge job has expired (jobs are kept for 6 hours).{" "}
                <Link href="/" className="underline">
                  Forge a new fighter
                </Link>{" "}
                or pick one from the{" "}
                <Link href="/gallery" className="underline">
                  gallery
                </Link>
                .
              </p>
            )}
            {slow && !err && (
              <p className="text-xs text-orange-200/60">
                Aholo is busier than usual on this step ({Math.round(stageAge / 60)} min so far). It&apos;ll keep going; you can practice
                below or leave this page open and come back.
              </p>
            )}
            {fighter && job?.rigless && (
              <p className="text-xs text-orange-200/70">
                Lux3D&apos;s auto-rig couldn&apos;t find a humanoid skeleton in this shape, so {fighter.name} fights freestyle: the full
                Lux3D mesh, animated with procedural lunges, spins and hops. Try a photo with a clearer body shape for full rigged moves.
              </p>
            )}
            {fighter ? (
              <div className="flex flex-wrap gap-3">
                <Link href={`/fight?p1=${fighter.id}`} className="rounded-xl bg-orange-500 px-6 py-3 font-display text-lg font-black italic text-black hover:bg-orange-400" data-action="fight-new">
                  FIGHT WITH {fighter.name.toUpperCase()}!
                </Link>
                <Link href="/gallery" className="rounded-xl border border-orange-300/30 px-5 py-3 font-display">
                  See it in the gallery
                </Link>
              </div>
            ) : (
              !job?.error && (
                <div className="flex flex-wrap items-center gap-3 text-sm text-orange-100/70">
                  <span className="flex-1">💡 {TIPS[tip % TIPS.length]}</span>
                  {!practice && (
                    <button onClick={startPractice} className="rounded-xl border border-orange-400/60 bg-orange-500/10 px-4 py-2 font-display font-bold" data-action="practice">
                      🥊 Practice while you wait
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </section>

        {practice && (
          <section className="relative h-[62vh] min-h-[380px] overflow-hidden rounded-2xl border border-orange-300/15" data-practice>
            {ready && <GameScene />}
            {ready && <Hud />}
            {fighter && (
              <div className="absolute inset-x-0 top-14 flex justify-center">
                <Link href={`/fight?p1=${fighter.id}`} className="animate-[pop_0.4s_ease-out] rounded-xl bg-lime-400 px-5 py-2 font-display font-black text-black shadow-2xl">
                  ✓ {fighter.name} is ready — fight for real →
                </Link>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
