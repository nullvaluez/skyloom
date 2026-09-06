# FLY ROUND 24 — "SMOOTH WORLD" (PLAN)

> Authored 2026-09-06 by Fable off a six-reader reconnaissance of the renderer
> at commit `3592656` (the Round 21 "Steady State" merge). The full evidence
> ledger is [`scripts/r24-recon.md`](scripts/r24-recon.md); every pain-point id
> below (FL-xx frame loop, T-x terrain, WB-x chunk pipeline, L-x lighting,
> A-x/B-x post-target intel, HARN-x harness) points into it. Five Opus agents
> — **A PACE / B WORLD / C LIGHT / D ATMOS / E CERT** — under Fable
> orchestration.

## §0 Lineage and rulings

**Base.** `main` is the R21 tree at `3592656` plus this scaffolding. The R21
close commit that followed it touched no code; its two records
(`FLY_ROUND21.md`, `scripts/r21-close-sweep.md`) are imported here verbatim so
the honest R21 §1 tables and §6 checkpoints are in-tree. **Rounds 22, 22.1 and
23 are ARCHIVED, not merged**: branch `archive/r22-r23-main-44ec502` and tag
`r23-archived-44ec502` (the tag is local-only: this environment's git proxy rejected the tag push, so the BRANCH is the durable archive ref) hold that tree. Never merge it wholesale — R22 shipped on
a user waiver, R22.1 certified a 13-harness subset, R23 could not stream tiles,
and the merge of the two parallel rounds was build-only (recon B2). Read their
ledgers for diagnoses; re-implement, never cherry-pick.

**User rulings (2026-09-06), all in force:**

1. **Salvage by clean re-implementation** of the later rounds' well-evidenced
   fixes: the zero-area triangle filter (A1), the skirt fast path then the
   worker move (A2), in-frame DPR steps (A3), slew-limited visual ground
   elevation, parcel grow ease, idle-sliced prewarm tail, veg commit cap (A5,
   A6, A9). Nothing else from R22/R23 comes across.
2. **"Perpetual rendering" means** continuous streaming and finalization so no
   frame carries a burst, plus a fixed-timestep simulation with an interpolated
   render pose so motion stays smooth through any hitch, plus a governor that
   targets the display's own refresh. `frameloop="always"` already holds.
3. **Verification venue.** The cloud container cannot reach Esri, OpenFreeMap or
   adsb.lol (403) and its WebGL is SwiftShader at ~1 fps under the game's load
   (HARN-ENV-1/2/3). E builds an **offline world fixture** so every
   structural, draw-count, determinism and fixed-pose pixel-A/B gate runs here;
   **every fps / ms / stutter / tearing number is measured on the user's
   machine only**, and a SwiftShader number never re-baselines a live one.
4. **Sanctioned contract moves:** vendor three-tile (verbatim copy, switch-gated
   patches, `VENDOR.md` ledger); `WORKER_PROTOCOL 17→18` (done in W0 at all six
   pin sites); worker-output hash re-baselines under an A/B control; a ONE-TIME
   re-baseline of the horizon/satellite pixel gates for the color-space fix
   (L1); the medium tier may leave the R19 byte-freeze for `AERIAL_LAW` and
   `ONE_SUN` (phones stay capped at medium).
5. **Ambition.** Level A (consistency) is COMMITTED and ships ON at close when
   green: one sun, linear-correct haze, post order + dither, reversed-depth
   fix, shadow catcher + stable kernel, smooth terrain normals, lit clouds,
   tamed Lambert env. Level B is BUILT AND MEASURED, ON only if its gates and
   budgets are green: `AERIAL_LAW`, `LOD_CROSSFADE`. `SKY_PROCEDURAL` is
   built-but-off pending a user checkpoint. **PBR buildings and TAA are NOT
   this round** (§7).
6. **Pacing.** `FRAME_STEP` behind its flag, ON at close if the harness pose
   contracts hold (`flight.pos` stays the sim truth; the interpolated pose is a
   NEW field, `runtime.flight.renderPos/renderQuat`, that render consumers opt
   into). Governor targets native refresh. Sub-native render-scale rungs ON
   (`LADDER_FIX`) with a user taste checkpoint. No TAA.
7. **Draw ceilings unchanged:** Owens ≤ 261 / satellite ≤ 375 / toy ≤ 480;
   satellite soak p95 tris ≤ 2.2 M BLOCKING; heap no-climb. Any +draw must be
   content-gated so Owens stays 0 by construction.

**Still open (ask the user at kickoff; proceed on defaults if unanswered):**
which symptoms they saw and on which build (a white frame / freeze-and-snap /
labels swimming in turns / soft-then-sharp / blurry screen-edge terrain in
turns / edge shimmer / a real tear line), and their machine (GPU, resolution,
DPR, refresh rate, browser, windowed vs fullscreen). Default assumption: a
DPR-1 60 Hz desktop in Chrome, satellite style.

## §1 Environment protocol (read before running anything)

- **Launch shim (no repo change):** harnesses `require('playwright')` and pin
  `channel:'chrome'`. Here: `NODE_PATH=/opt/node22/lib/node_modules
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node -r <scratch>/pw-shim.js
  scripts/verify-X.js` where the shim wraps `chromium.launch` to drop `channel`
  and append `--use-angle=swiftshader` (HARN-ENV-1). E may promote this to a
  `PW_CHANNEL`/`PW_EXTRA_ARGS` read in ONE shared launcher helper.
- **Offline world fixture (E, W1 first deliverable):** a node http server on
  127.0.0.1 with `Access-Control-Allow-Origin: *` serving synthetic imagery
  PNG at the ArcGIS URL shape, DEM as terrain-rgb PNG (three-tile's registered
  decoder; 64² tiles suffice), and MVT `.pbf` via geojson-vt + vt-pbf emitting
  exactly the OpenMapTiles layers/fields the worker reads (`building` with
  `render_height`/`height`/`render_min_height`/`hide_3d`, `transportation`
  `class`/`brunnel`, `aeroway`, `water`, `waterway`, `landuse`, `landcover`,
  `park`; extent 4096; buildings only at z ≥ 13). Scenes: dense city, suburb,
  EMPTY desert (the Owens control), and a 200-with-empty-body tile. Wiring is
  harness-only via Playwright `context.route` (MEASURED to reach module-worker
  fetches, HARN-OBS-10) for OFM TileJSON + `.pbf`, Esri imagery, and a
  synthetic `/api/aircraft` stub. DEM: the 3-line harness-only hook in
  `lib/fly/tile-sources.js` reading `window.__flyTileFixture` (weather-model
  idiom; production byte-identical). Every frozen pixel/hash gate gains a
  **FIXTURE baseline column**; live columns are re-baselined only from the
  user's machine (HARN-GAP-6).
- **What the fixture proves here:** worker fingerprints/determinism, kept and
  placed counts, draw/tri ceilings (`gl.info` is deterministic per pose), mesh
  census, uniform reads, protocol/flag/source scans, composer-buffer ===
  drawing-buffer, program-count flatness, flag-off byte identity, cache-key
  registry, boot monotonicity, and fixed-pose pixel A/B for shading (SwiftShader
  is bit-stable). **What needs the user's machine:** every fps/ms number, the
  governor, frame pace, tearing, driver artifacts, live tileset drift, live
  traffic.
- **Hygiene:** run from your own worktree with its own `.next` and port; never
  `next build` while a browser gate runs; artifacts go to `scripts/r24-out/`
  (gitignored) not beside the scripts; the fleet pins in `scripts/_boot.js`
  stay — un-pin per gate with the accessor-swallow idiom; the three node gates
  (`verify-classify.mjs`, `verify-warbirds.mjs`, `verify-daily.mjs`) run
  anywhere.
- **User-machine diagnosis pack (E, W1):** one `scripts/r24-user-diag.md` the
  user follows on the R21 build BEFORE any fix lands — boot satellite, fly the
  Powell → Columbus serpentine at 200–400 m AGL for 3 minutes, `copy(__flyStats
  .frame)` + `copy(__flyStats)`, paste back. That is the round's real RED.

## §2 Pain-point inventory → owner

| Owner | Ids | Headline |
|---|---|---|
| A PACE | T1 T2 T3 T4(a) T5 T9 T14 · FL-02 FL-03 FL-04 FL-05 FL-08 FL-09 FL-01 FL-13 · A2 A3 A4 A9 · WB-3 | main-thread skirt sort; quadtree walks every frame and collapses behind you; uploads inside the render; no fixed step; DPR step out of frame; HUD one frame late; finalize not budgeted |
| B WORLD | WB-1 WB-2 WB-4 WB-5(prep) WB-6 WB-8 WB-9 · A1 A1b A5 A6 · FL-10 · T8 | zero-area flash; no birth/evict fades; dusk/tier recompile storms; heal = delete+refetch; lead not in bend pad; raw groundElev sweeps |
| C LIGHT | L1 L2 L3 L5 L6 L8 L7 · WB-7 · FL-07 FL-12 · T6 T7 T11 T12 T13 | sRGB haze in a linear buffer; four suns; depth double-convert; shadows on nothing + sparkle; SMAA pre-tonemap; faceted terrain; unlit clouds; mirror env on Lambert |
| D ATMOS | L4 L10 · T4(b/c) T10 · A8 | five atmosphere laws; photographic sky; hard LOD pops; night post-haze with no sun term |
| E CERT | HARN-ENV-1..3 HARN-GAP-4..8 HARN-HYG-9 · A7 | nothing renders here; no frame-pace instrument; fleet pins hide ship-state visuals; hashes over live tiles; flicker residual unattributed |

## §3 Charters

Every charter: worktree `r24/<letter>` off `main`; every feature behind its
pre-seeded block; flag-off byte identity proven (fingerprint scenes or pixel
A/B on the fixture); one ledger `scripts/r24-<letter>-<name>.md` with RED
before GREEN; new shader text = new FINAL cache key + PREWARM warm-set entry
in the same change; agents never commit to `main` (Fable merges).

### A PACE — "no frame carries a burst"

1. **W1a, merge first (day 1):** vendor three-tile verbatim into
   `lib/fly/vendor/three-tile/` (`index.js` + the plugin with its one
   `from 'three-tile'` import rewritten to the vendored core, because the
   plugin registers loaders into whichever LoaderFactory singleton it imports
   — recon A2), `VENDOR.md` patch ledger with ZERO patches, `package.json`
   overrides/transpilePackages pointed at it, byte-identical boot. C and D
   patch behind switches only after this lands.
2. `TERRA_PACE.skirtFast`: O(V) boundary scan on Martini grid coords replaces
   the allocate-and-sort edge finder; proven output-identical on a node
   fixture of captured index buffers (regular, holed, Uint16/Uint32,
   non-manifold bail to the verbatim body). Then `skirtWorker`: skirt +
   attribute concat inside the LERC worker, transferables out (T2, A2).
3. `timerFix`, `mergeHysteresis`, `keepResident` (+ wire the dead
   `TILES.lruBudgetBytes` as the residency bound), `parallelLoad`,
   `imageBitmap`, `preUpload`, `lodOutsideRender` (T1, T3, T5, FL-03). Each
   its own switch, each its own before/after row on the fixture (tile
   ready/resident counts, requests per serpentine, evictions) — fps rows only
   from the user's machine.
4. `STEP_SAFE` (A3): governor parks the DPR in a module cell; a priority −99
   `useFrame` applies `setPixelRatio/setSize/composer.setSize` then React
   `setDpr` in the same tick; 1 s safety valve; composer registered from a
   keyed effect. `LADDER_FIX` (A4): sub-native rungs before the first tier
   rung; `nativeRefresh` makes the governor target the estimated refresh.
5. `FRAME_STEP` (FL-04): 120 Hz accumulator, ≤4 substeps, `renderPos/renderQuat`
   published and consumed by PlayerPlane, chase cam, contrail, ground shadow;
   `flight.pos` untouched for crash/harness contracts; a probe that proves the
   render pose equals the sim pose at the substep boundary.
6. `HUD_SYNC` (FL-01): LabelCanvas draws via R3F `addAfterEffect` (or a
   priority-2 frame) with this frame's camera matrices; keep the phone 30 Hz
   step. `FINALIZE_PACE` (WB-3, A9): wall-clock brake on every engine including
   the first chunk when the last frame overran; veg commit cap.
   `REBASE_CALM` (FL-09, T12): drop the dead store bump, targeted matrix
   update, anchor quantised to a micro-noise cell multiple.
7. Owens ≤ 261 / sat ≤ 375 / toy ≤ 480 must hold with every switch on; the
   R21 stability quartet green on the fixture and on the user's machine.

### B WORLD — "nothing pops, nothing flashes, nothing recompiles mid-flight"

1. `FLASH_GUARD` (A1/A1b, WB-1): ~45-line area filter at drape finalize over
   DRAPED positions, `minArea2: 0`, in-place compaction, same array by
   reference when clean; at `sat-building-engine` finalize, `sat-skyline`
   finalize and `toy-world` finalize; runtime pin `__flyFlashPin='off'` for a
   same-session RED leg; a default-framebuffer readback instrument (CDP
   screencast is blind to one-frame events — A1 evidence).
2. `RING_DEDUPE` (WB-1): worker drops the closing clone + consecutive equal
   points after `clipRing`; flag-off byte-identical bundles; fix `simplifyRing`
   so the skyline keeps `ring[0]` (A1b). Re-baseline neon-cover/seam hashes
   under a controlled A/B (fixture column + user-machine live column).
3. `CHUNK_FADE` (WB-2, A6): per-mesh birth ramp with zero new keys for
   sat-buildings/skyline (per-chunk material instance, same program, fade
   uniform = altitude × birth); opacity ramp for additive roads/water; toy
   births via a new `uBirth` in the fade family (three key bumps + prewarm);
   deferred evict behind a fade-out timer, hard-evict on warp, `maxConcurrent`
   so Owens never grows. Parcel `growK` step → ≥600 ms ease (A6).
4. `HEAL_IN_PLACE` (WB-8, T8): retain per-run groundY, re-drape the resident
   position buffer with a ranged upload; evict+refetch only when the bundle is
   gone. `GROUND_VIS` (A6): slew-limited `runtime.groundElevVis` (≤4 m/frame,
   snap on warpEpoch) for `setBendEye` and the AGL-keyed fades only.
5. `ENV_UNIFORM` (WB-4, A5): constant PMREM height across every sky bucket
   (upsample the 1k twilight files + blend scratch to the day file's class, or
   the reverse — A/B the noon pixel cost); prewarm both shadow states and both
   env heights; re-warm on style flip and on a late HDRI; idle-rAF slicing of
   the post-reveal compile tail; publish `gl.info.programs.length` deltas per
   frame into `__flyStats`. `BEND_LEAD` (WB-6): pad × (1 + maxLeadFrac) at all
   four engines + a moving-leg census sample.
6. Prep for C: outward-wound wall quads from `classifyRingsSat`'s sign so
   FrontSide becomes possible later (WB-5) — behind `RING_DEDUPE`, measured,
   not flipped this round unless the wall-normal fixture gate is green.

### C LIGHT — "one sun, one color space, edges that hold still"

1. `LINEAR_HAZE` (L1): decode every haze/fade/aerial target to linear at the
   setters (`setEdgeFade*`, `setDepthHaze*`, `setSatContentHaze`,
   AerialPerspective `uHazeColor`); no GLSL change; re-tune `SKY.altAtmo` /
   `TOY.haze` / `GLOBE.rim` by fixture A/B; add the rim-seam gate (terrain
   fade-end vs dome band luma delta at noon AND deep night).
2. `ONE_SUN` (L3): the directional follows `runtime.sun` at every tier;
   `setHillDir`, the dome lobe and water specular read the same vector;
   explicit moon key at night; satellite monuments Toon → Lambert (needs the
   frozen `verify-monuments-sat` sanction: do it once, close the R20 Taj
   residual in the same move).
3. `POST_ORDER` (L6): bloom → aerial → ACES → grade → vignette → SMAA last
   with `encodeOutput` + dither; `SMAAPreset.HIGH`/LUMA measured; grade
   constants re-tuned post-curve. `DEPTH_FIX` (L2, FL-07): patch the CoC /
   depth-mask `1.0-depth` under three r185's define, fix the dead sky
   early-out, add a depth round-trip gate before any future SSAO.
4. `SHADOW_CALM` (L5, FL-12): enable the built ground catcher behind a
   caster-present + AGL < 1500 gate (+1 draw only where casters exist);
   stable PCF kernel via a ShaderChunk override; texel-snapped light
   position; `normalBias` 4 → ≤1 slope-scaled. No three CSM.js (it re-keys
   every variant).
5. `TERRAIN_LIGHT` (L8, T6, T7): fragment-stage N·L, hillshade weight keyed on
   sun elevation (photo sun wins by day), smooth central-difference normals
   from the full DEM grid computed in A's vendored worker (skirt verts inherit
   their edge normal), shorter error-bounded skirts with a darkened flag,
   fwidth-attenuated micro grain (T13). Coordinate with A: your worker patch
   is a switch in `VENDOR.md`.
