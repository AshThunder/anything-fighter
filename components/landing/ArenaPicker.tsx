"use client";
import type { ArenaDef } from "@/lib/arenas";

export type ArenaView = "splat" | "pano";

const BADGE: Record<ArenaDef["source"], string> = {
  builtin: "Built-in",
  spatialgen: "SpatialGen",
  reality: "Aholo Reality",
  sample: "Viewer sample",
};

/** Arena cards: built-in ring, SpatialGen worlds (3DGS or panorama view), Aholo Reality room scans. */
export function ArenaPicker({
  arenas,
  value,
  view,
  onChange,
}: {
  arenas: ArenaDef[];
  value: string;
  view: ArenaView;
  onChange: (id: string, view: ArenaView) => void;
}) {
  const cur = arenas.find((a) => a.id === value);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {arenas.map((a) => {
          const sel = a.id === value;
          return (
            <button
              key={a.id}
              data-arena={a.id}
              onClick={() => !a.pending && onChange(a.id, a.splatUrl ? view : "pano")}
              disabled={a.pending}
              title={a.note ?? a.prompt}
              className={`relative h-16 overflow-hidden rounded-xl border text-left ${sel ? "border-orange-400 ring-1 ring-orange-400" : a.pending ? "cursor-wait border-dashed border-orange-300/20 opacity-50" : "border-orange-300/15 opacity-80 hover:opacity-100"}`}
            >
              {a.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(242,127,13,0.5),#1a1511_70%)]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
              <span className="absolute left-1.5 top-1 rounded bg-black/55 px-1 text-[8px] uppercase tracking-wider text-orange-100/80">{BADGE[a.source]}</span>
              <span className="absolute bottom-1 left-1.5 right-1 truncate font-display text-[11px] font-bold">{a.name}</span>
              {a.pending && (
                <span className={`absolute right-1.5 top-1 text-[8px] uppercase tracking-wider ${a.stuck ? "text-red-300/80" : "animate-pulse text-orange-200/80"}`}>
                  {a.stuck ? "Aholo queue stuck" : a.status === "RUNNING" ? `generating ${Math.round((a.progress ?? 0) * 100)}%` : a.status ? "queued" : "generating…"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {arenas.some((a) => a.pending) && (
        <p className="text-[10px] text-orange-200/45">
          Greyed-out worlds are still in Aholo&apos;s SpatialGen / Reality queue (one job at a time per account). Every fight works
          in the ready arenas meanwhile.
        </p>
      )}
      {cur?.splatUrl && cur.panoUrl && (
        <div className="flex items-center gap-2 text-[11px] text-orange-200/60">
          Render as
          {(["splat", "pano"] as const).map((v) => (
            <button
              key={v}
              data-view={v}
              onClick={() => onChange(cur.id, v)}
              className={`rounded-lg border px-2 py-0.5 ${view === v ? "border-orange-400 bg-orange-500/15 text-orange-50" : "border-orange-300/15"}`}
            >
              {v === "splat" ? "3DGS (Aholo Viewer)" : "Panorama"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
