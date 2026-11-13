"use client";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useEffect, useState } from "react";
import { Arena } from "@/components/arena/Arena";
import { AholoSplatLayer, isMobileGPU } from "@/components/arena/AholoSplatLayer";
import { CameraRig, DashTrails, HitSparks } from "./Effects";
import { Fighter } from "./Fighter";
import { SafeModel } from "./SafeModel";
import { StudioEnv } from "./StudioEnv";
import { useGame } from "@/lib/game/store";
import { ARENA_HALF, resetSim, sim, step } from "@/lib/game/sim";
import { attachInput, readPlayerInput, setTwoPlayer } from "@/lib/game/input";
import { duckMusic, sfx, startMusic, stopMusic } from "@/lib/game/audio";
import { startClip, stopClip } from "@/lib/game/recorder";

const canvases = () => Array.from(document.querySelectorAll<HTMLCanvasElement>("[data-game-root] canvas"));
import { resetAI, runAI } from "@/lib/game/ai";

/** The one simulation loop. React state only changes on hits and phase transitions. */
function GameLoop() {
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const { phase, applyHit, setPhase, setWinner, mode, level, notify } = useGame.getState();
    const fighting = phase === "fight";
    if (fighting) {
      readPlayerInput();
      if (mode === "cpu") runAI(dt, level);
      else if (mode === "practice") {
        runAI(dt, "easy");
        sim.f[1].buf = null; // sparring dummy: moves + blocks, never attacks
        for (const f of sim.f) f.hp = Math.max(f.hp, 25); // never KO in practice
        sim.time = 60;
      }
    }
    const events = step(dt, fighting);
    for (const e of events) {
      if (e.kind === "move") {
        notify(e.who, e.move);
        sfx(e.move === "super" ? "vs" : "whoosh", e.move === "super" ? 1 : 1.6);
        continue;
      }
      applyHit(e.defender, sim.f[e.defender].hp, e.dmg, e.blocked, e.heavy);
      if (e.tag) notify(e.tag === "parry" ? e.defender : e.attacker, e.tag);
      sfx(e.tag === "parry" ? "block" : e.blocked ? "block" : e.heavy ? "kick" : "punch", e.tag === "parry" ? 1.6 : 0.8 + e.dmg / 20);
      // haptics on a phone: light tap per clean hit, longer buzz on heavy hits / knockdowns
      if (!e.blocked && typeof navigator !== "undefined") navigator.vibrate?.(e.tag === "knockdown" || e.tag === "antiair" ? 60 : e.heavy ? 30 : 12);
    }

    if (fighting) {
      const [a, b] = sim.f;
      const koIdx = a.hp <= 0 ? 0 : b.hp <= 0 ? 1 : sim.time <= 0 ? (a.hp < b.hp ? 0 : b.hp < a.hp ? 1 : 1) : -1;
      if (koIdx !== -1) {
        const winner = (koIdx === 0 ? 1 : 0) as 0 | 1;
        sim.f[koIdx].state = "ko";
        sim.f[koIdx].stateT = 0;
        sim.f[koIdx].atk = null;
        sim.fx.superSlow = 0;
        sim.fx.slowmo = 0.3;
        sim.fx.shake = 1;
        setWinner(winner);
        setPhase("ko");
        sfx("ko");
        duckMusic(true);
        setTimeout(() => {
          sim.fx.slowmo = 1;
          sim.f[winner].state = "victory";
          sim.f[winner].stateT = 0;
          sim.f[winner].atk = null;
          useGame.getState().setPhase("victory");
          sfx("victory");
          setTimeout(() => stopClip(), 2500);
        }, 1600);
      }
    }
  });
  return null;
}

function PhaseDriver() {
  const phase = useGame((s) => s.phase);
  const setPhase = useGame((s) => s.setPhase);
  useEffect(() => {
    if (phase === "loading") setPhase(useGame.getState().mode === "practice" ? "intro" : "vs");
    if (phase === "vs") {
      sfx("whoosh");
      const s = setTimeout(() => sfx("vs"), 450);
      const t = setTimeout(() => setPhase("intro"), 2400);
      return () => {
        clearTimeout(t);
        clearTimeout(s);
      };
    }
    if (phase === "fight" && useGame.getState().mode !== "practice") startClip(canvases);
    if (phase === "intro") {
      resetSim();
      resetAI();
      duckMusic(false);
      const t = setTimeout(() => setPhase("fight"), 2600);
      return () => clearTimeout(t);
    }
  }, [phase, setPhase]);
  return null;
}

