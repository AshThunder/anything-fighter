"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PLACEHOLDER_FIGHTERS, type FighterDef } from "@/lib/fighters";
import { BUILTIN_ARENAS, type ArenaDef } from "@/lib/arenas";
import { ArenaPicker, type ArenaView } from "./ArenaPicker";
import { RoomScan } from "./RoomScan";

const VersusPreview = dynamic(() => import("./VersusPreview"), { ssr: false });

type Stage = "upload" | "mascot" | "mesh" | "rig" | "retarget" | "export" | "done";
const STAGES: { key: Stage; label: string; tool: string }[] = [
  { key: "upload", label: "Photo", tool: "Aholo Asset upload" },
  { key: "mascot", label: "Fighter concept", tool: "Lux3D multimodal image" },
  { key: "mesh", label: "3D mesh + PBR", tool: "Lux3D image→3D" },
  { key: "rig", label: "Skeleton", tool: "Lux3D auto-rig" },
  { key: "retarget", label: "Fight moves", tool: "Lux3D retarget ×10" },
  { key: "export", label: "Print files", tool: "Lux3D STL/3MF/USDZ" },
];

interface JobView {
  id: string;
  stage: Stage;
  error?: string;
  mode: "live" | "mock";
}

async function downscale(file: File, max = 1024): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.86));
}

