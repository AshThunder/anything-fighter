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
- Typical call chains (TS method names): `createAssetClient` → `uploadFile`; `world.generations.create` / `world.reconstructions.create` → `world.waitFor(worldId)`; `lux3d.imgTo3d.create({ img, version: "G1" })` → `lux3d.tasks.waitFor(taskId)`. (This app replaces `waitFor` with one `retrieve` per client poll.)
- World/Lux3D are always async: create, then poll (`waitFor` / `tasks.waitFor`). Do not assume a create call returns the finished asset.

**RenderCloud has no official SDK.** Call it through the OpenAPI (`POST /global/rendercloud/v1/jobs`, mesh ingest under `/global/rendercloud/v1/mesh-upload-process/task/*`). `lib/poster.ts` sends those requests through the `@manycore/aholo-sdk-core` gateway client.

**3D Gaussian splat viewing:** use `@manycore/aholo-viewer` (already vendored to `public/vendor/aholo-viewer` because bundling it through Next/Turbopack breaks its Blob-URL workers). See `components/arena/AholoSplatLayer.tsx`.

**Lux3D agent skill (read before changing rig/mesh/retarget calls):** https://labs.aholo.ai/api-docs/en/skills/lux3d
Also: skills index https://labs.aholo.ai/api-docs/en/skills, authentication https://labs.aholo.ai/api-docs/en/authentication, interactive API https://labs.aholo.ai/api-docs/en/api-reference/, ClawHub mirror of the Lux3D skill https://clawhub.ai/violalulu/lux3d.

### SDK migration: done (13 Nov 2026, commit `1c425bf`)

All Aholo calls in the deployed app go through the official packages, created once in **`lib/aholo-sdk.ts`** (server-only; key from `AHOLO_API_KEY`; `region: "com"`, `baseUrl` = `AHOLO_API_BASE` or `https://api.aholo.ai`; 45 s request timeout):

| Package | Used in | Calls |
|---|---|---|
| `@manycore/aholo-sdk-asset` | `uploadAsset()` (photo, room scan, posed/normalised GLBs) | `uploadBuffer` |
| `@manycore/aholo-sdk-lux3d` | `lib/aholo.ts` `lux3d.*` wrappers | `multimodalToImage.create`, `imageToFourView.create` (wired, unused), `imgTo3d.create`, `humanoidAutoRig.create`, `humanoidAnimationRetarget.create`, `multiFormatExport.create`, `tasks.retrieve` |
| `@manycore/aholo-sdk-world` | `lib/world.ts` | `generations.create`, `reconstructions.create`, `retrieve`, `list` |
| `@manycore/aholo-sdk-core` | `lib/poster.ts` (RenderCloud), error mapping | `createGatewayClient().gatewayRequest` (RenderCloud has no SDK; its OpenAPI routes go through the core transport), `AholoError` / `BusinessError` / `RateLimitError` |

