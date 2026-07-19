# Fly Round 13 — "Solid Ground" (2026-07-19)

The plan-driven big visual pass ([FLY_ROUND13_PLAN.md](FLY_ROUND13_PLAN.md), executed same-day
in a network-open environment): satellite-first (~85%), Neon gets the cheap §8 bundle. Five
Opus 4.8 implementation agents built Phases 0–5 in order; the Fable orchestrator reviewed every
diff against §11, re-ran gate harnesses independently, and committed per phase. Two live bugs
the user caught mid-round were root-caused and fixed by the orchestrator (§7). Every phase
landed with **zero harness gate re-baselines** — all 30+ gate values that existed at
`round13-pre` still hold as written.

Commits: P0 `b18c92c` · P1 `d72adb1` · P2 `701330e` · P3+bootfix `3110498` · P4+cloudfix
`825a283` · P5 (this commit). Tag `round13-pre` = the pre-round tree.

## 1. Phase 0 — Look foundation: ACES tone mapping + satellite grade

- The app had NO tone map (composer forced NoToneMapping). Now: `<ToneMapping>` as the FINAL
  composer child, mode per style in `SKY.toneMapping.byStyle`. **A/B verdict (18 captures,
  `scripts/r13-tonemap-*`): ACES both styles.** AgX numerically killed clipping but visibly
  fogged both styles (built for scene-referred HDR; this app is display-referred LDR imagery +
  a curated ink palette). ACES recovered the blown Sierra snow (clip 11%→0) and left Neon
  essentially identical with slightly deeper blacks. `'None'` restores the pre-R13 baseline.
- Satellite's first grade: `SKY.grade` (HueSaturation +0.08, BrightnessContrast +0.05) + a
  sun-frac white balance ([WhiteBalance.js](components/fly/WhiteBalance.js) — merges into the
  EffectPass, uniform mutated in place on a 5s cadence; golden-warm → noon-neutral → night-cool).
- Bloom evaluated under ACES and deliberately UNCHANGED (all luma gates held with headroom).
- Draws: tone map = the only +1; grade merges. All scenes far inside gates.

## 2. Phase 1 — Satellite atmosphere

- **Aerial haze ON** (`SKY.haze` 16–55km max 0.5) — pure uniform flip of the always-compiled
  uHaze channel; zero cache-key moves. Hillshade A/B margin stayed ~18–20/255 (gate >2).
- **`SKY.altAtmo` = the rim triple's single source**: time-of-day keyframes (deep night →
  twilight → golden → certified-day `#c6d7e8`) × an expApproach-smoothed altitude cool-shift
  drive scene fog color, the tile edge-fade/haze target (new raw setters `setEdgeFadeRGB`/
  `setDepthHazeRGB`) and the SkyDome band (`setSkyAtmo`) from ONE interpolation per frame.
  Fog density falls 7.5e-6 → 3e-6 with altitude. **The FL300 "wet mirror" is dead**
  (`r13-atmo-sat-fl300-nj.png` vs pre-R13 `edge-08-day-fl300.png`). Low-AGL day output is
  byte-identical round-11 (`#c6d7e8`/7.5e-6 verified live); `GLOBE.rim.satellite` is now the
  boot fallback and equals the day keyframe exactly.
- `WORLD_EDGE.altHorizon.byStyle.satellite` → true, but satellite takes its OWN branch in the
  −50 writer (static 60/120km band; only color/haze/density live). The toy R12 branch is
  verbatim-unchanged.
- **Time-of-day HDRI sky** (`SKY.hdriCycle`): dawn/dusk/night qwantani 1K pureskies (CC0,
  manifested) behind a bucket-keyed `<Environment>`, swapped on discrete sun-frac crossings
  (5s poll; dawn/dusk split on az) with per-bucket env/bg intensities (night 0.16/0.26 — the
  moonlit HDRI is HDR-bright and read as overcast at full). **Satellite's first real night
  since the Night style retired in R7.** Swap cost: one-frame rAF gap 22–68ms on rare
  crossings; no prewarm (warps are masked by the R6 cinematic). Toy: unconditional noon HDRI.
- **Cloud pass**: the satellite deck is LIT (MeshLambert + Kenney `cloud-cumulus.png`, flat
  bases via `boundsYFrac 0.18`), `dayTint` reworked to a subtle chromatic bias
  (`warmBand 0.45→0.25` — kills the live-caught salmon deck; ⚠ overlaps the R11 §4 pending
  `dayTint` sign-off, see §8), and an AGL-keyed spread (`altSpread.sat*`) so at cruise the
  deck reads as weather below you. Toy clouds pixel-stable this phase.

