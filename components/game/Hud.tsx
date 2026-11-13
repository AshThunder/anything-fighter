"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useGame } from "@/lib/game/store";
import type { FighterDef } from "@/lib/fighters";
import { METER_MAX, sim } from "@/lib/game/sim";
import { jump, press, setHeld } from "@/lib/game/input";
import { isMuted, setMuted, sfx, unlockAudio } from "@/lib/game/audio";
import { getClip, onClip, snapshotCard } from "@/lib/game/recorder";

export const gameCanvases = () => Array.from(document.querySelectorAll<HTMLCanvasElement>("[data-game-root] canvas"));

const SIDE_C = ["#f97316", "#38bdf8"] as const;

/** Screenpack-style lifebar: portrait, slanted bar with lagging damage layer, name plate. */
function HealthBar({ idx }: { idx: 0 | 1 }) {
  const hp = useGame((s) => s.hp[idx]);
  const f = useGame((s) => s.fighters?.[idx]);
  const mode = useGame((s) => s.mode);
  const lastHit = useGame((s) => s.lastHit);
  const right = idx === 1;
  const shaking = lastHit && lastHit.who === idx && !lastHit.blocked;
  const tag = idx === 0 ? "P1" : mode === "2p" ? "P2" : mode === "practice" ? "SPAR" : "CPU";
  const low = hp <= 30;
  const face = f?.thumbUrl ?? f?.posterUrl;
  return (
    <div className={`flex min-w-0 flex-1 items-start gap-1.5 md:gap-2 ${right ? "flex-row-reverse" : ""}`} data-lifebar={idx}>
      <div
        className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border-2 bg-black/60 md:h-14 md:w-14"
        style={{ borderColor: SIDE_C[idx], background: `radial-gradient(circle at 50% 70%, ${f?.color ?? "#333"}66, #0d0b09)` }}
      >
        {face && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={face} alt="" className={`h-full w-full object-cover ${right ? "-scale-x-100" : ""} ${hp <= 0 ? "grayscale" : ""}`} />
        )}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${right ? "items-end" : "items-start"}`}>
        <div
          key={shaking ? lastHit.id : "still"}
          className={`relative h-4 w-full overflow-hidden border border-black/80 bg-black/70 shadow-[0_2px_0_rgba(0,0,0,0.5)] md:h-6 ${right ? "-scale-x-100" : ""} ${shaking ? "animate-[barshake_0.3s_ease-out]" : ""}`}
          style={{ clipPath: "polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)" }}
        >
          <div className="absolute inset-y-0 left-0 bg-white/80 transition-[width] duration-[900ms] ease-in" style={{ width: `${hp}%` }} />
          <div className="absolute inset-y-0 left-0 bg-red-600 transition-[width] delay-150 duration-700 ease-out" style={{ width: `${hp}%` }} />
          <div
            className={`absolute inset-y-0 left-0 transition-[width] duration-100 ${low ? "animate-[lowhp_0.6s_ease-in-out_infinite]" : ""}`}
            style={{ width: `${hp}%`, background: low ? "linear-gradient(180deg,#fca5a5,#dc2626 60%,#7f1d1d)" : "linear-gradient(180deg,#fef08a,#facc15 45%,#ea580c)" }}
          />
          <div className="absolute inset-x-0 top-0 h-1/3 bg-white/25" />
        </div>
        <div className={`flex max-w-full items-center gap-1.5 ${right ? "flex-row-reverse" : ""}`}>
          <span className="rounded px-1 font-arcade text-[9px] leading-tight text-black md:text-[10px]" style={{ background: SIDE_C[idx] }}>
            {tag}
          </span>
          <span className="truncate font-arcade text-[11px] uppercase leading-tight text-white text-stroke md:text-sm">{f?.name}</span>
        </div>
      </div>
    </div>
  );
}

function Timer() {
  const [t, setT] = useState(60);
  const mode = useGame((s) => s.mode);
  useEffect(() => {
    const i = setInterval(() => setT(Math.ceil(sim.time)), 250);
    return () => clearInterval(i);
  }, []);
  const urgent = mode !== "practice" && t <= 10;
  return (
    <div
      className={`flex h-11 w-12 shrink-0 items-center justify-center rounded-lg border-2 bg-black/70 font-arcade text-2xl tabular-nums md:h-14 md:w-16 md:text-3xl ${urgent ? "animate-pulse border-red-500 text-red-400" : "border-white/20 text-white"}`}
      data-timer
    >
      {mode === "practice" ? "∞" : Math.max(0, t)}
    </div>
  );
}

/** Whole-screen shake on heavy clean hits (on top of the 3D camera shake). */
function useScreenShake() {
  const lastHit = useGame((s) => s.lastHit);
  useEffect(() => {
    if (!lastHit || lastHit.blocked || !lastHit.heavy) return;
    const el = document.querySelector<HTMLElement>("[data-game-root]");
    el?.animate(
      [
        { transform: "translate(0,0)" },
        { transform: "translate(-7px,4px)" },
        { transform: "translate(6px,-4px)" },
        { transform: "translate(-3px,2px)" },
        { transform: "translate(0,0)" },
      ],
      { duration: 260, easing: "ease-out" },
    );
  }, [lastHit]);
}

/** Live super-meter values (polled from the sim, 10×/s). */
function useMeters(): [number, number] {
  const [m, setM] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const i = setInterval(() => {
      const a = Math.round(sim.f[0].meter), b = Math.round(sim.f[1].meter);
      setM((p) => (p[0] === a && p[1] === b ? p : [a, b]));
    }, 100);
    return () => clearInterval(i);
  }, []);
  return m;
}

/** Super meter under each lifebar; glows and says SUPER when full. */
function MeterBar({ idx, value }: { idx: 0 | 1; value: number }) {
  const full = value >= METER_MAX;
  const right = idx === 1;
  return (
    <div className={`flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`} data-meter={idx} data-meter-value={value}>
      <div className={`relative h-2 w-24 overflow-hidden rounded-sm border border-black/70 bg-black/70 md:h-2.5 md:w-40 ${right ? "-scale-x-100" : ""}`}>
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-150 ${full ? "animate-pulse" : ""}`}
          style={{ width: `${value}%`, background: full ? "linear-gradient(90deg,#22d3ee,#e879f9,#facc15)" : "linear-gradient(90deg,#0ea5e9,#22d3ee)" }}
        />
      </div>
      <span className={`font-arcade text-[8px] leading-none md:text-[10px] ${full ? "text-yellow-300 drop-shadow-[0_0_6px_rgba(250,204,21,0.9)]" : "text-cyan-200/60"}`}>
        {full ? "SUPER" : "METER"}
      </span>
    </div>
  );
}

