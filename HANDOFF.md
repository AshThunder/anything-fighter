# Anything Fighter — Agent Handoff

> **Read this first** if you are a coding agent (Cursor, Claude Code, or otherwise) picking up this repo with no prior context. This document is the recovery brief: product, hackathon constraints, architecture as it exists in code, Aholo API notes, env vars, known breakage, and what to build next.
>
> **Do not commit secrets.** Never put API key values, tokens, passwords, or vault entries in this file, in git, or in client-side code. Refer to environment variable *names* only.

**Live demo:** https://anything-fighter.vercel.app
**Source:** https://github.com/AshThunder/anything-fighter (public, branch `master`)

---

## 1. Project summary & pitch

**Anything Fighter** is a solo entry in the **Manycore Aholo Global 3D AI Hackathon**.

**Pitch:** Snap a photo of any object — a mug, a sneaker, a rubber duck, a person — and Aholo Lux3D turns it into a rigged, animated 3D fighter. Fighters brawl in AI-generated 3D arenas (Aholo SpatialGen) or in a scan of your own room (Aholo Reality), and each fighter gets a cinematic KO poster (Aholo RenderCloud).

One-liner used in the README: *Snap anything. Fight everything.*

**Owner / team**

| | |
|---|---|
| Legal name | Eromonsele Michael |
| GitHub | [AshThunder](https://github.com/AshThunder) |
| Discord | Chris Gold |
| Email (Aholo / LuxReal login) | chrisgoldog@gmail.com |
| Team | Gold Tek (solo, 1-person team) |
| Time zone | Africa/Lagos (WAT, UTC+1; no DST) |

**Owner working preferences (treat as hard constraints):**

- All coding happens **locally** on the owner's machine (or this project's checkout). **Do not use cloud coding agents.**
- **Do not connect GitHub through Cursor or any other third-party GitHub integration.** Use the `gh` CLI (and `git` remotes) only.
- The GitHub repo must stay **public**.
- Never submit the official hackathon form, post to X, or send mail/messages as the owner without an explicit "yes, submit/send this" from the owner. Drafts are fine.
- Gmail was previously declined ("Not now") — do not re-push connecting it.

---

## 2. Manycore-first stack (owner directive)

**Manycore tools and their recommended stack are the core of this project.** New work should deepen that usage, not replace it with a parallel stack. Fun and completeness still matter for judging, but tool use is the largest expert criterion (30%).

Official guidance lives in Aholo's `llms.txt` / OpenAPI (local copies at `/workspace/llms.txt` and `/workspace/openapi.json` on the recovery box; published at the docs URLs below). If docs conflict, the OpenAPI spec and the pages under `https://labs.aholo.ai/api-docs/en/` are authoritative. The GitHub README of the SDK repo is secondary.

### Use the official TypeScript SDKs (do not hand-write HTTP)

For Asset, World, and Lux3D, prefer the official SDKs over raw `fetch`:

| Package | Service |
|---|---|
| `@manycore/aholo-sdk-asset` | Uploads (OUS) |
| `@manycore/aholo-sdk-world` | SpatialGen generations + Reality reconstructions |
| `@manycore/aholo-sdk-lux3d` | multimodal-to-image, img-to-3d, humanoid rig, retarget, export, task polling |

- TypeScript SDK docs: https://labs.aholo.ai/api-docs/en/sdk/typescript
- SDK overview: https://labs.aholo.ai/api-docs/en/sdk
- Runnable examples: https://github.com/manycoretech/aholo-spatial-sdk (and `typescript/examples`)
- Auth is the same as REST: env var `AHOLO_API_KEY`, or `apiKey` in client config. Region `com` → `https://api.aholo.ai` (this project is international / `com`, not `cn`).
- Typical call chains (TS method names): `createAssetClient` → `uploadFile`; `world.generations.create` / `world.reconstructions.create` → `world.waitFor(worldId)`; `lux3d.imgTo3d.create({ img, version: "G1" })` → `lux3d.tasks.waitFor(taskId)`.
- World/Lux3D are always async: create, then poll (`waitFor` / `tasks.waitFor`). Do not assume a create call returns the finished asset.

**RenderCloud has no official SDK.** Call it through the OpenAPI (`POST /global/rendercloud/v1/jobs`, mesh ingest under `/global/rendercloud/v1/mesh-upload-process/task/*`). That is already how `lib/poster.ts` and `scripts/render-poster.mjs` work.

**3D Gaussian splat viewing:** use `@manycore/aholo-viewer` (already vendored to `public/vendor/aholo-viewer` because bundling it through Next/Turbopack breaks its Blob-URL workers). See `components/arena/AholoSplatLayer.tsx`.

**Lux3D agent skill (read before changing rig/mesh/retarget calls):** https://labs.aholo.ai/api-docs/en/skills/lux3d
Also: skills index https://labs.aholo.ai/api-docs/en/skills, authentication https://labs.aholo.ai/api-docs/en/authentication, interactive API https://labs.aholo.ai/api-docs/en/api-reference/, ClawHub mirror of the Lux3D skill https://clawhub.ai/violalulu/lux3d.

### Migration status (important)

A **migration from the hand-written HTTP client to the official SDKs is in progress.** As of the last handoff commit, `package.json` still does **not** depend on `@manycore/aholo-sdk-asset`, `-world`, or `-lux3d`. The live pipeline (`lib/aholo.ts`, `lib/world.ts`, `scripts/aholo-cli.mjs`) still talks to `https://api.aholo.ai` with raw `fetch` and an `Authorization` header set to the raw key.

When you touch Aholo integration:

