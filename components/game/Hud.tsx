"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useGame } from "@/lib/game/store";
import { sim } from "@/lib/game/sim";
import { press, setHeld } from "@/lib/game/input";
import { isMuted, setMuted, sfx, unlockAudio } from "@/lib/game/audio";
import { getClip, onClip, snapshotCard } from "@/lib/game/recorder";

export const gameCanvases = () => Array.from(document.querySelectorAll<HTMLCanvasElement>("[data-game-root] canvas"));

function HealthBar({ idx }: { idx: 0 | 1 }) {
  const hp = useGame((s) => s.hp[idx]);
  const f = useGame((s) => s.fighters?.[idx]);
  const mode = useGame((s) => s.mode);
  const lastHit = useGame((s) => s.lastHit);
  const right = idx === 1;
  const shaking = lastHit && lastHit.who === idx && !lastHit.blocked;
  const tag = idx === 0 ? "P1" : mode === "2p" ? "P2" : mode === "practice" ? "SPARRING" : "CPU";
  return (
    <div className={`flex flex-1 flex-col gap-1 ${right ? "items-end" : "items-start"}`}>
      <div className="flex items-center gap-2 font-display text-xs uppercase tracking-widest text-orange-50 md:text-sm">
        {!right && <span className="h-2.5 w-2.5 rounded-full" style={{ background: f?.color }} />}
        {!right && <span className="text-[10px] text-orange-200/60">{tag}</span>}
        <span className="max-w-[30vw] truncate">{f?.name}</span>
        {right && <span className="text-[10px] text-orange-200/60">{tag}</span>}
        {right && <span className="h-2.5 w-2.5 rounded-full" style={{ background: f?.color }} />}
      </div>
      <div
        key={shaking ? lastHit.id : "still"}
        className={`relative h-4 w-full overflow-hidden rounded-md border border-orange-200/20 bg-black/60 md:h-5 ${right ? "-scale-x-100" : ""} ${shaking ? "animate-[barshake_0.3s_ease-out]" : ""}`}
      >
        <div className="absolute inset-y-0 left-0 bg-red-500/70 transition-[width] duration-700 ease-out" style={{ width: `${hp}%` }} />
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-100"
          style={{ width: `${hp}%`, background: `linear-gradient(90deg, #f27f0d, ${hp > 30 ? "#facc15" : "#ef4444"})` }}
        />
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
  return <div className="w-14 text-center font-display text-3xl font-bold tabular-nums text-orange-50 md:w-16 md:text-4xl">{mode === "practice" ? "∞" : t}</div>;
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
      {n >= 4 ? "ROUND 1" : n > 0 ? n : ""}
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

  if (phase === "intro") {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div className="font-display text-base uppercase tracking-[0.4em] text-orange-200/80 md:text-xl">
          {fighters?.[0].name} vs {fighters?.[1].name}
        </div>
        <div className="font-display text-7xl font-black italic text-orange-500 drop-shadow-[0_0_30px_rgba(242,127,13,0.6)] md:text-8xl">
          <Countdown />
        </div>
      </div>
    );
  }
  if (phase === "fight") return <FightFlash />;
  if (phase === "ko") {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="font-display text-[7rem] font-black italic leading-none text-orange-500 drop-shadow-[0_0_40px_rgba(242,127,13,0.7)] animate-[pop_0.4s_ease-out] md:text-[9rem]">
          K.O.
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
            <div className="text-center font-display text-4xl font-black italic md:text-5xl" style={{ color: w.color }}>
              {w.name} wins!
            </div>
            <div className="text-sm text-orange-100/70">
              Clean hits {hits[winner]} · {fighters[winner === 0 ? 1 : 0].name} landed {hits[winner === 0 ? 1 : 0]}
            </div>
            <div className="flex gap-2">
              <button onClick={rematch} className="rounded-xl bg-orange-500 px-5 py-2.5 font-display font-bold text-black hover:bg-orange-400">
                Rematch
              </button>
              <Link href="/" className="rounded-xl border border-orange-300/30 px-5 py-2.5 font-display text-orange-50 hover:bg-white/5">
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

function TouchPad() {
  const hold = (k: "left" | "right" | "block") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      unlockAudio();
      setHeld(k, true);
    },
    onPointerUp: () => setHeld(k, false),
    onPointerLeave: () => setHeld(k, false),
    onPointerCancel: () => setHeld(k, false),
  });
  const tap = (a: "punch" | "kick") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      unlockAudio();
      press(a);
    },
  });
  const btn = "pointer-events-auto h-16 w-16 touch-none select-none rounded-full border border-orange-300/30 bg-black/50 font-display text-xs font-bold text-orange-100 active:scale-95 active:bg-orange-500/40";
  return (
    <div className="absolute inset-x-0 bottom-5 flex items-end justify-between px-5 [@media(hover:hover)]:hidden" data-touchpad>
      <div className="flex gap-3">
        <button className={btn} {...hold("left")}>◀</button>
        <button className={btn} {...hold("right")}>▶</button>
      </div>
      <div className="flex items-end gap-3">
        <button className={btn} {...hold("block")}>Block</button>
        <button className={`${btn} h-[4.5rem] w-[4.5rem]`} {...tap("kick")}>Kick</button>
        <button className={`${btn} h-20 w-20 bg-orange-500/30`} {...tap("punch")}>Punch</button>
      </div>
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
      className="pointer-events-auto absolute right-4 top-16 rounded-lg bg-black/40 px-2 py-1 text-sm text-orange-100/70 hover:text-orange-50 md:top-20"
      title={m ? "Unmute" : "Mute"}
      data-action="mute"
    >
      {m ? "🔇" : "🔊"}
    </button>
  );
}

export function Hud() {
  const phase = useGame((s) => s.phase);
  const mode = useGame((s) => s.mode);
  const hint =
    mode === "2p"
      ? [
          ["P1", "A/D · F punch · G kick · S block"],
          ["P2", "←/→ · K punch · L kick · ↓ block"],
        ]
      : [
          ["A/D", "move"],
          ["J", "punch"],
          ["K", "kick"],
          ["L / Shift", "block"],
        ];
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <div className="flex items-start gap-3 px-4 pt-4 md:gap-4 md:px-6 md:pt-5">
        <HealthBar idx={0} />
        <Timer />
        <HealthBar idx={1} />
      </div>
      <MuteButton />
      <HitCallout />
      <ComboCounter />
      <div className="pointer-events-auto">
        <Banner />
      </div>
      {phase === "fight" && (
        <div className="absolute bottom-4 left-1/2 hidden -translate-x-1/2 gap-4 rounded-xl bg-black/40 px-4 py-2 text-xs text-orange-100/70 [@media(hover:hover)]:flex">
          {hint.map(([k, v]) => (
            <span key={k}>
              <b className="text-orange-300">{k}</b> {v}
            </span>
          ))}
        </div>
      )}
      {mode !== "2p" && (phase === "fight" || phase === "intro") && <TouchPad />}
    </div>
  );
}