6. `CLOUD_LIT` (L7): custom material on the drei instancer — fake sphere
   normal, sun side / shadow side / back-scatter rim, moon tint, overcast
   grey; same draw count. `LAMBERT_ENV` (WB-7): reflectivity/combine on the
   four Lambert content materials, A/B at the certified poses.
7. Every change: fixture pixel A/B at the canonical poses + the R21 flicker
   gate's five-control protocol before/after; the neon toy palette stays
   pixel-identical under the 0-gated uniforms.

### D ATMOS — "one atmosphere, no hard pops" (Level B, measured)

1. `AERIAL_LAW` (L4): one analytic f(distance, height, sunDir) → (extinction,
   inscatter), Rayleigh-ish + Mie lobe toward `runtime.sun`, colored by the rim
   triple; evaluated per-material at medium/low in the fade family + content
   slot + a new slot in air/anchor variants, and as the post pass at high with
   identical constants; retires the separate tile depth haze and folds the
   60–120 km rim melt into extinction → 1; fogExp2 stays as the weather
   multiplier. Registry bump + prewarm in the same change; horizon gates
   re-baselined once (with C's L1, one batch). Night: strength on the windows'
   dayFrac ramp so deep night reads 0 (A8).
2. `LOD_CROSSFADE` (T4): pre-upload before the swap, then a ≤300 ms
   parent-retained crossfade — prefer the parent-texture clip-UV blend (~0
   extra draws) over a second draw; geometry snap hidden by the fade; boot is
   fade-free; Owens draws unchanged.
3. `SKY_PROCEDURAL` (L10): analytic sky in the dome fragment from
   `runtime.sun` that also outputs the rim/inscatter color for `AERIAL_LAW`;
   HDRIs kept as IBL only. BUILT-BUT-OFF; A/B PNGs at the canonical poses for
   the user checkpoint.
4. Go/no-go per feature: gates green, Owens/sat/toy ceilings held, no new
   lazy compiles (`programs.length` flat), verify-flicker unchanged.

### E CERT — "a green means something here AND there"

1. **W1 first:** the launch shim; the offline world fixture (§1) with its
   scene generator, `context.route` wiring, `/api/aircraft` stub, terrain-rgb
   DEM hook; a FIXTURE baseline column on every frozen pixel/hash/count gate;
   `verify-seam`'s node leg pinned to fixture tiles (HARN-GAP-7).
2. `FRAME_STATS` (HARN-GAP-4): in-app ring buffer at `__flyStats.frame` (dt,
   long frames > 33 / > 100 ms per minute, worst dt, `longtask` count, last
   stall's attribution hook); soak-fly and verify-stability read it instead of
   private collectors; `scripts/r24-user-diag.md` for the user's RED.
3. New RED-calibrated gates on the flag-off tree: `verify-flash-guard`
   (default-framebuffer pale detector + degenerate census), `verify-frame-pace`
   (stalls/min from `FRAME_STATS`; RED only on the user's machine — say so),
   `verify-step-clean` (same-frame DPR proof), `verify-fade` (birth/evict
   counts never change `ready`, Owens 0), `verify-one-sun` (all sun vectors
   agree), `verify-linear-haze` (rim-seam delta), `verify-depth-roundtrip`,
   `verify-lod-fade`. Every gate states which fleet pin it releases and proves
   the released term is reachable in that tier.
4. Post-merge smoke after each W2 merge (E → A → B → C → D); the fixture fleet
   on the integrated tree; the user-machine run list (R21 quartet, sat soak
   15 min, frame-pace, flash-guard at the Powell pose) written as exact
   commands; the close ledger `scripts/r24-close-sweep.md` with an honest
   "not measurable here" column.

## §4 Measurement protocol and frozen numbers

- Canonical poses: Powell OH low serpentine (200–400 m AGL), Columbus
  downtown, Manhattan settled (Brooklyn Bridge chase), Owens Valley (EMPTY
  control), Melton AU (parcel carpet), Neon NYC low + FL260, one dusk
  crossing. Fixture equivalents: dense city / suburb / desert scenes.
- Instruments: fixture pixel A/B per flag; `gl.info` draws/tris per pose;
  worker fingerprints; `programs.length` per frame; `__flyStats.frame` on the
  user's machine (stalls/min, worst dt, p99); verify-flicker's five controls
  for anything touching emissives or bloom; a default-framebuffer readback for
  one-frame events.
- Frozen: Owens ≤ 261, sat ≤ 375, toy ≤ 480 draws; fixed-pose tris ≤ 2.0 M,
  soak p95 ≤ 2.2 M; texture bytes ≤ 300 MB; `PERF_BUDGET.gpuFrameMs` 12;
  `BOOT.maxBootMs` and reveal timing may not lengthen; `WARP.flashMs` 250;
  `verify-monuments-sat` frozen unless C's sanctioned evolution; the R21
  quartet (stability 17 / flicker 7 / tier-step 10 / seam 13) green
  throughout; `verify-flicker` bound of 12 never moves (add the quiescence
  precondition instead — A7).
- Load-decided instruments get one quiet re-run then a CONTROL, never a new
  bound.

## §5 Waves and merge order

- **W0 (this commit):** protocol 17→18 lockstep; 26 `enabled:false` blocks;
  recon ledger; R21 records imported; archive refs pushed.
- **W1:** E fixture + shim + `FRAME_STATS` + user-diag pack; A vendor-verbatim
  merged on day 1; A–D implement behind flags in their worktrees; E calibrates
  every new gate RED on the flag-off tree.
- **W2 (integration, one reviewed merge each, E smoke after each):**
  E → A → B → C → D. Conflicts are constants-free by construction; FlyScene
  and world-bend hunks are arbitrated by Fable with the owner present.
- **W3 (certification):** fixture fleet here; the user runs the machine list;
  flag flips only on green; `FLY_ROUND24.md` record + `CLAUDE.md` notice;
  honest verdict with the "unmeasurable here" column.

## §6 User checkpoints (schedule, do not skip)

1. The user-diag pack on the R21 build FIRST (stalls/min, worst dt, which
   symptoms) — the round's RED.
2. Symptom list + machine facts (the §0 open questions).
3. Sub-native rungs: softer-under-load vs a tier hitch (`LADDER_FIX`).
4. LOD crossfade look (dither vs parent-texture blend) and skirt cliffs.
5. Linear haze + one sun: the noon and dusk horizon vs the R21 frames.
6. Shadows: catcher on, sparkle gone, floating fixed.
7. `SKY_PROCEDURAL` A/B PNGs (built-but-off).
8. Performance feel on the user's machine through all of the above — FIRST,
   not last (the R20 §6.15 lesson).

## §7 Not this round, and refuted theories

- **Not this round:** TAA/TAAU (ghosting on ~1,600 dead-reckoned aircraft +
  per-vertex bend; the venue cannot measure it); PBR buildings (fragment cost
  over downtowns unmeasured); N8AO/SSAO (four reversed-depth library defects,
  not present here); re-applying R22's TERRA_SHARP stack (z18 + demMaxZoom 16 +
  error table) before A's skirt work is measured at Powell (B1); NIGHT_CITY_R23.
- **Refuted, do not re-open cold (D1):** the DPR step causing the flash (0 pale
  in 112 forced steps + 70,285 live frames); a near-camera cloud billboard
  causing the flash (7/7 same-frame hide bisection). If a flash recurs after
  `FLASH_GUARD`: degenerate census at the other sites, in-page default
  framebuffer readback, drawRange bisection.