export default function GameScene() {
  useEffect(() => {
    // test hook for screenshots / demo recording: /fight?...&debug=1 exposes the sim
    if (new URLSearchParams(window.location.search).has("debug")) (window as unknown as { __sim: typeof sim }).__sim = sim;
  }, []);
  const fighters = useGame((s) => s.fighters);
  const arena = useGame((s) => s.arena);
  const mode = useGame((s) => s.mode);
  useEffect(() => attachInput(), []);
  useEffect(() => setTwoPlayer(mode === "2p"), [mode]);
  useEffect(() => {
    startMusic();
    return () => stopMusic();
  }, []);
  useEffect(() => {
    sim.half = arena.kind === "splat" && arena.half ? arena.half : ARENA_HALF;
  }, [arena]);
  // Mobile: cap DPR at 1.5 and skip MSAA (two WebGL canvases at DPR 2.6 is what gets contexts killed on phones).
  const [mobile] = useState(isMobileGPU);
  // If the R3F context is lost and not restored within 2.5 s, remount the canvas (fighters must never vanish).
  const [glKey, setGlKey] = useState(0);
  if (!fighters) return null;
  const splat = arena.kind === "splat" && arena.url;
  return (
    <div className="absolute inset-0 bg-ink" data-game-root data-arena={arena.kind}>
      {splat && (
        <AholoSplatLayer
          urls={arena.urls?.length ? arena.urls : [arena.url!]}
          upAxis={arena.upAxis}
          origin={arena.origin}
          scale={arena.scale}
          yaw={arena.yaw}
          poster={arena.fallbackPano}
          onFail={splatFailed}
        />
      )}
      <Canvas
        key={glKey}
        className="!absolute inset-0"
        shadows
        dpr={mobile ? [1, 1.5] : [1, 2]}
        camera={{ fov: 40, position: [0, 1.6, 5.5], near: 0.05, far: 200 }}
        gl={{ alpha: !!splat, preserveDrawingBuffer: true, antialias: !mobile, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          const el = gl.domElement;
          let restored = true;
          el.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            restored = false;
            console.warn("[game] R3F WebGL context lost");
            setTimeout(() => !restored && setGlKey((k) => k + 1), 2500);
          });
          el.addEventListener("webglcontextrestored", () => (restored = true));
          // perf probe for scripts/fps.mjs (debug only): draw calls / triangles / textures
          if (new URLSearchParams(window.location.search).has("debug")) (window as unknown as { __gl: typeof gl }).__gl = gl;
        }}
      >
        <hemisphereLight args={["#ffe8cc", "#1a1410", 0.9]} />
        <directionalLight
          position={[3, 7, 4]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-7}
          shadow-camera-right={7}
          shadow-camera-top={5}
          shadow-camera-bottom={-2}
        />
        <pointLight position={[-4, 2.5, 2]} color="#f27f0d" intensity={5} distance={9} />
        <pointLight position={[4, 2.5, 2]} color="#38bdf8" intensity={4} distance={9} />
        <StudioEnv />
        <Arena spec={arena} />
        <Suspense fallback={null}>
          <SafeModel def={fighters[0]} render={(d) => <Fighter def={d} index={0} />} />
          <SafeModel def={fighters[1]} render={(d) => <Fighter def={d} index={1} />} />
          <PhaseDriver />
        </Suspense>
        <HitSparks />
        <DashTrails />
        <CameraRig />
        <GameLoop />
        {!splat && (
          <EffectComposer>
            {/* flat look: no vignette (radial edge darkening) since the 13 Nov UI pass; bloom glow only */}
            <Bloom luminanceThreshold={1.4} intensity={0.8} mipmapBlur />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

/** Splat couldn't load / draw on this device: fall back to the world's panorama, else the built-in ring. */
function splatFailed(reason?: string) {
  const a = useGame.getState().arena;
  if (a.kind !== "splat") return;
  console.warn(`[game] splat arena fallback (${reason ?? "unknown"}) → ${a.fallbackPano ? "panorama" : "Neon Ring"}`);
  useGame.setState({ arena: a.fallbackPano ? { kind: "pano", url: a.fallbackPano, name: a.name } : { kind: "stage", name: a.name } });
}