Rules kept: key server-only; mock mode when no key; spend guard; **poll-driven state machine** (one `create` or one `tasks.retrieve` / `world.retrieve` per request; the SDKs' blocking `waitFor` helpers are deliberately not used inside serverless requests). `toAholoError()` maps SDK errors to the app's `AholoError` (429 / 5xx / network / timeouts are transient and retried on the next poll; `BusinessError` keeps its `c` code, e.g. `RIG_ELIGIBILITY_FAILED`). `img-to-3d` still sends `customSize: 1800` (not in the SDK's TS type; passed through in the JSON body). Verified live on prod with forge `gen-mwemw090-24ff0e` (see §9).

The one-off CLI scripts in `scripts/` (`aholo-cli.mjs`, `forge-fighter.mjs`, `gen-worlds.mjs`, `reconstruct-room.mjs`, `render-poster.mjs`) still use raw REST; they are not part of the deployed app. Migrate them to the SDKs if you touch them.

In-app visibility: a **"Powered by Aholo" strip** (`components/ui/PoweredBy.tsx`) lists the services that actually built each fighter (`FighterDef.services`, set by `jobServices()` in `lib/aholo.ts`, inferred by `fighterServices()` in `lib/fighters.ts` for older fighters). Shown on the forge panel (planned services), the live forge page (lights up per stage), the select screen and every gallery card.

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

Hackathon grant was **3,600** credits. Balance was about **3,148** before testing on 13 Nov 2026. Live end-to-end forges and related tests that day were estimated at **~120–140 credits** (morning), then **~40–45** for the Mama re-rig (rig 15 + 8-clip retarget + RenderCloud poster) and **~40–45** for the SDK verification forge (mesh 1 + rig 15 + 8-clip retarget + poster; concept step skipped). Rough total for 13 Nov: **~200–230**. **Do not treat that as an exact remaining balance — check the Aholo dashboard** before running more live jobs.

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
- **Official Manycore SDKs:** `@manycore/aholo-sdk-asset` 1.3, `-world` 1.4, `-lux3d` 1.9, `-core` 1.3 (see §2)
- **`@manycore/aholo-viewer` 1.14.0** (3DGS; vendored — see below)
- **`sharp`** (poster JPEG, roster thumbs)
- **`@vercel/functions`** (Runtime Cache for job state and generated files on Vercel)
- **`@vercel/blob`** (optional durable store for finished forged fighters, `lib/durable.ts`)
- **`@gltf-transform/*`** + `meshoptimizer` (shrink textures, strip retarget GLBs to skeleton + clip, weld/simplify)
- Fonts (local, `app/fonts`): Space Grotesk (display), Inter (body), **Bungee** (arcade headings, `font-arcade` / `.arcade-title`, OFL)
- `server-only` on Aholo / store modules so the key cannot leak into the client bundle

There is **no database**. Persistence is:

- Locally: `public/fighters/<id>/` and `public/arenas/<id>/`
- On Vercel: starter roster **plus baked user forges** (`public/fighters/gen-mwejr65q-c81d76` Mama, `gen-mwemw090-24ff0e` SDK Test, `gen-mwel0i8j-076867` Quack Test; un-ignored by name in `.gitignore` / `.vercelignore`) are in the deployment FS (read-only, durable). New jobs and artefacts go to **`/tmp`** (same-instance only) **plus Vercel Runtime Cache** (per-region, ephemeral, 2 MB item limit — large GLBs are base64-chunked at 1.2 MB). Job TTL 6 hours; finished-fighter TTL 7 days. Cache entries **do** get evicted (on 13 Nov ~12:00 WAT Mama's `rigged.glb`, two statues and several clips were already gone while their `fighter.json` was still listed).
- **Durable tier (`lib/durable.ts`, added 13 Nov 2026):** when a Vercel Blob store is connected (`BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` + OIDC; `BLOB_ACCESS` default `private`), `finish()` saves every finished **live** fighter as ONE pack `fighters/<id>.afp` (optimised files + `fighter.json` + final `job.json`; never `*.orig.glb`; the mesh only for freestyle fighters, for the re-rig) and adds the id to `fighters/index.json`: 2 Blob advanced ops per forge (Hobby includes 2,000/month). Reads: `/tmp` → shipped FS → Runtime Cache → Blob pack (unpacked into `/tmp` once per instance). `listGeneratedFighters` backfills one not-yet-durable finished fighter per request (`waitUntil`). Without Blob credentials it is a no-op. **The Blob store is not connected yet** (see §9). Offline test: `npm run test:durable` (mocked Blob API, no network).
- `listGeneratedFighters` skips any fighter whose model file is gone (`fighterFileProbe`: fs stat / cache meta + last chunk / durable index), and the fight scene wraps every fighter in `components/game/SafeModel.tsx` (failing clip → same model with procedural moves; failing model → Boltbox stand-in), so a vanished asset never blanks the canvas.

`npm run predev` / `prebuild` run `npm run vendor`, which copies `node_modules/@manycore/aholo-viewer/dist` → `public/vendor/aholo-viewer`. Import the viewer at runtime with a non-bundled `import()` or its workers break (`parseSplatData` / `n.onerror`).

### Routes (App Router)

| Path | Role |
|---|---|
| `/` (`app/page.tsx` → `components/landing/Landing.tsx`) | Mobile-first arcade home (see "UI structure" below): forge panel, character select, stage select, sticky 1P/2P + FIGHT bar |
| `/forge/[id]` | Live forge progress + "practice while you wait" sparring (`ForgeClient.tsx`) |
| `/fight` | 1v1 fight (`FightClient.tsx`). Phases: `loading → vs` (VS splash, skipped in practice) `→ intro → fight → ko → victory`. Query: `p1`, `p2`, `arena` (default `stage`), `view=splat\|pano`, `mode=cpu\|2p\|practice`, `debug=1` (exposes `window.__sim`) |
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
| `lib/aholo-sdk.ts` | **The only Aholo transport**: SDK client factory, `call()` / `toAholoError()`, `uploadAsset`, `isMockMode` |
| `lib/aholo.ts` | Server-only Lux3D pipeline state machine (via `lib/aholo-sdk.ts`), mock mode, freestyle fallback, re-rig, `jobServices`, job→fighter |
| `lib/store.ts` | Job + fighter file I/O (local FS vs `/tmp` + Runtime Cache) |
| `lib/forge-limit.ts` | Daily spend guard (Lagos calendar day; IPs hashed) |
| `lib/world.ts` | SpatialGen + Reality jobs via aholo-sdk-world, queue guard, signed result URLs, `isWorldStuck` (RUNNING at 0% for 90 min measured from when we first saw it RUNNING, stored in Runtime Cache `worldrun:<id>`) |
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
| `components/landing/*` | `Landing` (+ `ForgePanel`, `CREDIT_LINE`), `SelectScreen`, `ArenaPicker`, `RoomScan`, `VersusPreview` (camera auto-fits phone aspect) |
| `components/ui/PoweredBy.tsx` | "Powered by Aholo" service chips |
| `scripts/*` | CLI for roster forges, worlds, room scans, posters, Playwright screens / e2e, LuxReal pack |

### UI structure (redesign, commits `f3771aa`, `f3033ea`)

Followed `/workspace/game-ui-skills/` (SpellfAIre game-ui-design, awesome-gamedev game-ui-ux, IKEMEN Forge screenpack select/VS/lifebar patterns). Mobile-first, tested at 390×844 and 1440×900.

- **Home** (`Landing.tsx`): sticky header (arcade logo, Gallery), hero, **ForgePanel** (big photo tile, Snap / Upload, name, one big FORGE button, STL/3MF checkbox, live/mock dot, Powered-by strip), **SelectScreen**, **Stage select**, credit footer (`CREDIT_LINE` = "Built with Aholo Lux3D · SpatialGen · Viewer · Reality · RenderCloud · #Manycorehackathon"), and a fixed **fight bar** (1P vs CPU / 2 players + FIGHT!, safe-area padded).
- **SelectScreen**: two explicit **YOU/CPU** slots (or **P1/P2** in 2P mode) at the top — thumbnail + name, tap a slot to choose who you're picking for, active slot highlighted with a 3 px colour edge. Plain instruction ("Pick your fighter" / "Pick your opponent"). **Random** button. Portrait grid with large colour-matched YOU/CPU (or P1/P2) badges. Missing thumbs fall back to concept → poster → photo, then a silhouette (never initials). 3D versus preview kept (slightly shorter on phones). Shift-click / right-click still assigns the opponent; arrows + Enter still work. `pick` / `side` state in `Landing.tsx` is unchanged.
- **ArenaPicker**: swipeable (mobile) / grid (desktop) cards with **real previews**: `cover` comes from the SpatialGen/Reality panorama automatically for finished worlds; built-ins use in-game screenshots `public/arenas/thumbs/{stage,sample-bear}.jpg`. The **Aholo Reality "Fight in your room" builder is always visible** under the stage cards (not buried under Coming soon). Queued worlds sit behind an **"In Aholo's queue"** toggle. The room file picker has a separate Upload (no `capture`, so Android can pick a video from the gallery) and Record button. Home auto-selects the first finished SpatialGen/Reality arena.
- **Fight HUD** (`components/game/Hud.tsx`): **VS splash** (`phase === "vs"`, 2.4 s, tap to skip; RenderCloud posters or concepts slam in; whoosh + new `vs` SFX), screenpack-style **lifebars** (portrait, slanted bar, white/red lagging damage layers, low-HP pulse, P1/CPU tag), boxed **round timer** (red pulse at 10 s or less), Round 1 / 3-2-1 / FIGHT!, hit/combo callouts, **screen shake** on heavy hits (Web Animations on `[data-game-root]` + `navigator.vibrate`), **K.O. / TIME! stamp** banner, victory panel with PERFECT, rematch/roster, KO card / clip / caption, bigger touch buttons. Hit sparks + camera shake (`Effects.tsx`) and WebAudio SFX were already there.
- Forge page and gallery use the arcade logo/heading; gallery cards show the Powered-by strip.
- **Flat pass (13 Nov 2026, ~17:00 WAT):** everything above now uses the flat token system in `app/globals.css` (no gradients; owner rule). See §9 "Flat UI/UX pass, no gradients" for the palette and per-screen changes.

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

**Mama** (`gen-mwejr65q-c81d76`) is a user-forged fighter on **production** (Runtime Cache / `/tmp`, not in this git tree). Lux3D refused her original rig (`RIG_ELIGIBILITY_FAILED`; her mesh was 0.27 × 0.30 × 0.07 m because `aiPredictSize` sized her like a figurine). **Re-rig succeeded on 13 Nov 2026 (rig started ~07:52 WAT) on attempt 1** (1.8 m normalised copy of her existing mesh, no new mesh/concept): `rigged.glb` + 8 clips (idle, walk, punch, kick, block, hit, ko, victory) + a new posed RenderCloud poster; done ~08:03 WAT. Her one-shot `rerig` is used up (`rerig.attempt = 1`). **By ~12:00 WAT the Runtime Cache had evicted her `rigged.glb` (and `mesh.glb`, `anim-ko.glb`)**, so the rigged Mama is lost; only her earlier freestyle `statue.glb` survived. She is now **baked into git as a freestyle fighter** (`public/fighters/gen-mwejr65q-c81d76/`: `statue.glb`, photo, poster, thumb; procedural moves). Getting the rigged Mama back needs a new forge from her concept image (~40 credits, owner decision).

### Arenas & world jobs

Built-in always-available arenas: **Neon Ring** (`stage`) and the official Aholo Viewer **sample bear** `.sog` (always listed after the finished worlds since 13 Nov 2026; it used to drop out once a generated world was playable, a side effect of `31af7df`). `/api/arenas` falls back to these two built-ins if listing the worlds throws.

SpatialGen / Reality dirs under `public/arenas/` (prompts + `world-id.txt`; no baked splat/pano in git; finished worlds are served via signed-URL redirects):

| Arena id | Name | Kind | World ids (oldest first) |
|---|---|---|---|
| `kitchen-colosseum` | Kitchen Colosseum | SpatialGen | `3FO4K4V8HG19`, `3FO4K4V8IL5L` (resubmit) |
| `toy-shop` | Toy Shop at Midnight | SpatialGen | `3FO4K4V8H9C7` |
| `rooftop-dojo` | Rooftop Dojo at Sunset | SpatialGen | `3FO4K4V8HCO8` |
| `my-room` | My Room (scan) | Reality | `3FO4K4V8HJDA`, `3FO4K4V8IOHM` (resubmit) |

`/api/arenas` lists live status. If any world id for a dir has `SUCCEEDED`, the arena becomes playable via a signed-URL redirect (no multi-MB rehost in serverless storage). Pending arenas are flagged; **RUNNING at 0% for >90 minutes since first seen RUNNING** (`STUCK_MS`, `isWorldStuck`) is marked `stuck` (Aholo's `updateTime` is the submission time, so the old check flagged jobs as stuck the moment they started). New SpatialGen / Reality creates are **refused while the account queue is non-empty** (`WORLD_QUEUE_BUSY`), unless `WORLD_QUEUE_GUARD=off`. Fights always have Neon Ring (and the sample splat if no other splat is ready).

The account can run **one world job at a time**. **There is no cancel endpoint.** A stuck RUNNING job blocks everything behind it.

**Aholo Viewer + same-origin URLs:** the viewer parses splats in a worker, which cannot resolve relative URLs. `AholoSplatLayer` passes `new URL(url, location.href)` (fixed in `31af7df`; before that every `/api/assets/arenas/...` splat failed with "Failed to parse URL"). `/api/assets/arenas/<id>/world.spz` and `pano.jpg` 302 to a freshly signed `holo-cos.aholo3d.cn` URL (CORS OK).

**Known visual issue:** Kitchen Colosseum's splat placement is not tuned (`origin`/`scale`/`yaw` defaults), so the camera sits close to the splat surface and the backdrop looks blurry. Tune per-arena placement in `lib/arenas-server.ts` (or default that arena to `view=pano`).

### Fight engine

- `GameScene`: one R3F `<Canvas>`, one `useFrame` sim tick. React/Zustand state updates mainly on hits and phase changes.
- Modes: 1P vs CPU, 2-player one keyboard, practice (infinite time, CPU does not attack — used during forge).
- Controls (also in README "Play"): solo A/D or ←/→ move · W/↑/Space jump · S/↓ crouch · J punch · K kick · L/Shift/C block · U special (or back→forward+J) · I super. 2P: P1 A/D, W, S, F punch, G kick, H block, R special, T super; P2 ←/→, ↑, ↓, K/Numpad1, L/Numpad2, M/Numpad0 block, O/Numpad3, P/Numpad6. Touch pad: ▲ Jump, ▼ Crouch (hold), ◀ ▶, Punch, Kick, Block, Special, Super (meter ring). Sound toggle on the HUD.
- Move set and rules: see "Gameplay package" in section 9. `npm run test:sim` checks every rule offline.
- After a fight: rematch, **KO card** (1600×900 PNG compositing the RenderCloud poster when present), and a **canvas recording** (MediaRecorder → MP4 where supported, else WebM). Nothing is posted automatically.
- Kick maps to Lux3D preset `Melee_Hook` — the 85 official presets include **no kick**.

### Mock mode

If `AHOLO_API_KEY` is unset, **every** pipeline (fighters, worlds, room scans) runs in mock mode: staged delays, no credits, clearly labelled in the UI. Mock fighters reuse the placeholder robot rig so the UX is demoable offline. When a spend-guard cap is hit the forge continues in mock mode by default (`FORGE_LIMIT_FALLBACK` unset or `mock`; `block` = old HTTP 429). Such jobs carry `mockReason: "limit"`: the forge page shows a "demo forge, no credits, stand-in robot body, live forging resets at midnight Lagos time" note, the fighter's tagline says so, and on a live deployment mock fighters are hidden from the public roster and gallery (`/fight` and the forge page still find them via `/api/fighters?all=1`).

### Spend guard

`lib/forge-limit.ts`, applied in `POST /api/pipeline` for live jobs only. Default fallback is **mock** (changed 13 Nov 2026 so judges never dead-end). Counters live in Runtime Cache namespace `anything-fighter-limits`, or an in-memory `Map` (per instance, resets on cold start) when the cache API is missing. Limits use the **Africa/Lagos calendar day**.

---

## 6. Aholo API cheat-sheet

**Base:** `https://api.aholo.ai` (override with `AHOLO_API_BASE`). **Every gateway route is under `/global`.**

**Auth:** `Authorization` header = the **raw API key**. **No `Bearer` prefix.** Upload (OUS) is different: `GET /global/asset/v1/token` with the gateway key, then talk to the returned `globalDomain` with header `ous-token-v2`.

**Lux3D tasks** are async. Poll `GET /global/lux3d/v1/generate/task/get?taskid=`. Status: **0 init, 1 running, 3 success, 4 failed, 6 canceled**. Result URLs expire in **~2 hours**. `img-to-3d` versions are `G1` or `G1-Turbo`; `faceCount` 10_000–300_000; `outputFormat` zip/glb/ply. `customSize` is millimetres and takes priority over `aiPredictSize`.

REST routes behind the SDK calls (useful for error codes and for the scripts, which still use raw REST). The app itself calls these only through the SDKs (§2):

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
- The SDKs throw `BusinessError` for `{c != "0"}` envelopes and plain `Error` for request timeouts; always go through `call()` so the transient/retry logic sees a status.
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
| `FORGE_LIMIT_FALLBACK` | When a cap is hit: `mock` (continue as a labelled demo forge, no credits) or `block` (HTTP 429, use the roster) | `mock` (code default since 13 Nov 2026; unset on Vercel) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store for durable forged fighters (`lib/durable.ts`). Created automatically when a Blob store is connected to the project. **Secret.** Unset → Runtime Cache only | **set** (13 Nov 2026 ~14:33 WAT: store `anything-fighter-blob`, `store_Hp1jQpIueA07pOwV`, private, iad1; all environments) |
| `BLOB_ACCESS` | `private` or `public`; must match the store | `private` |
| `GALLERY_SECRET` | Server-only HMAC key for uploader delete links and the `/moderation` queue. Unset → no delete tokens issued, `/moderation` returns 503. **Never** prefix with `NEXT_PUBLIC_`. | (unset; owner must add in Vercel before production photo-sharing) |
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
- Production deploy: pushing `master` does **not** deploy (no Git integration on the project). Two ways that work:
  - **Vercel MCP connector, no CLI login (used 13 Nov 2026, 13:15 WAT):** `create_deployment` with `teamId team_NyHis4XaubowPGijevC9O9oQ`, `skipAutoDetectionConfirmation: "1"`, `requestBody: { name: "anything-fighter", project: "anything-fighter", target: "production", gitSource: { type: "github", org: "AshThunder", repo: "anything-fighter", ref: "master", sha: "<commit>" } }`. Vercel clones the public repo at that commit and builds with the project settings/env; `prebuild` regenerates the gitignored `public/vendor/aholo-viewer`. Only **committed** files ship (gitignored fighters/arenas are not deployed). Watch with `get_deployment` / `list_deployment_events` (`builds: 1`).
  - CLI from a checkout (needs `vercel login` or a `VERCEL_TOKEN`; the box CLI is logged out): `vercel deploy --prod --scope michris-projects`.

- No deploy is required for docs-only changes.

### Where this repo came from

The app originally lived only on Vercel. Source was recovered from a production deployment (`dpl_BG6VcHFtUP4CwFWF3UF4qsZDrYtT` and a follow-up "full source" commit) and published to GitHub. Anything listed in `.vercelignore` was **never on Vercel** and is therefore **missing** from this tree unless it was regenerated later.

---

## 9. Current status & known issues (13 Nov 2026, ~08:25 WAT)

**Production:** https://anything-fighter.vercel.app → deployment **`dpl_2gsDTpoAx3Jzsv2uvTsKvNeVtUen`** (commit `5e7abd9`: flat UI/UX pass, no gradients; deployed 13 Nov 2026 ~17:01 WAT via the Vercel MCP connector, Git source). Rollback target if needed: `dpl_4mu7EzAvB7RHyR89NdWSmaNGkrS3` (commit `3813922`: gameplay package, jump/crouch, CPU difficulty, generated opponents, freestyle arms; ~16:30 WAT). Before that: `dpl_ACftxh6e8xzkcUiKucitMYsezEST` (commit `0ef461f`: durable Blob storage live, photo privacy, cache headers; ~14:36 WAT). Before that: `dpl_5fesGPGHSXz11jN5JmFbVbJ4kPw1` (`76b8853`, reliability + Android fix, ~13:16 WAT); `dpl_292pigZcsTVWyhW8THvRx3pSLT8v` (commit `90acc20`: Android black-arena fix, never-black splat fallbacks, portrait 3/4 camera); `dpl_6qmMATG1V36wf8K8JSLBJw1a1RYW` (`45c0017`: mobile fight-screen fixes + splat auto-fit); `dpl_5zUXe85v37fNY2g3rg1yGvY4tVo3` (`31af7df`: UI redesign + viewer fix). Earlier today: `dpl_FsPMx6FaR71B4q1Veyu8vBxPzvpm` (SDK migration, `1c425bf`), `dpl_EeLbHb9dMiKqMegQNLRU3NW3Xssg` (freestyle animation + rerig, `15a8184`).

- Live forge path is end-to-end on the **official SDKs**: verified with forge **`gen-mwemw090-24ff0e` ("SDK Test")**, started 08:07 WAT with `mascot=0` (a humanoid concept image as input): aholo-sdk-asset upload, img-to-3d, auto-rig, 8-clip retarget, RenderCloud poster, done 08:20 WAT, fully rigged, `services = [asset, mesh, rig, retarget, poster]`. It is in `GALLERY_ONLY_IDS` (hidden from the roster).
- World reads (`list`, `retrieve`) on aholo-sdk-world verified live via `/api/arenas`.
- Forge "Failed to fetch (retrying…)" was a client polling bug (fixed `6a13b4d`).
- Rig path requests 1.8 m characters, rescues, or falls back to freestyle (`04babd7`, `15a8184`); freestyle fighters are animated procedurally (`15a8184`).
- **Mama is now fully rigged** (see §5).
- Not yet tested live through the SDK: `multiFormatExport` (STL/3MF checkbox) and `generations.create` / `reconstructions.create` (the queue guard refuses new world jobs while the queue is busy).

**World queue (Aholo-side; no cancel API):**

| World id | Arena | State at ~08:23 WAT |
|---|---|---|
| `3FO4K4V8HG19` | Kitchen Colosseum | **SUCCEEDED** (Aholo email 08:09 WAT). Playable on prod; the splat loads in the Aholo Viewer after the `31af7df` fix (signed SPZ ~5.5 MB, HTTP 200); the pano is its stage-select cover. Placement needs tuning (see §5). |
| `3FO4K4V8HJDA` | My Room (Reality scan) | **SUCCEEDED** (~08:20 WAT). Listed as playable on prod; not yet checked in a fight. |
| `3FO4K4V8H9C7` | Toy Shop at Midnight | RUNNING, 0% (just started) |
| `3FO4K4V8HCO8` | Rooftop Dojo at Sunset | PENDING |
| `3FO4K4V8IL5L` | Kitchen Colosseum duplicate resubmit | PENDING. Will burn queue time and ~10 credits for a world we already have; only Aholo support can cancel it |
| `3FO4K4V8IOHM` | My Room duplicate resubmit | PENDING. Same (~20 credits) |

The app still refuses new world jobs while the queue is non-empty (`WORLD_QUEUE_BUSY`). Support contact: feedback@official.aholo3d.com (or the hackathon Discord). Finished worlds show up automatically as playable stage cards.

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

**Storage caveat:** until a Blob store is connected, user-forged fighters on Vercel live in ephemeral Runtime Cache and do vanish (see "Reliability for judging" below). Mama, SDK Test and Quack Test are now baked into `public/fighters/<id>/` (optimised assets only). To bake another one: download its files from `/api/assets/<id>/…`, copy only optimised files (never `*.orig.glb`), write `fighter.json`, and add a `!public/fighters/<id>/` line to both `.gitignore` and `.vercelignore`.

**UI:** redesigned (see §5 "UI structure"), then flattened on 13 Nov ~17:00 WAT (see "Flat UI/UX pass, no gradients" below; **no gradients anywhere** is an owner rule). Remaining polish ideas: tune Kitchen Colosseum / My Room splat placement, gamepad support, best-of-3 rounds with win icons.

---

### Mobile fight-screen fixes: DONE (13 Nov 2026, ~09:20 WAT)
Commits `54d363f` + `45c0017`. Prod deployment **`dpl_6qmMATG1V36wf8K8JSLBJw1a1RYW`** (first deploy of `54d363f`: `dpl_9VrNi58cfqBCFHmA3bMP7yLCHjLf`). No Aholo credits spent, no world jobs started.
1. **Splat load on mobile.** CORS on `holo-cos.aholo3d.cn` is fine (`Access-Control-Allow-Origin: *`); the likely culprit was the extra 302 hop or a dropped fetch on the phone network (couldn't reproduce on a real Android). `/api/arenas` now returns `splatUrls` = [direct Aholo CDN URL, same-origin streaming proxy `/api/assets/arenas/<id>/world.spz?proxy=1`, verified 200 / 2.6 MB in 3.2 s]. `AholoSplatLayer` takes `urls`, tries each twice with backoff, always passes absolute URLs, shows only a pulsing "Loading arena…", and on total failure (or if the viewer can't start) calls `onFail` → `splatFailed()` in `GameScene.tsx` swaps the arena to the world's panorama, else Neon Ring. Raw error text is gone (console only). Verified with a bad URL: falls back to Neon Ring and the fight continues.
2. **Splat framing.** New `lib/splat-fit.ts` (pure, ~5 ms per world): decodes SPZ positions + opacity; SpatialGen worlds are anchored on the panorama eye at the splat origin (15-unit radius, floor = densest 5 cm band just below the eye; ignores the sky dome and the street under Rooftop Dojo); Reality scans use the lowest dense band. Footprint = largest floor rectangle (handles L-shaped rooms), camera looks down its long axis toward the denser end wall, scale = clamp(max(17/L, 8.5/W), 0.8, 4), fighters 3 m in front of the far wall; output `origin/scale/yaw/half`. `lib/splat-placement.ts` serves hand-checked overrides from `SPLAT_PLACEMENT` in `lib/arenas.ts` (Kitchen Colosseum, My Room, Toy Shop, Rooftop Dojo), else auto-fits new worlds server-side (8 s budget, continues via `waitUntil`, Runtime Cache key `splatfit:v2:<worldId>`). `sim.half` clamps fighters to the walkable width. Debug tuning hook: `/fight?debug=1&splat=<url>&place=ox,oy,oz,scale,yaw,half`.
3. **Fight camera.** `CameraRig` (`components/game/Effects.tsx`): vertical FOV 50/45/40 by aspect, distance from the horizontal FOV and fighter separation (+1.15 m margin each side), zooms out fast and in slowly, publishes `fov` to the splat layer.
4. **Hit flash.** `Fighter.tsx`: brief red tint (albedo multiply + small red emissive at the original intensity), exact restore of base color/emissive. The old flash pushed `emissiveIntensity` to 3 with bloom → white ghost.
5. **Touch controls.** `Hud.tsx` TouchPad: 56 px d-pad left, diamond right (Kick top, Block left, 72 px Punch), safe-area padding; fits 360–390 px.
Screenshots (box): before `/workspace/shots/before/{kitchen-colosseum,my-room}-390.png`; after `/workspace/shots/after/{kitchen-colosseum,my-room,toy-shop,rooftop-dojo}-390.png`, `/workspace/shots/after/{kitchen-colosseum,rooftop-dojo}-1440.png`; tuning shots in `/workspace/shots/fit/`.
World queue at ~09:15 WAT: Kitchen Colosseum, My Room, **Toy Shop and Rooftop Dojo all SUCCEEDED** and are playable; `3FO4K4V8IL5L` (Kitchen duplicate) no longer in the queue; `3FO4K4V8IOHM` (My Room duplicate) RUNNING 0%.

### Android black arena + small fighters: DONE (13 Nov 2026, ~09:25 WAT)
Commit `90acc20`. Prod deployment **`dpl_292pigZcsTVWyhW8THvRx3pSLT8v`**. No Aholo credits spent, no world jobs started.
Report: owner's Android (Chrome, ~412 px), prod `dpl_6qmMATG1V36wf8K8JSLBJw1a1RYW`, 08:59 WAT: solid black arena, no loading text, small fighters.
**Root cause (confirmed in code + reproduced on prod; the device-side trigger is a hypothesis):** the panorama arena **never rendered**. In `components/arena/Arena.tsx`, `<primitive attach="background" object={tex}/>` (and Neon Ring's `<color attach="background">` / `<fog>`) sat inside a `<group>`, so R3F attached them to `group.background` (a no-op), not `scene.background`. `/fight?arena=kitchen-colosseum&view=pano` on the old prod reproduces the owner's screenshot exactly (black, small fighters, no "Loading arena…"), at mobile and desktop sizes. So when the splat failed on the phone, `splatFailed()` swapped to the "pano fallback" → black. Why the splat failed on that phone is **not confirmed** (no real device here; SwiftShader emulation loads all four worlds fine). Most likely: WebGL context loss. The old viewer canvas rendered at full DPR (1081×2401 on a 412×915 DPR-2.6 phone) alongside an R3F canvas at DPR 2 with MSAA, and the viewer handles a lost context internally ("EGS: Context Lost, try restoring") without throwing. Old code also had no timeouts, so a hung parse would have spun forever.
**Fixes:**
1. `Arena.tsx`: `useSceneLook()` sets `scene.background` / `fog` / `environment` on the scene and restores them on unmount (a splat arena needs a null background). Pano wrapped in an error boundary → Neon Ring if the image fails.
2. `AholoSplatLayer.tsx`: hard timeouts (viewer import 15 s, each parse/upload attempt 30 s, whole load 60 s); a `webglcontextlost` listener → immediate fallback; pixel watchdog (samples the viewer canvas at 1.5–16 s; the splat stays hidden behind the pano poster until a sample proves it drew; 3 blank samples in a row and ≥10 s → fallback); "no frames" and render-exception → fallback; while loading, the world's panorama shows as a dimmed CSS backdrop with "Loading arena…" (never black). Viewer `pixelRatio` capped at 1.25 px/CSS px on phones (≤2 on desktop); `preserveDrawingBuffer` explicit. Splat count not capped: the worlds are only 120k–353k splats (SPZ header), so it isn't the problem.
3. `GameScene.tsx`: on phones R3F DPR ≤1.5, no MSAA; R3F context loss not restored within 2.5 s → remount the canvas; `splatFailed(reason)` logs the reason; root `data-arena` (and `data-splat-state` on the layer) for tests.
4. **Portrait camera** (`Effects.tsx` `CameraRig`, `lib/game/sim.ts`): side-on can't fit two fighters at 40%+ height on a 0.45 aspect (visible width ≈1.8 m). Portrait now uses a **3/4 view (48° yaw from P1's side)**, bisects the distance so both silhouettes fit (0.6 m margin), aims slightly toward the near fighter, and starts rounds at ±0.95 m (`sim.startHalf`; kick range is 1.7). Fighters are ~35–40% of the screen height at round start and ~45% in close combat; desktop/landscape is unchanged (side-on). `sim.cam.yaw` is published and the splat layer **un-rotates** it, so each world's tuned backdrop composition is unchanged.
**Verified on prod** (Playwright + Chrome, 412×915, DPR 2.625, touch, Android UA, 4× CPU throttle, SwiftShader): Kitchen Colosseum, My Room, Toy Shop, Rooftop Dojo all render the splat (`ready`); Neon Ring and no-arena default fine; forced viewer context loss → Kitchen panorama; blank render (debug placement off into space) → Neon Ring (My Room has no pano); bad splat URL → Neon Ring; `view=pano` Toy Shop → panorama. Desktop 1440×900 unchanged. Screenshots: `/workspace/shots/android/` (`prod-*.png`, `prod-grid-arenas.png`, `prod-grid-fallbacks.png`, `before-prod-pano-kitchen.png` = the reproduced bug, `desktop-*.png`). Test script: `/workspace/tools/android.mjs <url> <out> [waitMs] [viewer|r3f]` (`PROXY_API=<prod>` routes `/api/arenas|assets` when testing a local `next start`).
**Owner to check on the phone:** one fight per arena; if a world falls back, the console line `[game] splat arena fallback (<reason>)` names the reason (remote-debug via `chrome://inspect`). Panorama fallback shows the world's 360° photo: fighters stand over it (no floor alignment), fine as a fallback.

### Reliability for judging: DONE, DEPLOYED (13 Nov 2026, code ~12:20 WAT, deployed ~13:16 WAT)
Commit `cced8ad`. **Deployed** in `dpl_5fesGPGHSXz11jN5JmFbVbJ4kPw1` (13 Nov 2026 ~13:16 WAT); previously prod was `dpl_292pigZcsTVWyhW8THvRx3pSLT8v`. Still open: Blob store connect + spend-guard env values (owner). Pushing `master` does not deploy (the Vercel project has no Git integration; deploys are `vercel deploy --prod` from a checkout). No Aholo credits spent, no world jobs, no e2e runs; prod env vars unchanged.
1. **Forged-fighter durability.** Finding: forged fighters are rehosted (not served from expiring Lux3D URLs) but only into Runtime Cache + `/tmp`, and the cache was already evicting them: on prod at ~12:00 WAT Mama `rigged.glb`/`mesh.glb`/`anim-ko.glb`, Kicks Test `statue.glb`, `gen-mweoxohh-7015b6` `statue.glb`/`photo.jpg` and Quack Test `anim-punch/ko/victory.glb` returned 404 while all of them were still in `/api/fighters`, i.e. the roster offered fighters that couldn't load. Fixes: (a) baked what was still retrievable into git (optimised files only): **Mama** (freestyle, see §5), **SDK Test** (full rig, 8 clips), **Quack Test** (rig + 5 clips); Kicks Test and `gen-mweoxohh-7015b6` (no model left; the latter's concept is a photoreal person, not baked) are now hidden automatically; (b) `lib/durable.ts` Blob pack store + backfill (see §5); (c) roster hides fighters with a missing model; (d) `SafeModel` boundary in the fight scene and versus preview; (e) `/fight` loads `?all=1` so gallery-only and demo fighters opened by id work (it used to silently swap them for Mug Shot).
   **Blob store: DONE (see "Durable storage live" below).** Original note: `create_storage_stores_blob` (private, `iad1`, name `anything-fighter-fighters`, connect to the project) returned HTTP 500 with outcome unknown at ~12:19 WAT; the project still has no `BLOB_*` env var. In the Vercel dashboard → Storage: if `anything-fighter-fighters` exists, connect it to `anything-fighter` (all environments); otherwise create a **private** Blob store and connect it. Then redeploy. Free on Hobby (1 GB, 2,000 advanced / 10,000 simple ops per month; over the limit Blob pauses, nothing is billed, and the app falls back to Runtime Cache).
2. **Sample arena card** is always listed again (`lib/arenas-server.ts`); `/api/arenas` falls back to built-ins if listing throws.
3. **Spend guard:** code default `FORGE_LIMIT_FALLBACK` is now `mock` (prod has it unset, so the next deploy switches prod from 429 to labelled demo forges). Prod values today: `FORGE_IP_DAILY_LIMIT=2`, `FORGE_GLOBAL_DAILY_LIMIT=15`. **Proposed (owner to set; not changed):** IP 2, **global 4/day** 19–30 Nov (worst case ~200 credits/day ≈ 2,200 over the review window), then **2–3/day** through 31 Dec; leave fallback on `mock`. 15/day × ~50 credits could drain the estimated ~2,900 balance in about 4 days. Check the Aholo dashboard balance first.
4. **Player-visible debug text:** forge errors now show plain-language messages (`lib/player-errors.ts`) with the raw text behind a "Technical details" toggle plus Retry / "Fight with the roster" / "Try another photo"; poll errors no longer echo raw messages or HTTP codes; expired/unknown forge ids show "Forge not found" instead of a frozen "Forging…" panel; `/fight` load failure shows "Couldn't load the fighters" + Try again (was a raw `TypeError` string); gallery has a retry instead of "Loading…" forever; room scan and arena/pipeline API errors are friendly (raw text goes to the server log); the forge name is no longer pre-filled from camera filenames like `1794557018319…` (which is how `gen-mweoxohh-7015b6` got a numeric name).
**Tests (local, mock mode, no credits):** `npm run lint` clean, `npm run build` OK, `npm run test:durable` OK (pack encode/decode, save, index, cold-instance read, `*.orig.glb` excluded). `next start` on :3217 (no key) and :3218 (dummy key + `FORGE_IP_DAILY_LIMIT=0`, only `/api/pipeline` hit): mock forge end to end; limit hit → `mockReason: "limit"` demo forge, hidden from the roster, fightable by id; arenas list Neon Ring + sample; baked fighters served; Playwright + Chrome (SwiftShader) at 390×844 and 1440×900 on `/`, `/gallery`, `/fight` (Mama vs SDK Test on the sample splat), `/fight` with a missing clip + a corrupt model (both fall back, fight runs), `/forge/<error job>`, `/forge/<unknown id>`, `/forge/<demo job>`: no raw error text. Screenshots: `/workspace/shots/reliability/` on the box.

### Android "This page couldn't load" on generated fighters: FIXED, DEPLOYED (13 Nov 2026, fix ~12:40 WAT, deployed ~13:16 WAT)
Owner report (Android Chrome, prod): tapping any generated character shows "This page couldn't load / Reload to try again". **That screen is the Next.js 16 default error page, not a Chrome renderer crash or OOM.** Reproduced on prod with headless Chrome at Android settings (412×915, DPR 2.625, touch, Android UA, 4× CPU throttle; script `/workspace/tools/android.mjs` on the box): roster tap on Mama, `/fight?p1=gen-mwejr65q-c81d76`, and `/forge/gen-mweoxohh-7015b6` → FIGHT WITH all end there. Every time it follows a 404 on the fighter's model (`rigged.glb` / `anim-ko.glb` for Mama, `statue.glb` for `gen-mweoxohh-7015b6`) and an uncaught `useGLTF` "Could not load … 404" error. JS heap stays at 4–15 MB. Prod's public roster has exactly two generated fighters, and both have lost their model to Runtime Cache eviction, so "any generated character" crashes. **Not a size problem:** generated GLBs match the starters (2× 1024² WebP textures, ~33–47k verts, 46–57k tris; `gen-mweoxohh` `posed.glb` is 5.3 MB with 1024² PNGs and is not loaded by the game).
**Fix:** `cced8ad` already covers it (baked Mama / SDK Test / Quack Test, roster hides fighters whose model is missing, `SafeModel` fallback). Verified on the local build with the same emulation: roster tap and `/fight?p1=` for Mama, SDK Test and Quack Test load and fight; a forced 404 on Mama's model falls back and the fight runs. `b0450d9` adds: `/api/pipeline/<id>` returns `modelMissing`, so the forge page of a finished fighter whose model is gone says so (Forge a new fighter / Fight with the roster) instead of a dead-end FIGHT button; `/fight` shows "That fighter is no longer available…" instead of silently swapping to Mug Shot; long names wrap on mobile (the numeric name overflowed the card); a missing photo no longer shows a broken image. **Only needs a deploy** (no env change). `gen-mweoxohh-7015b6` stays unbaked (photoreal person, public repo). Its model could be rebuilt from the surviving prod `posed.glb` (box: `/workspace/bake/gen-mweoxohh-7015b6/statue.recovered.glb`, 2.2 MB) if the owner wants it back.
**Deploying:** the `vercel` CLI (65.15 via `npx`) on the box is logged out. There is no `VERCEL_TOKEN` / OIDC token and no `.vercel` link, so `npx vercel deploy --prod` needs `vercel login` (device flow in the box browser) or a `VERCEL_TOKEN` env var (never commit it). The Vercel connector (MCP) can deploy without either: `upload_file` per file (by SHA1) + `create_deployment` with `files`, `project: anything-fighter`, `target: production`. That is slower (every file is uploaded, including GLBs/splats). Not attempted.
**Deployed** as `dpl_5fesGPGHSXz11jN5JmFbVbJ4kPw1` (READY, aliased to anything-fighter.vercel.app, ~13:16 WAT). Prod check with `/workspace/tools/android.mjs` (Android emulation): roster tap on Mama → selected as 1P, versus preview loads; `/fight?p1=gen-mwejr65q-c81d76` → Mama vs Mug Shot fight runs; `/forge/gen-mweoxohh-7015b6` → "is no longer available" with Forge a new fighter / Fight with the roster. No Next error page anywhere. Public roster: 5 starters + Mama; baked SDK Test / Quack Test models serve 200; `/vendor/aholo-viewer/index.js` 200; arenas include sample-bear. Screenshots: `/workspace/shots/crash/deploy/` on the box.

### Durable storage live + photo privacy: DONE, DEPLOYED (13 Nov 2026, ~14:36 WAT)
Owner approved creating the Blob store and keeping players' photos private. Deployment **`dpl_ACftxh6e8xzkcUiKucitMYsezEST`** (commit `0ef461f`).
- **Blob store:** the 12:19 WAT `create_storage_stores_blob` 500 *had* created `anything-fighter-fighters`, but it was never connected (a retry returns 409 `store_name_not_unique`; the connector has no list/connect tool). So a new private store **`anything-fighter-blob`** (`store_Hp1jQpIueA07pOwV`, iad1) was created connected to the project: `BLOB_READ_WRITE_TOKEN` exists for production, preview and development. **Owner cleanup (optional):** delete the empty orphan `anything-fighter-fighters` in Dashboard → Storage.
- **Verified on prod:** `GET /api/health` → `{"durable":"blob"}`; `/api/health?probe=1` writes and reads back a dummy bundle (`health/probe.afp`, ok in 152 ms; memoised 10 min per instance). The first real live forge after the deploy (**"Dial"**, `gen-mweyqam9-2449b6`, forged 13:38 WAT by a player, rigged, 8 clips) was backfilled into Blob automatically (`[durable] saved 12 files to Blob`, index = 1). Its `mascot.png` had already been evicted from Runtime Cache before the backfill (thumb falls back, see backlog).
- **Cache:** bundles written with a 1-year cache (immutable per id); `/api/assets/gen-*/…` (except `fighter.json`) served `public, max-age=31536000, s-maxage=31536000, immutable`; starters unchanged (`max-age=3600`). Durable index memo 5 min. ⚠ Because forged files are now immutable for a year, **never change a baked `gen-*` file in place**; write a new filename instead.
- **Privacy:** `isPrivateFighterFile()` (`lib/fighters.ts`): `gen-*/photo.*` is never served (`/api/assets` → 404), never listed (`photoUrl` dropped from new fighters and stripped from old `fighter.json` at list time), never used for thumbnails (thumbs come from the Lux3D concept or the RenderCloud poster). Job responses (`/api/pipeline*`) go through `publicJob()`, which strips `remote` (signed Aholo URLs, including the uploaded photo). The forge page shows "🔒 kept private" in the photo tile; the gallery shows "🔒 private". The baked `photo.jpg` files for Mama / SDK Test / Quack Test were removed from git (still in git history) and their thumbs regenerated from their RenderCloud posters; `.gitignore` / `.vercelignore` exclude `public/fighters/gen-*/photo.*`. The photo is still kept inside the private durable bundle.
- **Tests:** `npm run test:durable` (mocked Blob API) also checks the 1-year pack cache and the probe; lint + build clean; local `next start` checks of 404 / cache headers; prod checks above.

### Gameplay package + generated opponents + jump/crouch + freestyle arms: DONE, DEPLOYED (13 Nov 2026, ~16:30 WAT)
Owner approved building and deploying it (no new Aholo animations, zero credits). All moves run on the Lux3D clips each fighter already has (jab = `punch`, cross = `punch2` / Punch_Cross where present, else a 1.3× jab; hook, kick, sweep, air attack = `kick`; knockdown = `hit2` / Hit_Knockback, else KO clip), with a procedural layer on top so **freestyle (unrigged Lux3D) meshes do every move too**.
- **Sim** (`lib/game/sim.ts`, rewritten): per-attack table `ATTACKS` (startup / active / range / damage / stun / knock / height / airReach), 150 ms input buffer, cancel-on-hit strings (`CHAINS`): **P P K** = jab → cross → hook (knockdown), **K P** = kick → rush, **crouch P → K** = low punch → sweep. Damage scaling `max(0.4, 1 − 0.12 × combo)`, counter-hit +20 %, block chip, **parry** (block within 120 ms of the hit: attacker stunned, +15 meter), knockdowns with 0.4 s wake-up invulnerability.
- **Special** (U, or back→forward+punch; touch SPECIAL): dash-strike, armour to 0.42 s, knockdown, fighter-colour dash trail, 1.1 s cooldown. **Super** (I / touch SUPER when the meter is full): slow-mo + camera zoom, 3 hits (punch → punch2 → kick, 10 + 10 + 18 before scaling), flash + big sparks, armoured. Meter fills from hits dealt (0.9 × dmg) and taken (0.5 × dmg), shown under the life bars and as a ring on the SUPER button.
- **Jump / crouch (owner request 15:00 WAT):** vertical axis `y / vy` (gravity 18, jump 6.4 m/s → ~0.7 s, ~1.1 m apex, horizontal speed fixed at take-off, no double jump). Crouch (hold down) lowers the hurtbox: **highs (jab, cross) whiff over it**. **Lows** (low punch, sweep) must be crouch-blocked; **air attacks** (punch or kick while airborne, once per jump) are overheads that must be blocked standing. Each grounded attack has an `airReach` (jab 0.35 m, cross 0.45, kick 0.95, hook 1.1, super 1.3, sweep 0.1): a jump clears anything lower, and **any clean hit on an airborne fighter is an anti-air knockdown** (pops them up slightly; the base for juggles later). Fighters can jump over each other (push-apart only when heights are close). Animation is procedural for every body: root height, stretch on take-off, tuck at the apex, landing squash; **rigged bodies bend the knees** (Mixamo `UpLeg`/`Leg` bones, bend sign measured on the bind pose) and drop the hips by the bent-leg length; freestyle meshes squash and tumble.
- **CPU** (`lib/game/ai.ts`): Easy / Normal / Hard (landing fight bar "CPU" toggle → `&cpu=`; default Normal; practice is always Easy and never attacks). Normal/Hard extend strings on hit, special from range, super when full, punish whiffs, parry (Hard), **jump in with air attacks, hop sweeps, crouch under jabs/crosses then low-punch, crouch-block lows, sweep, anti-air kick jumpers**. The AI drives the same inputs as a player, so it works for starters, rigged forged fighters and freestyle meshes.
- **Generated fighter as opponent:** `/fight?p1=…&p2=gen-…` (P1 defaults to another fighter when only `p2` is given); forge page **"FIGHT AGAINST <name>"** next to "FIGHT WITH"; gallery **"Fight vs"** next to "Fight as" (reaches gallery-only fighters like SDK Test / Quack Test); the roster already lets any fighter be the CPU / P2 ("Tap a fighter for CPU"); local 2P and the CPU both work with generated fighters, including freestyle Mama.
- **HUD / touch:** callouts (Special!, SUPER!, Parry!, Counter!, Armor!, Knockdown!, Anti-air!) + super flash; vibration on hits (12 / 30 / 60 ms); touch pad ▲ Jump / ▼ Crouch / ◀ ▶ + Punch (84 px), Kick, Block, Special, Super ring (all ≥ 56 px, fits 360 px); short move hint for the first 7 s on touch; desktop key bar updated. **Aholo visibility:** the VS screen tags each fighter ("Forged with Lux3D · rig + N Aholo clips", "Forged with Lux3D · freestyle moves", "Aholo Lux3D starter · retargeted clips") alongside the RenderCloud poster tag.
- **Deployed** as **`dpl_4mu7EzAvB7RHyR89NdWSmaNGkrS3`** (commit `3813922`, READY ~16:30 WAT). **Verified on prod:** `/api/health` durable blob; photos still 404; Android emulation (412×915, touch, 4× CPU throttle) **Mama (freestyle) vs Dial (generated, rigged, from Blob) as the Hard CPU**: full fight to KO, P1 strings jab→cross→hook ×2, kick→rush, sweep, air attack, super; CPU used specials, strings, lows, sweeps, supers; no page errors. Desktop practice mug vs duck: P-P-K ×3, K-P ×2, special, super, crouch, sweep, air attack, anti-air callout. Locally also: Android practice freestyle Mama (all moves via real touch-pad events), mug vs Mama CPU Normal (full fight; CPU used sweep/low/super/anti-air), SDK Test vs Quack Test CPU Hard (gen vs gen; CPU jump-ins, parries, supers), `?p2=` only (P1 defaults), desktop Hard Mama vs SDK Test full fight, local 2P mug vs Mama (P2 arrows jump/crouch, M block; P1 W/S/H, S+G sweep).
- **Freestyle arms, no more T-pose (owner note 15:34 WAT):** unrigged Lux3D meshes (Mama) are static T-poses and no posed mesh exists (only `statue.glb`). `lib/game/freestyle-rig.ts` detects an arms-out mesh at load (width ≥ 0.7 × height), bakes it into model space and turns it into SkinnedMeshes with a 3-bone skeleton (root + one per shoulder; weights by lateral distance past the chest width, height-gated so legs stay put). Fighter.tsx aims each arm every frame: guard (arms down, fists slightly forward, breathing bob), walk swing, jab/cross/low extend the lead/rear arm, hook swings round, kicks/air throw the arms out for balance, special = both fists forward, block = forearms crossed, hit/KO flail, victory raised + wave; it starts in the guard so even the first frame isn't a T-pose. On top of the existing body sway, bob, lean, lunges and squash. Zero credits; rigged fighters untouched (skipped when bones exist).
- **Thumb fallback:** a forged fighter whose concept image was evicted (Dial) now falls back to its RenderCloud poster in the roster.
- **Tests:** `npm run test:sim` (18 deterministic checks: strings + scaling, jump arc / no double jump, crouch whiffs highs, low punch, sweep vs standing block / crouch-block / jump, overhead vs crouch-block / standing block, anti-air knockdown, jab under a jump, special, super). Browser driver `/workspace/tools/fight-test.mjs <url&debug=1> <outPrefix> <mobile 0|1> <fullFight 0|1>` (keyboard or real touch pointer events on the pad, waits on the sim clock because SwiftShader runs at ~4 fps) and `/workspace/tools/twop-test.mjs` (2P keys). Screenshots in `/workspace/shots/gameplay/` (box only).

### Flat UI/UX pass, no gradients: DONE, DEPLOYED (13 Nov 2026, deployed ~17:01 WAT)
Owner request (17:05 WAT): "upgrade the UI/UX, I don't want gradients". **Rule from now on: no CSS linear/radial/conic gradients, no gradient text, no gradient bars/buttons/backgrounds, no Tailwind `bg-gradient-*` / `from-*` / `via-*`.** Solid fills, outlines, hard offset shadows and soft glows only. Check before every commit: `rg -n -i gradient app components lib` must print nothing. No gameplay logic changed; zero Aholo credits.
- **Design tokens** (`app/globals.css` `@theme`, used as Tailwind colours `bg-ink`, `text-muted`, `border-line`…): `ink #0b0b0e` (page), `panel #15151b`, `panel-2 #1e1e27`, `line #2b2b37`, `line-strong #454556`, `fg #f5f5f7`, `muted #b4b4c3` (≥7:1 on panel), `dim #8b8b9e` (≥4.5:1 on ink); accents **`blaze #ff5a1f`** (P1 + primary action; black text on it ≈7:1), **`volt #22c7ff`** (P2 / CPU + secondary action), **`gold #ffd23f`** (health, super, focus ring, "Powered by Aholo"), `danger #ff3b47`, `ok #3ddc84`. Component classes: `.btn` (min 44 px) + `.btn-primary` / `.btn-volt` / `.btn-ghost` / `.btn-outline-volt` / `.btn-sm` / `.btn-lg` (solid fill + hard 4 px bottom edge), `.card`, `.eyebrow`, `.tag`, `.skeleton`. One global keyboard focus style (3 px gold outline). `.arcade-title` = Bungee with a hard black drop (no glow). Type: Bungee for headings/labels, Space Grotesk for buttons, Inter for body (base 15–16 px, secondary text 12–14 px, no 8–9 px text left except tiny image labels).
- **Shared header** `components/ui/SiteHeader.tsx` (home, forge, gallery): logo, gold **"Powered by Aholo"** badge (links to the hackathon page; "Aholo" only on phones), Gallery or "+ Forge" CTA.
- **Home**: eyebrow "Manycore Aholo 3D AI Hackathon · Gaming", hero copy names Lux3D + SpatialGen, a 3-step strip (Snap → Lux3D builds/rigs/animates → Fight in an Aholo world), CTAs "Forge a fighter" (phones) / "Fight now with the roster ↓"; numbered sections **1. Forge a fighter / 2. Select fighter / 3. Select stage**; forge panel is a flat card (`#forge` anchor) with labelled name input, ghost Snap/Upload, solid FORGE button (disabled = grey outline), 20 px checkbox in a 44 px label, error box. Fight bar: 48 px segmented "vs CPU | 2P", CPU level button, solid FIGHT!.
- **Character select**: flat split backdrop (blaze/volt tints) behind the 3D versus preview, gold VS; portrait cards have a **solid name strip under the image** (fills with the side colour when picked, 2-line names), 3 px side-colour border + hard shadow, 1P/CPU tags; side tabs 44 px.
- **Stage select**: cards with a solid name strip (blaze when selected), solid source badge; Render-as buttons and Coming-soon toggle 44 px.
- **Forge page**: status headline in Bungee, eyebrow mode line (elapsed shown only while forging, as m/s), **segmented progress bar (one solid segment per stage) + "Step n of N: <stage>" + minutes left**, numbered stage cards (✓ / ✗ / pulsing current), tip box, solid buttons (Fight with = blaze, Fight against = volt), lost-job state with Forge-new / Gallery buttons (tiles hidden), skeleton concept tile while waiting.
- **Gallery**: cards lead with name + tagline + move count, concept / RenderCloud (and the original photo only when `photoPublic` is set; otherwise "🔒 Private") row, Powered-by strip, three 44 px actions (Fight as / Fight vs / View 3D) plus a Report link; skeleton loading cards, error card with Try again, empty state with Forge CTA. Policy line under the intro.
- **Fight HUD**: life bars are **solid gold (red when ≤30 %) with a white lagging-damage layer and 10 % tick marks**, 20 px tall on phones; super meters solid volt (gold when full) with 25 % ticks; timer 48×56; names 12 px with hard shadow; VS splash = flat diagonal blaze / volt halves, posters with hard ink shadow and "Aholo RenderCloud" + Aholo tags in gold-on-ink; KO band = ink with gold borders; FIGHT! in Bungee; victory card flat with solid buttons; mute (44 px) top-right and a **back-to-roster button now also on phones** (top-left, 44 px).
- **Touch pad**: one style for every button (translucent ink disc + 3 px solid outline): moves/jump/crouch/block white, Punch blaze (84 px), Kick volt, Special gold; **Super ring is an SVG stroke** (dash length = meter) instead of a conic fill; all ≥56 px, same positions as before (`data-btn` unchanged, `fight-test.mjs` drives it).
- **3D**: Neon Ring already used a solid background colour + distance fog (no sky shader); the post-processing **Vignette (radial edge darkening) was removed**, Bloom kept. Splat arenas untouched; the splat-loading backdrop is now the panorama under a flat ink overlay (or solid panel).
- **Deployed** as **`dpl_2gsDTpoAx3Jzsv2uvTsKvNeVtUen`** (commit `5e7abd9`, READY ~17:01 WAT, aliased to anything-fighter.vercel.app; rollback `dpl_4mu7EzAvB7RHyR89NdWSmaNGkrS3`). **Verified on prod:** `/api/health` durable blob; new header / "Powered by Aholo" badge / numbered sections served; `ui-shots.mjs` desktop 1280×800 + Android: landing, select, forge (Mama), forge-not-found, gallery, VS splash, fight HUD, no page errors (`/workspace/shots/ui/prod/`); Android `fight-test.mjs` Mama vs Mug Shot Hard CPU via the touch pad (strings, special, crouch, jump, anti-air; no errors); Kitchen Colosseum splat arena on Android renders with the new HUD.
- **Intentional exceptions:** none in our UI code. Built bundles still contain the word "gradient" only in Tailwind's `transition-property` list (`--tw-gradient-from…`, not a visual), three.js internals (`gradientMap`) and the postprocessing library's own shader code.
- **Tests:** `npm run lint`, `npm run build`, `npm run test:sim` (all pass). Local `next start` with `/api/*` proxied to prod: desktop 1280×800 + Android emulation shots; `fight-test.mjs` Android full fight mug vs Mama (Hard CPU) to KO via the touch pad (strings, special, super, sweep, air, anti-air; no page errors; the only "no button punch/kick" lines are presses sent after the KO when the pad is gone). Screenshots (box): before `/workspace/shots/ui/before-*`, after `/workspace/shots/ui/after-*`, fight run `/workspace/shots/ui/fight/`. Shot script: `/workspace/tools/ui-shots.mjs <base> <dir> <prefix>` (`PROXY=<prod>` for local builds).

### Gallery button, fighter picker, opt-in photo sharing, room-scan UX: DONE LOCALLY, NOT DEPLOYED (13 Nov 2026, ~17:50 WAT)
Branch `ui/picker-gallery` (local only — do not push or deploy until the owner has reviewed screenshots).
- **Gallery button:** `SiteHeader` uses a solid outline 44 px `btn-outline` "Gallery"; home hero adds "Browse the gallery"; footer has a Gallery link.
- **Fighter picker:** redesigned `SelectScreen` (see §5). Fixes the confusing "Tap a fighter for CPU" toggle, tiny corner tags, and missing-thumb initials (e.g. Dial).
- **Opt-in photo sharing (default OFF):** forge form checkbox + attestation (`PHOTO_ATTESTATION`). Public share is allowed only when the uploader opts in, attests, **and** a client-side face gate finds no face. Aholo's published OpenAPI (Asset, World, Lux3D, RenderCloud, Spatial Understanding) has **no face-detection or moderation endpoint**, so the face gate uses MediaPipe Tasks Vision in the browser only (`lib/face-gate.ts`). If a face is found or the model fails, the forge still runs and the photo stays private (fail closed). `photoPublic` is stored on `fighter.json` only at create time — older forges are never published retroactively. `/api/assets` serves `gen-*/photo.*` only when that flag is true, with `Cache-Control: private, no-store` so a takedown is immediate. The Blob store stays **private**. Gallery cards already showed Lux3D concept + RenderCloud poster + 3D; they now also show the original photo when opted in, plus a **Report** dialog (queue at `/moderation`, owner secret). The forge-done page shows a one-time **Remove from gallery** control (HMAC token in `sessionStorage`, signed with `GALLERY_SECRET`).
- **"Fight in your room" (Aholo Reality):** the builder was hidden under "Coming soon" even with an empty queue, and the file input used `capture="environment"` which on Android often skips the gallery and blocks picking a 10–20 s video. Builder is now a first-class stage-select card; Upload vs Record are separate. Live API was already working (the screenshot showed "Reality API · Flash" and an existing "My Room (Scan)" arena). No Aholo password needed — use the existing `AHOLO_API_KEY`.
- **Owner action before production:** set `GALLERY_SECRET` in Vercel (production, preview, development). Do not commit a value. Do not submit or post anything.
- **Tests:** `npm run build` (and lint) after these changes. Screenshots: `/workspace/shots/`.

### Known future fixes / backlog (logged 13 Nov 2026, 08:35 WAT)
Not started yet. Move each one into "In progress right now" when you begin it, and into status with its commit and deploy IDs when it's done.

**Arenas / worlds**
- ~~The Aholo sample splat arena card disappears once any generated world is ready~~ done (13 Nov, reliability commit).
- ~~Verify My Room fight visually~~ done (mobile + desktop, `54d363f`). Kitchen Colosseum panorama card still not eyeballed.
- ~~Toy Shop / Rooftop Dojo framing~~ done (`45c0017`); check their stage-select preview cards.
- Duplicate queued worlds `3FO4K4V8IL5L` and `3FO4K4V8IOHM` will spend about 30 credits on worlds we already have. Only Aholo support can cancel them, and only with the owner's approval.

**Forge pipeline**
- After the SDK migration, a full live forge *including the concept (multimodal-to-image) step* has not been run. The verification forge skipped it to save credits. Test one end to end, photo to poster.
- `multiFormatExport` (the "printable STL / 3MF" checkbox) runs through the SDK but has never been tested live.
- `imageToFourView` → multi-view `imgTo3d` (G1) is available but unused. It might improve mesh quality; test once and compare cost.
- `scripts/*.mjs` (offline CLI tools) still use raw REST. Migrate them to the SDKs for consistency with the Manycore-first directive.

**Reliability for judging (demo must stay up until at least 31 Dec 2026)**
- ~~Durable forged-fighter assets~~ done in code (baked fighters + `lib/durable.ts`); **owner: connect a private Blob store, then deploy** (see "Reliability for judging" above).
- ~~Spend guard review~~ done: fallback default `mock`; **owner: set the proposed `FORGE_GLOBAL_DAILY_LIMIT`** (see above).
- Credits can't be read via the API locally. Check the balance on the Aholo dashboard before any batch of live tests.

**UI / game feel**
- Verify the 2-player single-keyboard mode and the desktop layout after the redesign and the mobile fixes.
- ~~Raw debug/error text visible to players~~ done (13 Nov, reliability commit).
- Forge page for a demo (mock) forge still ticks the Lux3D stage cards (the banner explains it is simulated); consider greying them.

**Process**
- Several agents may work in this repo. Stage files by name (never `git add -A`) and `git pull --rebase` before committing.
- Before killing a dev server, check which agent owns it. A stray `next-server` (PID 51554) was killed by mistake on 13 Nov.

## 10. Roadmap / next steps

Do these in roughly this order unless the owner directs otherwise.

1. ~~Mama re-rig~~ done. ~~Fighting-game UI redesign~~ done. ~~Official SDK migration~~ done (app code; CLI scripts still raw REST).
2. ~~Tune splat placement~~ done (`54d363f`, `45c0017`; auto-fit for future worlds).
3. Optionally migrate `scripts/*.mjs` to the SDKs; optionally try `lux3d.imageToFourView` then multi-view `imgTo3d` (G1) for better meshes (extra credits; test once).
4. **Project report** (PDF or PPT) covering concept, development, asset iterations, and results — required for submission.
5. **Demo video** of the real app running (voiceover/subtitles OK).
6. **Fill the official submission form as a draft** (demo link, report, track = Gaming, devices = None, source repo, etc.). **Do not submit without the owner's explicit OK.**
7. **Draft an X post** with `#Manycorehackathon` for the owner to post. Do not post it yourself.
8. **LuxReal KO replays / trailer:** LuxReal has **no public video API**. An invitation / Lux3D-related key from Manycore is required for deeper integration. The survey is already in; credits may take 1–2 days. Meanwhile `scripts/luxreal-pack.mjs` can assemble posed GLBs + posters + panos for manual upload at the LuxReal web app when those files exist. LuxReal ID for this account: `3FO4FONYS18J`.
9. Ask Aholo support to cancel the duplicate world jobs `3FO4K4V8IL5L` and `3FO4K4V8IOHM` (owner decides; do not contact them without approval).

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
| `5bb99ea` | HANDOFF.md |
| `1c425bf` | All Aholo calls on the official Manycore TypeScript SDKs (`lib/aholo-sdk.ts`); Powered-by strip; README SDK section |
| `f3771aa` | Fighting-game UI redesign (home, character select, stage select, VS splash, HUD) |
| `f3033ea` | Arcade logo/heading on forge + gallery |
| `31af7df` | Aholo Viewer absolute splat URL fix; stuck = time since first seen RUNNING |
| `54d363f` | Splat auto-fit + overrides, CDN→proxy→pano/stage fallback, aspect-aware fight camera, hit-flash tint, touch controls fit 390 px |
| `45c0017` | Splat auto-fit anchored on the SpatialGen viewpoint; Rooftop Dojo placement |
| `90acc20` | Android black arena: scene-level pano/stage background (was a no-op), splat timeouts + context-loss + pixel watchdog, mobile DPR caps, portrait 3/4 camera (fighters ~40–45% of height) |
| `cced8ad` | Reliability for judging: baked Mama / SDK Test / Quack Test; optional Vercel Blob pack store (`lib/durable.ts`) + backfill; roster hides fighters with missing models; `SafeModel` fallback; sample splat always listed; spend-guard fallback `mock` (labelled demo forge); friendly player-facing errors. Deployed with `76b8853` as `dpl_5fesGPGHSXz11jN5JmFbVbJ4kPw1` |
| `b0450d9` | Android "This page couldn't load" (model 404 → Next error page): forge page `modelMissing` state, `/fight` missing-fighter notice, mobile name wrap. Deployed with `76b8853` as `dpl_5fesGPGHSXz11jN5JmFbVbJ4kPw1` |
| `3813922` | Gameplay package (strings, special, super meter, parry, knockdowns), jump/crouch (highs / lows / overheads / anti-air), CPU Easy/Normal/Hard, generated fighters as opponent (FIGHT AGAINST, gallery Fight vs, `p2=gen-…`), freestyle arm rig (no T-pose), touch Jump/Crouch/Special/Super, `npm run test:sim`. Deployed as `dpl_4mu7EzAvB7RHyR89NdWSmaNGkrS3` |
| `0ef461f` | Durable Blob storage live (store `anything-fighter-blob`), 1-year immutable caching for forged assets, `/api/health` (+probe), players' photos private. Deployed as `dpl_ACftxh6e8xzkcUiKucitMYsezEST` |
| `5e7abd9` | Flat UI/UX pass: no gradients anywhere, design tokens + `.btn`/`.card` system, shared header with "Powered by Aholo" badge, clearer home / select / stage / forge progress / gallery, solid segmented life + super bars, SVG super ring, unified 44 px+ touch pad, mobile back button, vignette removed. Deployed as `dpl_2gsDTpoAx3Jzsv2uvTsKvNeVtUen` |

Later commits may exist — run `git log` before you start.

---

## 11. Ground rules for the next agent

- Work in this repo; keep changes reviewable; do not rewrite working pipeline code without cause.
- Another agent may be editing at the same time: touch only the files your task needs; never `git add -A`.
- **Keep this file current with every change** (owner request, 13 Nov 2026): update the relevant section, §9 status (including the prod deployment id) and the commit table in the same commit or the next one.
- Spend Aholo credits sparingly; check the dashboard; respect the spend guard.
- Do not add production credentials to the client, the repo, or the submission packet.
- Do not submit the hackathon form, publish the X post, or send mail as the owner unless they clearly asked for that exact action.
- Prefer Manycore's recommended SDKs and tools (§2) for anything new in the 3D pipeline.
- When in doubt, re-read this file, `README.md`, and `lib/aholo.ts`.

Good luck. Snap anything. Fight everything.