1. Prefer finishing or extending the SDK migration rather than adding more hand-rolled HTTP helpers.
2. Leave RenderCloud on OpenAPI (no SDK exists).
3. Keep the API key server-only (`process.env.AHOLO_API_KEY`, never `NEXT_PUBLIC_*`).
4. Do not break the poll-driven job state machine or mock mode while swapping the transport.
5. The REST cheat-sheet in §6 is still accurate for the *current* code and for RenderCloud; treat the SDK docs as the target for Asset / World / Lux3D.

Manycore surface already in the product (keep these, and make them obvious in the UI and the project report):

| Tool | Role in the game |
|---|---|
| OUS / Asset upload | User photo, room-scan video, posed GLBs |
| Lux3D multimodal-to-image | Object photo → full-body fighter concept |
| Lux3D img-to-3D (G1-Turbo, PBR) | Concept → textured mesh |
| Lux3D humanoid auto-rig | Mixamo-named skeleton |
| Lux3D animation retarget | 10 fight-move clips |
| Lux3D multi-format export | Optional STL / 3MF / USDZ (off by default in the live forge) |
| SpatialGen | Text → 3DGS arenas + panoramas |
| Reality | Phone video / photos → splat of "your room" |
| Aholo Viewer | 3DGS backdrop under the fight canvas |
| RenderCloud | Path-traced KO / victory poster |
| LuxReal | Manual cinematic trailer / KO-replay pack (no public video API; see §10) |

---

## 3. Hackathon facts

Official site: https://www.aholo.ai/hackathon
Participation rules and submission rules were captured locally as `/workspace/rules0.md` and `/workspace/rules1.md` (fragmented scrapes — prefer the live site if they disagree).

### Deadlines (convert to the owner's zone)

| Event | Official time | Africa/Lagos (WAT, UTC+1) |
|---|---|---|
| Registration + **entry submission** + **team roster lock** | **19 Nov 2026, 6:00 a.m. EST (UTC−5)** | **19 Nov 2026, 12:00 noon WAT** |
| Review window | 20–30 Nov 2026 | same calendar days |
| Results | expected early December 2026 | |
| Popularity Award opt-in (optional) | 30 Nov 2026, 4:00 a.m. EST | 30 Nov 2026, 10:00 a.m. WAT |
| **Demo must stay up** | Through **31 Dec 2026** inclusive, *or* until 30 days after winners are announced and the public notice period ends, whichever is later | |

The time recorded by the Competition system is definitive.

### Hard requirements

- Entries **must actually use Aholo Lux3D**, and it must play a substantive role (this project already does).
- Submit **only** through the "Project submission" section of the official site. Discord posts, spreadsheets, and social posts are not an official submission.
- **No production credentials**, real user data, or secrets in the entry, the repo, links, or write-ups.
- Demo link, test account (if any), and core features must remain reachable for the period above.
- Do not fabricate demos or claim unimplemented features.

### Required submission materials

1. A **project report** in PDF or PPT.
2. A link to a **working demo** and/or a **demo video**. ModelScope Studio has been recommended as the hosted-demo option; the production Vercel app also counts as a working demo if it stays up.

Optional (bonus; not required for eligibility):

- **Source code link** — the public GitHub repo.
- **Social post** — an X post with the official hashtag `#Manycorehackathon` (also needed for the 5% "reach" expert score; entries with no social post score 0 on that criterion only). Popularity Awards on the international platform are also on X and need a registered post link with project name, one-sentence intro, actual demo footage, and official hashtags.

The form also asks for **ecosystem devices** (use "None" unless the owner adds hardware) and **1–3 application tracks**. **Gaming** is the best primary track for this entry.

### Judging

- Four stages: eligibility screening → Top 50 → Top 6 → public announcement.
- Final score: **70% expert judges / 30% community judges**.
- Expert criteria (the 70%):

  | Criterion | Weight |
  |---|---|
  | Use of Manycore Tech's tools | **30%** |
  | Fun and engagement | **25%** |
  | Innovation | **20%** |
  | Completeness | **20%** |
  | Social reach | **5%** |

- Application awards: expert-nominated. Creativity awards: community-nominated. Popularity Awards are separate and do not count toward Top 6 scores.
- Prize pool is published in the submission rules (Special / First / Second / Third / Application / Creativity / Popularity). The Special Award ("3D AI New Species") may go unawarded.

### Current Competition status (as of 13 Nov 2026, WAT)

- Team confirmed, idea submitted.
- **Final submission form is still empty (0/4).** Fill it as a **draft** when asked; **never submit without the owner's explicit OK**.
- LuxReal questionnaire was already submitted (13 Nov 2026) with email `chrisgoldog@gmail.com`, LuxReal ID `3FO4FONYS18J`, area of interest **Interactive Film Games (FMV)**, and "Have you used LuxReal before? **No**". A copy was emailed to the same address. Their post said credits take 1–2 days to appear.

### Credits

Hackathon grant was **3,600** credits. Balance was about **3,148** before testing on 13 Nov 2026. Live end-to-end forges and related tests that day were estimated at **~120–140 credits**. **Do not treat that as an exact remaining balance — check the Aholo dashboard** before running more live jobs.

Live forges are capped in the app to protect the budget (`FORGE_IP_DAILY_LIMIT` default 2 per IP per Lagos day, `FORGE_GLOBAL_DAILY_LIMIT` default 15). A full live forge is on the order of **~35–60 credits** (concept image ~12, img-to-3D ~1, auto-rig ~15, retarget ~3/clip × up to 10, plus a non-fatal RenderCloud poster). SpatialGen worlds are 10 credits each; Reality Flash reconstructions are 20. Scripted roster forges and e2e runs spend credits too — do not fire them casually.

---

## 4. Links

