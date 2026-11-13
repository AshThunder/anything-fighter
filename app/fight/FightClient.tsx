"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Hud } from "@/components/game/Hud";
import { useGame, type ArenaSpec } from "@/lib/game/store";
import { GALLERY_ONLY_IDS, PLACEHOLDER_FIGHTERS, type FighterDef } from "@/lib/fighters";
import { BUILTIN_ARENAS, type ArenaDef } from "@/lib/arenas";

const GameScene = dynamic(() => import("@/components/game/GameScene"), { ssr: false });

export default function FightClient() {
  const sp = useSearchParams();
  const p1 = sp.get("p1") ?? undefined;
  const p2 = sp.get("p2") ?? undefined;
  const arena = sp.get("arena") ?? "stage";
  const view = sp.get("view") ?? "splat"; // splat | pano
  const mode = sp.get("mode") === "2p" ? "2p" : sp.get("mode") === "practice" ? "practice" : "cpu";
  const setMode = useGame((s) => s.setMode);
  useEffect(() => setMode(mode), [mode, setMode]);
  // CPU difficulty: ?cpu=easy|normal|hard (the roster's fight bar remembers the last pick)
  const cpu = sp.get("cpu");
  const setLevel = useGame((s) => s.setLevel);
  useEffect(() => setLevel(cpu === "easy" || cpu === "hard" ? cpu : "normal"), [cpu, setLevel]);
  const setup = useGame((s) => s.setup);
  const ready = useGame((s) => !!s.fighters);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      // ?all=1 so gallery-only and demo fighters opened by id (gallery "Fight", forge page) are found too
      fetch("/api/fighters?all=1").then((r) => {
        if (!r.ok) throw new Error(`fighters HTTP ${r.status}`);
        return r.json();
      }),
      fetch("/api/arenas")
        .then((r) => r.json())
        .then((r) => (r.arenas?.length ? r : { arenas: BUILTIN_ARENAS }))
        .catch(() => ({ arenas: BUILTIN_ARENAS })),
    ])
      .then(([{ fighters }, { arenas }]: [{ fighters: FighterDef[] }, { arenas: ArenaDef[] }]) => {
        if (!alive) return;
        const all = fighters?.length ? fighters : PLACEHOLDER_FIGHTERS;
        // fighters not picked by id come from the public roster (no test / gallery-only / demo forges)
        const roster = all.filter((f) => !f.id.startsWith("test-") && !GALLERY_ONLY_IDS.includes(f.id) && f.source !== "mock");
        const pool = roster.length >= 2 ? roster : all;
        // any fighter (starter, forged rigged or freestyle) can be P1 or the opponent: ?p1=…&p2=gen-…
        const a = all.find((f) => f.id === p1) ?? pool.find((f) => f.id !== p2) ?? pool[0];
        const b = all.find((f) => f.id === p2 && f.id !== a.id) ?? pool.find((f) => f.id !== a.id) ?? all.find((f) => f.id !== a.id) ?? PLACEHOLDER_FIGHTERS[0];
        // a fighter opened by id whose files are gone (old forge, lost before durable storage): say so instead of a silent swap
        const gone = [p1, p2].filter((id) => id && !all.some((f) => f.id === id)).length;
        setNotice(gone ? `${gone > 1 ? "Those fighters are" : "That fighter is"} no longer available, so we picked from the roster.` : null);
        const ar = arenas.find((x) => x.id === arena);
        const dbg = debugSplat();
        const spec: ArenaSpec = dbg
          ? dbg
          : ar && view === "pano" && ar.panoUrl
            ? { kind: "pano", url: ar.panoUrl, name: ar.name }
            : ar?.splatUrl
              ? {
                  kind: "splat",
                  url: ar.splatUrl,
                  urls: ar.splatUrls,
                  name: ar.name,
                  upAxis: ar.upAxis,
                  origin: ar.origin,
                  scale: ar.scale,
                  yaw: ar.yaw,
                  half: ar.half,
                  fallbackPano: ar.panoUrl,
                  ...debugPlacement(),
                }
              : ar?.panoUrl
                ? { kind: "pano", url: ar.panoUrl, name: ar.name }
                : { kind: "stage", name: "Neon Ring" };
        setup([a, b], spec);
      })
      .catch((e) => {
        console.warn(`[fight] setup failed: ${e instanceof Error ? e.message : e}`);
        if (alive) setErr("Couldn't load the fighters.");
      });
    return () => {
      alive = false;
    };
  }, [p1, p2, arena, view, setup, attempt]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0d0b09]">
      {ready && <GameScene />}
      {ready && <Hud />}
      {ready && notice && (
        <button
          onClick={() => setNotice(null)}
          className="absolute left-1/2 top-16 z-20 max-w-[90vw] -translate-x-1/2 rounded-lg bg-black/70 px-3 py-1.5 text-xs text-orange-100/90"
          data-notice="fighter-missing"
        >
          {notice} ✕
        </button>
      )}
      {!ready && (
        <div className="flex h-full flex-col items-center justify-center gap-3 font-display text-orange-200/70">
          {err ?? "Loading fighters…"}
          {err && (
            <div className="flex gap-2 text-sm">
              <button
                onClick={() => {
                  setErr(null);
                  setAttempt((n) => n + 1);
                }}
                className="rounded-lg bg-orange-500 px-4 py-1.5 font-bold text-black"
              >
                Try again
              </button>
              <Link href="/" className="rounded-lg border border-orange-300/30 px-4 py-1.5">
                Back to roster
              </Link>
            </div>
          )}
        </div>
      )}
      <Link href="/" className="absolute left-4 bottom-4 z-10 hidden rounded-lg bg-black/40 px-3 py-1.5 text-xs text-orange-100/70 hover:text-orange-50 md:block">
        ← Roster
      </Link>
    </main>
  );
}

/** Tuning hook (debug only): /fight?...&debug=1&place=ox,oy,oz,scale,yaw,half overrides the splat placement. */
function debugPlacement(): Partial<ArenaSpec> {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const p = q.has("debug") ? q.get("place") : null;
  if (!p) return {};
  const v = p.split(",").map(Number);
  return { origin: [v[0], v[1], v[2]], scale: v[3], yaw: v[4], half: v[5] };
}

/** Tuning hook (debug only): &debug=1&splat=<url>&place=... renders any splat without an arena entry. */
function debugSplat(): ArenaSpec | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const u = q.has("debug") ? q.get("splat") : null;
  return u ? { kind: "splat", url: u, name: "debug", upAxis: "Z", ...debugPlacement() } : null;
}
