# FLY ROUND 18 — "Alive & Dangerous" — ROUND RECORD

> Round CLOSED 2026-07-27. Plan: [FLY_ROUND18_PLAN.md](FLY_ROUND18_PLAN.md).
> Execution: five
> Opus 5 agents in two waves under Fable orchestration on branch
> `claude/round18-alive-dangerous`; scaffolding commit `86597b4` pre-seeded
> all eleven R18 constants blocks + store fields so agent diffs stayed
> disjoint (zero constants merge conflicts across five agents — the one
> conflict all round was two adjacent import lines in FlyMode).

## 0. Why this round

The user's R17 live verdict: the world still feels boring — "buildings have no
variety, we are still missing ROOFS", and the game should feel like a fun
arcade game. A Fable GPU fly-around (high tier, NYC/suburb/Alps/Neon,
screenshots) plus a 3-explorer recon confirmed five root causes: charcoal
prisms floating on pale imagery, roof dispatch that excluded most buildings,
the visible 2.7 km building-bubble edge, a sterile satellite ground (plus the
Hudson sawtooth), and a game layer with no juice and no stakes (the
`CAMERA.shake*` constants had zero readers; the plane could not crash).

## 1. THE finding of the round — the winding defect (A1)

**`classifyRings` (vector-tile.worker.js) hard-codes `signedArea > 0 =
exterior`, and that sign is wrong for every polygon layer OpenFreeMap
ships.** A feature whose first ring failed the test started no polygon and
was dropped whole; the only survivors were courtyard buildings (whose hole
wound the other way — and they rendered their *courtyard*). Measured on tile
14/4824/6157 (Manhattan): building 1481→0, landcover 512→0, landuse 59→0,
water 16→0 under the old rule. Live, the satellite ring over Midtown held
**114 buildings across 12 chunks** — the densest city on Earth rendered as a
hundred lonely boxes, which IS the R17 "no variety, no roofs" verdict at its
root.

Fix: `classifyRingsSat` — winding-agnostic (the sign of a feature's FIRST
ring defines exterior; correct under either winding per MVT 2.1), gated
behind `ROOFS_SAT.enabled` so the byte-noop revert covers the coverage fix
too. Midtown: **114 → 3,860 buildings kept** (7,643 parsed), draws 259→263,
0.64 M tris.

**⚠ Neon carries the identical defect** at three frozen call sites
(`polygonPass` land/water, toy buildings, toy scatter) — toy ground patches,
buildings and trees are all ~99% dropped there too. Toy was frozen this
round; fixing it moves every Neon visual baseline, so it needs its own
certification round. **This is the standing headline candidate for R19.**

## 2. Wave 1 — what shipped

### A1 "BLOCKSMITH" — coverage, roofs, suburbs, tones, water (protocol 13→14)
- New 4-arg-pushV roof helpers (window-free by construction): `pushInsetPeak`
  (hip/mansard/pyramid via insetFrac, concavity guard bails to flat),
  `pushShed`, `pushPenthouse`, `pushWaterTank`, `pushChimney`,
  `pushMastSat`/`pushAntennaFarmSat`, `pushCrownSat`/`pushSpireSat` (crown
  steps UP from the roofline — the toy crown's below-roofline emissive band
  is invisible without emissive). Height-banded dispatch (`ROOFS_SAT`),
  "always-something" fallback; caps re-tuned 380/260/200/200 → 500/500/320/320
  after the coverage fix (plan values left 21.1% of Manhattan flat; now
  0.16%). Zero extra draws.
- Suburb selection: volume-stratified (top-180 by areaM2×h anchors + fractional
  stride over a hash-shuffled remainder — MVT feature order is spatially
  clustered, raw stride keeps one corner). R15 kept 0.0% of sub-600 m²
  footprints (true share 54.2%); R18 keeps 37–45%. Caveat: OpenFreeMap z14 is
  heavily generalized outside dense cores (Naperville ships 3 buildings/tile)
  — no algorithm can render footprints that never arrive.
