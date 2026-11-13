# Anything Fighter — Demo video plan

Target length: **2–3 minutes**. Audience: Manycore Aholo Global 3D AI Hackathon judges (Gaming track).  
Working demo (stays up): https://anything-fighter.vercel.app  
Do **not** record or spend credits until the owner approves the plan (and, separately, any live forge).

Judges score **Use of Manycore Tech's tools at 30%**, so every Aholo product that actually runs in the app is named on screen and in the voiceover: **Asset / OUS, Lux3D, SpatialGen, Reality, Aholo Viewer, RenderCloud**.

The official brief allows a voiceover and/or subtitles. Burn in subtitles either way.

---

## 1. What we can film now (no credits)

These are already on production. Playwright (or a person) can drive the live site and record them without pressing **Forge it!**, starting a room scan, or creating a SpatialGen world.

| # | Shot | Where | Approx. | Why it matters |
|---|---|---|---|---|
| A | Title / hook | `/fight?p1=mug&p2=duck&arena=toy-shop` already running, then a hard cut to the home hero | 8 s | Immediate “this is a game” hook. Toy Shop is a SpatialGen 3DGS world in Aholo Viewer. |
| B | Home + thesis | `/` desktop 1280×800 (or 1920×1080) | 12 s | “Snap anything. Fight everything.” Credit line in the footer already lists every Aholo tool. |
| C | Forge form (no submit) | `#forge` on `/`. Set an example photo from `public/examples/` (rubber-duck, fire-hydrant, or rotary-dial), tick the share opt-in so the attestation is visible, **do not click Forge it!** | 15 s | Shows the one-shot pipeline, “Aholo live”, the Powered-by strip (Asset Upload, Lux3D multimodal→image, image→3D, auto-rig, retarget, RenderCloud), and photo-sharing consent. |
| D | Pipeline cutaway | `/gallery` cards for the five starters, or the report’s photo → Lux3D concept → RenderCloud poster grid | 15 s | Narrates the Lux3D stages without waiting ~5 minutes or spending credits. |
| E | Fighter select | `/` → Select fighter. Pick **Mug Shot** vs **Quack Attack**, 3D versus preview | 12 s | Live Lux3D meshes idling; Powered-by strip on the selected fighter. |
| F | Stage select | `/` → stage cards: Toy Shop at Midnight, Rooftop Dojo at Sunset, Kitchen Colosseum, **My Room (scan)** | 12 s | SpatialGen worlds + the Reality room already on prod. Show the room-builder UI (do **not** upload a video). |
| G | Fight in a SpatialGen arena | `/fight?p1=mug&p2=duck&arena=toy-shop` then a second clip on `rooftop-dojo` (Mug Shot vs Toast Master or Quack Attack vs Toast Master) | 25 s | Aholo Viewer splat backdrop, Lux3D-rigged clips (jab / cross / hook / special / super). 1P keys: A/D move, J punch, K kick, U special, I super. |
| H | Fight in the Reality room | `/fight?p1=sneaker&p2=mug&arena=my-room` | 15 s | “Fight in your room” — existing Reality reconstruction, no new 20-credit scan. |
| I | Gallery before / after | `/gallery` — starter cards: source photo, Lux3D concept, RenderCloud poster, 3D turntable | 18 s | The before→after the form asks for. Stick to the five starters (Mug Shot, Sole Survivor, Quack Attack, Toast Master, Prickly Pete) unless the owner wants other roster fighters included. |
| J | KO card | End of a CPU fight; open **KO card** and the optional clip download | 10 s | RenderCloud poster on the card; share caption already mentions Lux3D and `#Manycorehackathon`. Nothing is posted. |
| K | Mobile | 412×915 (or 1080×1920 recorded, then fitted). Home forge panel, gallery, `/fight` with the touch pad | 15 s | Completeness + “works on a phone”. |
| L | Close | Home hero + logo + URL + `#Manycorehackathon` | 8 s | Clear call to try the live demo. |

**Safe URL cheatsheet (production, no jobs started):**