| What | URL |
|---|---|
| GitHub repo (public, `master`) | https://github.com/AshThunder/anything-fighter |
| Production demo (public) | https://anything-fighter.vercel.app |
| Vercel team | `michris-projects` |
| Vercel project | `anything-fighter` (`prj_eJ9Aq6asZoPGWIIF8lIujnTxAV5e`) |
| Hackathon site | https://www.aholo.ai/hackathon |
| Aholo API docs home | https://labs.aholo.ai/api-docs/en/ |
| Lux3D API reference (tag) | https://labs.aholo3d.com/api-docs/api-reference#tag/lux3d |
| Lux3D official skill | https://labs.aholo.ai/api-docs/en/skills/lux3d |
| Lux3D skill (ClawHub) | https://clawhub.ai/violalulu/lux3d |
| TS SDK docs | https://labs.aholo.ai/api-docs/en/sdk/typescript |
| SDK examples | https://github.com/manycoretech/aholo-spatial-sdk |
| Aggregate OpenAPI | https://labs.aholo.ai/api-docs/openapi.en.json |

**Deploy notes:** Preview deployments are **SSO-protected**. **Production is public** (deployment protection was turned off on prod so judges can open the demo). Do not turn protection back on for production before the demo-uptime window ends.

Local OpenAPI / `llms.txt` copies may exist at `/workspace/openapi.json` and `/workspace/llms.txt` on the recovery box; they are not in the git repo.

---

## 5. Stack & architecture (from the actual code)

### Tech stack

- **Next.js 16.4.6** App Router, TypeScript, Tailwind 4 (`@tailwindcss/turbopack` 4.3.3), Turbopack
- `cacheComponents: true` and `partialPrefetching: true` in `next.config.ts`
- **React 19.3.0**
- **React Three Fiber** `@react-three/fiber` 9.8.2, **drei** 10.7.9, **three** 0.187, `@react-three/postprocessing`, `three-stdlib`
- **Zustand** 5.1.0 (fight HUD / phase store in `lib/game/store.ts`)
- **`@manycore/aholo-viewer` 1.14.0** (3DGS; vendored — see below)
- **`sharp`** (poster JPEG, roster thumbs)
- **`@vercel/functions`** (Runtime Cache for job state and generated files on Vercel)
- **`@gltf-transform/*`** + `meshoptimizer` (shrink textures, strip retarget GLBs to skeleton + clip, weld/simplify)
- `server-only` on Aholo / store modules so the key cannot leak into the client bundle

There is **no database**. There is no paid Blob/Redis/Postgres store. Persistence is:

- Locally: `public/fighters/<id>/` and `public/arenas/<id>/`
- On Vercel: starter roster is baked into the deployment FS (read-only). New jobs and artefacts go to **`/tmp`** (same-instance only) **plus Vercel Runtime Cache** (per-region, ephemeral, 2 MB item limit — large GLBs are base64-chunked at 1.2 MB). Job TTL 6 hours; finished-fighter TTL 7 days. Cache entries can be evicted — generated fighters may disappear. This is a known limitation.

`npm run predev` / `prebuild` run `npm run vendor`, which copies `node_modules/@manycore/aholo-viewer/dist` → `public/vendor/aholo-viewer`. Import the viewer at runtime with a non-bundled `import()` or its workers break (`parseSplatData` / `n.onerror`).

### Routes (App Router)

| Path | Role |
|---|---|
| `/` (`app/page.tsx` → `components/landing/Landing.tsx`) | Landing: photo upload / camera (`capture=environment`), roster (click = P1, shift/right-click = CPU or P2), 1P/2P toggle, versus preview, arena picker, room scan |
| `/forge/[id]` | Live forge progress + "practice while you wait" sparring (`ForgeClient.tsx`) |
| `/fight` | 1v1 fight (`FightClient.tsx`). Query: `p1`, `p2`, `arena` (default `stage`), `view=splat\|pano`, `mode=cpu\|2p\|practice`, `debug=1` (exposes `window.__sim`) |
| `/gallery` | Every forged fighter (photo → concept → poster, turntable, Fight). `?all=1` includes hidden test forges |
| `POST /api/pipeline` | Start a forge (multipart: `photo`, `name`, optional `mascot`, `exportPrint`, `prompt`). `maxDuration = 300` |
| `GET /api/pipeline` | `{ mode: "live"\|"mock", labels }` |
| `GET /api/pipeline/[id]` | **Poll + advance the job by one step.** This is what actually moves the pipeline. |
| `POST /api/pipeline/[id]/retry` | Restart the failed stage (max 3). Costs that stage's credits again. |
| `POST /api/pipeline/[id]/rerig` | Re-rig a **finished freestyle** fighter from its existing mesh (once). Then poll `GET /api/pipeline/[id]`. |
| `GET /api/fighters` | Roster JSON. Hides `test-*` and `GALLERY_ONLY_IDS` unless `?all=1`. Falls back to the Boltbox placeholder if fewer than 2 real fighters exist. |
| `GET /api/arenas` | Arena catalogue + account world queue (status, progress, stuck flag). `maxDuration = 30` |
| `POST /api/arenas` | Start a SpatialGen job `{ name, prompt }`. HTTP 409 `WORLD_QUEUE_BUSY` if the account queue is not empty. |
| `GET /api/arenas/[id]` | Poll + advance a world/room job. |
| `POST /api/room` | Reality "fight in your room": multipart `files` = one `.mp4`/`.mov` or ≥20 photos, max 200 MB. `maxDuration = 120`. |
| `GET /api/assets/[...path]` | Serves generated files (and redirects finished unsaved world splats to a fresh signed Aholo URL). Blocks `job.json`, `*-log.json`, `*.orig.*`. |

