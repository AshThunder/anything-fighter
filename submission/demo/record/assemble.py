#!/usr/bin/env python3
"""Assemble the 1080p30 Anything Fighter demo.

One-command rebuild (does not overwrite v1 unless --output points at it):

  /workspace/demo/.venv/bin/python /workspace/demo/record/assemble.py \
      --voice en-GB-RyanNeural \
      --output /workspace/demo/Anything-Fighter-Demo-v2.mp4

Pass a different --voice to regenerate the same script with another edge-tts voice.
Does not start any Aholo jobs. Reuses existing clips in /workspace/demo/clips/.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import textwrap
import time
from pathlib import Path

ROOT = Path("/workspace/demo")
CLIPS = ROOT / "clips"
RAW = CLIPS / "raw"
MP4 = CLIPS / "mp4"
VO_ROOT = ROOT / "vo"
WORK = ROOT / "edit"
WORK.mkdir(exist_ok=True)
(WORK / "parts").mkdir(exist_ok=True)

FORGE_RESULT = CLIPS / "FORGE-RESULT.json"
TIMELINE = CLIPS / "forge-timeline.json"

W, H, FPS = 1920, 1080, 30
BG = "0x0b0b0e"

# Gameplay speed-up (setpts=PTS/speed). UI pages stay at 1.0.
SPEED = {
    "A_hook_vs": 1.0,
    "A_hook_fight": 1.70,
    "G_fight_toyshop": 1.75,
    "H_fight_myroom": 1.70,
    "N_hydra_fight": 1.80,
    "K_mobile_fight": 1.70,
    "L_close": 1.0,
}

# Visual holds after each VO line (plus the inter-segment gap).
EXTRA_AFTER = {
    "01_hook": 0.25,
    "02_home": 0.30,
    "03_forge_form": 0.30,
    "04_live_forge": 3.80,  # time-lapse needs picture after the line
    "05_roster": 0.35,
    "06_select_stages": 0.45,
    "07_fight_viewer": 0.70,
    "08_reality": 0.80,
    "08b_hydra": 1.00,
    "09_gallery": 0.35,
    "10_close": 1.00,
}

FIGHT_IDS = {"01_hook", "07_fight_viewer", "08_reality", "08b_hydra"}


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd) if isinstance(cmd, list) else cmd)
    subprocess.check_call(cmd, **kw)


def probe(path: Path) -> float:
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "csv=p=0", str(path)
    ], text=True).strip()
    return float(out)


def ensure_mp4(name: str, src_webm: Path | None = None) -> Path:
    dst = MP4 / f"{name}.mp4"
    src = src_webm or (RAW / f"{name}.webm")
    if dst.exists() and (not src.exists() or dst.stat().st_mtime >= src.stat().st_mtime):
        return dst
    if not src.exists():
        raise FileNotFoundError(src)
    vf = (
        f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},"
        f"fps={FPS},format=yuv420p"
    )
    run([
        "ffmpeg", "-y", "-i", str(src), "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "19",
        "-an", "-movflags", "+faststart", str(dst)
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dst


def cut(src: Path, ss: float, dur: float, out: Path, speed: float = 1.0):
    """Take `dur` seconds of SOURCE starting at ss. speed>1 shortens the output."""
    vf = [
        f"scale={W}:{H}:force_original_aspect_ratio=decrease",
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG}",
        f"fps={FPS}",
        "format=yuv420p",
    ]
    speed = speed or 1.0
    if abs(speed - 1.0) > 0.01:
        vf.insert(0, f"setpts=PTS/{speed}")
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{max(ss, 0):.3f}",
        "-t", f"{max(dur, 0.05):.3f}",
        "-i", str(src),
        "-vf", ",".join(vf), "-an",
        "-c:v", "libx264", "-preset", "fast", "-crf", "19",
        "-pix_fmt", "yuv420p", str(out),
    ]
    run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ensure_mobile_mp4(name: str) -> Path:
    """Crop the 412x915 phone viewport out of the 1080x1920 recording, then letterbox to 16:9."""
    src = RAW / f"{name}.webm"
    dst = MP4 / f"{name}.mp4"
    if dst.exists() and (not src.exists() or dst.stat().st_mtime >= src.stat().st_mtime):
        # already cropped in a previous build
        w = subprocess.check_output([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", str(dst)
        ], text=True).strip()
        if w.startswith("1920,1080"):
            return dst
    if not src.exists():
        if dst.exists():
            return dst
        raise FileNotFoundError(src)
    vf = (
        "crop=412:915:0:0,"
        "scale=-2:1080,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},"
        f"fps={FPS},format=yuv420p"
    )
    run([
        "ffmpeg", "-y", "-i", str(src), "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "19",
        "-an", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dst)
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dst


def silence_wav(path: Path, seconds: float):
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
         "-t", f"{seconds:.3f}", "-c:a", "pcm_s16le", str(path)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def build_voiceover(manifest: dict, include_hydra: bool):
    segs = list(manifest["segments"])
    if not include_hydra:
        segs = [s for s in segs if s["id"] != "08b_hydra"]
    pre = 0.30
    gap = 0.40
    post = 0.70
    concat_list = []
    srt_rows = []
    t = 0.0
    sil = WORK / "sil_pre.wav"
    silence_wav(sil, pre)
    concat_list.append(sil)
    t += pre
    timeline = []
    for i, s in enumerate(segs):
        start = t
        end = t + s["duration"]
        style = s.get("caption_style") or ("FightSub" if s["id"] in FIGHT_IDS else "Sub")
        srt_rows.append((start, end, s["sub"], style, s["id"]))
        concat_list.append(Path(s["wav"]))
        t = end
        pad = gap + EXTRA_AFTER.get(s["id"], 0)
        if i == len(segs) - 1:
            pad = post + EXTRA_AFTER.get(s["id"], 0)
        if pad > 0.01:
            sp = WORK / f"sil_{s['id']}.wav"
            silence_wav(sp, pad)
            concat_list.append(sp)
            t += pad
        timeline.append({
            "id": s["id"], "vo_start": start, "vo_end": end, "until": t,
            "sub": s["sub"], "caption_style": style,
        })
    lst = WORK / "vo_concat.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in concat_list))
    vo_out = WORK / "vo_full.wav"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(vo_out)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    (WORK / "vo_timeline.json").write_text(json.dumps({"duration": t, "segments": timeline}, indent=2))
    return vo_out, t, srt_rows, timeline


def ts(s: float) -> str:
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".", ",")


def write_srt(rows, path: Path):
    lines = []
    for i, row in enumerate(rows, 1):
        a, b, text = row[0], row[1], row[2]
        lines.append(f"{i}\n{ts(a)} --> {ts(b)}\n{text}\n")
    path.write_text("\n".join(lines))


def write_ass(rows, titles, path: Path):
    # Fight captions sit higher so they clear the desktop HUD / touch controls.
    # Fight lower-thirds hang under the health bar (alignment 8).
    header = textwrap.dedent("""\
        [Script Info]
        ScriptType: v4.00+
        PlayResX: 1920
        PlayResY: 1080
        WrapStyle: 0
        ScaledBorderAndShadow: yes

        [V4+ Styles]
        Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
        Style: Sub,Inter,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,56,1
        Style: FightSub,Inter,34,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,3,0,2,90,90,168,1
        Style: MobileSub,Inter,32,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,300,1
        Style: Lower,Inter,32,&H0000A5FF,&H000000FF,&H00101018,&H80000000,-1,0,0,0,100,100,1,0,1,3,0,2,80,80,120,1
        Style: LowerFight,Inter,32,&H0000A5FF,&H000000FF,&H00101018,&H80000000,-1,0,0,0,100,100,1,0,1,3,0,8,80,80,92,1
        Style: Title,Inter,60,&H00FFFFFF,&H000000FF,&H000A0A12,&H00000000,-1,0,0,0,100,100,2,0,1,4,0,8,80,80,80,1
        Style: End,Inter,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,3,0,5,80,80,70,1

        [Events]
        Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    """)

    def ass_time(s):
        h = int(s // 3600)
        m = int((s % 3600) // 60)
        sec = s % 60
        return f"{h:d}:{m:02d}:{sec:05.2f}"

    ev = []
    for row in rows:
        a, b, text, style = row[0], row[1], row[2], (row[3] if len(row) > 3 else "Sub")
        ev.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},{style},,0,0,0,,{text.replace(chr(10), r'\\N')}")
    for a, b, style, text in titles:
        ev.append(f"Dialogue: 1,{ass_time(a)},{ass_time(b)},{style},,0,0,0,,{text}")
    path.write_text(header + "\n".join(ev) + "\n")


def forge_timelapse(out: Path, target_dur: float):
    webm = RAW / "M_live_forge.webm"
    src = webm if webm.exists() else (MP4 / "M_live_forge.mp4")
    if not src.exists():
        raise FileNotFoundError("M_live_forge source missing")
    dur = probe(src)
    events = json.loads(TIMELINE.read_text()) if TIMELINE.exists() else []
    fr = json.loads(FORGE_RESULT.read_text()) if FORGE_RESULT.exists() else {}

    def vtime_of(e):
        if fr.get("finishedAt"):
            from datetime import datetime
            fin = datetime.fromisoformat(fr["finishedAt"].replace("Z", "+00:00")).timestamp()
            video_start = fin - dur
            return e["t"] / 1000.0 - video_start
        return None

    points = {}
    for e in events:
        vt = vtime_of(e)
        if vt is None:
            continue
        prog = (e.get("progress") or "") + e.get("event", "")
        if e["event"] == "clicked-forge":
            points.setdefault("click", vt)
        if e["event"] == "on-forge-page":
            points.setdefault("page", vt)
        if e["event"] == "forge-ready" or "All 6 steps done" in prog:
            points["ready"] = vt
        if "Fighter concept" in prog and e["event"] == "stage":
            points.setdefault("concept", vt)
        if "3D mesh" in prog:
            points.setdefault("mesh", vt)
        if "Skeleton" in prog:
            points.setdefault("rig", vt)
        if "fight moves" in prog:
            points.setdefault("retarget", vt)
        if "KO poster" in prog:
            points.setdefault("poster", vt)

    parts = []
    n = 0

    def add(ss, src_d, speed=1.0):
        nonlocal n
        if src_d <= 0.08 or ss >= dur - 0.05:
            return 0.0
        ss = max(0.0, ss)
        if ss + src_d > dur:
            src_d = dur - ss
        if src_d <= 0.08:
            return 0.0
        p = WORK / "parts" / f"forge_{n:02d}.mp4"
        cut(src, ss, src_d, p, speed=speed)
        parts.append(p)
        n += 1
        return src_d / max(speed, 0.01)

    # Filled form + click, then arrive on the live page.
    add(2.8, 3.2, 1.0)
    page = points.get("page", 12.5)
    add(page, 2.2, 1.0)
    mesh = points.get("mesh", 70)
    if mesh - (page + 2.2) > 2:
        add(page + 2.2, mesh - (page + 2.2), speed=max((mesh - (page + 2.2)) / 1.0, 1))
    add(mesh, 1.0, 1.0)
    rig = points.get("rig", 138)
    if rig - (mesh + 1.0) > 1.5:
        add(mesh + 1.0, rig - (mesh + 1.0), speed=max((rig - (mesh + 1.0)) / 0.7, 1))
    add(rig, 1.0, 1.0)
    ret = points.get("retarget", 208)
    if ret - (rig + 1.0) > 1.5:
        add(rig + 1.0, ret - (rig + 1.0), speed=max((ret - (rig + 1.0)) / 0.7, 1))
    add(ret, 1.0, 1.0)
    poster = points.get("poster", 405)
    if poster - (ret + 1.0) > 2:
        add(ret + 1.0, poster - (ret + 1.0), speed=max((poster - (ret + 1.0)) / 0.9, 1))
    add(poster, 1.0, 1.0)
    ready = points.get("ready", max(dur - 8, poster + 2))
    if ready - (poster + 1.0) > 2:
        add(poster + 1.0, ready - (poster + 1.0), speed=max((ready - (poster + 1.0)) / 1.0, 1))
    add(ready, min(4.0, max(dur - ready, 1)), 1.0)

    if not parts:
        raise SystemExit("forge timelapse produced no parts")
    lst = WORK / "forge_concat.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    tmp = WORK / "parts" / "forge_tl_raw.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-an", "-pix_fmt", "yuv420p", str(tmp)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    d = probe(tmp)
    # If still a little long, speed the whole tl slightly rather than cutting the click or the ready reveal.
    if target_dur and d > target_dur + 0.12:
        speed = d / target_dur
        cut(tmp, 0.0, d, out, speed=speed)
        print(f"forge timelapse {probe(out):.2f}s (sped {speed:.2f}x to fit {target_dur:.2f}s) from {dur:.1f}s  points",
              {k: round(v, 1) for k, v in points.items()})
    else:
        if tmp.resolve() != out.resolve():
            run(["ffmpeg", "-y", "-i", str(tmp), "-c", "copy", str(out)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"forge timelapse {probe(out):.2f}s from {dur:.1f}s  points",
              {k: round(v, 1) for k, v in points.items()})


def load_or_make_vo(voice: str, skip_vo: bool) -> dict:
    outdir = VO_ROOT / voice
    manifest_path = outdir / "manifest.json"
    if skip_vo and manifest_path.exists():
        print(f"Reusing existing VO at {outdir}")
        return json.loads(manifest_path.read_text())
    if manifest_path.exists():
        man = json.loads(manifest_path.read_text())
        segs = json.loads((VO_ROOT / "segments.json").read_text())
        ids_ok = [s["id"] for s in man.get("segments", [])] == [s["id"] for s in segs]
        wavs_ok = all(Path(s["wav"]).exists() for s in man.get("segments", []))
        if man.get("voice") == voice and ids_ok and wavs_ok and not _segments_newer_than(manifest_path):
            print(f"VO cache hit for {voice}")
            return man
    # Generate (or regenerate) this voice.
    sys.path.insert(0, str(ROOT / "record"))
    import gen_vo  # noqa: E402
    return gen_vo.main(["--voice", voice, "--outdir", str(outdir)])


def _segments_newer_than(manifest_path: Path) -> bool:
    segs = VO_ROOT / "segments.json"
    return segs.exists() and segs.stat().st_mtime > manifest_path.stat().st_mtime


def hold_last_frame(src: Path, seconds: float, out: Path):
    still = out.with_suffix(".png")
    run(["ffmpeg", "-y", "-sseof", "-0.05", "-i", str(src), "-frames:v", "1", str(still)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run(["ffmpeg", "-y", "-loop", "1", "-i", str(still), "-t", f"{seconds:.3f}",
         "-vf", f"fps={FPS},format=yuv420p",
         "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-an", str(out)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Assemble the Anything Fighter demo video")
    ap.add_argument("--voice", default="en-GB-RyanNeural",
                    help="edge-tts voice, e.g. en-GB-RyanNeural or en-US-BrianNeural")
    ap.add_argument("--output", type=Path, default=ROOT / "Anything-Fighter-Demo-v2.mp4",
                    help="destination mp4 (defaults to v2 so v1 is not overwritten)")
    ap.add_argument("--skip-vo", action="store_true",
                    help="reuse already-generated wavs for this voice")
    return ap.parse_args(argv)


def main(argv=None):
    t0 = time.time()
    args = parse_args(argv)
    voice = args.voice
    master = Path(args.output)

    include_hydra = False
    fr = {}
    if FORGE_RESULT.exists():
        fr = json.loads(FORGE_RESULT.read_text())
        include_hydra = bool(fr.get("success")) and (
            (RAW / "N_hydra_fight.webm").exists() or (MP4 / "N_hydra_fight.mp4").exists()
        )

    needed = [
        "A_hook", "B_home", "C_forge_form", "D_gallery_roster", "E_select", "F_stages",
        "G_fight_toyshop", "H_fight_myroom", "I_gallery_detail", "L_close",
    ]
    if include_hydra:
        needed.append("N_hydra_fight")
    for n in needed:
        if (RAW / f"{n}.webm").exists() or (MP4 / f"{n}.mp4").exists():
            if (RAW / f"{n}.webm").exists() or not (MP4 / f"{n}.mp4").exists():
                try:
                    ensure_mp4(n)
                except FileNotFoundError:
                    if not (MP4 / f"{n}.mp4").exists():
                        raise

    for kname in ("K_mobile_fight", "K_mobile_home", "K_mobile_gallery"):
        if (RAW / f"{kname}.webm").exists() or (MP4 / f"{kname}.mp4").exists():
            ensure_mobile_mp4(kname)

    manifest = load_or_make_vo(voice, args.skip_vo)
    vo_path, vo_dur, srt_rows, vo_tl = build_voiceover(manifest, include_hydra)
    print(f"VO duration {vo_dur:.2f}s  voice={voice}")

    by_id = {s["id"]: s for s in vo_tl}

    def window(id_):
        s = by_id[id_]
        return s["vo_start"], s["until"], s["until"] - s["vo_start"]

    parts = []
    idx = 0
    close_mobile_dur = 0.0

    def take(src_name, ss, dur, speed=1.0):
        nonlocal idx
        src = MP4 / f"{src_name}.mp4"
        out = WORK / "parts" / f"v{idx:02d}_{src_name}.mp4"
        cut(src, ss, dur, out, speed=speed)
        parts.append(out)
        idx += 1
        return probe(out)

    def fit_clips(clips, target):
        """clips: list of (name, ss, max_avail, speed). Stretch/trim to target."""
        nonlocal idx
        lens = []
        for name, ss, avail, speed in clips:
            lens.append(avail / (speed or 1))
        total = sum(lens) or 1
        acc = 0.0
        for i, ((name, ss, avail, speed), L) in enumerate(zip(clips, lens)):
            if i == len(clips) - 1:
                need = max(target - acc, 0.2)
            else:
                need = target * (L / total)
            src_need = need * (speed or 1)
            src_need = min(src_need, avail)
            actual = take(name, ss, src_need, speed)
            acc += actual
        if acc < target - 0.08:
            pad = target - acc
            last = parts[-1]
            frz = WORK / "parts" / f"v{idx:02d}_hold.mp4"
            hold_last_frame(last, pad, frz)
            parts.append(frz)
            idx += 1

    # 01 hook: brief VS, then the Toy Shop splat fight (sped).
    _, _, t = window("01_hook")
    hook_fight_avail = max(probe(MP4 / "A_hook.mp4") - 15.0 - 0.15, 4.0)
    gdur = probe(MP4 / "G_fight_toyshop.mp4")
    fit_clips([
        ("A_hook", 2.0, 3.2, SPEED["A_hook_vs"]),
        ("A_hook", 15.0, hook_fight_avail, SPEED["A_hook_fight"]),
        # more punchy Toy Shop action so the hook never freezes on a still
        ("G_fight_toyshop", 36.0, max(min(14.0, gdur - 36.2), 5.0), SPEED["G_fight_toyshop"]),
    ], t)

    _, _, t = window("02_home")
    fit_clips([("B_home", 0.4, 14.0, 1.0)], t)

    _, _, t = window("03_forge_form")
    fit_clips([("C_forge_form", 2.0, 20.2, 1.0)], t)

    _, _, t = window("04_live_forge")
    if (RAW / "M_live_forge.webm").exists() or (MP4 / "M_live_forge.mp4").exists():
        tl_path = WORK / "parts" / "forge_tl.mp4"
        forge_timelapse(tl_path, t)
        d = probe(tl_path)
        if d >= t + 0.05:
            # keep the end so "Hydra Punch is ready" is not cut off
            out = WORK / "parts" / f"v{idx:02d}_forge.mp4"
            cut(tl_path, max(0.0, d - t), t, out, 1.0)
            parts.append(out)
            idx += 1
        else:
            parts.append(tl_path)
            if d < t - 0.08:
                frz = WORK / "parts" / f"v{idx:02d}_forgehold.mp4"
                hold_last_frame(tl_path, t - d, frz)
                parts.append(frz)
                idx += 1
            idx += 1
    else:
        fit_clips([("C_forge_form", 2.0, 20.2, 1.0)], t)

    _, _, t = window("05_roster")
    fit_clips([("D_gallery_roster", 0.5, 14.0, 1.0)], t)

    _, _, t = window("06_select_stages")
    e_avail = 12.5
    f_avail = 0
    if (MP4 / "F_stages.mp4").exists():
        f_avail = min(5.5, probe(MP4 / "F_stages.mp4") - 0.3)
    if f_avail > 2:
        fit_clips([("E_select", 1.0, e_avail, 1.0), ("F_stages", 0.3, f_avail, 1.0)], t)
    else:
        fit_clips([("E_select", 1.0, e_avail, 1.0)], t)

    # 07 toyshop fight: FIGHT! banner + first exchange, then the punchy end. Skip the idle mid-section.
    _, _, t = window("07_fight_viewer")
    gdur = probe(MP4 / "G_fight_toyshop.mp4")
    fit_clips([
        ("G_fight_toyshop", 12.0, 6.0, SPEED["G_fight_toyshop"]),
        ("G_fight_toyshop", 36.0, max(gdur - 36.0 - 0.2, 5.0), SPEED["G_fight_toyshop"]),
    ], t)

    # 08 Reality room: action + knockdown, skip VS / countdown.
    _, _, t = window("08_reality")
    hdur = probe(MP4 / "H_fight_myroom.mp4")
    fit_clips([("H_fight_myroom", 21.0, max(hdur - 21.0 - 0.2, 5.0), SPEED["H_fight_myroom"])], t)

    if include_hydra and "08b_hydra" in by_id:
        _, _, t = window("08b_hydra")
        nd = probe(MP4 / "N_hydra_fight.mp4")
        # Hits and knockdown; skip VS / early walk-up.
        fit_clips([("N_hydra_fight", 26.0, max(nd - 26.0 - 0.2, 4.0), SPEED["N_hydra_fight"])], t)

    _, _, t = window("09_gallery")
    fit_clips([("I_gallery_detail", 0.4, 15.0, 1.0)], t)

    _, _, t = window("10_close")
    clips = []
    if (MP4 / "K_mobile_fight.mp4").exists():
        kd = probe(MP4 / "K_mobile_fight.mp4")
        # In-ring action, skip the VS splash.
        clips.append(("K_mobile_fight", 11.5, max(kd - 11.5 - 0.2, 4.0), SPEED["K_mobile_fight"]))
    if (MP4 / "K_mobile_home.mp4").exists():
        clips.append(("K_mobile_home", 0.3, 6.0, 1.0))
    clips.append(("L_close", 0.5, 12.0, SPEED["L_close"]))
    # Remember how long the mobile-fight piece will be, for caption style.
    if clips and clips[0][0] == "K_mobile_fight":
        name, ss, avail, speed = clips[0]
        other = sum(a / (s or 1) for (_, _, a, s) in clips[1:])
        # same proportion as fit_clips
        total_l = sum(a / (s or 1) for (_, _, a, s) in clips) or 1
        close_mobile_dur = t * ((avail / (speed or 1)) / total_l)
        close_mobile_dur = min(close_mobile_dur, avail / (speed or 1))
    fit_clips(clips, t)

    # Split the close caption: MobileSub over the phone fight, Sub over the home/end card.
    if close_mobile_dur > 0.4 and "10_close" in by_id:
        new_rows = []
        for row in srt_rows:
            if len(row) > 4 and row[4] == "10_close":
                a, b, text, _, sid = row[0], row[1], row[2], row[3], row[4]
                split = a + close_mobile_dur
                if split < b - 0.3:
                    new_rows.append((a, split, text, "MobileSub", sid))
                    new_rows.append((split, b, text, "Sub", sid))
                else:
                    new_rows.append((a, b, text, "MobileSub", sid))
            else:
                new_rows.append(row)
        srt_rows = new_rows

    vlist = WORK / "video_concat.txt"
    vlist.write_text("".join(f"file '{p}'\n" for p in parts))
    video = WORK / "video_raw.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(vlist),
         "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-an", str(video)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    vdur = probe(video)
    print(f"Video concat {vdur:.2f}s  VO {vo_dur:.2f}s")

    def mid(id_, frac=0.0, length=3.2, style="Lower"):
        s = by_id[id_]
        a = s["vo_start"] + frac
        return a, min(a + length, s["until"] - 0.05), style

    titles = []
    a, b, st = mid("01_hook", 0.1, 3.8, "LowerFight")
    titles.append((a, b, st, "Snap anything. Fight everything."))
    if "04_live_forge" in by_id:
        a, b, st = mid("04_live_forge", 0.2, 4.0, "Lower")
        titles.append((a, b, st, "Lux3D — photo → concept → mesh → auto-rig → retarget"))
        a, b, st = mid("04_live_forge", 4.4, 3.2, "Lower")
        titles.append((a, b, st, "Asset / OUS — photo upload"))
    a, b, st = mid("06_select_stages", 6.0, 4.0, "Lower")
    titles.append((a, b, st, "SpatialGen — Toy Shop · Rooftop Dojo"))
    a, b, st = mid("07_fight_viewer", 0.2, 3.6, "LowerFight")
    titles.append((a, b, st, "Aholo Viewer — 3DGS fight backdrop"))
    a, b, st = mid("08_reality", 0.1, 3.4, "LowerFight")
    titles.append((a, b, st, "Reality — fight in a scanned room"))
    a, b, st = mid("09_gallery", 0.2, 4.0, "Lower")
    titles.append((a, b, st, "Gallery — photo · concept · poster · 3D"))
    a, b, st = mid("10_close", 0.2, 3.2, "LowerFight")
    titles.append((a, b, st, "RenderCloud — KO poster"))
    a, b, st = mid("10_close", max(0, (by_id["10_close"]["until"] - by_id["10_close"]["vo_start"]) - 6.0), 6.0, "End")
    titles.append((a, b, st, "anything-fighter.vercel.app  ·  #Manycorehackathon"))

    ass = WORK / "captions.ass"
    write_ass(srt_rows, titles, ass)
    write_srt(srt_rows, WORK / "captions.srt")

    ass_esc = str(ass).replace("\\", "\\\\").replace(":", "\\:").replace("'", r"\'")
    vf = f"ass={ass_esc},format=yuv420p"
    mux_t = max(vo_dur, vdur)
    run([
        "ffmpeg", "-y",
        "-i", str(video),
        "-i", str(vo_path),
        "-t", f"{vo_dur:.3f}",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
        "-shortest",
        "-movflags", "+faststart",
        str(master),
    ])
    size = master.stat().st_size
    d = probe(master)
    elapsed = time.time() - t0
    info = {
        "path": str(master),
        "duration": d,
        "bytes": size,
        "voice": voice,
        "speed_factors": SPEED,
        "vo_duration": vo_dur,
        "video_duration": vdur,
        "rebuild_seconds": round(elapsed, 1),
        "forge": {k: fr.get(k) for k in ("fighterName", "success", "finalStatus", "mode", "sharePhoto") if fr},
        "rebuild_command": (
            f"/workspace/demo/.venv/bin/python /workspace/demo/record/assemble.py "
            f"--voice {voice} --output {master}"
        ),
    }
    (WORK / "master-v2.json").write_text(json.dumps(info, indent=2))
    print(f"MASTER {master}  {d:.2f}s  {size} bytes  ({size/1e6:.1f} MB)  voice={voice}  build={elapsed:.1f}s")
    return info


if __name__ == "__main__":
    main()