/** SPECIAL / SUPER / PARRY / COUNTER / KNOCKDOWN callouts + the white SUPER flash. */
function Callout() {
  const c = useGame((s) => s.callout);
  const fighters = useGame((s) => s.fighters);
  const [hidden, setHidden] = useState(-1);
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(() => setHidden(c.id), c.kind === "super" ? 1300 : 800);
    return () => clearTimeout(t);
  }, [c]);
  const show = c && c.id !== hidden ? c : null;
  if (!show) return null;
  const sup = show.kind === "super";
  const color = show.kind === "parry" ? "#e0f2fe" : sup ? "#facc15" : show.kind === "special" ? fighters?.[show.who].color ?? "#f97316" : "#fde68a";
  return (
    <>
      {sup && <div key={`f${show.id}`} className="pointer-events-none absolute inset-0 bg-white animate-[superflash_0.45s_ease-out_forwards]" data-super-flash />}
      <div
        key={show.id}
        className={`pointer-events-none absolute inset-x-0 ${sup ? "top-[30%]" : "top-[24%]"} flex flex-col items-center animate-[pop_0.25s_ease-out]`}
        data-callout={show.kind}
      >
        <div
          className={`font-arcade text-stroke ${sup ? "text-6xl md:text-8xl" : "text-3xl md:text-5xl"}`}
          style={{ color, filter: `drop-shadow(0 0 18px ${color})` }}
        >
          {show.text}
        </div>
        {sup && fighters && <div className="mt-1 font-display text-sm uppercase tracking-[0.3em] text-white/90">{fighters[show.who].name}</div>}
      </div>
    </>
  );
}