## 3. Phase 2 — Aircraft presence (style-agnostic)

All four plan review agents called the hero jet the flattest object on screen; fixed:

- **`PLAYER.hull`**: every hull material regraded to clearcoat MeshPhysical + per-style
  fresnel rim (satellite sun-white 0.4, toy moon-cool `#bcd4ff` 1.25; own cache key
  `player-hull-rim`, plane-local, no world-bend). Canopy keeps the R8 glossy swap, glassier.
- **`PLAYER.navLights`**: double-flash tail/wingtip strobes + belly beacon ember on the
  existing +1 additive Points draw; per-style emit clears each style's bloom threshold.
- **`PLAYER.afterburner`**: throttle-driven 2-tone toon flame (blue-white core + orange
  sheath, 34Hz flicker), +2 draws only when lit — BOOST finally looks like BOOST (Neon's #1
  review gap).
- **Ground contact — deliberate deviation (orchestrator-approved)**: shipped the 1-draw
  [PlayerGroundShadow](components/fly/PlayerGroundShadow.jsx) contact blob for satellite, NOT
  the ortho rig. Draws would have fit (246/375 measured) but the rig requires
  `receiveShadow` on every streaming tile — a whole-terrain fill-rate cost invisible to the
  draw gate, in the perf-sensitive default style (the exact R11 lag class). The rig remains a
  documented follow-up. Toy gained the hero's true cast shadow free (`castShadow` on the
  clone; its receiver already exists).
- **Traffic**: `hullPresence` brightness floor over dark ground (existing instanceColor
  channel; satellite daylight byte-identical), procedural soft-glow billboard sprite on the
  same far-LOD instanced draw (no more colored squares).
- **Contrails**: altitude-scaled width/opacity (`CONTRAIL.altScale` — thin near minAlt, wide
  and sharp at cruise) + TWIN per-engine ribbons (±1.7m, 1→2 draws, shared material, all
  three R6 ribbon protections per-ribbon, `applyBendAir` kept).
- **Moonlit night key** (P1 handoff): `SKY.hdriCycle.keyColor/hemiSky` cool the directional +
  hemi COLOR per bucket (night `#9bb4e6`/`#5a6f9e`) — color only; verify-sun's intensity
  gates untouched (2.20/0.77).
- **BOOST contrail bug (plan §5): NOT reproduced on real GPU** (contrailPts 44→320 across a
  6s boost) — the review sighting was SwiftShader-only.

## 4. Phase 3 — CENTERPIECE: 3D extruded buildings in satellite

The toy worker already extrudes OpenFreeMap footprints with heights; satellite now mounts a
lean buildings-only layer. Zero new assets or network sources.

- Worker `detail: 'sat-buildings'` (**WORKER_PROTOCOL 9→10**, stale-safe: a protocol-9 worker
  returns no `satBuilding` key → engine renders nothing + dev warn-once). Building
  tessellation/extrusion/roofs only — no roads/landuse/neon attributes; neutral hash-varied
  concrete/tan vertex tones; the R8 synthetic `render_height: 5` trap handled.
- **[SatBuildingEngine](lib/fly/toy-world/sat-building-engine.js)** (purpose-built lean
  streamer — NOT ToyWorldEngine, so `__toyWorld` is never defined in satellite and
  verify-round11 gate A holds) + [SatBuildingLayer](components/fly/SatBuildingLayer.jsx)
  (own worker instance, dev global `__satBuildings`). Single z14 ring r=3600u, `maxChunks 12`
  (nearest-win → bounded draws over any density), 2s/600m cadence, **altitude hysteresis
  2200/2800m AGL** (zero building draws at cruise), per-building raw-DEM centroid drape
  (an earlier per-chunk grid drape floated SF hills by 24m and was replaced; `demZ ≥ 12`
  gate; post-warp fast-accept window so destinations pop in).
- **New bend variant `world-bend-anchor-satbldg`**: per-vertex FOOTPRINT-CENTROID attribute
  (`aBendAnchor`) drops each building rigidly inside ONE merged chunk mesh — the R6 shear
  lesson solved without instancing. Reaches no other variant.
