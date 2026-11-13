"use client";
/** Gallery of every Lux3D-forged fighter: source photo → Lux3D concept → rigged 3D (turntable) → RenderCloud poster. */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FighterDef } from "@/lib/fighters";

const VersusPreview = dynamic(() => import("@/components/landing/VersusPreview"), { ssr: false });

export default function GalleryClient() {
  const [fighters, setFighters] = useState<FighterDef[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/fighters?all=1")
      .then((r) => r.json())
      .then((r) => setFighters((r.fighters as FighterDef[]).filter((f) => f.source !== "placeholder")));
  }, []);
  return (
    <main className="min-h-dvh bg-[#0d0b09] text-orange-50">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(242,127,13,0.14),transparent_60%)]" />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-5 py-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            ANYTHING<span className="text-orange-500">FIGHTER</span>
          </Link>
          <Link href="/" className="rounded-xl bg-orange-500 px-4 py-2 font-display text-sm font-bold text-black">
            + Forge a fighter
          </Link>
        </header>
        <div>
          <h1 className="font-display text-4xl font-black italic">Gallery</h1>
          <p className="text-sm text-orange-100/60">
            Every fighter here started as one photo. Lux3D re-imagined it, built a PBR mesh, rigged it and retargeted 10 moves; RenderCloud shot the poster.
          </p>
        </div>
        {!fighters && <p className="text-orange-200/50">Loading…</p>}
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fighters?.map((f) => (
            <article key={f.id} className="overflow-hidden rounded-2xl border border-orange-300/15 bg-[#1a1511]/80" data-gallery-card={f.id}>
              <div className="grid h-44 grid-cols-3 gap-px bg-black/50">
                {[
                  [f.photoUrl, "Photo"],
                  [f.thumbUrl, "Lux3D concept"],
                  [f.posterUrl, "RenderCloud"],
                ].map(([src, label]) => (
                  <div key={label} className="relative overflow-hidden bg-black/40">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={`${f.name} ${label}`} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-orange-200/30">—</div>
                    )}
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[8px] uppercase tracking-wider text-orange-100/70">{label}</span>
                  </div>
                ))}
              </div>
              {open === f.id && (
                <div className="h-64 bg-[radial-gradient(circle_at_50%_80%,rgba(242,127,13,0.15),transparent_70%)]">
                  <VersusPreview a={f} solo />
                </div>
              )}
              <div className="flex items-center gap-2 p-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: f.color }} />
                <div className="flex-1">
                  <div className="font-display font-bold">{f.name}</div>
                  <div className="text-[11px] text-orange-200/50">
                    {f.tagline} · {Object.keys(f.animUrls ?? {}).length} moves
                  </div>
                </div>
                <button onClick={() => setOpen(open === f.id ? null : f.id)} className="rounded-lg border border-orange-300/25 px-2.5 py-1 text-xs">
                  {open === f.id ? "Hide 3D" : "3D"}
                </button>
                <Link href={`/fight?p1=${f.id}`} className="rounded-lg bg-orange-500 px-2.5 py-1 font-display text-xs font-bold text-black">
                  Fight
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
