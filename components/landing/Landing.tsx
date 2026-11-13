"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PLACEHOLDER_FIGHTERS, type FighterDef } from "@/lib/fighters";
import { BUILTIN_ARENAS, type ArenaDef } from "@/lib/arenas";
import { sfx, unlockAudio } from "@/lib/game/audio";
import { PoweredBy } from "@/components/ui/PoweredBy";
import { GalleryIcon, SiteHeader } from "@/components/ui/SiteHeader";
import { ArenaPicker, type ArenaView } from "./ArenaPicker";
import { RoomScan } from "./RoomScan";
import { SelectScreen } from "./SelectScreen";
import { photoHasFace } from "@/lib/face-gate";
import { GALLERY_POLICY, PHOTO_ATTESTATION } from "@/lib/gallery-policy";

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

/** Suggest a fighter name from the file name, but not camera junk like "IMG_2041" or "1794557018319". */
function nameFromFile(file: string): string {
  const base = file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  if (!/[a-z]{3}/i.test(base) || /^(img|dsc|pxl|photo|image|screenshot|whatsapp|signal|mvimg|dcim)\b/i.test(base) || /\d{5,}/.test(base)) return "";
  return base.slice(0, 24);
}

function ForgePanel({ live }: { live: boolean | null }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [exportPrint, setExportPrint] = useState(false);
  const [sharePhoto, setSharePhoto] = useState(false);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setError(null);
    setSharePhoto(false);
    setAttested(false);
    if (!name) setName(nameFromFile(f.name));
  };

  const forge = async () => {
    if (!file) return;
    if (sharePhoto && !attested) {
      setError("To share your photo, please confirm the statement under the checkbox.");
      return;
    }
    unlockAudio();
    sfx("fight");
    setBusy(true);
    setError(null);
    let share = sharePhoto && attested;
    if (share) {
      setError("Checking the photo for faces…");
      const face = await photoHasFace(file);
      if (face === "yes") {
        share = false;
        setSharePhoto(false);
        setError("We found a face in this photo, so it can't be shared publicly. Forging anyway — the photo stays private.");
      } else if (face === "error") {
        share = false;
        setSharePhoto(false);
        setError("Couldn't check the photo for faces, so it will stay private. Forging anyway.");
      } else {
        setError(null);
      }
    }
    const blob = await downscale(file);
    const fd = new FormData();
    fd.set("photo", blob, "photo.jpg");
    fd.set("name", name || "Mystery Fighter");
    fd.set("exportPrint", exportPrint ? "1" : "0");
    fd.set("sharePhoto", share ? "1" : "0");
    fd.set("photoAttestation", share ? "1" : "0");
    fd.set("faceClear", share ? "1" : "0");
    let r: { error?: string; job?: { id: string }; deleteToken?: string };
    try {
      const res = await fetch("/api/pipeline", { method: "POST", body: fd });
      const text = await res.text();
      try {
        r = JSON.parse(text);
      } catch {
        r = { error: "The server is busy, please try again in a moment." };
      }
    } catch {
      r = { error: "Couldn't reach the server, check your connection and try again." };
    }
    if (r.error || !r.job) {
      setError(r.error ?? "Forge failed to start");
      setBusy(false);
      return;
    }
    if (r.deleteToken) {
      try {
        sessionStorage.setItem(`af-delete:${r.job.id}`, r.deleteToken);
      } catch {
        /* private mode */
      }
    }
    router.push(`/forge/${r.job.id}`);
  };

  return (
    <div id="forge" className="card scroll-mt-20 border-2 border-line-strong p-4 shadow-[0_6px_0_#000] sm:p-5" data-forge-panel>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="arcade-title text-xl text-fg sm:text-2xl">
          <span className="text-blaze">1.</span> Forge a fighter
        </h2>
        <span className="text-xs text-muted">1 photo → rigged 3D · ~5 min</span>
      </div>
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files?.[0]);
          }}
          aria-label={preview ? "Change photo" : "Pick a photo"}
          className={`flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 text-center text-xs sm:h-32 sm:w-32 ${
            preview ? "border-blaze" : "border-dashed border-line-strong bg-ink text-muted hover:border-blaze hover:text-fg"
          }`}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="your object" className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 leading-snug">
              <span className="block text-3xl" aria-hidden>
                📸
              </span>
              Any object
            </span>
          )}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label className="sr-only" htmlFor="fighter-name">
            Fighter name
          </label>
          <input
            id="fighter-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fighter name"
            maxLength={24}
            className="h-11 rounded-lg border-2 border-line-strong bg-ink px-3 text-base text-fg outline-none placeholder:text-dim focus:border-blaze"
          />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => camRef.current?.click()} className="btn btn-ghost btn-sm">
              📷 Snap
            </button>
            <button onClick={() => fileRef.current?.click()} className="btn btn-ghost btn-sm">
              🖼 Upload
            </button>
          </div>
        </div>
      </div>
      <button disabled={!file || busy} onClick={forge} data-action="forge" className="btn btn-primary btn-lg mt-4 h-14 w-full">
        {busy ? (sharePhoto && attested ? "Checking photo…" : "Forging…") : file ? "Forge it!" : "Pick a photo first"}
      </button>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={exportPrint} onChange={(e) => setExportPrint(e.target.checked)} className="h-6 w-6 shrink-0 accent-[#ff5a1f]" />
          Also export printable STL / 3MF
        </label>
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${live ? "text-ok" : "text-gold"}`}>
          <span className={`h-2 w-2 rounded-full ${live ? "bg-ok" : "bg-gold"}`} />
          {live === null ? "…" : live ? "Aholo live" : "Mock pipeline (no key)"}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-3" data-share-photo>
        <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={sharePhoto}
            onChange={(e) => {
              setSharePhoto(e.target.checked);
              if (!e.target.checked) setAttested(false);
            }}
            className="mt-0.5 h-6 w-6 shrink-0 accent-[#ff5a1f]"
          />
          <span>Share my original photo in the Gallery (off by default)</span>
        </label>
        {sharePhoto && (
          <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-muted">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-[#ff5a1f]" />
            <span>{PHOTO_ATTESTATION}</span>
          </label>
        )}
        <p className="text-xs text-dim">{GALLERY_POLICY}</p>
      </div>
      {error && (
        <p className="mt-2 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-fg" role="alert">
          {error}
          {/forge limit reached/i.test(error) ? (
            <>
              {" "}
              —{" "}
              <a href="#select" className="font-semibold text-blaze underline">
                pick from the roster
              </a>
            </>
          ) : null}
        </p>
      )}
      <PoweredBy keys={["asset", "concept", "mesh", "rig", "retarget", "poster", ...(exportPrint ? (["export"] as const) : [])]} className="mt-3 border-t border-line pt-3" />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
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
  const [cpu, setCpu] = useState<"easy" | "normal" | "hard">("normal");
  const [arenas, setArenas] = useState<ArenaDef[]>(BUILTIN_ARENAS);
  const [mode, setMode] = useState<"live" | "mock" | null>(null);

  const loadArenas = useCallback(async () => {
    const r = await fetch("/api/arenas")
      .then((x) => x.json())
      .catch(() => ({}));
    if (r.arenas?.length) setArenas(r.arenas);
  }, []);
  useEffect(() => {
    fetch("/api/fighters")
      .then((x) => x.json())
      .then((r) => r.fighters?.length && setFighters(r.fighters))
      .catch(() => {});
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

  const fightHref = `/fight?p1=${p1Id}&p2=${p2Id}&arena=${arena}&view=${view}${versus === "2p" ? "&mode=2p" : `&cpu=${cpu}`}`;
  const arenaName = arenas.find((a) => a.id === arena)?.name;

  const STEPS: [string, string][] = [
    ["Snap", "any object"],
    ["Lux3D", "builds, rigs + animates it"],
    ["Fight", "in an Aholo 3D world"],
  ];

  return (
    <main className="min-h-dvh bg-ink pb-[calc(6.5rem+env(safe-area-inset-bottom))] text-fg">
      <SiteHeader />
      <Link
        href="/gallery"
        data-nav="gallery-banner"
        className="mx-auto mt-3 flex min-h-12 w-[calc(100%-2rem)] max-w-6xl items-center justify-between rounded-xl bg-gold px-4 font-display text-base font-extrabold text-ink shadow-[0_4px_0_#c9a012] sm:hidden"
      >
        <span className="inline-flex items-center gap-2">
          <GalleryIcon className="h-5 w-5" />
          Gallery
        </span>
        <span className="text-sm font-bold">See every fighter →</span>
      </Link>

      <div className="mx-auto flex max-w-6xl flex-col gap-10 overflow-x-clip px-4 pt-6 sm:px-6 sm:pt-10">
        <section className="grid items-center gap-6 md:grid-cols-[1fr_1.05fr] md:gap-10 [&>*]:min-w-0">
          <div className="flex flex-col gap-4">
            <span className="eyebrow">Manycore Aholo 3D AI Hackathon · Gaming</span>
            <h1 className="arcade-title text-[clamp(1.7rem,8vw,2.35rem)] leading-[0.95] [overflow-wrap:anywhere] sm:text-6xl lg:text-7xl">
              Snap anything.
              <br />
              <span className="text-blaze">Fight everything.</span>
            </h1>
            <p className="max-w-md text-base text-muted">
              Your mug, your sneaker, your rubber duck: <b className="text-fg">Aholo Lux3D</b> turns one photo into a rigged 3D fighter with real
              moves, then throws it into an AI-built <b className="text-fg">SpatialGen</b> arena.
            </p>
            <ol className="grid grid-cols-3 gap-2" aria-label="How it works">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="rounded-lg border border-line bg-panel px-2.5 py-2">
                  <div className="font-arcade text-sm text-fg">
                    <span className="text-blaze">{i + 1}</span> {t}
                  </div>
                  <div className="text-xs leading-snug text-muted">{d}</div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <a href="#forge" className="btn btn-primary md:hidden">
                Forge a fighter
              </a>
              <a href="#select" className="btn btn-ghost">
                Fight now with the roster ↓
              </a>
              <Link href="/gallery" className="btn btn-gold">
                <GalleryIcon />
                Browse the gallery
              </Link>
            </div>
          </div>
          <ForgePanel live={mode === null ? null : mode === "live"} />
        </section>

        <div id="select" className="scroll-mt-16">
          <SelectScreen fighters={fighters} p1={p1Id} p2={p2Id} side={side} setSide={setSide} pick={pick} versus={versus} />
        </div>

        <Link
          href="/gallery"
          data-nav="gallery-cta"
          className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border-2 border-gold bg-gold/15 px-4 py-3 text-fg shadow-[0_4px_0_#c9a012] hover:bg-gold/25"
        >
          <span>
            <span className="inline-flex items-center gap-2 font-arcade text-xl text-gold">
              <GalleryIcon className="h-5 w-5" />
              Gallery
            </span>
            <span className="mt-1 block text-sm text-muted">Every Lux3D fighter, concept art, poster and 3D model.</span>
          </span>
          <span className="btn btn-gold btn-sm shrink-0">Open →</span>
        </Link>

        <section className="flex flex-col gap-3" data-stage-select>
          <h2 className="arcade-title text-2xl text-fg sm:text-3xl">
            <span className="text-blaze">3.</span> Select stage
          </h2>
          <RoomScan live={mode === null ? null : mode === "live"} onReady={onRoomReady} />
          <ArenaPicker
            arenas={arenas}
            value={arena}
            view={view}
            onChange={(id, v) => {
              setArena(id);
              setView(v);
            }}
          />
        </section>

        <footer className="border-t border-line py-5 text-center text-xs text-dim">
          <Link href="/gallery" className="inline-flex min-h-11 items-center px-2 font-semibold text-muted hover:text-fg">
            Gallery
          </Link>
          <span aria-hidden className="mx-2">
            ·
          </span>
          {CREDIT_LINE}
        </footer>
      </div>

      {/* sticky fight bar: mode + FIGHT, thumb-reachable */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-line bg-ink pb-[env(safe-area-inset-bottom)]" data-fight-bar>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6">
          <div className="flex shrink-0 overflow-hidden rounded-lg border-2 border-line-strong" role="group" aria-label="Opponent">
            {(["cpu", "2p"] as const).map((m) => (
              <button
                key={m}
                data-versus={m}
                aria-pressed={versus === m}
                onClick={() => setVersus(m)}
                className={`flex min-h-12 min-w-12 items-center justify-center px-2.5 font-display text-xs font-bold sm:px-3 sm:text-sm ${
                  versus === m ? "bg-fg text-ink" : "bg-panel text-muted hover:text-fg"
                }`}
              >
                {m === "cpu" ? (
                  <>
                    <span className="sm:hidden">vs CPU</span>
                    <span className="hidden sm:inline">1P vs CPU</span>
                  </>
                ) : (
                  <>
                    <span className="sm:hidden">2P</span>
                    <span className="hidden sm:inline">2 players</span>
                  </>
                )}
              </button>
            ))}
          </div>
          {versus === "cpu" && (
            <button
              onClick={() => setCpu((c) => (c === "easy" ? "normal" : c === "normal" ? "hard" : "easy"))}
              className="flex min-h-12 w-16 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-line-strong bg-panel text-xs font-bold uppercase leading-tight sm:w-20"
              data-cpu-level={cpu}
              aria-label={`CPU difficulty: ${cpu}. Tap to change`}
              title="CPU difficulty (tap to change)"
            >
              <span className="text-[10px] text-dim">CPU</span>
              <span className={cpu === "hard" ? "text-danger" : cpu === "easy" ? "text-ok" : "text-gold"}>{cpu}</span>
            </button>
          )}
          <div className="hidden min-w-0 flex-1 truncate text-sm text-muted md:block">
            <b className="text-blaze">{fighters.find((f) => f.id === p1Id)?.name}</b> vs <b className="text-volt">{fighters.find((f) => f.id === p2Id)?.name}</b> ·{" "}
            {arenaName}
          </div>
          <Link href="/gallery" aria-label="Gallery" className="btn btn-gold h-14 shrink-0 px-3 font-extrabold uppercase tracking-wide sm:px-4" data-nav="gallery-bar">
            <GalleryIcon />
            <span className="hidden xs:inline sm:inline">Gallery</span>
          </Link>
          <Link
            href={fightHref}
            onClick={() => {
              unlockAudio();
              sfx("fight");
            }}
            data-action="fight"
            className="btn btn-primary btn-lg h-14 flex-1 text-2xl md:max-w-xs"
          >
            Fight!
          </Link>
        </div>
      </div>
    </main>
  );
}