Hobby Vercel plans may cap `maxDuration` at 60s even when the route asks for 300s. That is why retarget downloads **one clip per poll**.

### Key modules

| Path | What it does |
|---|---|
| `lib/aholo.ts` | Server-only Lux3D pipeline state machine, OUS upload, task helpers, mock mode, freestyle fallback, re-rig, job→fighter |
| `lib/store.ts` | Job + fighter file I/O (local FS vs `/tmp` + Runtime Cache) |
| `lib/forge-limit.ts` | Daily spend guard (Lagos calendar day; IPs hashed) |
| `lib/world.ts` | SpatialGen + Reality jobs, queue guard, signed result URLs |
| `lib/arenas.ts` / `lib/arenas-server.ts` | Arena types, builtins, shipped + app-created arena list, stuck detection |
| `lib/fighters.ts` | `FighterDef`, starter roster IDs, gallery-only IDs, placeholder |
| `lib/moves.ts` | Move set ↔ Lux3D preset IDs (max 10 per retarget task) |
| `lib/optimize.ts` | gltf-transform helpers |
| `lib/pose.ts` | Bake a static 1.8 m pose (also used to normalise meshes for re-rig) |
| `lib/poster.ts` / `lib/poster-usda.ts` | RenderCloud ingest + USDA scene + job poll |
| `lib/game/sim.ts` | Pure mutable fight sim (hitboxes, block, hitstun, knockback, hit-stop, slow-mo) |
| `lib/game/ai.ts`, `input.ts`, `audio.ts`, `recorder.ts`, `store.ts` | CPU, keyboard/touch, WebAudio SFX/music, KO card + clip recorder, Zustand store |
| `components/game/*` | `GameScene` (one R3F canvas, one `useFrame` loop), `Fighter`, `Effects`, `Hud`, `StudioEnv` |
| `components/arena/*` | Neon ring / panorama / splat arenas; Aholo Viewer layer (separate canvas under transparent R3F — they cannot share a WebGL context or depth buffer, so fighters always draw on top of the splat) |
| `components/landing/*` | Landing, arena picker, room scan, versus preview |
| `scripts/*` | CLI for roster forges, worlds, room scans, posters, Playwright screens / e2e, LuxReal pack |

### Forge pipeline (data flow)

Stages in code (`lib/aholo.ts` `STAGES`):

`upload` → `mascot` → `mesh` → `rig` → `retarget` → `poster` → `export` → `done`

1. **Landing** `POST /api/pipeline` with the photo. Spend guard runs first (live mode only). Job id is `gen-<base36 time>-<6 hex>`. Photo is stored; in live mode the first `advanceJob` also uploads it through OUS.
2. **Forge page** polls `GET /api/pipeline/<id>` every ~3.5s (live) / 0.9s (mock). **Each GET calls `advanceJob()`, which performs at most one transition.** There is no background worker. If the tab stops polling, the Aholo tasks may still run, but **this app will not start the next stage until a poll arrives.**
3. Polling in `ForgeClient.tsx` is a **self-rescheduling loop** with exponential backoff, a 75s request abort, and immediate resume on `visibilitychange` / `focus` / `online`. A single "Failed to fetch" must not kill the loop (that bug shipped, then was fixed in `6a13b4d`).
4. **mascot:** Lux3D `multimodal-to-image` with a "full-body humanoid fighting-game character / T-pose" prompt, so an object photo can be rigged. Can be skipped if `mascot=0`.
5. **mesh:** Lux3D `img-to-3d` with `version` from `AHOLO_MESH_VERSION` (default `G1-Turbo`), `faceCount` from `AHOLO_MESH_FACES` (default 60000), `enablePbr: true`, `outputFormat: ["glb"]`. **`aiPredictSize` is off; `customSize: 1800` (mm, i.e. 1.8 m).** If `customSize` is rejected with a non-5xx error, it retries without it but still without `aiPredictSize`.
6. **rig:** Lux3D `animations/rig/task/create`. On success, the ~22 MB Mixamo-named GLB is downloaded to `/tmp`, optimised (WebP textures) to `rigged.glb`, and persisted.
7. If the rig returns **`RIG_ELIGIBILITY_FAILED`:** one automatic **rescue re-rig** of a 1.8 m normalised copy of the same mesh (`rigRescue`). If that also fails, the job **finishes freestyle** (`rigless: true`): optimised unrigged mesh as `statue.glb`, no skeleton, no retarget credits. A posed mesh is still baked when possible so a poster can be rendered.
8. **retarget:** 10 presets, `animationOutputMode: "separate"`, `animateInPlace: true`. Result `content` is a **JSON string** of `actions[]` (not a raw GLB). Each raw clip is ~22 MB and repeats the mesh; we download **one clip per poll**, strip to skeleton + clip (~0.05–0.1 MB), and also bake a mid-jab `posed.glb` from the punch clip for RenderCloud.
9. **poster:** Upload posed GLB → RenderCloud mesh ingest → USDA scene (`lib/poster-usda.ts`) → offline render job → `poster.jpg`. **Non-fatal:** any failure or **>8 minutes** skips to export. Disable entirely with `POSTER_STAGE=off`.
10. **export:** Optional printable STL/3MF/USDZ (`exportPrint=1` on create). Default off in the UI.
11. **done:** Writes `fighter.json` and adds the id to the Runtime Cache index. The client then offers a fight.

**Rehosting:** Aholo result URLs **expire after ~2 hours**, so artefacts needed later are copied into the job store (or, for unsaved world splats, redirected through `/api/assets/arenas/...` to a freshly signed URL). Do not persist 22 MB `*.orig.glb` files in Runtime Cache — those stay in `/tmp`.

