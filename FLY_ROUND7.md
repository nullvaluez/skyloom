# Fly Mode — Round 7 "Electric Night City" (neon revamp + arcade glue + depth)

> **STATUS: BUILT 2026-07-17** (phases A–F implemented the same day; §3 is
> the record; §4 lists what was verified vs pending the final sweep). Read
> after FLY_ROUND6.md — all of its §5 lessons still apply, plus §6 here.
> Plan file: `~/.claude/plans/look-over-fly-round6-md-to-hidden-barto.md`.

## 1. The ask (user, 2026-07-17, post-round-6 review)

> "the second image attached is our neon toy view, but it feels so
> incredibly dull and boring… id also like to add more features and
> functionality so this feels like a mini arcade explore game. im
> interested in also exploring how to make the satelite view 'better' from
> a texture perspective… or a way to add depth"

Directions picked by the user (AskUserQuestion): **Electric night city**
neon direction; **airport interaction** + **inspect redesign (transparent
isometric) + full 360° RMB look** as the gameplay picks; **depth pass on
Esri** (not a provider swap — keyless alternatives are 10 m/px, worse close
up); **retire the Night style**.

Mid-round live reports (all fixed same-session, §3.G):
1. "neon map loads SO slow / i don't see a difference" → stale tab across a
   dev-server restart + my harness load; resolved by hard refresh.
2. "aircraft ABOVE our altitude appear below us… at our altitude appear on
   the same horizon plane" → traffic altitude lift (§3.G1).
3. "we do not have any roofs on our buildings" → rooftop brightness
   (§3.G2 — long-standing, exposed by the new 360° camera).

## 2. Root causes found (before building)

- **Neon dullness:** toy is the ONLY style with vector geometry (buildings/
  roads/water/trees) but *nothing emitted light* — Tokyo at 800 m read as an
  unlit clay model; rural areas have no buildings at all. Night style was a
  flat CARTO raster with none of it.
- **RMB look:** [chase-camera.js] clamped pitch ±1.2 and kept the LOOK-AHEAD
  target during free-look — at 180° the camera faced away from the plane.
  Two deeper bugs found while building: (a) browsers coalesce fast
  pointermoves and the delivered event's movementX drops intermediate deltas
  (fixed with getCoalescedEvents); (b) the chase rig's world-space position
  lag (v·τ ≈ 45 m at cruise — it *sells speed*) flattens any orbit of a
  moving plane — the camera could never get overhead.
- **Satellite flatness:** three-tile's TileMaterial IS a lighting-responsive
  MeshStandardMaterial with real DEM vertex normals — relief was washed by
  ambient (hemi + envIntensity 0.85 + fixed high sun). No anisotropy
  anywhere; z16 cap smeared low passes.
- **Traffic-at-horizon:** GLOBE.trafficBend capped drops to keep high
  traffic above eye (round 6) — physically-correct ~2° elevations pinned
  everything to the horizon band.

## 3. What shipped

### A — Full 360° RMB free-look
Orbit pose (spherical around the plane, aimed AT it, `CAMERA.freeLook`)
blended over the chase pose; **offset-space damping** for the orbit (world-
space lag flattens orbits — §2); pointer capture + coalesced-event summing
in input-controller. `runtime.chaseRig` exposed for harnesses.
**Harness:** `verify-freelook.js` — 370° sweep, facing dot ≥ 0.96
throughout, pitch 1.5 rad (top-down), 2 s snapback, off-canvas capture. The
rear/top views of your own plane exist for the first time.

### B — Neon "Electric Night City" (toy)
- **Facade windows + parapet glow:** worker bakes `aFacade` (vec4: wall-arc
  m / height / building H / hash) on wall verts; `applyWindowLights` wraps
  the beacon-patched building material (**key
  `world-bend-fade-beacon-win`**). Warm amber majority + cool minority
  accent per building hash; ~2% slow flicker on the beacon clock; parapet
  edge glow. Constants `WINDOWS`; colors `PALETTE.windowWarm/Cool/Edge`.
- **Runway edge lights + thresholds:** worker bakes light quads along
  aeroway runway lines into the LAND group (`aGlow` 0..1 arc, −1 sentinel
  everywhere incl. the ground grid); `applyRunwayGlow` wraps the pulse-
  patched land material (**key `world-bend-fade-pulse-rwy`**), optional
  rabbit chase on the existing pulse clock. Constants `RUNWAY_LIGHTS`.
  Gotcha found: lights must sit ABOVE the whole aeroway+road liftEps stack
  (`LIFT.road + 0.6`) — at +0.3 over aeroway they were z-buried under JFK's
  apron polygons.