/** How this fighter's body + moves came from Aholo (shown on the VS screen). */
function aholoTag(f: FighterDef) {
  const n = Object.keys(f.animUrls ?? {}).length;
  if (!f.id.startsWith("gen-")) return "Aholo Lux3D starter · retargeted clips";
  return n ? `Forged with Lux3D · rig + ${n} Aholo clips` : "Forged with Lux3D · freestyle moves";
}

/** Pre-round VS screen: RenderCloud posters / Lux3D concepts slam in from both sides. Tap to skip. */
function VsSplash() {
  const fighters = useGame((s) => s.fighters);
  const arena = useGame((s) => s.arena);
  const mode = useGame((s) => s.mode);
  const setPhase = useGame((s) => s.setPhase);
  const phase = useGame((s) => s.phase);
  if (!fighters) return null;
  const tags = ["1P", mode === "2p" ? "2P" : "CPU"];
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-20 overflow-hidden bg-[#0d0b09]"
      onClick={() => phase === "vs" && setPhase("intro")}
      data-vs-splash
    >
      {fighters.map((f, i) => (
        <div
          key={`bg${f.id}`}
          className="absolute inset-0"
          style={{
            clipPath: i === 0 ? "polygon(0 0, 100% 0, 100% 38%, 0 62%)" : "polygon(0 62%, 100% 38%, 100% 100%, 0 100%)",
            background: `linear-gradient(${i === 0 ? 135 : 315}deg, ${SIDE_C[i]}d0, ${f.color}40 50%, #0d0b09 85%)`,
          }}
        >
          <div className="absolute inset-0 opacity-20 [background:repeating-linear-gradient(-60deg,transparent_0_14px,rgba(255,255,255,0.35)_14px_16px)] animate-[stripes_0.8s_linear_infinite]" />
        </div>
      ))}
      {fighters.map((f, i) => {
        const img = f.posterUrl ?? f.thumbUrl;
        const left = i === 0;
        return (
          <div
            key={f.id}
            className={`absolute flex w-[46vw] max-w-[300px] flex-col gap-2 md:top-1/2 md:w-[24vw] md:-translate-y-1/2 ${
              left ? "left-[5%] top-[7%] items-start md:left-[8%]" : "bottom-[7%] right-[5%] items-end md:bottom-auto md:right-[8%]"
            }`}
            style={{ animation: `${left ? "slidein-l" : "slidein-r"} 0.45s cubic-bezier(.2,.9,.3,1.2) both` }}
          >
            <div
              className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border-4 shadow-[0_14px_40px_rgba(0,0,0,0.6)]"
              style={{ borderColor: SIDE_C[i], transform: `rotate(${left ? -4 : 4}deg) skewX(10deg)`, background: `radial-gradient(circle at 50% 70%, ${f.color}66, #120e0b 75%)` }}
            >
              {img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt="" className={`h-full w-full object-cover ${left ? "" : "-scale-x-100"}`} />
              )}
              {f.posterUrl && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[8px] uppercase tracking-wider text-white/80">RenderCloud</span>}
            </div>
            <div className={`flex flex-col ${left ? "items-start pl-3" : "items-end pr-3 text-right"}`} style={{ transform: "skewX(10deg)" }}>
              <span className="px-2 font-arcade text-xs text-black md:text-sm" style={{ background: SIDE_C[i] }}>
                {tags[i]}
              </span>
              <span className="font-arcade text-2xl leading-none text-white text-stroke drop-shadow-[0_4px_0_rgba(0,0,0,0.6)] md:text-4xl">{f.name}</span>
              <span className="mt-1 px-2 text-[9px] uppercase tracking-wider text-white/70 md:text-[11px]" data-aholo-tag>
                {aholoTag(f)}
              </span>
            </div>
          </div>
        );
      })}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="font-arcade text-[6.5rem] leading-none text-orange-400 text-stroke drop-shadow-[0_0_40px_rgba(242,127,13,0.9)] animate-[vsslam_0.5s_0.35s_ease-out_both] md:text-[11rem]">
          VS
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-0.5 pb-[env(safe-area-inset-bottom)] text-center">
        <div className="font-arcade text-xs tracking-widest text-orange-100/80 md:text-sm">Stage · {arena.name ?? "Neon Ring"}</div>
        <div className="text-[10px] text-white/50">tap to skip</div>
      </div>
    </div>
  );
}

