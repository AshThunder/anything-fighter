"use client";
import dynamic from "next/dynamic";
import { useRef, useState, type KeyboardEvent } from "react";
import type { FighterDef } from "@/lib/fighters";
import { sfx, unlockAudio } from "@/lib/game/audio";
import { PoweredBy } from "@/components/ui/PoweredBy";

const VersusPreview = dynamic(() => import("./VersusPreview"), { ssr: false });

const P1C = "#ff5a1f";
const P2C = "#22c7ff";

function portraitSrcs(f: FighterDef): string[] {
  return [f.thumbUrl, f.posterUrl, f.photoUrl].filter((u): u is string => !!u);
}

function Silhouette({ color }: { color: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ background: `${color}26` }} aria-hidden>
      <svg viewBox="0 0 64 96" className="h-[80%] w-auto" fill={color} opacity="0.75">
        <circle cx="32" cy="16" r="10" />
        <path d="M18 34c0-5 6-9 14-9s14 4 14 9v7c0 3-2 5-5 6l3 30c.4 3.5-2 7-5.5 7h-19c-3.5 0-5.9-3.5-5.5-7l3-30c-3-1-5-3-5-6z" />
      </svg>
    </div>
  );
}

function Portrait({ f, i }: { f: FighterDef; i: number }) {
  const srcs = portraitSrcs(f);
  const [idx, setIdx] = useState(0);
  const src = srcs[idx];
  if (!src) return <Silhouette color={f.color} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setIdx((n) => n + 1)}
      className="h-full w-full origin-bottom object-cover animate-[idlebob_2.4s_ease-in-out_infinite]"
      style={{ animationDelay: `${-(i * 0.37) % 2.4}s` }}
    />
  );
}

function PickSlot({
  side,
  active,
  tag,
  fighter,
  onSelect,
}: {
  side: 0 | 1;
  active: boolean;
  tag: string;
  fighter?: FighterDef;
  onSelect: () => void;
}) {
  const c = side === 0 ? P1C : P2C;
  return (
    <button
      type="button"
      data-side={side}
      aria-pressed={active}
      aria-label={`${tag}: ${fighter?.name ?? "not chosen yet"}${active ? ", currently picking" : ""}`}
      onClick={onSelect}
      className="flex min-h-[4.75rem] flex-1 items-center gap-2.5 overflow-hidden rounded-xl border-[3px] bg-panel px-2.5 py-2 text-left transition active:scale-[0.99]"
      style={{
        borderColor: active ? c : "var(--color-line-strong)",
        boxShadow: active ? `0 4px 0 ${c}` : "0 4px 0 #000",
      }}
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-panel-2">
        {fighter ? <Portrait key={fighter.id} f={fighter} i={side} /> : <Silhouette color={c} />}
      </div>
      <div className="min-w-0 flex-1">
        <span className="tag" style={{ background: c }}>
          {tag}
        </span>
        <div className="mt-0.5 truncate font-arcade text-sm leading-tight sm:text-base">{fighter?.name ?? "—"}</div>
      </div>
    </button>
  );
}

/**
 * Character select: two explicit YOU/CPU (or P1/P2) slots, plain-language instructions, a portrait grid
 * with large side badges, a Random button, and the live 3D versus preview.
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
  const youTag = versus === "2p" ? "P1" : "YOU";
  const oppTag = versus === "2p" ? "P2" : "CPU";
  const hint = side === 0 ? "Pick your fighter" : versus === "2p" ? "Pick player 2's fighter" : "Pick your opponent";

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

  const pickRandom = () => {
    unlockAudio();
    const exclude = side === 0 ? p2 : p1;
    const pool = fighters.filter((f) => f.id !== exclude);
    const list = pool.length ? pool : fighters;
    if (!list.length) return;
    pick(side, list[Math.floor(Math.random() * list.length)].id);
  };

  return (
    <section className="flex flex-col gap-3" data-select>
      <h2 className="arcade-title text-2xl text-fg sm:text-3xl">
        <span className="text-blaze">2.</span> Select fighter
      </h2>

      <div className="flex gap-2" role="group" aria-label="Chosen fighters">
        <PickSlot side={0} active={side === 0} tag={youTag} fighter={a} onSelect={() => setSide(0)} />
        <PickSlot side={1} active={side === 1} tag={oppTag} fighter={b} onSelect={() => setSide(1)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-h-6 text-base font-semibold text-fg" aria-live="polite" data-pick-hint>
          {hint}
          <span className="hidden font-normal text-dim [@media(hover:hover)]:inline">
            {" "}
            · arrows + Enter · shift-click / right-click = {oppTag}
          </span>
        </p>
        <button type="button" onClick={pickRandom} className="btn btn-ghost btn-sm" data-action="random">
          Random
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.05fr_1fr] lg:items-start">
        <div className="relative h-[32vh] min-h-[200px] max-h-[440px] overflow-hidden rounded-xl border border-line bg-panel sm:h-[40vh] lg:sticky lg:top-20 lg:h-[44vh]">
          <div className="absolute inset-y-0 left-0 w-1/2 bg-blaze/10" />
          <div className="absolute inset-y-0 right-0 w-1/2 bg-volt/10" />
          <div className="absolute inset-x-0 bottom-0 h-[22%] border-t border-line bg-ink/60" />
          <VersusPreview a={a} b={b} />
          <div className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 -rotate-6 font-arcade text-5xl text-gold text-stroke [text-shadow:0_4px_0_#000] sm:text-6xl">
            VS
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[46%]">
            <span className="tag" style={{ background: P1C }}>
              {youTag}
            </span>
            <div className="mt-1 truncate font-arcade text-lg leading-tight text-fg text-stroke sm:text-2xl">{a?.name ?? "—"}</div>
          </div>
          <div className="pointer-events-none absolute bottom-3 right-3 max-w-[46%] text-right">
            <span className="tag" style={{ background: P2C }}>
              {oppTag}
            </span>
            <div className="mt-1 truncate font-arcade text-lg leading-tight text-fg text-stroke sm:text-2xl">{b?.name ?? "—"}</div>
          </div>
          {a && <PoweredBy fighter={a} className="pointer-events-none absolute inset-x-3 top-2.5 hidden sm:flex" />}
        </div>

        <div ref={grid} onKeyDown={onKey} className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4" role="listbox" aria-label="Fighters">
          {fighters.map((f, i) => {
            const is1 = f.id === p1;
            const is2 = f.id === p2;
            const color = is1 ? P1C : is2 ? P2C : undefined;
            const badge = is1 ? youTag : is2 ? oppTag : null;
            return (
              <button
                key={f.id}
                data-fighter={f.id}
                role="option"
                aria-selected={is1 || is2}
                aria-label={`${f.name}${is1 ? `, ${youTag}` : ""}${is2 ? `, ${oppTag}` : ""}`}
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
                  {badge && (
                    <span
                      className="tag absolute left-1 top-1 px-1.5 py-1 text-xs sm:text-sm"
                      style={{ background: color }}
                    >
                      {badge}
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
    </section>
  );
}