- **Arterial light-strands:** `ROAD_PULSE` duty 0.12→0.18, boost 1.35→1.6.
- **Town glow-domes:** `TownGlow.jsx` — ONE additive instanced hemisphere at
  POI cities 9–30 km out, 2 s cadence placement, rebase-aware; new
  **`world-bend-anchor`** variant (ground bend + rim dissolve at instance
  origin — rigid instanced ground objects must not ride the per-vertex
  bend). +1 draw. Constants `TOWN_GLOW`.
**Harness:** `verify-neon-city.js` — layers armed, skyline lit-pixel band
0.3–14% (0.61% measured — lit but no white-out; the missing-attribute-
reads-0 trap is the failure mode), KJFK light-pixel gate, dome pool
mounted, draws 312, zero errors.

### C — Satellite depth pass
`applyHillshade` layer on the tile materials (**key
`world-bend-fade-hill`**): fragment multiplier from `transformedNormal` vs a
live sun direction; strength style-gated by uniform (0 outside satellite —
the same onTileMaterial hook patches toy's tan tiles). Sun az/el derived in
the existing day-cycle effect (east AM → west PM, elevation clamped
`minElRad`..`maxElRad` so noon never flattens). `Texture.DEFAULT_ANISOTROPY
= 8` set in terrain-engine module scope (the per-material hook fires before
the texture attaches — the static default is the only reliable lever).
`TILES.satMaxZoom` 16→17. Constants `HILLSHADE`; dev hook `__flyHill`.
**Harness:** `verify-sat-depth.js` — A/B mean |Δ| 32/255 over a Sierra
crop (strength 0 vs 0.55), sun-dir x flips +0.72→−0.95 AM→PM, z17 request
observed, draws 245 at low AGL. (Anisotropy gate pending the final sweep —
the probe needed the material-array fix; tile meshes carry material arrays.)

### D — Inspect redesign: transparent iso holo-codex
640 px two-zone layout: left 55% = big fov-24 isometric turntable with NO
panel background (floats over the live world), right = data stack on a
gradient-local scrim. Card body alpha ≤ 0.38, scrim 0.12 (was 0.55).
New `BearingChip` (bearing + relative altitude vs player) + V/S `Sparkline`
(rides the existing 500 ms telemetry). ALL round-6 wiring/testids
preserved; SpotToast pinned to its own dark glass (it inherited the
now-transparent card tokens). `inspect-tokens.js` carries the new
`textPanel` token.
**Harness:** `verify-inspect-actions.js` extended — alpha/width/turntable
gates + `inspect-bearing`/`inspect-sparkline` + a Day-noon legibility
screenshot (run pending the final sweep).

### E — Airport buzz / touch-and-go
`lib/fly/airport-buzz.js` (pure detector; airports subset of buildPoiList,
bbox pre-filter, lazily cached airport elevation, per-airport per-type
cooldown): **buzz** = AGL<140 & speed>70 sustained 2 ticks; **touch-go** =
dip <75 AGL then ≥40 m climb within 8 s (flight floor is 50 m — wheels-on
is impossible by design). Fed from Contracts' existing 1 Hz interval;
resets on warpEpoch (teleports mint nothing). Events → `fly-store.buzz` →
SpotToast "⌁ BUZZED THE TOWER / TOUCH-AND-GO" (amber accent) + 2 new
contract templates (`buzz-tower` 200 pts, `touch-go` 250 pts) via the same
advanceRef path as overfly. Constants `AIRPORT_BUZZ`.
**Harness:** `verify-airport-buzz.js` (run pending the final sweep).

### F — Night style retired
PauseMenu → 2 styles + localStorage migration ('night'→'toy', BEFORE the
validity check); `setMapStyle` guard for stale callers; MOODS.night /
BLOOM_BY_STYLE.night / FOG_BY_STYLE.night / CARTO tile branch + attribution
deleted; atlas "try Night style" nudge reworded. `NIGHT` + GLOBE/WORLD_EDGE
/CLOUDS night keys stay as documented dead constants (removal was the risky
path). **7 harnesses updated**: rim (2 styles), fly-style (Esri gates),
globe (night leg dropped), warp-arrival (raster path → satellite), tracers
(sat screenshots), edge-fx (toy carries floor gates), sun (toy inertness);
globe-night-check.js deleted. New `verify-style-retire.js` (migration/menu/
guard/zero-CARTO gates).

### G — Mid-round live fixes (user reports)
1. **Traffic altitude lift:** `GLOBE.trafficBend` gains `liftNearM 3000 /
   liftFarM 20000 / farLiftBoost 2.5` — the air-bend cap fraction ramps
   with distance into a NEGATIVE cap (an exaggeration): far high traffic
   draws at up to 2.5× its true height above the player. Measured: FL350 at
   32 nm now 23.8° above the horizon (was ~2°); ≤2 nm stays physical
   (formation/warp arrivals unchanged). GPU (both air variants) + CPU
   `airDrop` mirror updated together — labels/reticles/tracers agree.
2. **Rooftops:** brightened `PALETTE.buildingTop` #41507a→#55679c + roof
   mix glow weight 0.7→0.95 + parapet edgeBoost 0.55→0.85. NOT a
   regression — roofs rendered near-black since round 4; the 360° camera
   exposed it and the lit walls made tops read as holes.

## 4. Open for user review (sign-off checkpoints)

1. **Window look** (`WINDOWS.litFrac 0.38 / boost 1.7`, `windowWarm
   #ffb46b` + accents) — the #1 taste item.
2. **Traffic lift strength** `GLOBE.trafficBend.farLiftBoost 2.5`
   (1 = physical; FL350@32nm reads ~24° up at 2.5).
3. **Roof brightness** (`buildingTop #55679c`, roof mix 0.35/0.95).
4. **Runway chase** (`RUNWAY_LIGHTS.chase 0.35`; 0 = steady) + light color.
5. **Town glow-domes** (`TOWN_GLOW.opacity 0.35`, band 9–30 km).
6. **Hillshade strength 0.55** + `satMaxZoom 17` (watch warp-leg heap on
   the on-hardware soak; fallback = quality-tier gate).
7. **Inspect transparency** (`scrim 0.12`, body ≤0.38) vs Day-noon
   legibility — screenshots in scripts/inspect-r7-*.png after the sweep.
8. **Touch-and-go generosity** (`AIRPORT_BUZZ` thresholds).
9. Carried from round 6 §4: draws-350 gate decision; SPICY/contrail/rim/
   warp-pacing sign-offs.

## 5. Verification state

**All six phase harnesses green on final code:**
verify-freelook ✓ (370° orbit, facing ≥0.96, pitch 1.5, capture) ·
verify-neon-city ✓ (layers armed, skyline 0.61% lit, KJFK lights 0.158%,
domes, draws 312) · verify-sat-depth ✓ (hillshade A/B mean |Δ| 30/255,
sun-dir +0.72→−0.95 AM→PM, anisotropy 8, z17 streaming, draws 245) ·
verify-inspect-actions ✓ (18 gates — all round-6 wiring + alpha 0.38 /
662px / turntable 329px / bearing / sparkline / Day-noon open; live WARP
epoch-bump and CHASE formation with real mouse clicks) ·
verify-airport-buzz ✓ (buzz JFK, touch-go, cooldown silent, warp mints no
phantom — harness must PIN the plane over the field: cruise exits the
2.5km radius before the 2-tick confirmation) · verify-style-retire ✓
('night' storage migrates, 2-button menu, store guard, zero CARTO
requests, draws 322/217). Plus probes: roofs read from above; FL350@32nm
at 23.8° elevation.

**Pending — held for the user's live session:** the round-6 regression
set (globe, globe2, chase-cam, airbend, tracers, poi, rim, edge-fx, sun,
warp-arrival, atlas, contracts, spicy, fly-game, fly-style — ALL updated
for the 2-style world in this round) + the 15-min soak (watch warp-leg
heap: satMaxZoom 17 is the suspect if it regresses; fallback =
quality-tier gate). Run them SEQUENTIALLY, never while the user flies.

## 6. New lessons (append-worthy)

1. **Pointer-event coalescing eats drag input.** Fast pointermoves coalesce
   and the delivered event's movementX can carry only the last segment —
   sum `getCoalescedEvents()` for any drag-accumulation input.
2. **A damped world-space camera cannot orbit a moving target.** Position
   lag (v·τ) flattens the circle; damp the plane-relative OFFSET for orbit
   poses and keep world-space lag only for the chase pose (it sells speed).
3. **Baked overlay features must clear the whole liftEps stack.** Per-
   feature stacking epsilons walk up to +0.5 m — new overlay geometry at a
   fixed lift can be z-buried by any polygon whose eps drew higher (the
   JFK apron ate the runway lights).
4. **`Texture.DEFAULT_ANISOTROPY` is the only reliable anisotropy lever for
   loader-owned textures** — material hooks fire before the texture
   attaches; tile meshes also hold material ARRAYS (probe accordingly).
5. **"Realistic" projection reads dead in an arcade sky.** True elevation
   angles pin distant high traffic to the horizon; the lift ramp (physical
   near, exaggerated far) keeps close-range interactions honest while the
   sky reads alive. Keep GPU formula + CPU mirror in ONE file so they can't
   drift.
6. **A new camera angle is a new QA surface.** The 360° orbit instantly
   exposed rooftops that had rendered black for three rounds.
7. **Don't run browser harnesses while the user is live-testing the same
   dev server** — and expect a stale tab across a dev-server restart to
   show none of your changes ("(stale)" badge in the Next error overlay).
