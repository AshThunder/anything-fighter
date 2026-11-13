"use client";
import { useState, type ReactNode } from "react";
import type { ArenaDef } from "@/lib/arenas";
import { sfx, unlockAudio } from "@/lib/game/audio";

export type ArenaView = "splat" | "pano";

const BADGE: Record<ArenaDef["source"], string> = {
  builtin: "Built-in stage",
  spatialgen: "Aholo SpatialGen · 3DGS",
  reality: "Aholo Reality · your room",
  sample: "Aholo Viewer · 3DGS",
};

/** Real preview: SpatialGen panorama / cover when the world exists, else a screenshot of the arena in-game. */
const thumb = (a: ArenaDef) => a.cover ?? a.panoUrl;

/**
 * Stage select. Playable arenas are big swipeable cards with real previews; worlds still in Aholo's
 * SpatialGen / Reality queue are tucked behind a "Coming soon" toggle. The room-scan builder lives above this picker.
 */
export function ArenaPicker({
  arenas,
  value,
  view,
  onChange,
  soonExtra,
}: {
  arenas: ArenaDef[];
  value: string;
  view: ArenaView;
  onChange: (id: string, view: ArenaView) => void;
  soonExtra?: ReactNode;
}) {
  const [showSoon, setShowSoon] = useState(false);
  const ready = arenas.filter((a) => !a.pending);
  const soon = arenas.filter((a) => a.pending);
  const cur = arenas.find((a) => a.id === value);
  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0">
        {ready.map((a) => {
          const sel = a.id === value;
          const src = thumb(a);
          return (
            <button
              key={a.id}
              data-arena={a.id}
              aria-pressed={sel}
              onClick={() => {
                unlockAudio();
                sfx("click");
                onChange(a.id, a.splatUrl ? view : "pano");
              }}
              className={`group relative flex aspect-[16/11] w-[78vw] max-w-sm shrink-0 snap-center flex-col overflow-hidden rounded-xl border-[3px] bg-panel-2 text-left transition sm:w-auto sm:max-w-none ${
                sel ? "border-blaze shadow-[0_4px_0_#a8350b]" : "border-line hover:border-line-strong"
              }`}
            >
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={`${a.name} preview`} className={`absolute inset-0 h-full w-full object-cover transition duration-500 ${sel ? "scale-105" : "group-hover:scale-105"}`} />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-panel px-3 text-center">
                    <span className="font-arcade text-3xl text-line-strong">{a.source === "reality" ? "🏠" : a.name.slice(0, 1)}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {a.source === "reality" ? "Aholo Reality 3DGS" : "Preview coming soon"}
                    </span>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fg">{BADGE[a.source]}</span>
                {sel && <span className="tag absolute right-2 top-2 bg-blaze">Selected</span>}
              </div>
              <span className={`shrink-0 truncate px-3 py-2 font-arcade text-lg ${sel ? "bg-blaze text-ink" : "bg-ink text-fg"}`}>{a.name}</span>
            </button>
          );
        })}
      </div>

      {cur?.splatUrl && cur.panoUrl && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Render as
          {(["splat", "pano"] as const).map((v) => (
            <button
              key={v}
              data-view={v}
              onClick={() => onChange(cur.id, v)}
              aria-pressed={view === v}
              className={`btn btn-sm ${view === v ? "border-fg bg-fg text-ink" : "btn-ghost"}`}
            >
              {v === "splat" ? "3DGS (Aholo Viewer)" : "Panorama"}
            </button>
          ))}
        </div>
      )}

      {(soon.length > 0 || soonExtra) && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowSoon((s) => !s)}
            aria-expanded={showSoon}
            data-action="coming-soon"
            className="flex min-h-12 items-center justify-between rounded-lg border border-line bg-panel px-3 py-2.5 text-left text-sm text-muted hover:border-line-strong"
          >
            <span>
              <b className="font-arcade text-xs tracking-wide text-gold">Coming soon</b>
              <span className="ml-2">
                {soon.length} AI world{soon.length === 1 ? "" : "s"} in Aholo&apos;s queue
              </span>
            </span>
            <span className={`transition ${showSoon ? "rotate-180" : ""}`}>▾</span>
          </button>
          {showSoon && (
            <div className="flex flex-col gap-2" data-coming-soon>
              <ul className="grid grid-cols-2 gap-2">
                {soon.map((a) => (
                  <li key={a.id} data-arena={a.id} title={a.prompt ?? a.note} className="rounded-lg border border-dashed border-line-strong bg-panel p-2.5">
                    <div className="truncate font-display text-sm font-bold text-fg">{a.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-dim">{BADGE[a.source]}</div>
                    <div className={`mt-1 text-[11px] ${a.stuck ? "text-danger" : "text-muted"}`}>
                      {a.stuck ? "Aholo queue stuck" : a.status === "RUNNING" ? `Generating ${Math.round((a.progress ?? 0) * 100)}%` : "Queued"}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-dim">
                Aholo runs one world job at a time per account; these appear as playable arenas the moment they finish.
              </p>
              {soonExtra}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