**Retry:** `POST .../retry` clears `error` and restarts the current stage (max 3). Transient errors (429, 5xx, network, timeouts) are retried automatically for up to 10 consecutive failures without setting `job.error`. Downloads use a 100s timeout and surface as transient. Advance locks expire after 150s so a hung function cannot wedge a job on a warm instance forever.

**Re-rig of a finished freestyle fighter:** `POST /api/pipeline/<id>/rerig` (`rerigFreestyle`). Allowed once. Attempt 1: 1.8 m normalised mesh. Attempt 2 (if refused): welded + simplified. If both fail, the fighter stays freestyle (no new mesh/poster credits). Then keep polling the usual GET.

### Rigged vs freestyle fighters

- **Rigged:** `files.rigged` + `animUrls` for the move set. `Fighter.tsx` plays clips, with a light procedural overlay.
- **Freestyle:** Lux3D refused the skeleton. `modelUrl` points at `statue.glb` (or the mesh). `Fighter.tsx` detects freestyle when there is no idle/punch/walk clip and drives the **whole mesh** with procedural motion (breathing, sway, lean, squash-and-stretch punches/kicks, hits, KO, victory) — improved in `15a8184`. Gameplay (hitboxes, damage) still comes from `lib/game/sim.ts`; only the presentation differs.
- The client also falls back to procedural motion whenever a *rigged* fighter is missing a given clip.

### Starter roster and generated fighters

Shipped (git-tracked) Lux3D roster, shown first: **mug** (Mug Shot), **sneaker** (Sole Survivor), **duck** (Quack Attack), **toaster** (Toast Master), **cactus** (Prickly Pete). Built offline with `scripts/forge-fighter.mjs`.

Placeholder only if fewer than two real fighters exist: **robot** / Boltbox (RobotExpressive by Tomás Laulhé, CC0).

User forges live under `gen-*`. Pipeline test ids `gen-mwekglv2-db32ab` and `gen-mwel0i8j-076867` are gallery-only (`GALLERY_ONLY_IDS` in `lib/fighters.ts`). `test-*` is also hidden from the roster unless `?all=1`.

**Mama** is a user-forged fighter on **production** (Runtime Cache / `/tmp`, not in this git tree). Lux3D refused her original rig (`RIG_ELIGIBILITY_FAILED`; likely size predicted ~30 cm when `aiPredictSize` was still on). She shipped as freestyle. A re-rig from her existing mesh (1.8 m) was in progress around this handoff — check production `POST /api/pipeline/<mama-id>/rerig` status and her `job.json` via the live forge URL or `/api/pipeline/<id>` before starting another paid attempt (`rerig` is one-shot per job).

### Arenas & world jobs

Built-in always-available arenas: **Neon Ring** (`stage`) and, as a 3DGS fallback when no generated splat is ready, the official Aholo Viewer **sample bear** `.sog`.

Shipped-but-not-finished SpatialGen / Reality dirs under `public/arenas/` (prompts + `world-id.txt`, **no baked splat/pano in the recovered tree**):

| Arena id | Name | Kind | World ids (oldest first) |
|---|---|---|---|
| `kitchen-colosseum` | Kitchen Colosseum | SpatialGen | `3FO4K4V8HG19`, `3FO4K4V8IL5L` (resubmit) |
| `toy-shop` | Toy Shop at Midnight | SpatialGen | `3FO4K4V8H9C7` |
| `rooftop-dojo` | Rooftop Dojo at Sunset | SpatialGen | `3FO4K4V8HCO8` |
| `my-room` | My Room (scan) | Reality | `3FO4K4V8HJDA`, `3FO4K4V8IOHM` (resubmit) |

`/api/arenas` lists live status. If any world id for a dir has `SUCCEEDED`, the arena becomes playable via a signed-URL redirect (no multi-MB rehost in serverless storage). Pending arenas are flagged; **RUNNING at 0% for >90 minutes** (`STUCK_MS`) is marked `stuck`. New SpatialGen / Reality creates are **refused while the account queue is non-empty** (`WORLD_QUEUE_BUSY`), unless `WORLD_QUEUE_GUARD=off`. Fights always have Neon Ring (and the sample splat if no other splat is ready).

The account can run **one world job at a time**. **There is no cancel endpoint.** A stuck RUNNING job blocks everything behind it.

### Fight engine

- `GameScene`: one R3F `<Canvas>`, one `useFrame` sim tick. React/Zustand state updates mainly on hits and phase changes.
- Modes: 1P vs CPU, 2-player one keyboard, practice (infinite time, CPU does not attack — used during forge).
- Controls (also in README): P1 move A/D (solo also arrows), punch J, kick K, block L/Shift/S. P2: arrows, K/Numpad 1 punch, L/Numpad 2 kick, down/Numpad 0 block. Touch pad on phones. Sound toggle on the HUD.
- After a fight: rematch, **KO card** (1600×900 PNG compositing the RenderCloud poster when present), and a **canvas recording** (MediaRecorder → MP4 where supported, else WebM). Nothing is posted automatically.
- Kick maps to Lux3D preset `Melee_Hook` — the 85 official presets include **no kick**.

### Mock mode

If `AHOLO_API_KEY` is unset, **every** pipeline (fighters, worlds, room scans) runs in mock mode: staged delays, no credits, clearly labelled in the UI. Mock fighters reuse the placeholder robot rig so the UX is demoable offline. The spend guard can also force mock with `FORGE_LIMIT_FALLBACK=mock` when a cap is hit (default is to HTTP 429 and tell the user to try the roster).

### Spend guard

