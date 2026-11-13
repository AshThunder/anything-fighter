"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PLACEHOLDER_FIGHTERS, type FighterDef } from "@/lib/fighters";
import { BUILTIN_ARENAS, type ArenaDef } from "@/lib/arenas";
import { sfx, unlockAudio } from "@/lib/game/audio";
import { PoweredBy } from "@/components/ui/PoweredBy";
import { ArenaPicker, type ArenaView } from "./ArenaPicker";
import { RoomScan } from "./RoomScan";
import { SelectScreen } from "./SelectScreen";

export const CREDIT_LINE = "Built with Aholo Lux3D · SpatialGen · Viewer · Reality · RenderCloud · #Manycorehackathon";

async function downscale(file: File, max = 1024): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.86));
}

function ForgePanel({ live }: { live: boolean | null }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [exportPrint, setExportPrint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setError(null);
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 24));
  };

  const forge = async () => {
    if (!file) return;
    unlockAudio();
    sfx("fight");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("photo", await downscale(file), "photo.jpg");
    fd.set("name", name || "Mystery Fighter");
    fd.set("exportPrint", exportPrint ? "1" : "0");
    let r: { error?: string; job?: { id: string } };
    try {
      const res = await fetch("/api/pipeline", { method: "POST", body: fd });
      const text = await res.text();
      try {
        r = JSON.parse(text);
      } catch {
        r = { error: `Server busy (HTTP ${res.status}), please try again.` };
      }
    } catch {
      r = { error: "Couldn't reach the server, check your connection and try again." };
    }
    if (r.error || !r.job) {
      setError(r.error ?? "Forge failed to start");
      setBusy(false);
      return;
    }
    router.push(`/forge/${r.job.id}`);
  };

  return (
    <div className="relative rounded-3xl bg-gradient-to-br from-orange-500/70 via-orange-500/15 to-sky-400/40 p-[2px] shadow-[0_20px_60px_rgba(242,127,13,0.18)]" data-forge-panel>
      <div className="rounded-[22px] bg-[#16110d]/95 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="arcade-title text-xl text-orange-50 sm:text-2xl">Forge a fighter</h2>
          <span className="hidden text-[11px] text-orange-200/60 sm:inline">1 photo → rigged 3D · ~5 min</span>
        </div>
        <div className="mt-3 flex gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0]);
            }}
            aria-label="Pick a photo"
            className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-orange-300/40 bg-black/40 text-center text-xs text-orange-200/70 hover:border-orange-400 sm:h-32 sm:w-32"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="your object" className="h-full w-full object-cover" />
            ) : (
              <span className="px-2 leading-snug">
                <span className="block text-3xl">📸</span>
                Any object
              </span>
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fighter name"
              maxLength={24}
              className="h-11 rounded-xl border border-white/10 bg-black/40 px-3 text-base outline-none focus:border-orange-400"
            />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => camRef.current?.click()} className="h-11 rounded-xl border border-white/15 bg-white/[0.04] text-sm font-semibold hover:bg-white/10">
                📷 Snap
              </button>
              <button onClick={() => fileRef.current?.click()} className="h-11 rounded-xl border border-white/15 bg-white/[0.04] text-sm font-semibold hover:bg-white/10">
                🖼 Upload
              </button>
            </div>
          </div>
        </div>
        <button
          disabled={!file || busy}
          onClick={forge}
          data-action="forge"
          className="mt-3 h-14 w-full rounded-2xl bg-gradient-to-b from-orange-400 to-orange-600 font-arcade text-xl text-black shadow-[inset_0_-4px_0_rgba(0,0,0,0.25)] transition active:translate-y-0.5 disabled:from-orange-400/30 disabled:to-orange-600/30 disabled:text-black/50"
        >
          {busy ? "Forging…" : file ? "Forge it!" : "Pick a photo first"}
        </button>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-orange-200/70">
            <input type="checkbox" checked={exportPrint} onChange={(e) => setExportPrint(e.target.checked)} className="h-4 w-4 accent-orange-500" />
            Also export printable STL / 3MF
          </label>
          <span className={`flex items-center gap-1.5 text-[11px] ${live ? "text-lime-300/80" : "text-yellow-300/80"}`}>
            <span className={`h-2 w-2 rounded-full ${live ? "bg-lime-400" : "bg-yellow-400"}`} />
            {live === null ? "…" : live ? "Aholo live" : "Mock pipeline (no key)"}
          </span>
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-400">
            {error}
            {/forge limit reached/i.test(error) ? (
              <>
                {" "}
                —{" "}
                <a href="#select" className="underline hover:text-orange-200">
                  pick from the roster
                </a>
              </>
            ) : null}
          </p>
        )}
        <PoweredBy keys={["asset", "concept", "mesh", "rig", "retarget", "poster", ...(exportPrint ? (["export"] as const) : [])]} className="mt-3 border-t border-white/5 pt-3" />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  );
}

