"use client";
/**
 * Live "create your fighter" screen: polls the Lux3D pipeline job (each poll advances it server-side) and,
 * while you wait (~4 min live), lets you spar against a roster fighter in practice mode.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { PoweredBy } from "@/components/ui/PoweredBy";
import { SiteHeader } from "@/components/ui/SiteHeader";
import type { AholoServiceKey } from "@/lib/fighters";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Hud } from "@/components/game/Hud";
import { useGame } from "@/lib/game/store";
import type { FighterDef } from "@/lib/fighters";
import { BUILTIN_ARENAS } from "@/lib/arenas";
import { friendlyForgeError } from "@/lib/player-errors";

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
  "Strings: J J K (jab → cross → hook knockdown) or K J. Hold S + K to sweep.",
  "Jump (W) over sweeps and kick on the way down; crouch (S) under jabs.",
  "Fill the meter, then press I for a super. Tap block just before a hit to parry.",
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
  mockReason?: "limit";
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
  const [gone, setGone] = useState(false); // finished, but its 3D model was lost from storage
  const [deleted, setDeleted] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const deleteToken = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return id ? sessionStorage.getItem(`af-delete:${id}`) : null;
      } catch {
        return null;
      }
    },
    () => null,
  );
  const localPhoto = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return id ? sessionStorage.getItem(`af-preview:${id}`) : null;
      } catch {
        return null;
      }
    },
    () => null,
  );

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
        let j: { job?: JobView; fighter?: FighterDef | null; modelMissing?: boolean; error?: string };
        try {
          j = JSON.parse(text);
        } catch {
          throw new Error("server busy");
        }
        if (r.status === 404) {
          setLost(true);
          setErr(null);
          stopped = true;
          return;
        }
        if (!r.ok || j.error || !j.job) throw new Error(j.error ?? `HTTP ${r.status}`);
        fails.current = 0;
        setErr(null);
        setJob(j.job);
        if (j.fighter) {
          setFighter(j.fighter);
          setGone(!!j.modelMissing);
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
        if (!net) console.warn(`[forge] poll failed: ${msg}`);
        setErr(net ? "Connection hiccup, reconnecting… (your fighter keeps forging at Aholo)" : "The forge server is busy, retrying…");
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
    const { fighters } = await fetch("/api/fighters")
      .then((r) => r.json())
      .catch(() => ({ fighters: [] }));
    const list = ((fighters ?? []) as FighterDef[]).filter((f) => f.id !== id);
    if (list.length < 2) {
      setErr("Practice is unavailable right now, the roster didn't load.");
      return;
    }
    const a = list[Math.floor(Math.random() * list.length)];
    const b = list.find((f) => f.id !== a.id) ?? list[0];
    setMode("practice");
    setup([a, b], { kind: "stage", name: BUILTIN_ARENAS[0].name });
    setPractice(true);
  };

  const retry = async () => {
    try {
      const r = await fetch(`/api/pipeline/${id}/retry`, { method: "POST" }).then((x) => x.json());
      if (r.error) setErr(friendlyForgeError(r.error, job?.stage));
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

  const cur = idx >= 0 && idx < stages.length ? stages[idx] : undefined;
  const status = lost
    ? "Forge not found"
    : fighter && gone
      ? `${fighter.name} is no longer available`
      : fighter
        ? `${fighter.name} is ready!`
        : job?.error
          ? "Forge hit a snag"
          : `Forging ${job?.name ?? "your fighter"}…`;

  return (
    <main className="relative min-h-dvh bg-ink text-fg">
      <SiteHeader />
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <section className={`grid gap-5 ${lost ? "" : "md:grid-cols-[260px_1fr]"}`}>
          <div className={`flex gap-3 md:flex-col ${lost ? "hidden" : ""}`}>
            {([localPhoto || (fighter?.photoPublic ? fighter.photoUrl : undefined), asset(job?.files.mascot)] as (string | undefined)[]).map((src, i) => (
              <div key={i} className="relative aspect-square w-1/2 overflow-hidden rounded-xl border border-line bg-panel md:w-full">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={i ? "fighter concept" : "your photo"}
                    className="h-full w-full object-cover"
                    onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                  />
                ) : (
                  <div className={`flex h-full items-center justify-center px-3 text-center text-sm text-muted ${i && !lost && !job?.error ? "skeleton" : ""}`}>
                    {i ? (lost ? "—" : "Concept art incoming…") : "Your photo"}
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fg">
                  {i ? "Lux3D concept" : "Your photo"}
                </span>
              </div>
            ))}
          </div>

          <div className="card flex min-w-0 flex-col gap-4 p-4 sm:p-5" data-forge>
            <div className="flex flex-col gap-1">
              <span className={`eyebrow ${lost ? "hidden" : ""}`}>
                {job?.mode === "mock" ? (job.mockReason === "limit" ? "Demo forge · no credits" : "Mock pipeline · no API key") : "Live · Aholo Lux3D"}
                {!fighter && !job?.error && elapsed > 0 ? ` · ${elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`} elapsed` : ""}
              </span>
              <h1 className="min-w-0 font-arcade text-2xl leading-tight [overflow-wrap:anywhere] sm:text-3xl" aria-live="polite">
                {status}
              </h1>
            </div>

            {/* progress: one solid segment per stage + "Step n of N" */}
            {!lost && (
              <div className="flex flex-col gap-2" data-forge-progress>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="font-display font-bold">
                    {fighter ? (
                      <span className="text-ok">All {stages.length} steps done</span>
                    ) : job?.error ? (
                      <span className="text-danger">Stopped at step {idx + 1}: {cur?.label}</span>
                    ) : cur ? (
                      <>
                        Step {idx + 1} of {stages.length}: <span className="text-blaze">{cur.label}</span>
                      </>
                    ) : (
                      "Starting…"
                    )}
                  </span>
                  {!fighter && !job?.error && remaining > 0 && <span className="text-muted">about {Math.ceil(remaining / 60)} min left</span>}
                </div>
                <div className="flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={stages.length} aria-valuenow={fighter ? stages.length : Math.max(0, idx)}>
                  {stages.map((s, i) => {
                    const done = i < idx || !!fighter;
                    const active = i === idx && !job?.error && !fighter;
                    const failed = i === idx && !!job?.error;
                    return <span key={s.key} className={`h-2.5 flex-1 rounded-sm ${failed ? "bg-danger" : done ? "bg-ok" : active ? "animate-pulse bg-blaze" : "bg-line"}`} />;
                  })}
                </div>
              </div>
            )}

            <ol className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${lost ? "hidden" : ""}`}>
              {stages.map((s, i) => {
                const done = i < idx || !!fighter;
                const active = i === idx && !job?.error && !fighter;
                const failed = i === idx && !!job?.error;
                return (
                  <li
                    key={s.key}
                    aria-current={active ? "step" : undefined}
                    className={`rounded-lg border-2 px-2.5 py-2 text-xs ${
                      failed ? "border-danger bg-danger/10" : done ? "border-ok/50 bg-panel" : active ? "border-blaze bg-blaze/10" : "border-line bg-panel text-dim"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-display text-[13px] font-bold">
                      <span
                        aria-hidden
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                          failed ? "bg-danger text-ink" : done ? "bg-ok text-ink" : active ? "animate-pulse bg-blaze text-ink" : "bg-line text-muted"
                        }`}
                      >
                        {failed ? "✗" : done ? "✓" : i + 1}
                      </span>
                      <span className={done || active || failed ? "text-fg" : ""}>{s.label}</span>
                    </div>
                    <div className={`mt-0.5 ${done || active || failed ? "text-muted" : ""}`}>{s.tool}</div>
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
            {job?.mockReason === "limit" && (
              <p className="rounded-lg border border-gold/50 bg-gold/10 p-3 text-sm text-fg" data-demo-forge>
                Today&apos;s live Lux3D forge budget is used up, so this is a <b>demo forge</b>: the stages are simulated (no Aholo
                credits) and your fighter uses a stand-in robot body. Every fighter in the{" "}
                <Link href="/#select" className="font-semibold text-gold underline">
                  roster
                </Link>{" "}
                and{" "}
                <Link href="/gallery" className="font-semibold text-gold underline">
                  gallery
                </Link>{" "}
                was forged live by Lux3D. Live forging resets at midnight (Lagos time).
              </p>
            )}
            {job?.error && (
              <div className="flex flex-col gap-3 rounded-lg border-2 border-danger/60 bg-danger/10 p-3 text-sm" data-forge-error role="alert">
                <span className="text-fg">{friendlyForgeError(job.error, job.stage)}</span>
                <div className="flex flex-wrap gap-2">
                  {(job.retries ?? 0) < 3 && (
                    <button onClick={retry} className="btn btn-primary" data-action="retry">
                      Retry stage {job.retries ? `(${job.retries}/3)` : ""}
                    </button>
                  )}
                  <Link href="/#select" className="btn btn-ghost">
                    Fight with the roster
                  </Link>
                  <Link href="/" className="btn btn-ghost">
                    Try another photo
                  </Link>
                </div>
                <details className="text-xs text-dim">
                  <summary className="min-h-6 cursor-pointer select-none">Technical details</summary>
                  <code className="mt-1 block break-all">{job.error.slice(0, 300)}</code>
                </details>
              </div>
            )}
            {err && !job?.error && (
              <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-fg" role="status">
                {err}
              </p>
            )}
            {lost && (
              <div className="flex flex-col gap-3" data-notice="forge-lost">
                <p className="text-base text-muted">This forge job has expired or never existed (unfinished jobs are kept for 6 hours).</p>
                <div className="flex flex-wrap gap-2">
                  <Link href="/#forge" className="btn btn-primary">
                    Forge a new fighter
                  </Link>
                  <Link href="/gallery" className="btn btn-ghost">
                    Browse the gallery
                  </Link>
                </div>
              </div>
            )}
            {slow && !err && (
              <p className="text-sm text-muted">
                Aholo is busier than usual on this step ({Math.round(stageAge / 60)} min so far). It&apos;ll keep going; you can practice
                below or leave this page open and come back.
              </p>
            )}
            {fighter && gone && (
              <p className="rounded-lg border border-line-strong bg-panel-2 p-3 text-sm text-fg" data-notice="model-missing">
                {fighter.name}&apos;s 3D files are no longer stored, so it can&apos;t fight any more. Forge it again from a new photo, or pick
                a fighter from the roster.
              </p>
            )}
            {fighter && !gone && job?.rigless && (
              <p className="text-sm text-muted">
                Lux3D&apos;s auto-rig couldn&apos;t find a humanoid skeleton in this shape, so {fighter.name} fights freestyle: the full
                Lux3D mesh, animated with procedural lunges, spins and hops. Try a photo with a clearer body shape for full rigged moves.
              </p>
            )}
            {fighter && gone ? (
              <div className="flex flex-wrap gap-2">
                <Link href="/#forge" className="btn btn-primary btn-lg" data-action="forge-again">
                  Forge a new fighter
                </Link>
                <Link href="/fight" className="btn btn-ghost h-14">
                  Fight with the roster
                </Link>
              </div>
            ) : fighter ? (
              <div className="flex flex-wrap gap-2">
                <Link href={`/fight?p1=${fighter.id}`} className="btn btn-primary btn-lg [overflow-wrap:anywhere]" data-action="fight-new">
                  Fight with {fighter.name}!
                </Link>
                <Link href={`/fight?p2=${fighter.id}&cpu=normal`} className="btn btn-volt btn-lg text-base [overflow-wrap:anywhere]" data-action="fight-against">
                  Fight against {fighter.name}
                </Link>
                <Link href="/gallery" className="btn btn-ghost h-14">
                  See it in the gallery
                </Link>
              </div>
            ) : null}
            {fighter && !gone && deleteToken && !deleted && (
              <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm text-muted" data-delete-link>
                <p>This control is only shown to you, in this browser, after the forge. It removes the fighter from the gallery and unpublishes the original photo.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      if (!deleteToken || !id) return;
                      if (!window.confirm("Remove this fighter from the gallery and unpublish its photo?")) return;
                      setDeleteErr(null);
                      try {
                        const res = await fetch(`/api/fighters/${id}/delete`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ token: deleteToken }),
                        });
                        const j = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          setDeleteErr(j.error ?? "Couldn't delete this fighter.");
                          return;
                        }
                        try {
                          sessionStorage.removeItem(`af-delete:${id}`);
                        } catch {
                          /* ignore */
                        }
                        setDeleted(true);
                      } catch {
                        setDeleteErr("Couldn't reach the server.");
                      }
                    }}
                  >
                    Remove from gallery
                  </button>
                </div>
                {deleteErr && <p className="mt-2 text-danger">{deleteErr}</p>}
              </div>
            )}
            {fighter && deleted && (
              <p className="text-sm text-ok">Removed from the gallery. The original photo is unpublished.</p>
            )}
            {!fighter && !job?.error && !lost && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel-2 p-3 text-sm text-muted">
                <span className="min-w-[12rem] flex-1">
                  <b className="text-gold">Tip</b> · {TIPS[tip % TIPS.length]}
                </span>
                {!practice && (
                  <button onClick={startPractice} className="btn btn-ghost border-blaze" data-action="practice">
                    🥊 Practice while you wait
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {practice && (
          <section className="relative h-[62vh] min-h-[380px] overflow-hidden rounded-xl border border-line" data-practice>
            {ready && <GameScene />}
            {ready && <Hud />}
            {fighter && !gone && (
              <div className="absolute inset-x-0 top-14 flex justify-center">
                <Link href={`/fight?p1=${fighter.id}`} className="btn animate-[pop_0.4s_ease-out] border-ok bg-ok text-ink shadow-[0_4px_0_#000]">
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
