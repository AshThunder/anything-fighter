"use client";
import dynamic from "next/dynamic";
import { useRef, type KeyboardEvent } from "react";
import type { FighterDef } from "@/lib/fighters";
import { sfx, unlockAudio } from "@/lib/game/audio";
import { PoweredBy } from "@/components/ui/PoweredBy";

const VersusPreview = dynamic(() => import("./VersusPreview"), { ssr: false });

const P1C = "#ff5a1f";
const P2C = "#22c7ff";

function Portrait({ f, i }: { f: FighterDef; i: number }) {
  return f.thumbUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={f.thumbUrl}
      alt=""
      loading="lazy"
      draggable={false}
      className="h-full w-full origin-bottom object-cover animate-[idlebob_2.4s_ease-in-out_infinite]"
      style={{ animationDelay: `${-(i * 0.37) % 2.4}s` }}
    />
  ) : (
    <span className="flex h-full w-full items-center justify-center font-arcade text-3xl" style={{ color: f.color }}>
      {f.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function NamePlate({ f, side, tag }: { f?: FighterDef; side: 0 | 1; tag: string }) {
  const c = side === 0 ? P1C : P2C;
  return (
    <div className={`pointer-events-none absolute bottom-3 ${side === 0 ? "left-0 pl-3" : "right-0 pr-3 text-right"} max-w-[48%]`}>
      <div
        className="inline-block px-3 py-1 font-arcade text-[11px] text-black skew-panel"
        style={{ background: c, animation: `${side === 0 ? "slidein-l" : "slidein-r"} 0.35s ease-out` }}
        key={f?.id}
      >
        <span>{tag}</span>
      </div>
      <div className="mt-1 truncate font-arcade text-lg leading-tight text-fg text-stroke sm:text-2xl">{f?.name ?? "—"}</div>
      <div className="truncate text-xs text-muted">{f?.tagline}</div>
    </div>
  );
}

/**
 * Character select (screenpack "Select Info" style): live 3D idle preview of both picks over a big portrait grid
 * with P1 / CPU cursors. Tap places the active cursor, then hands over to the other side. Arrow keys move focus.
 */
export function SelectScreen({
  fighters,
  p1,
  p2,
  side,
  setSide,
  pick,
  versus,
}: {
  fighters: FighterDef[];
  p1?: string;
  p2?: string;
  side: 0 | 1;
  setSide: (s: 0 | 1) => void;
  pick: (side: 0 | 1, id: string) => void;
  versus: "cpu" | "2p";
}) {
  const grid = useRef<HTMLDivElement>(null);
  const a = fighters.find((f) => f.id === p1);
  const b = fighters.find((f) => f.id === p2);
  const p2tag = versus === "2p" ? "P2" : "CPU";

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const btns = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>("button[data-fighter]") ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const cols = Math.round(grid.current!.clientWidth / btns[0].clientWidth) || 3;
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = btns[Math.max(0, Math.min(btns.length - 1, i + d))];
    n.focus();
    sfx("click");
  };

  return (
    <section className="flex flex-col gap-3" data-select>
      <div className="flex items-end justify-between gap-2">
        <h2 className="arcade-title text-2xl text-fg sm:text-3xl">
          <span className="text-blaze">2.</span> Select fighter
        </h2>
        <div className="flex overflow-hidden rounded-lg border-2 border-line-strong" role="tablist" aria-label="Which side you're picking">
          {([0, 1] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={side === s}
              data-side={s}
              onClick={() => setSide(s)}
              className={`flex min-h-11 min-w-14 items-center justify-center px-3 font-arcade text-sm transition ${side === s ? "text-ink" : "bg-panel text-muted hover:text-fg"}`}
              style={side === s ? { background: s === 0 ? P1C : P2C } : undefined}
            >
              {s === 0 ? "1P" : p2tag}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.05fr_1fr] lg:items-start">
        {/* versus stage: both picks idling in 3D; flat split backdrop in the two side colours */}
        <div className="relative h-[44vh] min-h-[260px] max-h-[440px] overflow-hidden rounded-xl border border-line bg-panel lg:sticky lg:top-20">
          <div className="absolute inset-y-0 left-0 w-1/2 bg-blaze/10" />
          <div className="absolute inset-y-0 right-0 w-1/2 bg-volt/10" />
          <div className="absolute inset-x-0 bottom-0 h-[22%] border-t border-line bg-ink/60" />
          <VersusPreview a={a} b={b} />
          <div className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 -rotate-6 font-arcade text-5xl text-gold text-stroke [text-shadow:0_4px_0_#000] sm:text-6xl">
            VS
          </div>
          <NamePlate f={a} side={0} tag="1P" />
          <NamePlate f={b} side={1} tag={p2tag} />
          {a && <PoweredBy fighter={a} className="pointer-events-none absolute inset-x-3 top-2.5 hidden sm:flex" />}
        </div>

        {/* portrait grid with cursors */}
        <div>
          <p className="mb-2 flex min-h-6 items-center gap-1.5 text-sm text-muted" aria-live="polite">
            Tap a fighter for
            <span className="tag" style={{ background: side === 0 ? P1C : P2C }}>
              {side === 0 ? "1P" : p2tag}
            </span>
            <span className="hidden text-xs text-dim [@media(hover:hover)]:inline">· arrows + Enter · shift-click / right-click = {p2tag}</span>
          </p>
          <div ref={grid} onKeyDown={onKey} className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4" role="listbox" aria-label="Fighters">
            {fighters.map((f, i) => {
              const is1 = f.id === p1;
              const is2 = f.id === p2;
              const color = is1 ? P1C : is2 ? P2C : undefined;
              return (
                <button
                  key={f.id}
                  data-fighter={f.id}
                  role="option"
                  aria-selected={is1 || is2}
                  aria-label={`${f.name}${is1 ? ", 1P" : ""}${is2 ? `, ${p2tag}` : ""}`}
                  onClick={(e) => {
                    unlockAudio();
                    pick(e.shiftKey ? 1 : side, f.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    pick(1, f.id);
                  }}
                  className={`group relative flex aspect-[3/4] flex-col overflow-hidden rounded-lg border-[3px] bg-panel-2 text-left transition active:scale-95 ${
                    color ? "" : "border-line hover:border-line-strong"
                  }`}
                  style={color ? { borderColor: color, boxShadow: `0 4px 0 ${color}55` } : undefined}
                >
                  <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: `${f.color}26` }}>
                    <Portrait f={f} i={i} />
                    {is1 && (
                      <span className="tag absolute left-1 top-1 animate-[cursorpulse_1s_ease-in-out_infinite]" style={{ background: P1C }}>
                        1P
                      </span>
                    )}
                    {is2 && (
                      <span className="tag absolute right-1 top-1 animate-[cursorpulse_1s_ease-in-out_infinite]" style={{ background: P2C }}>
                        {p2tag}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 border-t border-line bg-ink px-1.5 py-1.5" style={color ? { background: color } : undefined}>
                    <div className={`font-arcade text-[11px] leading-tight [overflow-wrap:anywhere] line-clamp-2 sm:text-xs ${color ? "text-ink" : "text-fg"}`}>{f.name}</div>
                    {f.tagline.includes("freestyle") && <div className={`text-[10px] font-semibold uppercase tracking-wider ${color ? "text-ink/80" : "text-gold"}`}>freestyle</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