export default function Landing() {
  const [fighters, setFighters] = useState<FighterDef[]>(PLACEHOLDER_FIGHTERS);
  const [p1, setP1] = useState<string>("");
  const [p2, setP2] = useState<string>("");
  const [side, setSide] = useState<0 | 1>(0);
  const [arena, setArena] = useState<string>("stage");
  const [view, setView] = useState<ArenaView>("splat");
  const [versus, setVersus] = useState<"cpu" | "2p">("cpu");
  const [arenas, setArenas] = useState<ArenaDef[]>(BUILTIN_ARENAS);
  const [mode, setMode] = useState<"live" | "mock" | null>(null);

  const loadArenas = useCallback(async () => {
    const r = await fetch("/api/arenas").then((x) => x.json());
    if (r.arenas?.length) setArenas(r.arenas);
  }, []);
  useEffect(() => {
    fetch("/api/fighters")
      .then((x) => x.json())
      .then((r) => r.fighters?.length && setFighters(r.fighters));
    fetch("/api/arenas")
      .then((x) => x.json())
      .then((r) => {
        if (!r.arenas?.length) return;
        setArenas(r.arenas);
        const first = r.arenas.find((a: ArenaDef) => (a.source === "spatialgen" || a.source === "reality") && !a.pending);
        if (first) setArena(first.id);
      })
      .catch(() => {});
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((r) => setMode(r.mode))
      .catch(() => {});
  }, []);
  const onRoomReady = useCallback(
    async (a: ArenaDef) => {
      await loadArenas();
      setArena(a.id);
      setView("splat");
    },
    [loadArenas],
  );

  // default selection = first two roster fighters
  const p1Id = fighters.some((f) => f.id === p1) ? p1 : fighters[0]?.id;
  const p2Id = fighters.some((f) => f.id === p2) && p2 !== p1Id ? p2 : fighters.find((f) => f.id !== p1Id)?.id;

  const pick = (s: 0 | 1, id: string) => {
    sfx(s === 0 ? "click" : "block");
    if (s === 0) {
      if (id === p2Id && p1Id) setP2(p1Id); // swap
      setP1(id);
      setSide(1);
    } else {
      if (id === p1Id && p2Id) setP1(p2Id);
      setP2(id);
      setSide(0);
    }
  };

  const fightHref = `/fight?p1=${p1Id}&p2=${p2Id}&arena=${arena}&view=${view}${versus === "2p" ? "&mode=2p" : ""}`;
  const arenaName = arenas.find((a) => a.id === arena)?.name;

  return (
    <main className="min-h-dvh bg-[#0d0b09] pb-[calc(6.5rem+env(safe-area-inset-bottom))] text-orange-50">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(242,127,13,0.2),transparent_55%)]" />
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0d0b09]/80 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 sm:px-6">
          <Link href="/" className="font-arcade text-lg leading-none tracking-tight sm:text-xl">
            ANYTHING<span className="text-orange-500">FIGHTER</span>
          </Link>
          <Link href="/gallery" className="rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-orange-100/90 hover:bg-white/5">
            Gallery
          </Link>
        </div>
      </header>

      <div className="relative mx-auto flex max-w-6xl flex-col gap-8 overflow-x-clip px-4 pt-5 sm:px-6 sm:pt-8">
        <section className="grid items-center gap-5 md:grid-cols-[1fr_1.05fr] md:gap-8 [&>*]:min-w-0">
          <div className="flex flex-col gap-3">
            <h1 className="arcade-title text-[2.35rem] leading-[0.95] sm:text-6xl lg:text-7xl">
              Snap anything.
              <br />
              <span className="text-orange-500">Fight everything.</span>
            </h1>
            <p className="max-w-md text-[15px] text-orange-100/75">
              Your mug, your sneaker, your rubber duck: Aholo Lux3D turns one photo into a rigged 3D fighter with real moves, then
              throws it into an AI-built arena.
            </p>
          </div>
          <ForgePanel live={mode === null ? null : mode === "live"} />
        </section>

        <div id="select">
          <SelectScreen fighters={fighters} p1={p1Id} p2={p2Id} side={side} setSide={setSide} pick={pick} versus={versus} />
        </div>

        <section className="flex flex-col gap-3" data-stage-select>
          <h2 className="arcade-title text-2xl text-orange-50 sm:text-3xl">Select stage</h2>
          <ArenaPicker
            arenas={arenas}
            value={arena}
            view={view}
            onChange={(id, v) => {
              setArena(id);
              setView(v);
            }}
            soonExtra={<RoomScan live={mode === null ? null : mode === "live"} onReady={onRoomReady} />}
          />
        </section>

        <footer className="pb-4 text-center text-xs text-orange-200/50">{CREDIT_LINE}</footer>
      </div>

      {/* sticky fight bar: mode + FIGHT, thumb-reachable */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0d0b09]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur" data-fight-bar>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6">
          <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 text-[11px] font-bold sm:flex-row sm:text-xs">
            {(["cpu", "2p"] as const).map((m) => (
              <button
                key={m}
                data-versus={m}
                aria-pressed={versus === m}
                onClick={() => setVersus(m)}
                className={`px-2.5 py-1.5 sm:px-3 sm:py-2 ${versus === m ? "bg-orange-500 text-black" : "text-orange-100/70"}`}
              >
                {m === "cpu" ? "1P vs CPU" : "2 players"}
              </button>
            ))}
          </div>
          <div className="hidden min-w-0 flex-1 truncate text-sm text-orange-100/70 sm:block">
            <b style={{ color: "#f97316" }}>{fighters.find((f) => f.id === p1Id)?.name}</b> vs{" "}
            <b style={{ color: "#38bdf8" }}>{fighters.find((f) => f.id === p2Id)?.name}</b> · {arenaName}
          </div>
          <Link
            href={fightHref}
            onClick={() => {
              unlockAudio();
              sfx("fight");
            }}
            data-action="fight"
            className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-gradient-to-b from-orange-400 to-orange-600 font-arcade text-2xl text-black shadow-[inset_0_-4px_0_rgba(0,0,0,0.25),0_0_30px_rgba(242,127,13,0.35)] active:translate-y-0.5 sm:max-w-xs"
          >
            Fight!
          </Link>
        </div>
      </div>
    </main>
  );
}