function HitCallout() {
  const show = useGame((s) => s.lastHit);
  if (!show) return null;
  return (
    <>
      {show.heavy && !show.blocked && <div key={`f${show.id}`} className="pointer-events-none absolute inset-0 animate-[flash_0.25s_ease-out_forwards] bg-orange-200/30" />}
      <div
        key={show.id}
        className={`pointer-events-none absolute top-[28%] font-display text-2xl font-black uppercase italic drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] animate-[popfade_0.6s_ease-out_forwards] md:text-3xl ${
          show.who === 1 ? "right-[18%] text-orange-400" : "left-[18%] text-sky-300"
        }`}
      >
        {show.blocked ? "Blocked" : show.heavy ? `Smash! -${show.dmg}` : `-${show.dmg}`}
      </div>
    </>
  );
}

function ComboCounter() {
  const combo = useGame((s) => s.combo);
  if (!combo || combo.n < 2) return null;
  return (
    <div
      key={combo.id}
      className={`pointer-events-none absolute top-[40%] font-display font-black italic text-yellow-300 drop-shadow-[0_0_14px_rgba(250,204,21,0.7)] animate-[pop_0.25s_ease-out] ${combo.who === 0 ? "left-[8%]" : "right-[8%]"}`}
    >
      <div className="text-5xl leading-none md:text-6xl">{combo.n}</div>
      <div className="text-sm uppercase tracking-[0.3em]">hit combo</div>
    </div>
  );
}

/** "ROUND 1 → 3 → 2 → 1" during intro (2.6 s). */
function Countdown() {
  const [n, setN] = useState(4);
  useEffect(() => {
    sfx("ready");
    const i = setInterval(
      () =>
        setN((c) => {
          if (c - 1 > 0) sfx("ready");
          return c - 1;
        }),
      650,
    );
    return () => clearInterval(i);
  }, []);
  return (
    <span key={n} className="inline-block animate-[pop_0.3s_ease-out]">
      {n >= 4 ? "Round 1" : n > 0 ? n : ""}
    </span>
  );
}

/** Big "FIGHT!" for the first 0.9 s of the fight phase. */
function FightFlash() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    sfx("fight");
    const t = setTimeout(() => setShow(false), 900);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="font-display text-8xl font-black italic text-orange-500 drop-shadow-[0_0_40px_rgba(242,127,13,0.8)] animate-[pop_0.35s_ease-out] md:text-[10rem]">
        FIGHT!
      </div>
    </div>
  );
}

