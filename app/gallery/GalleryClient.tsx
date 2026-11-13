"use client";
/** Gallery of every Lux3D-forged fighter: source photo → Lux3D concept → rigged 3D (turntable) → RenderCloud poster. */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FighterDef } from "@/lib/fighters";
import { PoweredBy } from "@/components/ui/PoweredBy";
import { SiteHeader } from "@/components/ui/SiteHeader";

const VersusPreview = dynamic(() => import("@/components/landing/VersusPreview"), { ssr: false });

export default function GalleryClient() {
  const [fighters, setFighters] = useState<FighterDef[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
          <h1 className="arcade-title text-4xl">Gallery</h1>
          <p className="max-w-2xl text-base text-muted">
            Every fighter here started as one photo. Lux3D re-imagined it, built a PBR mesh, rigged it and retargeted its moves; RenderCloud shot the
            poster. Each card lists the Aholo services that built it.
          </p>
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
            // photo tile only when there is one (or a private one for player forges); concept + poster always
            const tiles = (
              [
                [f.photoUrl, "Photo"],
                [f.thumbUrl, "Lux3D concept"],
                [f.posterUrl, "RenderCloud"],
              ] as [string | undefined, string][]
            ).filter(([src, label]) => label !== "Photo" || src || f.id.startsWith("gen-"));
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
                <div className={`grid h-44 gap-px bg-line ${tiles.length === 3 ? "grid-cols-3" : tiles.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {tiles.map(([src, label]) => (
                    <div key={label} className="relative overflow-hidden bg-panel-2">
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt={`${f.name} ${label}`} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-dim">{label === "Photo" && f.id.startsWith("gen-") ? "🔒 Private" : "—"}</div>
                      )}
                      <span className="absolute bottom-1 left-1 rounded bg-ink px-1 py-px text-[9px] font-bold uppercase tracking-wider text-fg">{label}</span>
                    </div>
                  ))}
                </div>
                {open === f.id && (
                  <div className="h-64 border-b border-line bg-panel-2">
                    <VersusPreview a={f} solo />
                  </div>
                )}
                <PoweredBy fighter={f} className="px-3 pt-3" />
                <div className="grid grid-cols-3 gap-2 p-3">
                  <Link href={`/fight?p1=${f.id}`} className="btn btn-primary btn-sm" data-action="fight-as">
                    Fight as
                  </Link>
                  <Link href={`/fight?p2=${f.id}`} className="btn btn-outline-volt btn-sm" data-action="fight-against">
                    Fight vs
                  </Link>
                  <button onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id} className="btn btn-ghost btn-sm">
                    {open === f.id ? "Hide 3D" : "View 3D"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
