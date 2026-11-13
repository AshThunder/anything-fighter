# Hackathon submission packet

Sources and the project-report PDF for the Manycore Aholo Global 3D AI Hackathon entry. Status as of **13 Nov 2026, ~21:35 WAT** is in [`HANDOFF.md`](../HANDOFF.md) §3.

## What's in this folder

| Path | What it is |
|---|---|
| `Anything-Fighter-Report.pdf` | 12-page project report (the uploaded deliverable, ~3.1 MB). Screenshots were retaken from the live site and show the **Aholo live** badge. |
| `report/Anything-Fighter-Report.html` | HTML source for that PDF. |
| `report/build/` | Playwright scripts used to take shots and print the PDF. |
| `demo/DEMO-PLAN.md` | Demo-video plan and voiceover script. |
| `demo/record/` | Capture and assemble scripts (`assemble.py`, `gen_vo.py`, Playwright capture helpers). |
| `demo/edit/master-v2.json`, `demo/vo/segments.json` | v2 edit map and voiceover segment script. |
| `demo/FORGE-LOCK.json` | Marker that the one approved live forge (**Hydra Punch**, job `gen-mwfchqnq-a74ca3`) has already been used. |

## What is not in git

These stay on the recovery box only (`/workspace/demo`, `/workspace/report`):

- Demo videos (`Anything-Fighter-Demo-v2.mp4` and v1), clips, frames, voice WAVs, `.venv`
- Report screenshot/font assets (`/workspace/report/assets/`) and preview PNGs
- Any env files, API keys, or `/workspace/.gallery-secret`

The submitted **demo video v2** is the 2:08 1080p30 cut (edge-tts `en-GB-RyanNeural`, gameplay at 1.7–1.8×). Rebuild on the box with:

```bash
/workspace/demo/.venv/bin/python /workspace/demo/record/assemble.py \
    --voice en-GB-RyanNeural \
    --output /workspace/demo/Anything-Fighter-Demo-v2.mp4
```

Add `--skip-vo` to reuse the existing voiceover. The scripts still use those absolute box paths; this folder is a source snapshot, not a fully portable build tree.

**Do not start more paid Aholo jobs** without the owner's explicit approval. **Do not press Submit** on the hackathon form without the owner's explicit OK.