function ShareButtons({ posterUrl }: { posterUrl?: string }) {
  const [clip, setClip] = useState(getClip());
  const [card, setCard] = useState<string | null>(null);
  useEffect(() => onClip(() => setClip(getClip())), []);
  const fighters = useGame((s) => s.fighters);
  const winner = useGame((s) => s.winner);
  const makeCard = async () => setCard(await snapshotCard(gameCanvases(), posterUrl));
  const shareText = fighters && winner !== null ? `${fighters[winner].name} just KO'd ${fighters[winner === 0 ? 1 : 0].name} in Anything Fighter. Every fighter was forged from a photo with Aholo Lux3D. #Manycorehackathon` : "";
  const btn = "rounded-xl border border-orange-300/30 px-4 py-2 font-display text-sm text-orange-50 hover:bg-white/5";
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button onClick={makeCard} className={btn} data-action="ko-card">
        📸 KO card
      </button>
      {clip ? (
        <a href={clip.url} download={`anything-fighter-ko.${clip.ext}`} className={btn} data-action="clip">
          🎬 Save clip (.{clip.ext})
        </a>
      ) : (
        <span className="text-xs text-orange-200/50">recording clip…</span>
      )}
      <button onClick={() => navigator.clipboard?.writeText(shareText)} className={btn} title="Copy a post caption (nothing is posted)">
        📋 Copy caption
      </button>
      {card && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setCard(null)}>
          <div className="flex max-w-4xl flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card} alt="KO card" className="max-h-[70vh] rounded-xl border border-orange-300/20" />
            <div className="flex gap-2">
              <a href={card} download="anything-fighter-ko-card.png" className="rounded-xl bg-orange-500 px-5 py-2 font-display font-bold text-black">
                Download PNG
              </a>
              <button onClick={() => setCard(null)} className={btn}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Banner() {
  const phase = useGame((s) => s.phase);
  const winner = useGame((s) => s.winner);
  const fighters = useGame((s) => s.fighters);
  const hits = useGame((s) => s.hits);
  const mode = useGame((s) => s.mode);
  const rematch = useGame((s) => s.rematch);

  const hp = useGame.getState().hp;
  if (phase === "loading" || phase === "vs") return <VsSplash />;
  if (phase === "intro") {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div className="font-arcade text-6xl text-orange-400 text-stroke drop-shadow-[0_0_30px_rgba(242,127,13,0.6)] md:text-8xl">
          <Countdown />
        </div>
      </div>
    );
  }
  if (phase === "fight") return <FightFlash />;
  if (phase === "ko") {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" data-ko>
        <div className="absolute inset-x-0 top-1/2 h-28 -translate-y-1/2 -skew-y-3 bg-black/70 opacity-90 [background-image:repeating-linear-gradient(-60deg,transparent_0_18px,rgba(242,127,13,0.25)_18px_22px)] animate-[stripes_0.6s_linear_infinite] md:h-40" />
        <div className="relative font-arcade text-[6.5rem] leading-none text-red-500 text-stroke drop-shadow-[0_0_40px_rgba(239,68,68,0.8)] animate-[kostamp_0.45s_ease-out_both] md:text-[10rem]">
          {hp[0] > 0 && hp[1] > 0 ? "TIME!" : "K.O."}
        </div>
      </div>
    );
  }
  if (phase === "victory" && winner !== null && fighters) {
    const w = fighters[winner];
    const label = mode === "2p" ? `Player ${winner + 1} wins` : winner === 0 ? "You win" : "CPU wins";
    return (
      <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3 pb-10 md:pb-16">
        <div className="flex items-center gap-6 rounded-2xl border border-orange-300/20 bg-[#1a1511]/85 px-5 py-5 backdrop-blur md:px-8 md:py-6" data-victory>
          {w.posterUrl && (
            <a href={w.posterUrl} target="_blank" rel="noreferrer" title="Cloud-rendered poster (Aholo RenderCloud)" className="relative hidden shrink-0 sm:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.posterUrl} alt={`${w.name} poster`} className="h-56 rounded-xl border border-orange-300/20 object-cover shadow-2xl" />
              <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-orange-100/80">RenderCloud</span>
            </a>
          )}
          <div className="flex flex-col items-center gap-3">
            <div className="text-xs uppercase tracking-[0.4em] text-orange-200/70">{label}</div>
            <div className="text-center font-arcade text-3xl leading-tight text-stroke md:text-5xl" style={{ color: w.color }}>
              {w.name} wins!
            </div>
            {hp[winner] >= 100 && <div className="font-arcade text-lg text-yellow-300 animate-[pop_0.4s_ease-out]">Perfect!</div>}
            <div className="text-sm text-orange-100/70">
              Clean hits {hits[winner]} · {fighters[winner === 0 ? 1 : 0].name} landed {hits[winner === 0 ? 1 : 0]}
            </div>
            <div className="flex gap-2">
              <button onClick={rematch} className="h-12 rounded-xl bg-gradient-to-b from-orange-400 to-orange-600 px-6 font-arcade text-black hover:brightness-110">
                Rematch
              </button>
              <Link href="/" className="flex h-12 items-center rounded-xl border border-white/20 px-5 font-arcade text-orange-50 hover:bg-white/5">
                Roster
              </Link>
            </div>
            <ShareButtons posterUrl={w.posterUrl} />
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function TouchPad({ meter }: { meter: number }) {
  const hold = (k: "left" | "right" | "block" | "down") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      unlockAudio();
      setHeld(k, true);
    },
    onPointerUp: () => setHeld(k, false),
    onPointerLeave: () => setHeld(k, false),
    onPointerCancel: () => setHeld(k, false),
  });
  const tap = (a: "punch" | "kick" | "special" | "super") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      unlockAudio();
      press(a);
      navigator.vibrate?.(8);
    },
  });
  const full = meter >= METER_MAX;
  // Sized for 360–412 px portrait: d-pad left; right = Punch (biggest, under the thumb), Kick above, Block left of
  // Punch, Special above Block, Super (meter ring) on top. Every target ≥ 56 px.
  const btn =
    "pointer-events-auto absolute flex touch-none select-none items-center justify-center rounded-full border-2 border-white/25 bg-black/55 font-arcade text-[10px] leading-none text-orange-50 shadow-[inset_0_-3px_0_rgba(0,0,0,0.4)] active:scale-90 active:bg-orange-500/50";
  return (
    <div
      className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex items-end justify-between gap-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] [@media(hover:hover)]:hidden"
      data-touchpad
    >
      <div className="grid grid-cols-2 gap-2">
        <button
          className={`${btn} !relative h-14 w-16 flex-col gap-0.5 border-lime-300/50 text-[8px]`}
          aria-label="Jump"
          data-btn="jump"
          onPointerDown={(e) => {
            e.preventDefault();
            jump(0);
            navigator.vibrate?.(6);
          }}
        >
          <span className="text-base leading-none">▲</span>Jump
        </button>
        <button className={`${btn} !relative h-14 w-16 flex-col gap-0.5 border-violet-300/50 text-[8px]`} aria-label="Crouch" data-btn="crouch" {...hold("down")}>
          <span className="text-base leading-none">▼</span>Crouch
        </button>
        <button className={`${btn} !relative h-16 w-16 text-base`} aria-label="Move left" {...hold("left")}>◀</button>
        <button className={`${btn} !relative h-16 w-16 text-base`} aria-label="Move right" {...hold("right")}>▶</button>
      </div>
      <div className="relative h-[13.5rem] w-[11.5rem] shrink-0">
        <button
          className={`${btn} right-[4.6rem] top-0 h-14 w-14 !border-0 p-[3px]`}
          style={{ background: `conic-gradient(${full ? "#facc15" : "#22d3ee"} ${meter * 3.6}deg, rgba(255,255,255,0.12) 0)` }}
          aria-label="Super"
          data-btn="super"
          {...tap("super")}
        >
          <span className={`flex h-full w-full items-center justify-center rounded-full ${full ? "bg-yellow-400/90 text-black animate-pulse" : "bg-black/80 text-cyan-100/70"}`}>Super</span>
        </button>
        <button className={`${btn} left-0 top-[4.1rem] h-14 w-14 border-fuchsia-400/60 bg-fuchsia-500/25 text-[9px]`} aria-label="Special" data-btn="special" {...tap("special")}>
          Special
        </button>
        <button className={`${btn} right-0 top-[3.6rem] h-16 w-16 border-sky-400/60 bg-sky-500/25`} data-btn="kick" {...tap("kick")}>Kick</button>
        <button className={`${btn} bottom-0 left-0 h-16 w-16`} data-btn="block" {...hold("block")}>Block</button>
        <button className={`${btn} bottom-0 right-0 h-[5.25rem] w-[5.25rem] border-orange-400/70 bg-orange-500/35 text-[12px]`} data-btn="punch" {...tap("punch")}>Punch</button>
      </div>
    </div>
  );
}

