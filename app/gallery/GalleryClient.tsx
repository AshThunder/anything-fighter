"use client";
/** Gallery of every Lux3D-forged fighter: source photo → Lux3D concept → rigged 3D (turntable) → RenderCloud poster. */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FighterDef } from "@/lib/fighters";
import { PoweredBy } from "@/components/ui/PoweredBy";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { GALLERY_POLICY } from "@/lib/gallery-policy";

const VersusPreview = dynamic(() => import("@/components/landing/VersusPreview"), { ssr: false });

function GalleryImg({ src, alt }: { src: string; alt: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return <div className="flex h-full items-center justify-center bg-panel-2 px-2 text-center text-xs text-dim">Preview unavailable</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setOk(false)} className="h-full w-full object-cover object-center" />
  );
}

export default function GalleryClient() {
  const [fighters, setFighters] = useState<FighterDef[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<FighterDef | null>(null);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [reportState, setReportState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [reportError, setReportError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/fighters?all=1")
      .then((r) => r.json())
      // Lux3D showcase: no placeholder robot, no demo/mock forges
      .then((r) => setFighters(((r.fighters ?? []) as FighterDef[]).filter((f) => f.source === "lux3d")))
      .catch(() => setFailed(true));
  }, [attempt]);
  return (
    <main className="min-h-dvh bg-ink text-fg">
      <SiteHeader cta="forge" />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Forged with Aholo Lux3D</span>
          <h1 className="arcade-title text-[clamp(1.75rem,8vw,2.25rem)] [overflow-wrap:anywhere]">Gallery</h1>
          <p className="max-w-2xl text-base text-muted">
            Every fighter here started as one photo. Lux3D re-imagined it, built a PBR mesh, rigged it and retargeted its moves; RenderCloud shot the
            poster. Each card lists the Aholo services that built it.
          </p>
          <p className="max-w-2xl text-sm text-dim">{GALLERY_POLICY}</p>
        </div>
        {!fighters && !failed && (
          <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading fighters">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card overflow-hidden">
                <div className="skeleton h-44" />
                <div className="flex flex-col gap-2 p-3">
                  <div className="skeleton h-5 w-1/2 rounded" />
                  <div className="skeleton h-3 w-3/4 rounded" />
                  <div className="skeleton mt-1 h-11 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!fighters && failed && (
          <div className="card flex flex-col items-start gap-3 p-5" role="alert">
            <p className="text-base text-fg">Couldn&apos;t load the gallery.</p>
            <button
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
              className="btn btn-primary"
            >
              Try again
            </button>
          </div>
        )}
        {fighters && fighters.length === 0 && (
          <div className="card flex flex-col items-start gap-3 p-5" data-empty>
            <p className="font-arcade text-xl">No fighters yet</p>
            <p className="text-muted">Snap any object and Lux3D will turn it into the first one.</p>
            <Link href="/#forge" className="btn btn-primary">
              Forge a fighter
            </Link>
          </div>
        )}
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fighters?.map((f) => {
            const moves = Object.keys(f.animUrls ?? {}).length;
            const sourceLabel = f.photoKind === "example" ? "Example photo" : "Photo";
            const conceptUrl = f.thumbUrl && f.thumbUrl !== f.photoUrl ? f.thumbUrl : undefined;
            const conceptLabel = conceptUrl && f.posterUrl && conceptUrl !== f.posterUrl ? "Lux3D concept" : conceptUrl && !f.posterUrl ? "Preview" : "Lux3D concept";
            const posterUrl = f.posterUrl && f.posterUrl !== f.thumbUrl ? f.posterUrl : undefined;
            const showPrivate = !f.photoUrl && (f.id.startsWith("gen-") || f.id.startsWith("test-"));
            const after: { kind: "img" | "3d"; src?: string; label: string }[] = [];
            if (conceptUrl) after.push({ kind: "img", src: conceptUrl, label: conceptLabel });
            if (posterUrl) after.push({ kind: "img", src: posterUrl, label: "RenderCloud" });
            else if (f.modelUrl && !posterUrl) after.push({ kind: "3d", label: "3D" });
            const hasSource = !!(f.photoUrl || showPrivate);
            const hasArt = hasSource || after.some((a) => a.kind === "img");
            const inline3d = after.some((a) => a.kind === "3d");
            const show3d = open === f.id || (!hasArt && !!f.modelUrl);
            const panes = (hasSource ? 1 : 0) + after.length;
            const gridCols = panes >= 3 ? "grid-cols-3" : panes === 2 ? "grid-cols-2" : "grid-cols-1";
            return (
              <article key={f.id} className="card overflow-hidden" data-gallery-card={f.id}>
                <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: f.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-arcade text-base leading-tight [overflow-wrap:anywhere]">{f.name}</h2>
                    <div className="truncate text-xs text-muted">{f.tagline}</div>
                  </div>
                  <span className="shrink-0 rounded-md border border-line-strong px-1.5 py-0.5 text-[11px] font-bold text-fg">{moves ? `${moves} moves` : "freestyle"}</span>
                </div>
                {(hasSource || after.length > 0) && (
                  <div>
                    <div className="flex items-center justify-between gap-2 border-b border-line bg-ink px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-dim">
                      <span>Before</span>
                      <span aria-hidden>→</span>
                      <span>After</span>
                    </div>
                    <div className={`grid h-44 gap-px bg-line sm:h-52 ${gridCols}`}>
                      {showPrivate && (
                        <div className="relative flex h-full items-center justify-center bg-panel-2 px-2 text-center text-xs text-dim">
                          Kept private
                          <span className="absolute bottom-1 left-1 rounded bg-ink px-1 py-px text-[9px] font-bold uppercase tracking-wider text-fg">Photo</span>
                        </div>
                      )}
                      {f.photoUrl && (
                        <div className="relative overflow-hidden bg-panel-2">
                          <GalleryImg src={f.photoUrl} alt={`${f.name} ${sourceLabel}`} />
                          <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] rounded bg-ink px-1 py-px text-[9px] font-bold uppercase tracking-wider text-fg">{sourceLabel}</span>
                        </div>
                      )}
                      {after.map((pane) =>
                        pane.kind === "3d" ? (
                          <div key="3d" className="relative min-h-0 bg-panel-2" data-gallery-3d-inline={f.id}>
                            <VersusPreview a={f} solo />
                            <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-ink px-1 py-px text-[9px] font-bold uppercase tracking-wider text-fg">3D</span>
                          </div>
                        ) : (
                          <div key={pane.label} className="relative overflow-hidden bg-panel-2">
                            <GalleryImg src={pane.src!} alt={`${f.name} ${pane.label}`} />
                            <span className="absolute bottom-1 left-1 rounded bg-ink px-1 py-px text-[9px] font-bold uppercase tracking-wider text-fg">{pane.label}</span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
                {(open === f.id || (show3d && !inline3d)) && (
                  <div className={`border-b border-line bg-panel-2 ${hasArt ? "h-64" : "h-72"}`} data-gallery-3d={f.id}>
                    <VersusPreview a={f} solo />
                  </div>
                )}
                {!hasArt && !f.modelUrl && !inline3d && (
                  <div className="flex h-40 items-center justify-center bg-panel-2 text-sm text-dim">No preview available</div>
                )}
                <PoweredBy fighter={f} className="px-3 pt-3" />
                <div className="grid grid-cols-3 gap-1.5 p-3 sm:gap-2">
                  <Link href={`/fight?p1=${f.id}`} className="btn btn-primary btn-sm px-1.5 text-center text-xs leading-tight sm:text-sm" data-action="fight-as">
                    Fight as
                  </Link>
                  <Link href={`/fight?p2=${f.id}`} className="btn btn-outline-volt btn-sm px-1.5 text-center text-xs leading-tight sm:text-sm" data-action="fight-against">
                    Fight vs
                  </Link>
                  <button
                    onClick={() => setOpen(open === f.id ? null : f.id)}
                    aria-expanded={show3d || inline3d}
                    className="btn btn-ghost btn-sm px-1.5 text-center text-xs leading-tight sm:text-sm"
                    disabled={!f.modelUrl}
                  >
                    {!f.modelUrl ? "No 3D" : open === f.id ? "Hide 3D" : "View 3D"}
                  </button>
                </div>
                <div className="px-3 pb-3">
                  <button
                    type="button"
                    className="flex min-h-11 items-center text-sm font-semibold text-dim underline hover:text-muted"
                    data-action="report"
                    onClick={() => {
                      setReport(f);
                      setReason("");
                      setEmail("");
                      setReportState("idle");
                      setReportError(null);
                    }}
                  >
                    Report this card
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {report && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/80 p-3 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="report-title" data-report-dialog>
          <div className="card mb-[env(safe-area-inset-bottom)] max-h-[min(32rem,90dvh)] w-full max-w-md overflow-y-auto p-4 shadow-[0_8px_0_#000] sm:mb-0 sm:p-5">
            <h2 id="report-title" className="font-arcade text-xl">
              Report {report.name}
            </h2>
            <p className="mt-1 text-sm text-muted">Tell us why this card should be taken down (unsolicited photo, someone who didn&apos;t consent, other harm).</p>
            {reportState === "ok" ? (
              <p className="mt-3 text-sm text-ok">Thanks. We&apos;ll review it and can hide the fighter or unpublish the photo.</p>
            ) : (
              <>
                <label className="mt-3 block text-sm text-muted" htmlFor="report-reason">
                  Reason
                </label>
                <textarea
                  id="report-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-lg border-2 border-line-strong bg-ink px-3 py-2 text-sm text-fg"
                />
                <label className="mt-3 block text-sm text-muted" htmlFor="report-email">
                  Email (optional, if you want a reply)
                </label>
                <input
                  id="report-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 h-11 w-full rounded-lg border-2 border-line-strong bg-ink px-3 text-sm text-fg"
                />
                {reportState === "err" && reportError && (
                  <p className="mt-2 text-sm text-danger" role="alert">
                    {reportError}
                  </p>
                )}
              </>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {reportState !== "ok" && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={reportState === "busy"}
                  onClick={async () => {
                    setReportState("busy");
                    setReportError(null);
                    try {
                      const res = await fetch(`/api/fighters/${report.id}/report`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ reason, email: email || undefined }),
                      });
                      const j = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setReportState("err");
                        setReportError(j.error ?? "Couldn't send the report.");
                        return;
                      }
                      setReportState("ok");
                    } catch {
                      setReportState("err");
                      setReportError("Couldn't reach the server.");
                    }
                  }}
                >
                  {reportState === "busy" ? "Sending…" : "Send report"}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setReport(null)}
              >
                {reportState === "ok" ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