- **Shading — deliberate deviation (orchestrator-approved)**: MeshLambert + DoubleSide under
  the single scene sun instead of the plan's `dot(normal, uHillDir)` term — the worker's ring
  winding can't guarantee outward normals (DoubleSide flips via gl_FrontFacing), and a single
  sun means no double-sun over the baked imagery by construction. Trade: building faces don't
  track the AM→PM hillshade direction (static `mood.lightDir`) — minor, monuments behave the
  same.
- `SAT_BUILDINGS.enabled: true` shipped (tier ≥ medium); **`enabled: false` is the one-line
  byte-noop revert** — USER CHECKPOINT #2 (§8).
- **NEW harness [verify-sat-buildings.js](scripts/verify-sat-buildings.js)**: Manhattan
  2.6k ft **235 total draws** (building Δ5 over a 230 control; gate 375), Tokyo 225, cruise
  eviction, SF raw-DEM base gate (89 = DEM 95 − sink 6), flag-off byte-noop, gate A, zero
  errors.

## 5. Phase 4 — Low-AGL ground detail + water + monuments + letters

- **Micro-detail**: procedural 2-octave value-noise luma grain (±0.1) in the tile fragment
  patch, fading in below 1,500m AGL and gone by 2,500m; satellite-only, tier-gated; dev
  `__flyMicroOverride` for A/B. Noise over the staged grass/rock texture on purpose — tiling
  grass over real Manhattan imagery is the A4 "footprint mismatch reads fake" trap.
  **The ONLY existing cache key that moved: `world-bend-fade-hill-r8` → `-r13`** (reaches
  satellite AND toy tile programs; toy pixel-stable via zero-strength uniforms — neon suite
  green with zero gate edits). A/B: `r13-ground-microdetail-off/on.png`.
- **Hillshade v2** in the same patch/keys: slope AO (`aoByTier` .34/.28/.14) + slope
  saturation (`satByTier` .22/.18/0), both inside the `uHillStrength` envelope so the
  harness strength-0 A/B captures them. sat-depth margin 17.95–20/255 (gate >2).