/** Short move list: shown at the start of each fight, then fades (always on the desktop hint bar). */
function ComboHint({ touch }: { touch: boolean }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), 7000);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <div
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-lg bg-black/55 px-3 py-1.5 text-center text-[11px] leading-snug text-orange-100/85 transition-opacity [@media(hover:hover)]:hidden ${touch ? "bottom-[15.5rem]" : "bottom-16"}`}
      data-combo-hint
    >
      <b className="text-orange-300">Punch Punch Kick</b> · <b className="text-sky-300">Kick Punch</b> · <b className="text-fuchsia-300">◀▶+Punch</b> = Special
      <br />
      <b className="text-lime-300">Jump</b> over lows, hit in the air · <b className="text-violet-300">Crouch</b> under jabs, Crouch+Kick sweeps
      <br />
      Fill the meter, then <b className="text-yellow-300">SUPER</b> · tap Block just before a hit to parry
    </div>
  );
}

function MuteButton() {
  const [m, setM] = useState(() => isMuted());
  return (
    <button
      onClick={() => {
        setMuted(!m);
        setM(!m);
      }}
      className="pointer-events-auto absolute right-3 top-[4.6rem] rounded-lg bg-black/40 px-2 py-1 text-sm text-orange-100/70 hover:text-orange-50 md:top-20"
      title={m ? "Unmute" : "Mute"}
      data-action="mute"
    >
      {m ? "🔇" : "🔊"}
    </button>
  );
}

export function Hud() {
  useScreenShake();
  const phase = useGame((s) => s.phase);
  const mode = useGame((s) => s.mode);
  const meters = useMeters();
  const hint =
    mode === "2p"
      ? [
          ["P1", "A/D · W jump · S crouch · F punch · G kick · H block · R special · T super"],
          ["P2", "←/→ · ↑ jump · ↓ crouch · K punch · L kick · M block · O special · P super"],
        ]
      : [
          ["A/D", "move"],
          ["W", "jump"],
          ["S", "crouch"],
          ["J", "punch"],
          ["K", "kick"],
          ["L", "block"],
          ["U or A→D+J", "special"],
          ["I", "super"],
          ["Strings", "J J K · K J · S+K sweep"],
        ];
  return (
    <div className="pointer-events-none absolute inset-0 select-none" data-hud>
      <div className="flex items-start gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:gap-4 md:px-6 md:pt-5">
        <HealthBar idx={0} />
        <Timer />
        <HealthBar idx={1} />
      </div>
      <div className="mt-1 flex justify-between px-3 md:px-6" data-meters>
        <MeterBar idx={0} value={meters[0]} />
        <MeterBar idx={1} value={meters[1]} />
      </div>
      <MuteButton />
      <HitCallout />
      <ComboCounter />
      <Callout />
      <div className="pointer-events-auto">
        <Banner />
      </div>
      {phase === "fight" && (
        <div className="absolute bottom-4 left-1/2 hidden -translate-x-1/2 flex-wrap justify-center gap-x-4 gap-y-1 rounded-xl bg-black/40 px-4 py-2 text-xs text-orange-100/70 [@media(hover:hover)]:flex">
          {hint.map(([k, v]) => (
            <span key={k}>
              <b className="text-orange-300">{k}</b> {v}
            </span>
          ))}
        </div>
      )}
      {mode !== "2p" && (phase === "fight" || phase === "intro") && <TouchPad meter={meters[0]} />}
      {phase === "fight" && mode !== "2p" && <ComboHint touch />}
    </div>
  );
}