`lib/forge-limit.ts`, applied in `POST /api/pipeline` for live jobs only. Counters live in Runtime Cache namespace `anything-fighter-limits`, or an in-memory `Map` (per instance, resets on cold start) when the cache API is missing. Limits use the **Africa/Lagos calendar day**.

---

## 6. Aholo API cheat-sheet

**Base:** `https://api.aholo.ai` (override with `AHOLO_API_BASE`). **Every gateway route is under `/global`.**

**Auth:** `Authorization` header = the **raw API key**. **No `Bearer` prefix.** Upload (OUS) is different: `GET /global/asset/v1/token` with the gateway key, then talk to the returned `globalDomain` with header `ous-token-v2`.

**Lux3D tasks** are async. Poll `GET /global/lux3d/v1/generate/task/get?taskid=`. Status: **0 init, 1 running, 3 success, 4 failed, 6 canceled**. Result URLs expire in **~2 hours**. `img-to-3d` versions are `G1` or `G1-Turbo`; `faceCount` 10_000–300_000; `outputFormat` zip/glb/ply. `customSize` is millimetres and takes priority over `aiPredictSize`.

Endpoints this repo uses (SDK equivalents in parentheses — prefer those once the migration lands):

| Action | REST |
|---|---|
| Upload token | `GET /global/asset/v1/token` |
| OUS single / block upload | `{globalDomain}/ous/api/v2/single/upload`, `.../block/upload/init`, `.../part`, `.../upload/status` (status 5 + url = success; 6/8 = fail) |
| Multimodal image | `POST /global/lux3d/v1/generate/multimodal-to-image/task/create` |
| Image → 3D | `POST /global/lux3d/v1/generate/img-to-3d/task/create` |
| Auto-rig | `POST /global/lux3d/v1/animations/rig/task/create` |
| Retarget | `POST /global/lux3d/v1/animations/retarget/task/create` |
| Print export | `POST /global/lux3d/v1/multi-format-export/task/create` |
| Poll Lux3D | `GET /global/lux3d/v1/generate/task/get?taskid=` |
| SpatialGen | `POST /global/world/v1/generations` |
| Reality recon | `POST /global/world/v1/reconstructions` (`taskQuality: "low"\|"normal"\|"high"`, `scene: "space"` for indoor) |
| World status | `GET /global/world/v1/{worldId}` |
| World list / queue | `POST /global/world/v1/list` |
| RenderCloud ingest | `POST /global/rendercloud/v1/mesh-upload-process/task/create`, `GET .../task/get` |
| RenderCloud job | `POST /global/rendercloud/v1/jobs` (create with `usdContent` base64; poll with `{ operationId }`) |

World in-progress statuses: `PENDING` \| `PREPROCESSING` \| `RUNNING`. Success: `SUCCEEDED`. Failure: `FAILED` \| `CANCELED` \| `TIMEOUT` \| `REJECTED`. `createTime` / `updateTime` are Unix **milliseconds**. **One world job at a time per account. No cancel API.**

Lux3D JSON envelopes look like `{ c, m, d }` with `c === "0"` for OK. World/asset calls may return the object directly. RenderCloud is documented as `{ success, data, errorMsg }` but the live gateway sometimes uses the Lux3D envelope — `lib/poster.ts` unwraps both.

### Known gotchas

- **`RIG_ELIGIBILITY_FAILED`:** Lux3D decided the mesh could not take a humanoid skeleton and often does not say why. The usual cause here was `aiPredictSize: true` sizing the character to the *object* (~30 cm sneaker / mug). Always request a **1.8 m** character (`customSize: 1800`, no `aiPredictSize`). If it still fails, the shape or pose may be the problem — normalise, optionally weld/simplify, retry once, then ship freestyle rather than dead-ending the forge.
- **Client polling must self-reschedule.** Do not key the next poll only on a React `job` state update. A dropped request or a backgrounded mobile tab used to freeze the forge on "Failed to fetch (retrying…)" even though Aholo was fine, because the next stage only starts when this app polls.
- **Vercel FS is read-only except `/tmp`.** Never write generated fighters into `public/` on Vercel and expect it to stick. Use `lib/store.ts`.
- Aholo Viewer **cannot be mounted inside an R3F canvas** (own WebGL engine, no three.js). Two stacked canvases; no shared depth buffer.
- Retarget `separate` clips are named `animation_N`, not the preset id — map via `actions[].animation_id` ↔ URL.
- Rig output is a Mixamo-named 52-joint skeleton (`mixamorig:Hips` …).
- OUS multipart: at most 2 concurrent parts per file; identical MD5 may be deduplicated (no parts to upload).

---

## 7. Environment variables

**Server-only. Never prefix with `NEXT_PUBLIC_`. Never commit a real value.** Template: `.env.example`. `.gitignore` ignores `.env*`.

| Name | Purpose | Default |
|---|---|---|
| `AHOLO_API_KEY` | Aholo gateway key. If unset/blank, the app is in **mock mode**. | (empty → mock) |
| `AHOLO_API_BASE` | Gateway origin | `https://api.aholo.ai` |
| `AHOLO_MESH_VERSION` | Lux3D img-to-3d version (`G1` or `G1-Turbo`) | `G1-Turbo` |
| `AHOLO_MESH_FACES` | `faceCount` (10k–300k) | `60000` |
| `FORGE_IP_DAILY_LIMIT` | Live forges per client IP per Lagos day | `2` |
| `FORGE_GLOBAL_DAILY_LIMIT` | Live forges across all IPs per Lagos day | `15` |
| `FORGE_LIMIT_FALLBACK` | When a cap is hit: `block` (HTTP 429, use the roster) or `mock` (continue, no credits) | `block` |
| `POSTER_STAGE` | Set to `off` to skip RenderCloud posters in the live pipeline | (on) |
| `WORLD_QUEUE_GUARD` | Set to `off` to allow new world jobs even when the account queue is busy (usually a bad idea) | (on) |
| `VERCEL` | Set automatically on Vercel; switches storage to `/tmp` + Runtime Cache | unset locally |