export default function Landing() {
  const router = useRouter();
  const [fighters, setFighters] = useState<FighterDef[]>(PLACEHOLDER_FIGHTERS);
  const [p1, setP1] = useState<string>("");
  const [p2, setP2] = useState<string>("");
  const [arena, setArena] = useState<string>("stage");
  const [view, setView] = useState<ArenaView>("splat");
  const [versus, setVersus] = useState<"cpu" | "2p">("cpu");
  const [arenas, setArenas] = useState<ArenaDef[]>(BUILTIN_ARENAS);
  const [mode, setMode] = useState<"live" | "mock" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [exportPrint, setExportPrint] = useState(false);
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const loadRoster = useCallback(async () => {
    const r = await fetch("/api/fighters").then((x) => x.json());
    if (r.fighters?.length) setFighters(r.fighters);
  }, []);
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
        const first = r.arenas.find((a: ArenaDef) => a.source === "spatialgen" && !a.pending);
        if (first) setArena(first.id);
      });
    fetch("/api/pipeline").then((r) => r.json()).then((r) => setMode(r.mode));
  }, []);
  const onRoomReady = useCallback(
    async (a: ArenaDef) => {
      await loadArenas();
      setArena(a.id);
      setView("splat");
    },
    [loadArenas],
  );

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 24));
  };

  const forge = async () => {
    if (!file) return;
    setBusy(true);
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
      setJob({ id: "", stage: "upload", error: r.error ?? "Forge failed to start", mode: mode ?? "mock" });
      setBusy(false);
      return;
    }
    router.push(`/forge/${r.job.id}`);
  };

  useEffect(() => {
    if (!job?.id || job.stage === "done" || job.error) return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/pipeline/${job.id}`).then((x) => x.json());
      if (r.error) setJob({ ...job, error: r.error });
      else setJob(r.job);
      if (r.fighter) {
        await loadRoster();
        setP1(r.fighter.id);
        setBusy(false);
      }
    }, job.mode === "mock" ? 900 : 4000);
    return () => clearTimeout(t);
  }, [job, loadRoster]);

  const stageIdx = job ? STAGES.findIndex((s) => s.key === job.stage) : -1;
  // default selection = first two roster fighters
  const p1Id = fighters.some((f) => f.id === p1) ? p1 : fighters[0]?.id;
  const p2Id = fighters.some((f) => f.id === p2) && p2 !== p1Id ? p2 : fighters.find((f) => f.id !== p1Id)?.id;
  const a = fighters.find((f) => f.id === p1Id);
  const b = fighters.find((f) => f.id === p2Id);

  return (
    <main className="min-h-dvh bg-[#0d0b09] text-orange-50">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(242,127,13,0.18),transparent_60%)]" />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-8 overflow-x-clip px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex items-center justify-between">
          <div className="font-display text-lg font-bold tracking-tight">
            ANYTHING<span className="text-orange-500">FIGHTER</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-orange-200/60">
            <Link href="/gallery" className="mr-3 rounded-lg border border-orange-300/20 px-2.5 py-1 text-orange-100/80 hover:text-orange-50">
              Gallery
            </Link>
            <span className={`h-2 w-2 rounded-full ${mode === "live" ? "bg-lime-400" : "bg-yellow-400"}`} />
            <span className="hidden sm:inline">{mode === "live" ? "Aholo Lux3D live" : mode === "mock" ? "Mock pipeline (no API key)" : "…"}</span>
          </div>
        </header>

        <section className="grid items-center gap-8 md:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
          <div className="flex flex-col gap-5">
            <h1 className="font-display text-[2.6rem] font-black leading-[0.95] tracking-tight sm:text-5xl md:text-7xl">
              Snap anything.
              <br />
              <span className="text-orange-500">Fight everything.</span>
            </h1>
            <p className="max-w-md text-orange-100/70">
              Your mug, your sneaker, your rubber duck. Aholo Lux3D turns one photo into a rigged 3D fighter with real moves, then
              throws it into the ring.
            </p>
          </div>

          {/* forge card */}
          <div className="rounded-2xl border border-orange-300/15 bg-[#1a1511]/80 p-5 shadow-2xl backdrop-blur">
            <div className="mb-3 font-display text-sm uppercase tracking-[0.3em] text-orange-300/80">Forge a fighter</div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex h-36 w-full shrink-0 items-center sm:w-36 justify-center overflow-hidden rounded-2xl border-2 border-dashed border-orange-300/30 bg-black/30 text-center text-xs text-orange-200/60 hover:border-orange-400"
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="your object" className="h-full w-full object-cover" />
                ) : (
                  <span>
                    Drop or pick
                    <br />a photo
                  </span>
                )}
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Fighter name"
                  maxLength={24}
                  className="rounded-xl border border-orange-300/20 bg-black/40 px-3 py-2 text-sm outline-none focus:border-orange-400"
                />
                <div className="flex gap-2">
                  <button onClick={() => camRef.current?.click()} className="flex-1 rounded-xl border border-orange-300/25 px-3 py-2 text-sm hover:bg-white/5">
                    📷 Snap a photo
                  </button>
                  <button onClick={() => fileRef.current?.click()} className="flex-1 rounded-xl border border-orange-300/25 px-3 py-2 text-sm hover:bg-white/5">
                    Upload
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-orange-200/70">
                  <input type="checkbox" checked={exportPrint} onChange={(e) => setExportPrint(e.target.checked)} className="accent-orange-500" />
                  Also export printable STL / 3MF
                </label>
                <button
                  disabled={!file || busy}
                  onClick={forge}
                  className="rounded-xl bg-orange-500 px-4 py-2.5 font-display font-bold text-black transition hover:bg-orange-400 disabled:opacity-40"
                >
                  {busy ? "Forging…" : "Forge fighter"}
                </button>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

            {job && (
              <ol className="mt-4 grid grid-cols-3 gap-2">
                {STAGES.map((s, i) => {
                  const done = job.stage === "done" || i < stageIdx;
                  const active = i === stageIdx && !job.error;
                  return (
                    <li
                      key={s.key}
                      className={`rounded-xl border px-2.5 py-2 text-[11px] ${
                        done ? "border-lime-400/30 bg-lime-400/5" : active ? "border-orange-400/60 bg-orange-500/10" : "border-orange-300/10 opacity-50"
                      }`}
                    >
                      <div className="font-display font-bold">
                        {done ? "✓ " : active ? "● " : ""}
                        {s.label}
                      </div>
                      <div className="text-orange-200/50">{s.tool}</div>
                    </li>
                  );
                })}
              </ol>
            )}
            {job?.error && (
              <p className="mt-3 text-xs text-red-400">
                {job.error}
                {/forge limit reached/i.test(job.error) ? (
                  <>
                    {" "}
                    —{" "}
                    <a href="#roster" className="underline hover:text-orange-200">
                      try the roster
                    </a>
                  </>
                ) : null}
              </p>
            )}
          </div>
        </section>

        {/* roster */}
        <section id="roster" className="grid gap-6 md:grid-cols-[1fr_1.1fr] [&>*]:min-w-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-sm uppercase tracking-[0.3em] text-orange-300/80">Roster</h2>
              <span className="text-xs text-orange-200/50">Click = P1 · Shift/right-click = {versus === "2p" ? "P2" : "CPU"}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {fighters.map((f) => {
                const sel = f.id === p1Id ? "P1" : f.id === p2Id ? (versus === "2p" ? "P2" : "CPU") : null;
                return (
                  <button
                    key={f.id}
                    data-fighter={f.id}
                    onClick={(e) => (e.shiftKey ? setP2(f.id) : setP1(f.id))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setP2(f.id);
                    }}
                    className={`group relative flex flex-col overflow-hidden rounded-2xl border text-left transition ${
                      sel ? "border-orange-400 bg-orange-500/10" : "border-orange-300/10 bg-[#1a1511]/70 hover:border-orange-300/40"
                    }`}
                  >
                    <div className="relative flex h-24 items-center justify-center" style={{ background: `linear-gradient(135deg, ${f.color}33, transparent)` }}>
                      {f.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.thumbUrl} alt={f.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="font-display text-4xl font-black" style={{ color: f.color }}>
                          {f.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      {sel && <span className="absolute right-2 top-2 rounded-md bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-black">{sel}</span>}
                      <span className="absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-orange-100/70">
                        {f.source === "lux3d" ? "Lux3D" : f.source === "mock" ? "mock" : "placeholder"}
                      </span>
                    </div>
                    <div className="p-2.5">
                      <div className="font-display text-sm font-bold">{f.name}</div>
                      <div className="truncate text-[11px] text-orange-200/50">{f.tagline}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-orange-300/10 bg-[#1a1511]/60 p-4">
            <div className="flex items-center justify-between font-display">
              <span style={{ color: a?.color }}>{a?.name ?? "—"}</span>
              <span className="text-xs tracking-[0.4em] text-orange-200/50">VS</span>
              <span style={{ color: b?.color }}>{b?.name ?? "—"}</span>
            </div>
            <div className="h-64 overflow-hidden rounded-xl bg-[radial-gradient(circle_at_50%_80%,rgba(242,127,13,0.15),transparent_70%)]">
              <VersusPreview a={a} b={b} />
            </div>
            <ArenaPicker
              arenas={arenas}
              value={arena}
              view={view}
              onChange={(id, v) => {
                setArena(id);
                setView(v);
              }}
            />
            <RoomScan live={mode === null ? null : mode === "live"} onReady={onRoomReady} />
            <div className="flex items-center gap-2 text-xs text-orange-200/60">
              Mode
              {(["cpu", "2p"] as const).map((m) => (
                <button
                  key={m}
                  data-versus={m}
                  onClick={() => setVersus(m)}
                  className={`rounded-lg border px-2.5 py-1 ${versus === m ? "border-orange-400 bg-orange-500/15 text-orange-50" : "border-orange-300/15"}`}
                >
                  {m === "cpu" ? "1P vs CPU" : "2 players (one keyboard)"}
                </button>
              ))}
            </div>
            <Link
              href={`/fight?p1=${p1Id}&p2=${p2Id}&arena=${arena}&view=${view}${versus === "2p" ? "&mode=2p" : ""}`}
              className="rounded-xl bg-orange-500 py-3 text-center font-display text-xl font-black italic text-black hover:bg-orange-400"
            >
              FIGHT!
            </Link>
          </div>
        </section>

        <footer className="pb-6 text-xs text-orange-200/40">
          Built with Aholo Lux3D · SpatialGen · Aholo Viewer · Aholo Reality · LuxReal — #Manycorehackathon
        </footer>
      </div>
    </main>
  );
}
