# Round 13 — "Solid Ground": the big visual pass (satellite-first) — PLAN

> **Status: PLAN ONLY — no code changes yet.** This document was produced by a 4-agent
> visual review session (2026-07-19) whose environment could not reach the app's tile/data
> hosts (network policy). It is committed so a NEW session — in an environment with the
> allowlist below — can execute it. See §10 "How to resume".

## 1. Context & user decisions

The app is fly-only: a 3D mini-globe flight sim over live ADS-B traffic with two styles —
**satellite** (Esri imagery + DEM, app default, user's stated preference: "just looks and
functions better… contrails always look sharp, planes appear at right distances") and
**Neon/toy**. The ask: a purely visual big pass (shading, models, terrain depth, buildings,
lighting), perf-mindful, free assets allowed.

Four Fable review agents studied both modes (203 checked-in round screenshots in `scripts/`,
live boots of locally-rendered elements, full code review) — condensed reports in Appendix A.

**User decisions (2026-07-19 session):**
1. Scope: **satellite-first** (~85%); Neon gets only the cheap shader polish bundle (Phase 5).
2. **3D extruded buildings in satellite = the centerpiece** (Phase 3), flag-gated with a
   prototype sign-off checkpoint.
3. **Full look pass: adopt filmic tone mapping** (AgX vs ACES A/B) + satellite grade, with
   harness re-baseline (Phase 0).
4. Network allowlist will be widened by the user (new environment/session); domain list in §2.
5. Execution: implementation subagents = **Opus 4.8 at max effort**; **Fable 5 reviews and
   approves** each phase before it lands.

## 2. Prerequisite: environment network allowlist

The executing environment must allow (verify with curl before starting — expect non-000):
- **Runtime (required to render + run harnesses)**: `server.arcgisonline.com`,
  `elevation3d.arcgis.com`, `tiles.openfreemap.org`, `api.adsb.lol`, `opendata.adsb.fi`,
  `api.airplanes.live`, `api.adsbdb.com`, `opensky-network.org`
- **Assets (required to download)**: `polyhaven.com`, `dl.polyhaven.org`, `kenney.nl`,
  `poly.pizza`, `static.poly.pizza`, `opengameart.org`, `eoimages.gsfc.nasa.gov`,
  `raw.githubusercontent.com`

Configure in the Claude app: Code → Environments → (this environment) → Network access →
add domains. Docs: https://code.claude.com/docs/en/claude-code-on-the-web

## 3. Phase 0 — Look foundation: tone mapping + satellite grade

The app currently renders with **NO tone map**: `EffectComposer` sets `NoToneMapping` and
`Effects.jsx` never adds a `<ToneMapping>` effect — the shipped image is linear→sRGB, and
every color/luma calibration in the app assumes it.

- Add `<ToneMapping>` (from `@react-three/postprocessing`, already installed) as the FINAL
  child in `components/fly/Effects.jsx`. A/B **AgX vs ACES** with fixed-scene screenshot
  pairs (satellite noon + dusk over mountains and Manhattan; toy Midtown; boot pair). Pick
  per style if the two styles want different curves.
- Re-tune bloom threshold/intensity per style under the chosen curve (`SKY.bloomIntensity/
  bloomThreshold`, `TOY.*` in `lib/fly/fly-constants.js`).
- New **satellite grade block** in Effects.jsx (satellite currently gets NO grade; toy gets
  four passes): HueSaturation ~+0.08, BrightnessContrast ~+0.05, and a sun-frac-driven
  warm/cool shift reading `runtime.sun` (already published by FlyScene's day cycle).
- **Harness re-baseline sweep** — the gates expected to move: `verify-neon-city.js`
  warm-window luma band (40–140), `verify-window-grids.js` lit-pixel/luma gates,
  `verify-neon-alt.js` void-color `#04060d` ±24 match, `verify-rim.js` max-step, any
  screenshot-diff thresholds. Every moved number gets an inline comment citing Round 13.
- **USER CHECKPOINT #1**: live sign-off of the global look before later phases tune on top.

## 4. Phase 1 — Satellite atmosphere

- **Depth haze ON**: the `uHaze*` channel runs in every tile shader already and is hard-gated
  to `max 0` outside toy (`FlyScene.jsx:424`). Add a `SKY.haze` constants block + flip the
  gate. Haze color stays in the `#c6d7e8` rim family (rim-triple rule, fly-constants.js
  ~563-572). Re-check `verify-sat-depth`'s hillshade mean-Δ margin (haze dilutes it).
- **Altitude-aware fog**: density falls + color cools toward high-alt blue as AGL climbs
  (mirror of the toy R12 altHorizon thinking; satellite is `byStyle.satellite:false` today,
  fly-constants.js:634). Fixes the FL300 "wet mirror" horizon band
  (`scripts/edge-08-day-fl300.png`).
- **Time-of-day sky**: tint the SkyDome rimOnly band + fog + grade from `runtime.sun.frac`
  — SkyDome (`components/fly/SkyDome.jsx`) is a standalone bespoke ShaderMaterial OUTSIDE
  the world-bend cache-key registry, the safest shader in the codebase to extend. Add
  **Poly Haven 1K puresky HDRIs** (dawn/dusk/night, CC0, ~1MB each) crossfaded on discrete
  sun-frac transitions behind drei `<Environment>` — this also gives satellite a real night
  cheaply (Night style was retired in R7; nothing replaced it).
- **Cloud pass**: `CLOUDS.dayTint.warmBand` 0.45→~0.25 (live-caught salmon deck at sun frac
  0.55 — overlaps R11 §4 pending sign-off, surface to user); switch CloudField material
  MeshBasic→MeshLambert so the existing sun/hemi/env light the deck for real (simplify the
  R11 sunTint to avoid double-apply; update the `verify-round11` cloudTint probe); add one
  CC0 cloud sprite variant (+1 draw); per-puff Y-flatten for cumulus bases; bias cluster
  placement below the player at cruise.

## 5. Phase 2 — Aircraft presence (style-agnostic)

All four review agents: the hero jet is the flattest object on screen in BOTH styles.

- **Player hull**: material grade via the existing canopy clone-swap path
  (`components/fly/PlayerPlane.jsx:77-97`) — clearcoat/lower roughness + fresnel rim keyed
  per style (sun-white satellite, moon-cool toy); TRUE emissive nav/strobe on the model
  (traffic got baked `aEmissive` navs in R8, the player never did); throttle-driven
  afterburner cone (2-tone toon flame under bloom, ~1 draw).
- **Ground contact**: flip the EXISTING player-following ortho shadow rig on for satellite
  at low AGL (rig/tier/map-size plumbing exists in FlyScene.jsx:704-798, toy-only today);
  hide above ~2km AGL. **Keep the 800m radius — larger shadows are a hard NO** (the shadow
  path runs on the UNBENT world; divergence grows quadratically past ~1km). Shadow pass ≈
  +50 draws vs satellite's 350/375 gates — measure first; if it doesn't fit, ship only a
  1-draw contact blob reusing the cloud-shadow disc pool, or renegotiate the gate
  deliberately with a precedent note.
- **Traffic**: brightness floor over dark ground (existing per-instance tint channels in
  TrafficLayer); far-LOD billboards (untextured 1×1 quads today, TrafficLayer.jsx:65-80)
  get a silhouette/soft-glow sprite texture — same instanced draw; contrail altitude-scaled
  width/opacity + twin per-engine ribbons (`CONTRAIL` constants + emitter tweak).
- **Bug re-check**: during the review, no player contrail appeared in a 6s BOOST at 455kt
  (SwiftShader/LOW-tier session — may not reproduce on GPU). R6 contract says contrails
  backfill instantly. Verify on real GPU; fix if real.

## 6. Phase 3 — CENTERPIECE: 3D extruded buildings in satellite

Cities in satellite are flat photo-decals at exactly the altitudes the user flies
(`scripts/userrepro-runA-sat.png`, `warp-03-sat-tokyo.png`; only ~63 monument archetypes
exist). The toy vector worker already fetches OpenFreeMap building polygons WITH heights,
tessellates, extrudes, and roofs them — satellite simply never mounts that layer
(FlyScene.jsx gates ToyWorldLayer to toy). **Zero new assets or network sources needed.**

- New satellite building layer fed by the existing worker
  (`lib/fly/toy-world/vector-tile.worker.js`): building geometry only (no roads/landuse/neon
  attributes), neutral photo-matched materials — concrete/glass tones, sun-side shading via
  a hillshade-style `dot(normal, sunDir)` using the live hillshade sun uniform.
- Buildings sit on DEM-draped ground (reuse the monument ground-anchor pattern from
  LandmarkMonuments/R11).
- Scope: small streaming ring (~z14-class) around the player; tier-gated (high/medium);
  behind a `SAT_BUILDINGS.enabled` constants flag (byte-noop when off).
- Rigid geometry ⇒ **anchor bend variant** (`applyBendAnchor` family — per-vertex bend
  shears rigid objects, R6 lesson) with a NEW `customProgramCacheKey`. Worker changes bump
  `WORKER_PROTOCOL` 9→10 with sentinel-safe attribute fallbacks.
- Perf: worker-merged geometry, target ≤ a handful of draws; must fit `verify-sat-depth`'s
  ≤375 low-AGL gate or move it deliberately. Watch: hillshade + baked imagery shadows
  double-sun (cap shading ~0.6); terrain LOD seam cliffs get MORE visible near buildings —
  budget `LODThreshold` tuning time.
- NEW harness `scripts/verify-sat-buildings.js`: mounts in satellite, bounded draw delta,
  byte-noop when flag off, zero pageerrors, A/B screenshots (Manhattan 2.6k ft, Tokyo warp).
- **USER CHECKPOINT #2**: prototype flight + sign-off before default-on.

## 7. Phase 4 — Low-AGL ground detail + water + monuments

- **Procedural micro-detail overlay** in the tile fragment patch: high-frequency noise/normal
  perturbation fading in under ~1,500m AGL — breaks the "photo taped to a table" read of
  `scripts/satdepth-04-valley-low.png` (z16 mush). Wraps the `world-bend-fade-hill-r8`
  chain; key bump to `-r13`. Optionally sourced from a Poly Haven 1K aerial detail texture.
- **Hillshade v2**: cheap DEM ambient-occlusion term (valley darkening from normal.y) +
  slope-based saturation nudge, same fragment patch/keys, `strengthByTier` gated.
- **Water**: satellite glint overlay on worker-extracted water polygons (specular-only
  transparent material, anchored bend, strict tier gate, budget-checked vs the 375 gate)
  using three.js `waternormals.jpg` (MIT, downscaled 512).
- **Monuments satStyle**: two-tone ramp or baked vertex AO + stronger halo (flat Lambert
  `#cfc8ba` is nearly invisible today — `monuments-sat-01-redeemer-gl.png`). Overlaps R11 §4
  pending sign-off — tune WITH the user.
- **POI letters**: multiply letter opacity by the existing horizonFade/fog family in
  satellite (full-contrast white text currently punches through haze like a UI sticker).

## 8. Phase 5 — Neon polish bundle (cheap only; no new systems)

Gate: close the pending R12 §7 and R10 §4 live-tune tables WITH the user in the same
session — do not silently retune knobs the user is mid-review on.

- Jet presence arrives free from Phase 2.
- Roof CONTENT (3rd recurrence of "hollow rooftops"): worker-baked dim skylight grids /
  helipad glyphs, or an up-normal cap-plate branch with a luminance floor via the crownFloor
  pattern — key bump `world-bend-fade-beacon-grid-r8b` → `-r13`.
- Water moonlight streak aligned to `TOY.moonDirection` (foam/land material fragment).
- Toy-only toon cloud sprite (2–3-step shading to match the ramp aesthetic; same pool).
- Monument floodlight vertex bake (bottom-up gradient) + soft radial-gradient halo texture
  (replaces the crude flat blue puddle disc).
- Moon disc billboard on `TOY.moonDirection` + star size/brightness variation (SkyDome).
- TownGlow warm cores (clear bloom threshold at dome centers) — inside R12 §7 knob scope.
- Constraints: verify-neon-alt byte-identical spawn gate (band 14000/26000, grid alpha
  0.42) must hold; verify-neon-city lit-pixel ≤14%; verify-rim toy maxStep 6. Palette is
  taste-locked (R2 synthwave rejection): value/warmth moves only, NO hue moves.
- **USER CHECKPOINT #3**: R12 §7 + R10 §4 sign-off tables closed together with this bundle.

## 9. Assets to add (manifest-first: `lib/fly/assets.js` entry → `node scripts/gen-credits.mjs`)

- Poly Haven 1K puresky HDRIs: `qwantani_dawn_puresky`, `qwantani_dusk_1_puresky`,
  `qwantani_night_puresky` (CC0, ~1MB each) — Phase 1.
- 1 aerial terrain detail texture: Poly Haven `aerial_grass_rock` 1K (CC0) — Phase 4.
- three.js `waternormals.jpg` (MIT — same license as repo; downscale to 512) — Phase 4.
- 1 extra cloud sprite sheet (Kenney Particle Pack or OpenGameArt, CC0) + 1 toy toon puff.
- Blue-noise PNG (momentsingraphics.de, CC0) for SkyDome gradient dithering.
- **NO new building assets** (vector pipeline covers it) and **NO new aircraft GLBs**
  (flatness is a lighting problem, not mesh quality).
- NASA Black Marble night-lights: **deferred** — belongs to a future "night convergence"
  round (Neon emissive machinery over dimmed satellite imagery), noted as stretch.

## 10. How to resume (for the executing session)

1. Confirm the branch: `claude/visual-enhancement-review-nmciyp` (this file is its first
   commit). Read CLAUDE.md's round notices + FLY_ROUND11/12 before touching anything.
2. Curl-check every §2 runtime domain (expect HTTP codes, not 000). If blocked, STOP and
   tell the user — nothing visual can be verified without them.
3. `npm install`; `npm run dev`; boot both styles via `scripts/_boot.js` contract
   (`window.__flyBoot.pct === 100`); confirm tiles + traffic actually stream.
4. Execute phases IN ORDER (tone curve first so everything is tuned once, under it).
   Orchestrate with Workflow: **implementation agents Opus 4.8 `effort:'max'`; Fable 5
   reviews each phase's diff + harness results and approves before commit** — findings loop
   back to the implementer until clean. Commit per phase; push after approval. No PR unless
   the user asks. Tag `round13-pre` before Phase 0 lands.
5. Never run harnesses while the user live-tests (R7 lesson). Watch for stale tabs across
   dev-server restarts.
6. Write FLY_ROUND13.md as the record (with the three user checkpoint tables) and update
   CLAUDE.md's notice block at round end.

## 11. Constraints checklist (implementers MUST honor)

- **Cache-key discipline**: any generated-GLSL change bumps the FINAL
  `customProgramCacheKey` of every variant it reaches (R8 `-r8` sweep pattern; registry in
  `lib/fly/toy-world/world-bend.js` header). Building/land wrap ORDER is load-bearing
  (facade grid reads the beacon layer's `uBeaconT`).
- **GPU/CPU mirror rule**: air-bend/band changes update `airDrop()` / `getEdgeFade()`
  consumers identically; never re-derive from constants (R12 lesson).
- **Rim triple**: fog color = `GLOBE.rim` = edge-fade target move together, per style.
- No store writes inside React updaters; per-frame state on `runtime` + uniforms; placement
  recompute on 2s cadences; composer passes COUNT in `__flyStats.drawCalls`.
- **Budgets**: toy ≤480 draws, satellite ≤350 (375 low-AGL), tris 2.2M, `CANVAS.dprMax`
  1.5, aniso ≥4, satMaxZoom 16, gpuFrameMs 12. Tier-gate every new cost (`byTier`/
  `minTier` patterns). Full harness-gate table: Appendix B.
- Store literal `mapStyle:'toy'` is sacred (harness seeding); the satellite default lives
  in `lib/fly/map-style.js` — don't "fix" the literal.
- NO API keys, no r3f-perf, self-hosted assets only; CC-BY ⇒ credits UI mandatory.
- Depth-reading post effects beyond ToneMapping (N8AO/GodRays experiments — both already
  installed/available) need ONE live check vs `reversedDepthBuffer:true` first; deferred
  this round.

## 12. Verification

1. Per phase: relevant harness set green — verify-sat-depth, verify-round11, verify-rim,
   verify-edge-fx, verify-neon-city, verify-neon-alt, verify-monuments, verify-monuments-sat,
   verify-poi, verify-fleet, verify-boot, smoke-r9-2 — with any re-baselined gates
   documented inline; `npm run lint`.
2. New: `verify-sat-buildings.js` (Phase 3). A/B screenshot pairs at fixed scenes for
   Phases 0/1/3/4, checked into `scripts/` per house convention.
3. `soak-fly.js` once after Phase 3 and once at round end (renegotiate its stale budgets vs
   `PERF_BUDGET` first — its numbers predate R7).
4. End-to-end: fly the two certified "before" scenes — `satdepth-04` valley-low and
   Manhattan 2.6k ft — and compare against the checked-in screenshots.

---

# Appendix A — condensed review-agent reports (2026-07-19)

## A1. Satellite flight review (12 ranked gaps)
1. **Low-altitude ground flatness** — z16 photo-carpet cities, no parallax where the user
   flies. Cheap: procedural micro-detail under ~1500m AGL; expensive/highest-win: mount toy
   building extrusions in satellite (→ Phase 3).
2. **Static noon sky** — day cycle only scales intensities; golden hour doesn't exist (→ P1).
3. **Cruise horizon murk** — "wet mirror" band from HDRI cloud band + constant fogExp2 +
   dome band stacking (→ P1 altitude-aware fog + haze).
4. **Cloud popcorn + salmon dayTint at sun frac .55** (live-caught) (→ P1).
5. **No shadows / plastic models** — nothing casts shadows in satellite; jet is flat gray
   with zero specular (→ P2).
6. **No satellite color grade** — Effects.jsx gates all grading to toy (→ P0).
7. Hillshade is the terrain's only shading channel — add DEM AO + slope saturation (→ P4).
8. **Dead water** — rivers/harbors read as concrete (→ P4 glint overlay).
9. Far traffic = colored squares (untextured billboards) (→ P2 sprite).
10. Monuments read as untextured clay, nearly invisible (satStyle Lambert) (→ P4).
11. Player contrail near-invisible at cruise (2.2m ribbon @ 0.55 opacity) (→ P2).
12. POI letters ignore atmosphere — UI-sticker punch-through (→ P4 fade).
Risks: sat draw gates 350/375; z16 + aniso≥4 gates; R11 §4 sign-offs pending (don't
silently retune); hillshade vs baked imagery shadows (double-sun past ~0.6); LOD seam
cliffs become MORE visible with low-alt polish.

## A2. Neon flight review
Verdict: at its best (Midtown facades 1,200 ft) it works; overall reads "luminous
circuit-board map, not electric night city" — roads outshine buildings, rooftops hollow at
1,100 ft (3rd recurrence), suburbs collapse to lines-on-ink, R12 cruise planet has geography
but no LIGHT (TownGlow sub-bloom), water dead black, clouds read as smudge artifacts,
monuments dark stacks over crude halo puddles, sky has no moon. **#1 Neon gap is
style-agnostic: the player jet** (matte silhouette, no engine glow at BOOST, no on-model nav
lights). Investment rec: tilt heavily satellite; Neon gets the free/cheap bundle (→ Phase 5);
hold procedural suburb lot-fill unless the user asks; Neon's worker pipeline is the reusable
asset for satellite buildings. Live find: possible missing player contrail during BOOST
(SwiftShader/LOW-tier session) — re-check on GPU (→ P2).

## A3. Rendering architecture + perf budgets
- **No filmic tone mapping anywhere**: composer sets `NoToneMapping`; nothing re-adds it.
  Biggest look lever; recalibrates every luma-based gate (→ Phase 0).
- **Nearly-free wins already plumbed**: satellite aerial haze (`uHaze*` in every tile shader,
  gated to 0); SkyDome outside the cache-key registry; time-of-day window density = uniform
  writes; traffic hull roughness/metalness are inline literals (TrafficLayer.jsx:44-47).
- **Cheap adds available**: `n8ao@1.9.4` already in node_modules; GodRays/LensFlare shipped
  + unused with `SKY.sunDirection` HDRI-aligned and `runtime.sun` published; clouds are
  UNLIT MeshBasic → Lambert is one prop; emissive floor for lit windows via crownFloor
  pattern; hillshade v2 slope/altitude tint.
- **Light rig minimal**: 1 hemi + 1 directional + one 2K noon HDRI (env light in ALL styles,
  visible sky in satellite; no dusk/night variant). Satellite: zero cast shadows. Toy: 800m
  ortho shadow rig, ≈+50 draws, high/medium tiers.
- **Hard NOs**: large/cascaded shadow maps do NOT survive world-bend (shadow path runs on
  the unbent world; divergence quadratic past ~1km — keep 800m). Depth-reading post effects
  need one live check vs `reversedDepthBuffer:true`. New rigid instanced objects must use
  anchor bend variants.
- 15-item costed upgrade menu + full budget table produced (key numbers → Appendix B).

## A4. Comparative immersion + free assets
- **User pattern (R2→R12 doc-mined)**: (1) spatial coherence above all ("buried planes" =
  most-repeated complaint class); (2) effect continuity — intermittent is worse than none
  (contrails); (3) density — emptiness draws the harshest words ("dull and boring", "graph
  paper"); (4) photographic world = reference reality; stylized exaggeration ON it is
  welcomed (approved farLiftBoost 2.5). User signs off by flying, not tuning: five rounds of
  sign-off checklists remain pending.
- **Why satellite wins the A/B**: continuous texture frequency; baked-in depth cues;
  contrail figure-ground (emissive ribbons over mid-tone ground vs Neon where everything
  emits); scale anchoring + horizonFade against visible ground. Neon's keepers: identity/
  mood, letters, monument glow, calm HUD floor, only true night.
- **Ranked cross-mode gaps**: 1) satellite 3D buildings via existing vector worker (zero new
  assets); 2) aircraft presence/lighting; 3) satellite aerial perspective; 4) low-AGL detail
  texture + water normals; 5) night convergence (deferred stretch).