Script-only (not needed for `next dev`): `RESUBMIT=1` forces a new SpatialGen/Reality create in the CLI scripts (queues another unpaid-cancelable job — avoid while the queue is stuck); `REUPLOAD`, `MESH_TASK`, `FAST`, `SPLAT_ID`, `SPLAT_MATRIX`, `NO_BACKDROP`, `TAG` for `scripts/render-poster.mjs`; `ONLY`, `Q`, `NAME`, `PUNCHES`, `WAIT`, `VP1` for screenshot scripts; `TARGET_H` for `bake-pose.mts`; `CLOSED` for `make-backdrop.mts`.

On Vercel the key is set for all environments as a **sensitive** server env var. `vercel env pull` may write a **blank** value for sensitive vars — if `.env.local` has an empty `AHOLO_API_KEY`, you are silently in mock mode. Set the key in `.env.local` by hand (or from a secret store). On the original recovery box a key file may exist at `/home/box/.secrets/aholo_api_key`; do not print it, commit it, or copy it into the repo.

`.env.local` is gitignored. After `vercel link` it may also contain `VERCEL_OIDC_TOKEN` — also a secret, never commit.

---

## 8. Local dev & deploy

```bash
git clone https://github.com/AshThunder/anything-fighter.git
cd anything-fighter
npm install

# Link the Vercel project (scope michris-projects) if you need env / deploys:
vercel link --scope michris-projects --yes --project anything-fighter
vercel env pull .env.local
# If AHOLO_API_KEY is empty after the pull, set it manually in .env.local.
# Do not print the value.

npm run dev          # http://localhost:3000  (predev vendors the Aholo Viewer)
npm run build && npm start
npm run lint
```

Useful scripts (all spend credits if the key is set — be deliberate):

```bash
node --env-file=.env.local scripts/forge-fighter.mjs all          # starter roster, resumable, ~60 cr each
node --env-file=.env.local scripts/gen-worlds.mjs [arena-id]      # SpatialGen, 10 cr, one-at-a-time
node --env-file=.env.local scripts/reconstruct-room.mjs public/arenas/my-room/scan.mp4 my-room
node --env-file=.env.local scripts/render-poster.mjs mug
node scripts/e2e-forge.mjs photo.jpg "Name"                       # Playwright UI e2e (credits!)
npm run screens                                                   # Playwright shots; expects server on :3100
```

`luxreal/README.md` and `screens/` were listed in the original tree but **are not in the recovered source** (excluded by `.vercelignore` / `.gitignore` — see §9). `scripts/luxreal-pack.mjs` still documents how to build a manual LuxReal upload pack.

### Git & Vercel

- Default branch: **`master`**, remote `origin` = `https://github.com/AshThunder/anything-fighter.git`.
- Prefer small, reviewable commits. **Do not `git add -A`** if another agent may be editing in parallel — add only the files you intend.
- Push with `git push origin master` (or `gh`); do **not** install/use the Cursor GitHub connector.
- Production deploy, after a push (Vercel may already auto-deploy from GitHub) or explicitly:

  ```bash
  vercel deploy --prod --scope michris-projects
  ```

- No deploy is required for docs-only changes.

### Where this repo came from

The app originally lived only on Vercel. Source was recovered from a production deployment (`dpl_BG6VcHFtUP4CwFWF3UF4qsZDrYtT` and a follow-up "full source" commit) and published to GitHub. Anything listed in `.vercelignore` was **never on Vercel** and is therefore **missing** from this tree unless it was regenerated later.

---

## 9. Current status & known issues (13 Nov 2026, WAT)

