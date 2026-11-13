"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Hud } from "@/components/game/Hud";
import { useGame, type ArenaSpec } from "@/lib/game/store";
import { PLACEHOLDER_FIGHTERS, type FighterDef } from "@/lib/fighters";
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
  const setup = useGame((s) => s.setup);
  const ready = useGame((s) => !!s.fighters);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/fighters").then((r) => r.json()),
      fetch("/api/arenas").then((r) => r.json()).catch(() => ({ arenas: BUILTIN_ARENAS })),
    ])
      .then(([{ fighters }, { arenas }]: [{ fighters: FighterDef[] }, { arenas: ArenaDef[] }]) => {
        if (!alive) return;
        const all = fighters?.length ? fighters : PLACEHOLDER_FIGHTERS;
        const a = all.find((f) => f.id === p1) ?? all[0];
        const b = all.find((f) => f.id === p2 && f.id !== a.id) ?? all.find((f) => f.id !== a.id) ?? all[1];
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
      .catch((e) => setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [p1, p2, arena, view, setup]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0d0b09]">
      {ready && <GameScene />}
      {ready && <Hud />}
      {!ready && (
        <div className="flex h-full items-center justify-center font-display text-orange-200/70">{err ?? "Loading fighters…"}</div>
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