- **Assets**: Poly Haven 1K HDRIs = cheapest lighting-richness buy; Kenney kits CC0 for
  airport clutter ONLY (never city fill on imagery — footprint mismatch reads fake);
  keep existing aircraft GLBs; ambientcg.com bot-protects fetches (fallback only);
  full domain allowlist → §2.

# Appendix B — harness-enforced budget table (key gates)

| Gate | Value | Where |
|---|---|---|
| Toy draw calls | ≤ 480 (PERF_BUDGET 470 + composer slack) | verify-neon-city/edge-fx/rim/monuments/window-grids/roofs/neon-alt/round11 |
| Satellite draw calls | ≤ 350; ≤ 375 low-AGL | verify-rim/edge-fx/freelook/style-retire; verify-sat-depth:151 |
| Monument layer | Δdraws ∈ [1,15] | verify-monuments:242, verify-monuments-sat:192 |
| Anisotropy | tile texture ≥ 4 | verify-sat-depth:123-134 |
| satMaxZoom | z16 request observed (no z17) | verify-sat-depth:57/147 |
| Hillshade A/B | mean per-pixel Δ > 2/255 on toggle | verify-sat-depth:104-121 |
| Neon-alt spawn invariant | band EXACTLY 14000/26000, grid α 0.42, ultra 0 | verify-neon-alt gate A |
| Neon-alt cruise | band end 70–110km, ultraReady ≥8, void-pixel <25% crop | verify-neon-alt:113-155 |
| Window grids | ≥300 warm-lit px (R>B+15, luma 40–140), row-cluster ≥3 | verify-window-grids:8-20 |
| Rim smoothness | strip max color step ≤ per-style MAX_STEP (toy 6) | verify-rim:126-133 |
| Constants | 470/350 draws, 2.2M tris, 300MB tex, gpuFrameMs 12, dprMax 1.5 | fly-constants.js PERF_BUDGET/CANVAS |

Note: FlyScene accumulates `gl.info` across composer passes — every added post effect eats
into the same draw gates.