**Working on production** (https://anything-fighter.vercel.app), with recent reliability work pushed to `master`:

- Live forge path is end-to-end: photo → concept → mesh → rig (or freestyle) → retarget → RenderCloud poster.
- Forge "Failed to fetch (retrying…)" at the concept step was a **client polling bug**, not an Aholo outage. Fixed (`6a13b4d`).
- Rig path requests 1.8 m characters and rescues / falls back to freestyle (`04babd7`, `15a8184`).
- Freestyle motion is no longer a stiff statue (`15a8184`).
- Arenas tolerate a stuck world queue (`6b929db`).
- Two test forges on prod completed; the duck is fully rigged. Exact remaining credit balance should be read from the dashboard.

**Stuck SpatialGen / Reality queue (Aholo-side, cannot be cleared from the API):**

| World id | Intended arena | Notes |
|---|---|---|
| **`3FO4K4V8HG19`** | Kitchen Colosseum | **Stuck RUNNING at 0%** since **13 Nov 2026, 00:45 WAT**. This is the head of the queue. |
| `3FO4K4V8HJDA` | My Room | Waiting behind it |
| `3FO4K4V8H9C7` | Toy Shop at Midnight | Waiting |
| `3FO4K4V8HCO8` | Rooftop Dojo at Sunset | Waiting |
| `3FO4K4V8IL5L` | Kitchen Colosseum (duplicate resubmit) | Waiting — ask support to cancel this too |
| `3FO4K4V8IOHM` | My Room (duplicate resubmit) | Waiting — ask support to cancel this too |

Only **Aholo support** can cancel or unstick these. Worth asking them to cancel `3FO4K4V8HG19` and the two duplicate resubmits. Until then: do **not** submit more world jobs (the app already refuses); fight on Neon Ring / sample splat; finished worlds will appear automatically if any of the waiting jobs eventually succeed. Appeals / support contact published in the rules: feedback@official.aholo3d.com (also the hackathon Discord).

**Mama** is on the live roster as a **freestyle** (unrigged) fighter. Re-rig from her existing 1.8 m-normalised mesh was started; confirm whether that job finished, failed back to freestyle, or is still in `rig` before calling `/rerig` again (one-shot). If Lux3D still refuses, keep the improved procedural moves rather than spending a full new forge unless the owner wants a new photo.

**Missing from the recovered source** (`.vercelignore` / `.gitignore` — never deployed, not in git):

```
screens/
perf/
logs/
refs/
luxreal/
public/fighters/**/*.orig.glb
public/fighters/gen-*
public/arenas/*/scan.mp4
```

Also gitignored and therefore not in the repo: `public/vendor/` (rebuilt by `npm run vendor`), `public/arenas/room-*`, `public/arenas/world-*`, some poster intermediates, `.env*`, `.vercel/`, `.next/`. Starter-roster GLBs *are* supposed to be tracked; confirm they are present after clone (`public/fighters/mug|sneaker|duck|toaster|cactus|robot`).

**Storage caveat:** user-forged fighters on Vercel live in ephemeral Runtime Cache. They can vanish. For a durable demo roster, bake finished fighters into `public/fighters/<id>/` and commit the *optimised* assets (not `*.orig.glb`), or accept that only the starter five are guaranteed.

**UI:** the landing/roster still reads more like a tool dashboard than a fighting game, and is weak on mobile. A redesign is the next product work (see §10). Fun is 25% of expert judging.

---

## 10. Roadmap / next steps

Do these in roughly this order unless the owner directs otherwise.

1. **Finish Mama's re-rig** (or confirm failure and leave the improved freestyle animation in place). Do not burn a second full forge without asking.
2. **Fighting-game UI redesign** (owner approved, after looking at game-UI skills). Mobile-first:
   - Character-select grid with idle previews and a glowing P1 / CPU cursor
   - VS splash before each round
   - Arena cards with real preview images
   - Hide unavailable / stuck arenas behind a "coming soon" (or similar) instead of a clutter of greyed-out queue rows
   - Punchier fight HUD: lifebars, hit FX, screen shake, typography, sound
   - Follow these skills (they live on the recovery box under `/workspace/game-ui-skills/` as well):
     - [SpellfAIre `game-ui-design`](https://github.com/clydefrog1/SpellfAIre/blob/main/.agents/skills/game-ui-design/SKILL.md) — HUD readability, motion, mobile scaling
     - [awesome-gamedev `game-ui-ux`](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/game-ui-ux/SKILL.md) — responsive layout, safe areas, menu flow
     - [IKEMEN Forge](https://github.com/nategarelik/ikemen-forge) — select screen, VS splash, lifebars / screenpack patterns
3. **Continue the official SDK migration** (§2) without breaking the poll machine or mock mode.
4. **Project report** (PDF or PPT) covering concept, development, asset iterations, and results — required for submission.
5. **Demo video** of the real app running (voiceover/subtitles OK).
6. **Fill the official submission form as a draft** (demo link, report, track = Gaming, devices = None, source repo, etc.). **Do not submit without the owner's explicit OK.**
7. **Draft an X post** with `#Manycorehackathon` for the owner to post. Do not post it yourself.
8. **LuxReal KO replays / trailer:** LuxReal has **no public video API**. An invitation / Lux3D-related key from Manycore is required for deeper integration. The survey is already in; credits may take 1–2 days. Meanwhile `scripts/luxreal-pack.mjs` can assemble posed GLBs + posters + panos for manual upload at the LuxReal web app when those files exist. LuxReal ID for this account: `3FO4FONYS18J`.
9. If support clears the world queue, bake finished Kitchen / Toy Shop / Rooftop / My Room splats (or rely on signed-URL redirects) so the demo has real arenas.

### Commit history (high level, `master`)

| SHA | Summary |
|---|---|
| `b04c3cc` | Recovered from Vercel deployment `dpl_BG6VcHFtUP4CwFWF3UF4qsZDrYtT` |
| `2989873` | Recover full source from Vercel deployment |
| `6a13b4d` | Forge polling no longer dies after one failed fetch; freestyle fallback; safer forge start; `photoUrl` |
| `6b929db` | Arenas resilient to a stuck world queue; signed-URL redirect for finished worlds |
| `d6c1a3c` | RenderCloud KO poster stage (non-fatal) for every forged fighter, including freestyle |
| `04babd7` | Rig at 1.8 m (`customSize`, no `aiPredictSize`); auto re-rig once on a normalised copy; hide a debug test forge |
| `6669da8` | Expiring advance locks; 100s download timeout as transient; re-collect clips before finish |
| `da3320b` | README reliability notes |
| `15a8184` | Freestyle motion (breathing, squash-and-stretch, etc.) + one-shot `POST /api/pipeline/<id>/rerig` |

Later commits may exist — run `git log` before you start.

---

## 11. Ground rules for the next agent

- Work in this repo; keep changes reviewable; do not rewrite working pipeline code without cause.
- Another agent may be editing at the same time: touch only the files your task needs; never `git add -A`.
- Spend Aholo credits sparingly; check the dashboard; respect the spend guard.
- Do not add production credentials to the client, the repo, or the submission packet.
- Do not submit the hackathon form, publish the X post, or send mail as the owner unless they clearly asked for that exact action.
- Prefer Manycore's recommended SDKs and tools (§2) for anything new in the 3D pipeline.
- When in doubt, re-read this file, `README.md`, and `lib/aholo.ts`.

Good luck. Snap anything. Fight everything.
