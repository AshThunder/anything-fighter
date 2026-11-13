#!/usr/bin/env python3
"""Generate per-segment voiceover with edge-tts.

Each line can be split into parts with their own rate/pitch/volume, then
concatenated with short silences for rhythm (Ryan has no style tags).

  /workspace/demo/.venv/bin/python /workspace/demo/record/gen_vo.py --voice en-GB-RyanNeural
"""
from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path("/workspace/demo")
DEFAULT_SEGS = ROOT / "vo" / "segments.json"


def probe(path: Path) -> float:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        text=True,
    ).strip()
    return float(out)


def silence_wav(path: Path, seconds: float, rate: int = 48000):
    seconds = max(seconds, 0.02)
    subprocess.check_call(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r={rate}:cl=mono",
         "-t", f"{seconds:.3f}", "-c:a", "pcm_s16le", str(path)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def mp3_to_wav(mp3: Path, wav: Path):
    raw = wav.with_suffix(".raw.wav")
    subprocess.check_call(
        ["ffmpeg", "-y", "-i", str(mp3),
         "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(raw)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    trim_silence(raw, wav, pad=0.07)
    raw.unlink(missing_ok=True)


def trim_silence(src: Path, dst: Path, pad: float = 0.07):
    """Trim leading and trailing TTS padding only. Keep pauses inside the line."""
    # Reverse-trick: silenceremove with stop_periods would eat mid-sentence gaps.
    af = (
        f"silenceremove=start_periods=1:start_threshold=-34dB:start_silence={pad:.3f},"
        f"areverse,"
        f"silenceremove=start_periods=1:start_threshold=-34dB:start_silence={pad:.3f},"
        f"areverse"
    )
    subprocess.check_call(
        ["ffmpeg", "-y", "-i", str(src), "-af", af, "-c:a", "pcm_s16le", str(dst)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if not dst.exists() or dst.stat().st_size < 2048:
        dst.write_bytes(src.read_bytes())



def concat_wavs(paths: list[Path], out: Path):
    lst = out.with_suffix(".concat.txt")
    lst.write_text("".join(f"file '{p}'\n" for p in paths))
    subprocess.check_call(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c", "copy", str(out)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def parts_of(seg: dict) -> list[dict]:
    if seg.get("parts"):
        return list(seg["parts"])
    tts = seg.get("tts") or seg.get("sub") or ""
    return [{"tts": tts, "rate": "+8%", "pitch": "+0Hz", "volume": "+0%", "silence_after": 0.0}]


async def synth_part(text: str, voice: str, rate: str, pitch: str, volume: str, mp3: Path):
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume)
    await comm.save(str(mp3))


async def one_segment(seg: dict, voice: str, outdir: Path) -> dict:
    sid = seg["id"]
    work = outdir / "parts"
    work.mkdir(parents=True, exist_ok=True)
    pieces: list[Path] = []
    part_meta = []
    for i, p in enumerate(parts_of(seg)):
        rate = p.get("rate", "+8%")
        pitch = p.get("pitch", "+0Hz")
        volume = p.get("volume", "+0%")
        mp3 = work / f"{sid}_{i:02d}.mp3"
        wav = work / f"{sid}_{i:02d}.wav"
        await synth_part(p["tts"], voice, rate, pitch, volume, mp3)
        mp3_to_wav(mp3, wav)
        pieces.append(wav)
        dur = probe(wav)
        part_meta.append({**p, "duration": dur, "wav": str(wav)})
        gap = float(p.get("silence_after") or 0)
        if gap > 0.01:
            sil = work / f"{sid}_{i:02d}_sil.wav"
            silence_wav(sil, gap)
            pieces.append(sil)
    wav_out = outdir / f"{sid}.wav"
    mp3_out = outdir / f"{sid}.mp3"
    concat_wavs(pieces, wav_out)
    subprocess.check_call(
        ["ffmpeg", "-y", "-i", str(wav_out), "-codec:a", "libmp3lame", "-q:a", "4", str(mp3_out)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    dur = probe(wav_out)
    preview = (seg.get("sub") or parts_of(seg)[0]["tts"])[:60]
    print(f"{sid}: {dur:.2f}s  {preview}...")
    return {
        **{k: seg[k] for k in ("id", "sub", "mood", "caption_style") if k in seg},
        "duration": dur,
        "wav": str(wav_out),
        "mp3": str(mp3_out),
        "voice": voice,
        "parts": part_meta,
    }


async def generate(voice: str, segs_path: Path, outdir: Path) -> dict:
    segs = json.loads(segs_path.read_text())
    outdir.mkdir(parents=True, exist_ok=True)
    rows = []
    for seg in segs:
        rows.append(await one_segment(seg, voice, outdir))
    manifest = {
        "voice": voice,
        "segments_file": str(segs_path),
        "outdir": str(outdir),
        "segments": rows,
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    total = sum(r["duration"] for r in rows)
    print(f"TOTAL raw speech (with in-line gaps) {total:.1f}s  voice={voice}")
    return manifest


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Generate Anything Fighter demo voiceover")
    ap.add_argument("--voice", default="en-GB-RyanNeural",
                    help="edge-tts voice short name, e.g. en-GB-RyanNeural")
    ap.add_argument("--segments", type=Path, default=DEFAULT_SEGS)
    ap.add_argument("--outdir", type=Path, default=None,
                    help="defaults to /workspace/demo/vo/<voice>/")
    return ap.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    outdir = args.outdir or (ROOT / "vo" / args.voice)
    return asyncio.run(generate(args.voice, args.segments, outdir))


if __name__ == "__main__":
    main()