- Home: `https://anything-fighter.vercel.app/`
- Gallery: `https://anything-fighter.vercel.app/gallery`
- Toy Shop fight: `https://anything-fighter.vercel.app/fight?p1=mug&p2=duck&arena=toy-shop`
- Rooftop fight: `https://anything-fighter.vercel.app/fight?p1=duck&p2=toaster&arena=rooftop-dojo`
- My Room fight: `https://anything-fighter.vercel.app/fight?p1=sneaker&p2=mug&arena=my-room`
- Kitchen Colosseum (optional cut): `https://anything-fighter.vercel.app/fight?p1=cactus&p2=mug&arena=kitchen-colosseum`

Suggested runtime **without** a live forge: **about 2:25**.

---

## 2. What would need a live forge (owner approval)

A full live Lux3D forge on production costs on the order of **~35–60 credits** (concept image ~12, img-to-3D ~1, auto-rig ~15, retarget ~3/clip × up to 10, plus a non-fatal RenderCloud poster). Daily caps apply (`FORGE_IP_DAILY_LIMIT`, `FORGE_GLOBAL_DAILY_LIMIT`). **Do not start one without an explicit yes.**

| Shot | What we’d film | Cost | Needed? |
|---|---|---|---|
| M | A real photo going through the forge page: stage cards lighting up (OUS upload → Lux3D concept → mesh → auto-rig → retarget → RenderCloud poster), practice spar while it runs, then the new fighter on the roster | ~35–60 credits, ~5 minutes of wait (time-lapse in the edit) | **Optional but high impact.** This is the one shot that shows Aholo working *live*, not just results. |
| N | A new Reality room scan from a phone video | ~20 credits | **Not recommended.** `My Room (scan)` is already on prod (shot H). |
| O | A new SpatialGen world | ~10 credits | **Not recommended.** Three SpatialGen arenas are already playable. |

**Recommendation:** ship the 2:25 cut from shots A–L first. If the owner approves one live forge (a non-face object photo, sharing left off unless they opt in), insert a 20-second time-lapse as shot M between C and E and trim D/G slightly so the video stays under 3:00.

A **mock-mode** forge (local, no key) must not be passed off as a live Aholo run. If it is ever used as a timing rehearsal, it has to stay off the submitted tape.

---

## 3. Voiceover script (~2:25, no live forge)

Tone: arcade, confident, specific. Name the tools. Leave short holes so fight audio (or a light bed) can come through.

**[0:00–0:08. Shot A]**  
“Your mug. Your duck. Your room. Anything Fighter turns one photo into a rigged 3D fighter — and throws it into a world built by Aholo.”

**[0:08–0:20. Shot B]**  
“This is our Gaming-track entry for the Manycore Aholo Global 3D AI Hackathon. Every fighter, every arena, every backdrop you are about to see is made with Aholo’s own tools.”

**[0:20–0:35. Shot C]**  
“Snap or upload any object, give it a name, and hit Forge. Under the hood that’s Asset upload, then Lux3D — concept image, image-to-3D, humanoid auto-rig, and ten retargeted moves — and a RenderCloud KO poster. Sharing the original photo is off by default, and it needs a consent attestation.”

**[0:35–0:50. Shot D]**  
“Here is the same pipeline on the starter roster. A coffee mug becomes Mug Shot. A sneaker, a duck, a toaster, a cactus — each one a full-body fighter, not a floating object.”

**[0:50–1:14. Shots E, F]**  
“Pick your fighter and your opponent. The versus preview is the live Lux3D mesh. Then pick a stage: SpatialGen worlds like Toy Shop at Midnight and Rooftop Dojo — or fight inside a room scanned with Aholo Reality.”

**[1:14–1:54. Shots G, H]**  
“The fight runs in the browser, over an Aholo Viewer 3D Gaussian splat. Combos, a special, a super — the clips are Lux3D retargets, not canned human mocap on a generic body. And this arena is a real room scan. Same game, your space.”

**[1:54–2:12. Shot I]**  
“The gallery shows what was uploaded next to what Lux3D and RenderCloud made of it — photo, concept, poster, and a 3D turntable — so the before and after is always honest.”

**[2:12–2:25. Shots J, K, L]**  
“Win, and you leave with a RenderCloud KO card. It plays on a phone, too. Anything Fighter — built with Aholo Lux3D, SpatialGen, Viewer, Reality, and RenderCloud. Try it at anything-fighter.vercel.app. #Manycorehackathon.”