- House-height inference band (`houseInfer`: ≤220 m² → 5–8 m); rarely fires
  (~99% of OFM buildings carry mapped height) but kills the 13–17 m "house".
- Tone re-tune, measured: buildings-vs-imagery luminance delta −49.8 → −32.1
  (target band pinned in verify-roof-variety), `wallTones` +18.4% warm-tilted,
  `wallBaseMul[0]` 0.5→0.62, `roofTones.mid/tall` +10%; old values preserved
  in `ROOFS_SAT.legacyTone`.
- satWater sawtooth: worker emits `waterCoverage`; the engine bridges a 404
  tile with ≥2 ring-neighbors at coverage ≥0.6 with one full-tile quad on the
  shared glint material (fires at NY Upper Bay; high tier only).
- WORKER_PROTOCOL 13→14 (new details 'sat-skyline'/'sat-veg' + new output keys
  `waterCoverage`/`meta`/`satPts`); all four engine pins moved in lockstep;
  stale v13 bundles dropped by the new consumers.
- Collision columns for A5: built in the drape-apply pass (topY is post-drape
  ABSOLUTE altitude), 8×8 buckets/chunk, `engine.queryColumns(px,pz,r)`,
  published as `runtime.satBuildings`; x/z/r all world units.

### A4 "SHOWTIME" — juice, shake, music
- `lib/fly/juice.js` (trauma/combo/session, pure), `JuiceSystems.jsx` mounted
  after FlyScene (reads this frame's traffic `.distM`), `music-director.js`
  (4 layers on the shared AudioContext via new `audio.bus()`: AGL air bed,
  speed-keyed pentatonic pulse, proximity tension swell, night pad; D-dorian,
  2 Hz, `setTargetAtTime` only; enabled:false ⇒ zero nodes),
  `whooshSting()`/`crashThud()` one-shots, 'nearmiss' SpotToast flavor,
  ComboChip/RunSummary/BoostBar via a single self-contained `JuiceHud`.
- Shake landed INSIDE chase-camera post-slerp: 3 incommensurate sine pairs ×
  (speedShake + trauma²); speed term smoothstepped from 0.8×boost (cruise =
  180/750 = 0.24 ⇒ exactly zero — probe-safe by construction); wires the
  CAMERA.shakeSpeedFraction/shakeMaxDeg constants dead since R8. Zero-amp
  short-circuit never touches the quaternion.
- Event → pts/trauma: near-miss 50/0.35 (closest-approach inflection with
  peak-closing-rate gate — range rate is ~0 AT CPA, the literal spec rejected
  every real fly-by), buzz 60/0.25, touch-go 140/0.25, contract 200/0.35,
  rare+ spot 90/0.25, boost engage −/0.15, crash −/1.0 (ends run). Banked =
  base × min(3, 1+0.25·(combo−1)).
- Deviation accepted in review: NO LayoutRoot zone/testid changes — both chips
  self-anchor pointer-events:none (keeps verify-mobile-layout enumeration
  untouched in a zero-re-baseline round).

### A5 "GRAVITY" — crash, respawn, boost meter
- Detection (`crash-system.js`): terrain crash iff floor contact with
  COMMANDED sink < −30 m/s (`sinkRaw` — the soft floor zeroes realized vy) OR
  (speed > 200 AND pitch < −18°); trigger is "within one frame of the floor"
  (the soft-floor band makes `pos.y < floor` an asymptote a dive never
  reaches). Building crash: satellite only, ≥45 m/s, real engine columns.
  **Arm gate 5 s** after mount AND every warpEpoch bump (transient store
  subscription, inside `set` — an effect loses the race on a warp into a
  wall) AND respawn. Autopilot exempt from crashes AND the meter (a live NYC
  intercept follows landing traffic through 136 m AGL at −27 m/s).
- Sequence ~1.8 s: neutralize → ballistic tumble → CrashFlash →
  `juice?.onCrash()` + `audio.crashThud?.()` → respawn 2 km back-along-track
  at ground+400.000 m (gated exact), cruise, level; deliberately does NOT
  bump warpEpoch (no WarpFlash, no weather snap for a 2 km hop).
- PauseMenu "Flight stakes: Crashes ON / Forgiving" persisted at
  `fly-crash-mode` (explicit-click persistence); **default ON** (user
  decision); Forgiving ⇒ R17 slide byte-for-byte (gate-proven).
- Boost meter 6 s / 12 s regen / 0.25 re-arm; empty ⇒ speed falls to cruise
  while the HUD legend still reads BOOST (raw input never rewritten).

### W1 Fable integration commit (`2f8cfc4`) + probe fixes
- **Meter governs the '3' preset too** (A5 shipped Shift-only to protect
  verify-edge-fx's 40 s @ 750 m/s gate — a correct call under zero-re-baseline,
  but an unlimited-preset loophole guts the user's "full meter" pick). The
  resolution is the R16 weather-pin idiom: `window.__flyBoostInfinite = true`
  pinned fleet-wide in `scripts/_boot.js` (the meter never drains in
  harnesses); `verify-crash` is the ONE script that clears it. verify-edge-fx
  passed untouched (4 rebases @ 750).
- **queryColumns unit reconciliation**: A5 assumed r in true meters and
  divided the delta by mercK — the engine derives x/z AND r from the same
  draped buffer, so the test is world-vs-world (the /k made cylinders ~33%
  fat at NYC). Verified against engine source; gate 5a now drives the REAL
  engine (teleport inside the tallest streamed column; the original 900 m
  flyover sat above every real topY — only the injected topY:1e6 stub could
  pass it).
- verify-chase-cam probe made self-consistent (wait d<2400 so rangeK 1.6
  stays under the frozen 4000 band; TWO independent control experiments showed
  the pre-R18 baseline failing identically in live traffic). Gate numbers
  frozen — not a re-baseline.

### W1 sweep — 13/13 GREEN on the merged tree
verify-roof-variety (18) · verify-crash (23, building crash vs REAL columns)
· verify-juice (25) · verify-sat-buildings · **verify-sat-depth (Owens ≤261
holds)** · verify-edge-fx · verify-neon-city (toy 364 draws — byte-identical)
· verify-fly-game · verify-contracts · verify-warp-arrival · verify-freelook
· verify-chase-cam · verify-mobile (28/28). Two live-flake re-runs (Esri CORS
hiccup; documented tracer-cv), both green on retry. **Zero gate re-baselines.**

## 3. Wave 2 — city scale + living ground

### A2 "SKYLINE"
- Ring moved z13 → **z14** (charter correction from A1's data: z13 ships ONE
  merged 9.9M m² blob for all of Manhattan) and — A2's own key deviation — a
  chunk is a **groupN×groupN GROUP of z14 tiles merged into one geometry**
  (one z14 tile is 2,446 world units; 10 single-tile draws would reach 4.4 km,
  barely past the bubble they exist to rescue). At groupN 2, 10 high-tier
  chunks = 40 tiles ⇒ **8.7 km reach** (~6.6 km true at NYC), same draw
  budget. Drape = per-group bilinear DEM grid (169 samples ≈ 12,000 exact
  ones), null samples fall back to the player's ground elevation (0 would
  sink Denver 1.6 km).
- **Killed the plan's area-fallback**: the worker's invented height for
  area-only picks clamps 18–60 and SATURATES — every ≥2,500 m² pick came out
  exactly 60 m, growing a fake 20-story downtown over every big-box strip and
  three towers over empty desert (measured: Naperville 20 area-picks vs 1
  real ≥35 m building; Owens 3 vs 0). `minAreaM2` off; mapped h≥35 only.
  NYC skyline tris 180k → 46k, and Owens `ready === 0` from the DATA.
- Choreography: hole 4,000 m (feather 900) under 2,400 m AGL; eases to 0
  across SAT_BLDG_FADE's live band (read, never mirrored) — the city BECOMES
  mass; own cull 7,500→9,000, evict 9,500 / re-arm 9,200; per-frame
  visibility park for fully-holed groups. Measured: Owens skyline draws 0
  / scene 237; NYC 600 m: 9 draws / 45.7k tris / scene 257; 5,000 m: 209;
  10,200 m: evicted, 182.
- Monuments: sat-only `variant:'sat'` geometry (toy hashes proven 9/9
  byte-identical) — ESB/WTC setback cornices, chamfered crownTower shaft,
  church buttresses, dome drum, plinths; value-only grey vertex colors,
  `vertexColors:true` on the satellite material. +0 draws, ≤696 verts.

### A3 "GROUNDSKEEPER"
- Canopy = ONE pooled InstancedMesh of 42-tri squashed blobs, but each
  instance reads as a **stand** (radiusMul 1.6) — density is fixed by the
  frozen toy scatter recipe (a point per ~49 m square), one blob per tree
  read as confetti. Desaturated palette + luma jitter + conifer variant;
  scale-based alt/distance fades; per-chunk cap = floor(pool/maxChunks) so a
  pool cut is impossible; stable-stride decimation (never a distance sort).
- 5×5 per-chunk bilinear DEM (3×3 buries canopies on Alpine slopes);
  streaming INVERTED vs sibling engines (commit coarse DEM, re-grid in place
  — holding for demZ left Owens' outer ring treeless for 26 s).
- Movers (high tier): 48 boat hulls (merged hull+cabin, 24 tris) with drift +
  1.5 m/s creep, leash arithmetic proves on-water (33.9 ≤ 34 inside the
  worker's own 60-unit clearance); 12 industrial plume stacks × 3 billboards,
  **normal-blended not additive** (additive white steam is invisible over
  white warehouse roofs — measured).
- Numbers: Central Park 999 canopies / 278 draws; **Owens 952 rural canopies
  live and verify-sat-depth's own frozen pose reads 255–258 ≤ 261 — no
  re-baseline**; medium tier (phones): canopies yes, mover meshes never
  allocate. Three bugs caught by its own harness: an inline-ref re-render
  wipe (live-play defect — hovering a plane blanked the forest), A/B interval
  asymmetry, hero-occluded evidence shots (the R17 sat-night trap).

### W2 Fable integration
- verify-roof-variety **sun pin** (`__flySunOverride` = the A1 measurement
  hour): its luminance gates were wall-clock dependent — the
  buildings-vs-imagery delta flips SIGN at dusk and lumaStd read 28 vs the
  34 floor on the UNMODIFIED base (TWO independent W2 control experiments).
  Third probe-determinism fix of the round, same class as the others.
- Upper Bay "flat green slab with hard tile edges" (A3's report): confirmed
  PRE-EXISTING — the pre-round R17-tree tour screenshot shows the identical
  read over the Hudson. It is the R13 SAT_WATER look; A1's ocean-fill extends
  its coverage. Named follow-up (§8), not an R18 defect.

## 3b. Live-flight finding during the round — the dusk sky
Mid-round the user reported "the sky is so grey and dark now that we can't
see any contrails." Control experiment (identical live-weather/real-sun boots,
round branch vs pre-R18 main): **identical sky state on both trees**
(sunFactor 0.36, hdri 'dusk', same ACES/grade/bloom; tracerSunGain 0.38 both)
— the R13/R16 dusk pipeline, not an R18 regression; W1's diff touches nothing
in the sky path. Logged as a TASTE checkpoint (§6): the dusk band reads as a
milky haze wall and dims tracers to 38% — candidate tune: raise the dusk
tracer-gain floor (~0.6) + warm/deepen the dusk horizon keyframe.

## 4. Close-out — final sweep + soak (merged tree, evening live traffic)

**22 harnesses green, zero gate re-baselines**: roof-variety (18) · crash (23)
· juice (25) · skyline (17) · veg (23) · sat-buildings · sat-depth (Owens
≤261 with skyline empty-issuing AND 952 rural canopies live) · monuments ·
monuments-sat · neon-city (toy 363 draws) · edge-fx · round11 · freelook ·
warp-arrival · chase-cam · contracts · fly-game · mobile (28/28) ·
mobile-layout (both orientations) · roofs · window-grids · verify-classify/
warbirds (node). Live-flake retries during the sweep: Esri CORS ×1, upstream
tile 404 ×1, tracer-cv ×2 — all green on retry, all documented classes.

**Soak (15 min, live evening NYC):** steady-state p50 8.3 ms / p95 8.4–12.6 ms
THROUGHOUT — including an 11-minute-in surge to **525 live aircraft** (tris
peak 3.9 M and heap peak 875 MB, both traffic-ribbon-driven, both receding;
draws max 403 ≤ 480; rebase 0.5 ms; zero pageerrors). The 2.2 M tri budget
line is exceeded only during that live-traffic surge — a scene the budget's
authors never controlled for; frame time held the 12 ms budget through it.

**Probe-determinism ledger (the round's recurring theme — SEVEN fixes, zero
assertion-number changes):** chase-cam wait 3000→2400 + the hold-until-
reclose read, crash gate 5 drives the REAL column engine, crash gate 6
samples the app arm clock, roof-variety pins the sun, verify-veg pins the sun
(same wall-clock defect, second instance — its daylight-authored luminance
gates collapsed on the first after-dark run), veg remount dead-window guards,
and the fleet `__flyBoostInfinite` pin in _boot.js (verify-crash alone
un-pins). Every fix has a control experiment or a mechanistic proof in its
commit message.

## 4b. Live fix during the round — overcast tracer visibility
User report from CMH at overcast sunset: "ALL trails are gone." Fresh-client
repro confirmed; root cause: tracer gain keys off solar elevation only, so
overcast dusk left tracers at dayGain 0.38 against a darkened scene. Fix:
`TRACERS.sun.overcastNightK 0.65` — the night ramp keys off EFFECTIVE light
(sun × overcast). Measured at the repro spot: gain 0.38 → 1.04–1.12; clear
sky is the exact R16 expression (identity at overcastT 0 — which is also why
every weather-baseline harness is untouched). The companion sky complaint
(flat tan overcast-dusk dome) is pre-existing R16 rendering — checkpoint #17.

## 5. Neon nudge (Fable-authored, user sign-off PENDING)
Value/warmth-only, three values (`buildings` spread ×0.84…×1.22, `buildingShade`
off true black, `buildingTop` warmed), one isolated commit (`7865ba4`), A/B at
`scripts/r18-neon-*.png`, R17 values preserved inline. Toy gates re-run green
under it. Honest note: the visible change is modest — most Neon flatness
traces to the §1 winding defect (R19's headline), which the A/B screenshots
inadvertently document (Queens at 3,600 ft is roads-on-ink with almost no
buildings).

## 5b. Follow-ups filed (§8 discipline)
1. **R19 HEADLINE CANDIDATE: the toy/Neon winding defect** — three frozen
   call sites drop ~99% of toy polygons (ground patches, buildings, trees).
   Fixing it moves every Neon baseline → its own certification round.
2. **Satellite water material** — matte-green hard-edged slab from altitude
   (pre-existing R13 look; A1's ocean-fill widens its coverage). Needs a real
   material rework, pairs naturally with #1.
3. **Overcast-dusk sky** — the lid × dusk HDRI degenerates to a featureless
   tan dome; wants gradient retention (checkpoint #17 collects the taste).
4. edge-fx tracer-cv + fly-game hover-aim remain live-data flakes; the R16 §8
   synthetic-feed prescription stands.
5. A2: `SAT_SKYLINE.groupN` is reach + fetch-load in one knob (3 ⇒ ~13 km but
   ~90 fetches/fill); phone-class satellite not yet certified on device
   (verify-sat-mobile did not run in W2's gate list).
6. A3: plume prominence knobs (`SAT_AMBIENT.plumes.*`) read at 200–800 m over
   dark ground, near-invisible against bright haze — checkpoint #13.

## 6. User checkpoints (PENDING USER — the next live session's agenda)
| # | Area | Question | Knobs |
|---|---|---|---|
| 1 | Crash default feel | Stakes ON: does reckless-only crashing feel fair? Arm delay right? | `CRASH.*`, pause toggle |
| 2 | Sputter | Held-empty boost settles into ~1.5 s on / 3 s off — feedback or annoyance? | `BOOST_METER.rearmFrac` |
| 3 | Terrain sink 30 m/s | ~−10° at cruise into ground crashes — too strict/lenient? | `CRASH.terrain.sinkMps` |
| 4 | Boost meter numbers | 6 s capacity / 12 s regen pacing | `BOOST_METER.*` |
| 5 | Tone delta | Buildings vs imagery now −32 (was −50): grounded or washed? | `SAT_BUILDINGS.wallTones`, `ROOFS_SAT.legacyTone` revert |
| 6 | Roof variety read | 500–1500 ft over a city AND a suburb: real neighborhood? | `ROOFS_SAT.*` |
| 7 | Near-miss pacing | 120 m / 80 m/s closing / 20 s cooldown — thrilling or spammy? | `NEARMISS.*` |
| 8 | Combo pacing | 8 s window, ×3 cap | `COMBO.*` |
| 9 | Music taste | 4-layer procedural bed at 0.16 gain — keep, quieter, off-default? | `MUSIC.*` |
| 10 | Shake amount | trauma 1.4° max, speed 0.2° | `SHAKE.*` |
| 11 | Skyline crossfade | climb through 2,400–3,000 m: city becomes mass, no pop? | `SAT_SKYLINE.*` (W2) |
| 12 | Veg look | Park canopies + rural valley trees photo-plausible? | `SAT_VEG.*` (W2) |
| 13 | Movers | Boats + plumes: alive or gimmick? | `SAT_AMBIENT.*` (W2) |
| 14 | Monuments | ESB/WTC read as landmarks now? | `LANDMARKS_3D.satStyle` (W2) |
| 15 | Neon nudge | Approve the 3-value warmth/spread commit or revert | §5 |
| 16 | Carried | R15 §6 + R16 §6 + R17 §6 checkpoint tables remain open | — |
| 17 | Overcast-dusk look | Tracer fix landed (gain ~1.1 in overcast dusk) — does the flat tan sky dome itself need the gradient-retention rework next round? | `SKY_LIVE.weatherDim`, follow-up #3 |

## 7. Lessons (draft)
1. **A coverage defect can masquerade as a variety complaint.** "Buildings
   have no variety" was 97% "there are almost no buildings" — measure counts
   before styling anything.
2. **Winding conventions are data contracts.** Never hard-code a signed-area
   sign against a tile source; take the feature's own first-ring sign.
3. **An integration seam both sides tested is still untested.** A5 proved its
   consumer against an injected stub; A1 proved its producer's emission; the
   real pairing failed on units AND on probe geometry. The merge owner must
   drive the REAL pairing.
4. **The fleet-pin idiom generalizes.** `__flyWeatherOverride` (R16) →
   `__flyBoostInfinite` (R18): when a product mechanic would invalidate a
   fleet of frozen gates, pin the mechanic neutral in `_boot.js` and let ONE
   dedicated harness clear it deliberately.
5. **Probe preconditions must imply the assertion.** verify-chase-cam waited
   for <3000 m then asserted ≤4000 at rangeK 1.6 — structurally flaky for
   two rounds; verify-crash's 900 m flyover could never touch a real column.
6. **Pre-seeded disjoint config blocks kill merge hell.** Five agents, one
   trivial import-line conflict all round.
7. **A luminance gate authored without pinning the sun is a time bomb that
   detonates at sunset.** It went off TWICE in one round (verify-roof-variety
   at dusk, verify-veg after dark) — both authored and measured in daylight.
   Every visual-metric harness pins sun AND weather at authoring time, full
   stop.
