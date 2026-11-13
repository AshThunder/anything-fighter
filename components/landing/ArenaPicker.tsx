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
 * SpatialGen / Reality queue are tucked behind a "Coming soon" toggle (with the room-scan builder).
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
              className={`group relative aspect-[16/10] w-[78vw] max-w-sm shrink-0 snap-center overflow-hidden rounded-2xl border-2 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-sky-400 sm:w-auto sm:max-w-none ${
                sel ? "border-orange-400 shadow-[0_0_0_3px_rgba(242,127,13,0.35),0_10px_40px_rgba(242,127,13,0.25)]" : "border-white/10 opacity-80 hover:opacity-100"
              }`}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={`${a.name} preview`} className={`absolute inset-0 h-full w-full object-cover transition duration-500 ${sel ? "scale-105" : "group-hover:scale-105"}`} />
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(242,127,13,0.55),#1a1511_70%)]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
              <span className="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-100/90">{BADGE[a.source]}</span>
              {sel && <span className="absolute right-2 top-2 rounded-md bg-orange-500 px-1.5 py-0.5 font-arcade text-[10px] text-black">Selected</span>}
              <span className="absolute inset-x-3 bottom-2 truncate font-arcade text-xl text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]">{a.name}</span>
            </button>
          );
        })}
      </div>

      {cur?.splatUrl && cur.panoUrl && (
        <div className="flex items-center gap-2 text-xs text-orange-200/70">
          Render as
          {(["splat", "pano"] as const).map((v) => (
            <button
              key={v}
              data-view={v}
              onClick={() => onChange(cur.id, v)}
              className={`rounded-lg border px-2.5 py-1 ${view === v ? "border-orange-400 bg-orange-500/15 text-orange-50" : "border-orange-300/15"}`}
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
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-sm text-orange-100/80 hover:bg-white/[0.06]"
          >
            <span>
              <b className="font-arcade text-xs tracking-wide text-orange-300">Coming soon</b>
              <span className="ml-2 text-orange-200/60">
                {soon.length} AI world{soon.length === 1 ? "" : "s"} in Aholo&apos;s queue · build your own
              </span>
            </span>
            <span className={`transition ${showSoon ? "rotate-180" : ""}`}>▾</span>
          </button>
          {showSoon && (
            <div className="flex flex-col gap-2" data-coming-soon>
              <ul className="grid grid-cols-2 gap-2">
                {soon.map((a) => (
                  <li key={a.id} data-arena={a.id} title={a.prompt ?? a.note} className="rounded-xl border border-dashed border-white/15 bg-black/30 p-2.5">
                    <div className="truncate font-display text-sm font-bold text-orange-50/80">{a.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-orange-200/50">{BADGE[a.source]}</div>
                    <div className={`mt-1 text-[11px] ${a.stuck ? "text-red-300/80" : "text-orange-200/70"}`}>
                      {a.stuck ? "Aholo queue stuck" : a.status === "RUNNING" ? `Generating ${Math.round((a.progress ?? 0) * 100)}%` : "Queued"}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-orange-200/50">
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