If shot M is approved, add between C and E (~20 s, time-lapsed):  
“Watch a live forge: Lux3D designs the fighter, builds the mesh, rigs it, and retargets the moves, while you can spar with a practice partner. About five minutes, start to finish.”

---

## 4. On-screen titles (lower-thirds)

Keep these short and on screen long enough to read. They carry the 30% “use of tools” score if the VO is muted.

- Snap anything. Fight everything.
- Lux3D — photo → concept → mesh → auto-rig → retarget
- Asset / OUS — photo upload
- SpatialGen — Toy Shop / Rooftop Dojo / Kitchen Colosseum
- Aholo Viewer — 3DGS fight backdrop
- Reality — fight in a scanned room
- RenderCloud — KO poster
- Gallery — photo · concept · poster · 3D
- anything-fighter.vercel.app  ·  #Manycorehackathon

---

## 5. How to produce it (tools on this box)

Already installed, no extra purchase:

- **Google Chrome** (`/usr/bin/google-chrome`) and **Playwright** (`playwright-core` in `/workspace/report/build`) — same stack used for the report screenshots, including SwiftShader flags for WebGL (`--enable-unsafe-swiftshader --use-angle=swiftshader --ignore-gpu-blocklist`).
- **Playwright `recordVideo`** — `browser.newContext({ recordVideo: { dir, size: { width: 1920, height: 1080 } } })` writes a **WebM** per context. Drive each shot as its own context so clips are easy to trim.
- **ffmpeg 7.1** with **libx264**, **aac**, **libopus**, **libvpx-vp9**, **libmp3lame** — trim, scale, concat, burn subtitles, mux voiceover, export MP4.

Not installed today (optional later): a TTS engine (`edge-tts`, Piper, espeak). Prefer the **owner’s own voice** if they want to record a pass; otherwise we can install a TTS and generate a scratch read of the script. Subtitles should be burned in regardless (`ffmpeg` `subtitles=` / ASS).

**Proposed pipeline (when recording is approved, still no credits unless shot M is approved too):**

1. Write a Playwright tour script that opens the live URLs above, waits for canvases / fighters to appear, plays a short canned input sequence on `/fight` (J / K / U / I), scrolls the gallery, and resizes to a 412 px viewport for the mobile shot.  
   Safety: abort any non-GET to `/api/pipeline`, `/api/room`, and world-create endpoints, and never click `[data-action="forge"]` or the room-scan submit.
2. Record each shot to `/workspace/demo/clips/*.webm` at 1920×1080 (mobile: record 1080×1920, then fit into a 16:9 frame with the arcade background).
3. Transcode: `ffmpeg -i clip.webm -c:v libx264 -pix_fmt yuv420p -r 30 -c:a aac` to MP4.
4. Rough-cut and concat with an ffmpeg concat demuxer; add 0.3–0.5 s dissolves or hard cuts; overlay the lower-thirds and a 16:9 safe title card.
5. Record or generate the voiceover WAV, mix it under/over fight SFX (game audio may be missing or muted in headless Chrome — plan on VO + a light bed as the default).
6. Burn in English subtitles from the script.
7. Master: `/workspace/demo/Anything-Fighter-Demo.mp4`, 1920×1080, 30 fps, H.264 + AAC, high profile, `-movflags +faststart`, keep the file well under typical form limits (aim < 80 MB).

**Quality caveat:** fight scenes recorded on this box go through SwiftShader, not a discrete GPU. They are good enough for a clean demo, but if a shot looks soft we can recapture that one fight URL on a machine with a real GPU (the owner’s browser) and drop it into the same edit.

**Still B-roll already on disk** (use only if a live take fails): `/workspace/report/assets/` (gallery grid, fight stills, forge panel, room builder) and `/workspace/shots/`. Prefer moving video from the live site over stills.

---

## 6. Decisions for the owner (before we record)

1. Is the 2:25 no-credit cut (shots A–L) the one to make first?  
2. Approve **one** live forge for shot M? If yes, which object photo, and should photo sharing stay off?  
3. Voiceover: owner records, or a TTS scratch track plus burned-in subtitles?  
4. Any fighters besides the five starters to feature? (Recommendation: starters only, same as the report.)

Nothing has been recorded yet. No Aholo jobs were started for this plan.