- **Water glint**: worker `satWater` output (**WORKER_PROTOCOL 10→11**, stale-safe),
  SatBuildingEngine extension (same ring/tile fetch — no third engine), specular-only
  additive MeshPhong + scrolled 512px `waternormals.jpg` (MIT, manifested), high tier only.
  New key `world-bend-water-satglint-r13`; per-vertex bend (water follows the curve — an
  anchored bend would float a harbor's edges; documented deviation from the plan wording).
  Manhattan incl. water: 235 draws. Note: OpenFreeMap 404s open-bay tiles — glint appears on
  coastline/harbor/river tiles only.
- **Monuments satStyle v2**: MeshToon 3-step stone ramp on `#d7d0c2` + warm halo
  (`#ffe9c8`, 0.16) — form instead of the invisible flat Lambert. ⚠ Overlaps R11 §4 pending
  sign-off (§8).
- **POI letters**: satellite `fillOpacity × hazeCover × horizonRamp` — far names recede into
  the same haze the tiles get instead of punching through like UI stickers. Toy untouched;
  verify-poi green.

## 6. Phase 5 — Neon polish bundle (cheap only)

Implemented per §8 with the hard framing: **no R12 §7 / R10 §4 knob values were touched** —
everything is NEW additive constants, closed together with those tables at Checkpoint #3.
Taste lock honored: value/warmth moves only, zero hue moves.

- **Roof content** (3rd recurrence of "hollow rooftops"): skylight-lattice/luminance-floor
  branch in the building roof shading (`ROOF_CONTENT` — cell 6.5m, boost 0.5, floor 0.22);
  key bump `world-bend-fade-beacon-grid-r8b` → `-r13`. Roof-variance probe jumped to ~771
  (was ~flat), walls unchanged.
- **Water moonglade**: `WATER_MOON` streak aligned to `TOY.moonDirection` in the foam/water
  fragment (value-only shimmer); key bump `world-bend-fade-foam-r8` → `-r13`.
- **Toy toon cloud puff**: first-party procedural 512px 2–3-step silhouette
  (`public/textures/cloud-toon.png`, generator checked in as
  `scripts/gen-toon-cloud.mjs`, CC0, manifested). Same Clouds pool; night keeps `cloud.png`.
- **Monument floodlight** (`LANDMARKS_3D.floodlight` base 1.35 → top 0.82 vertex gradient) +
  soft radial-gradient halo texture replacing the flat blue puddle disc (`toyHalo`).
- **Moon disc + star variation** (SkyDome — outside the cache-key registry): `MOON` disc on
  `TOY.moonDirection` with soft halo; per-star size/brightness variation, still under bloom.
- **TownGlow warm cores** (`TOWN_CORES` — additive warm off-white core at each dome center,
  radiusFrac 0.34, opacity 0.6, tier ≥ medium, +1 instanced draw, parked when off). Inside
  R12 §7 SCOPE but implemented as new knobs only — close together at Checkpoint #3.
- The Phase-5 implementation agent hit the account session limit mid-verification; the
  orchestrator completed the review (cache-key sweep, constants audit, taste-lock check) and
  ran the full verification sweep below.

## 7. Live-caught fixes (user reports during the round)

1. **"Night at noon" boot** (satellite booted dark-blue/night at an Ohio afternoon; toggling
   styles fixed it): the frame loop can tick before React flushes the spawn-placement effect,
   publishing `runtime.geo` from the UNPLACED aircraft at the world origin — the day cycle's
   first run read lon 0 ("null island"), night UTC-wise, and stamped `sun.frac ≈ 0`; every
   R13 night consumer faithfully rendered night until the 60s cadence tick or a style
   toggle/warp re-ran it. Pre-R13 the same latch only dimmed intensity through the 0.35 floor
   — **satellite's new real night made a years-old race visible**. Fix: `spawnPlacedRef`
   gates the frame-loop geo publisher; the day cycle's `?? spawn.lon` fallback now wins at
   boot. Regression gate added to verify-boot (sun-at-spawn: reported sunFactor must match
   the value recomputed from the persisted lon — passed 0.951/0.951).
2. **Cloud deck whipping back and forth ~20s after a warp at ~14.5k ft (satellite)**: the P1
   `altSpread` satellite factor was a RAW per-frame function of `pos.y`, and cluster centers
   MULTIPLY by it — the post-warp flight-model altitude settle oscillated the whole deck at
   km scale (amplified by up to ±cell/2 ≈ 12km). Toy was immune because its input (the band
   end) is already damped in FlyScene. Fix: `altSpread.satSmoothSec 1.5` expApproach damping
   in CloudField; steady-state exact, so the certified low-AGL deck is bit-identical.
3. **Mid-edit HMR regression** ("toy clouds on the ground; satellite clouds grey, popping in
   and out"): the user flew while the Phase-5 agent was mid-implementation — constants
   referenced `cloud-toon.png` before the file was generated, and each `fly-constants.js`
   save HMR-invalidated the whole cloud stack live. No code defect: once the tree settled,
   verify-neon-city / verify-round11 (incl. the cloud ground-clearance gate, minAgl 1560m)
   passed unchanged. Process lesson → §10.

## 8. USER CHECKPOINT TABLES — ALL PENDING USER SIGN-OFF

### Checkpoint #1 — the global look (Phases 0/1/2, live-tunable)
| Knob | Default | Question for the eyeball |
| --- | --- | --- |
| `SKY.toneMapping.byStyle` | ACES/ACES | Filmic feel right in both styles? (`'None'` = pre-R13) |
| `SKY.grade.saturation` | 0.08 | Noon blue-sky punch (reads a touch paler under ACES than the old clipped look — this is the compensator) |
| `SKY.grade.goldenFrac/warm/cool` | 0.32 / warm / cool | Golden-hour warmth + night coolness timing |
| `SKY.haze.startM/endM/max` | 16k/55k/0.5 | Aerial perspective depth without mush |
| `SKY.altAtmo.tod` keyframes | see block | Dawn/twilight/golden rim colors |
| `SKY.altAtmo.fogDensityHigh` | 3e-6 | FL300 horizon: haze, not murk, not naked |
| `SKY.hdriCycle.intensity.night` | 0.16/0.26 | Night dark enough / too dark? |
| `SKY.hdriCycle.keyColor.night` | `#9bb4e6` | Moonlit ground hue |
| `CLOUDS.dayTint.*` | reworked (bias) | ⚠ CLOSES the R11 §4 pending `dayTint` row — salmon deck gone, golden hour still warm? |
| `CLOUDS.byStyle.satellite.lit/boundsYFrac` | true / 0.18 | Lit deck reads real? (`lit:false` = one-line revert) |
| `CLOUDS.altSpread.sat*` | 4000/4000/1.5s | Cruise deck-below feel + no whip after warps |
| `PLAYER.hull.*` | see block | Noon hull possibly too chromey (roughness/envMapIntensity) |
| `PLAYER.navLights/afterburner` | see blocks | Strobe cadence, flame size/colors |
| `PLAYER.groundShadow` | blob 26m/0.34 | Contact read OK? (true ortho rig = documented follow-up) |
| `TRAFFIC.hullPresence` | 1.75/1.55 | Dark-ground traffic never black, day untouched |
| `CONTRAIL.altScale/twin` | see block | Cruise contrails sharp; twin ribbons read as engines |

### Checkpoint #2 — satellite buildings prototype (fly it before it counts as default-on)
| Knob | Default | Question for the eyeball |
| --- | --- | --- |
| `SAT_BUILDINGS.enabled` | **true** (shipped for THIS prototype flight; `false` = full byte-noop revert) | Keep? |
| `SAT_BUILDINGS.wallTones` | 6 neutral grays | **Primary knob — reads slightly dark/charcoal vs the bright imagery** |
| `SAT_BUILDINGS.ring.r / maxChunks` | 3600u / 12 | Enough city? (draw headroom exists: 235/375 Manhattan) |
| `SAT_BUILDINGS.cullAglOnM/OffM` | 2200/2800 | Fade-out altitude feels right? (hard cull, no opacity fade — refinement candidate) |
| `SAT_BUILDINGS.minH/baseSinkM` | 6/6 | Low-rise presence vs slope gaps |
| `HILLSHADE.aoByTier/satByTier` | .34/.22 (high) | Mountain relief possibly too strong |
| `HILLSHADE.micro.*` | ±0.1 <1.5km | Low-AGL grain: texture or noise-fuzz? |
| `SAT_WATER` | high tier | Glint read (coastline tiles only — OFM gap on open bays) |
| `LANDMARKS_3D.satStyle` ramp/halo | 3-step / 0.16 warm | ⚠ CLOSES the R11 §4 pending `satStyle` row |

### Checkpoint #3 — Neon bundle (+ CLOSE the R12 §7 and R10 §4 tables in the same session)
| Knob | Default | Question for the eyeball |
| --- | --- | --- |
| `ROOF_CONTENT.*` | boost 0.5 / floor 0.22 / cell 6.5m | Rooftops finally have content at 1,100 ft? |
| `WATER_MOON.*` | boost 0.85 | Moonglade subtle or postcard? |
| `CLOUDS.textureToy` | toon puff | Toy deck matches the ramp aesthetic? |
| `LANDMARKS_3D.floodlight/toyHalo` | 1.35→0.82 / 1.6×0.5 | Monuments floodlit, halo no longer a puddle |
| `MOON.*` | disc 0.052 / glow 0.16 | Moon size/brightness |
| `TOWN_CORES.*` | 0.34/0.6 warm | Cruise metro warmth (R12 §7 scope — close that table now) |
| **R12 §7 table** | unchanged values | Close per FLY_ROUND12.md §7 |
| **R10 §4 table** | unchanged values | Close per FLY_ROUND10.md §4 |

## 9. Verification

- Per-phase: every listed harness green at existing thresholds — **zero gate re-baselines in
  the entire round** (the only harness edits: a sanctioned comment in verify-round11 and the
  NEW verify-boot sun-at-spawn gate + NEW verify-sat-buildings).
- Round-end full sweep (post-P5, orchestrator-run): results recorded below.
- `npm run lint`: 51-problem pre-existing baseline throughout; the round added zero.
- Stale-plan note: FLY_ROUND13_PLAN.md Appendix B lists verify-rim "toy maxStep 6" — the
  checked-in gate has been a flat `MAX_STEP = 18` since 2026-07-18. The plan number was
  stale, not the harness.

**Round-end full sweep (2026-07-19, post-P5, sequential to avoid contention):**

| Harness | Result |
| --- | --- |
| verify-boot (incl. NEW sun-at-spawn gate) | ALL PASS |
| verify-neon-city | PASS (draws 364; warm 0.34%; orchestrator re-run) |
| verify-neon-alt | ALL GREEN (spawn invariants EXACT; ×3 green runs this round-end) |
| verify-window-grids | PASS |
| verify-roofs | PASS (roof variance ~771 with skylight content — was ~flat) |
| verify-rim | PASS |
| verify-edge-fx | PASS after ONE sanctioned harness edit: the expected building
program key literal `beacon-grid-r8b`→`-r13` (tracking the P5 rename — the P5 agent died
before this harness; not a gate-value change). Its tracer-variance gate flaked cv 0.156 vs
0.15 once and passed clean on re-run — third flake-then-pass of that gate this round, all
traffic-churn correlated. |
| verify-monuments / verify-monuments-sat | PASS / PASS |
| verify-poi | PASS |
| verify-fleet | PASS |
| verify-tracers | PASS |
| verify-round11 | PASS (gate A intact; cloud minAgl 1560; draws 218; orchestrator re-run) |
| verify-sat-depth | PASS (hillshade Δ ~18-20/255; draws 246-247/375) |
| verify-sat-buildings | PASS (Manhattan 235 draws, Δ5; SF raw-DEM; byte-noop) |
| smoke-r9-2 | ALL PASS — after a required MIGRATION: it predated `_boot.js` and hand-seeded
only `fly-controls-seen`, so since the round-10 default flip it booted SATELLITE where
`__toyWorld` is required absent (R11 gate A) and its toy-globals gate could never pass; it
had simply not been run since. Now boots through `bootFly` like every other harness. |
| npm run lint | 51-problem pre-existing baseline; round added zero |

- `soak-fly 8` (budgets renegotiated in its header vs current PERF_BUDGET — the old
  <300-draw/<1.5M-tri targets predate R7; 8 min, toy, autonomous turns + boosts + a warp):
  **fps floor ≈119** (target ≥55), worst p95 frame 8.4ms (gpuFrameMs budget 12), max draws
  408 (≤480), heap 202→236MB oscillating with no monotonic climb, rebase ≤0.3ms, zero page
  errors. One flag: `maxTriangles` peaked at 2.36M vs the 2.2M PERF_BUDGET constant — a
  single post-warp stream-in transient (steady-state samples ran 0.5–1M) with zero frame-time
  cost; the nearest-win chunk caps trim it immediately. Watch, don't chase. Full data:
  `scripts/soak-results.json`.

## 10. Lessons

1. **A wider visual dynamic range turns silent fallbacks into visible bugs.** The null-island
   sun latch existed for months at "dims the lights 65% for a minute" severity; the moment
   satellite gained a real night, the same latch rendered midnight at noon. When a round adds
   range (night, tone mapping), re-audit every boot-path fallback the old range was hiding.
2. **Gate frame-loop publishers on placement, not on mount.** React passive effects run after
   paint; an R3F frame can tick between commit and effect flush and publish state derived
   from not-yet-initialized objects. Anything the frame loop derives from `flight.pos` is
   garbage until the spawn effect has run.
3. **Any multiplier on world-scale positions needs a damped input.** R12 knew this and damped
   the band end; the satellite altSpread reimplemented the multiplier without the damping and
   turned flight-model transients into km-scale scenery motion. Damp at the SOURCE the
   multiplier reads, and demand steady-state exactness so certified states stay byte-stable.
4. **Never let an implementation agent edit while the user flies** (the R7 harness rule's
   sibling). HMR ships every half-applied save to the user's open tab in real time — the
   user saw referenced-but-not-yet-written textures and whole-module invalidation churn as a
   "serious regression" that no committed code contained. Freeze edits during live sessions,
   or point live sessions at a non-HMR build.
5. **"Measure draws first" can still approve the wrong thing** — the P2 shadow rig fit the
   draw gate but failed on fill-rate, a cost draw gates can't see. When a feature's cost
   lands on a per-fragment path in the DEFAULT style, the gate that matters is frame time on
   the weakest certified hardware, and the R11 perf floor is the precedent to protect.
6. **Per-vertex anchor attributes generalize the anchor-bend lesson.** R6 said "rigid objects
   need anchor bend"; R13's merged building chunks (thousands of rigid boxes, one mesh)
   showed the anchor can be a per-vertex attribute (footprint centroid) instead of an
   instance transform — rigid-unit dropping without instancing overhead.
7. **A 4-agent plan review pays for itself.** The plan's stale Appendix-B rim number and its
   "anchored bend" wording for water were both caught and correctly overridden during
   execution because implementers were briefed to verify against checked-in reality, not to
   trust the plan text.
