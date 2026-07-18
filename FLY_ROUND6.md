# Fly Mode — Round 6 "Connected Sky" (reliability + rim + arrival + arcade glue)

> **STATUS: EXECUTED 2026-07-17** (phases A–G built and harness-verified the
> same day; §3 is the record). Sign-off items for the user are listed in §4.
> Read after FLY_ATLAS_REWORK.md — all of its §3 constraints still apply,
> plus the new lessons in §5 here.

## 1. The ask (user, 2026-07-17, during round-5 live review)

> "we seem to still have VERY buggy behavior with the worlds plane and sky
> feeling disconnected, as well as rendering issues being delayed such as
> contrails (STILL a problem), and also the map taking a while to fully
> load in. our 'warp' and 'chase' buttons also seem to not work anymore…
> this is starting to feel more immersive, but we are still not hitting the
> mark of a fun 3d style arcade flying game"

Plus mid-round reports: "some contrails are just vertical now and totally
disconnected" (screenshot), and "the label POI's seem to be very
intermittent... they should always be visible". Feature directions picked
by the user: **missions & scoring**, **chase camera & cinematics**,
**world immersion** (explicitly not progression/collection). Contrail
backfill approved as "fake it"; load-in approved as "both" (speed + mask).

## 2. Root causes found (headless investigation, before any fix)

- **Warp/chase "do nothing":** wiring intact (both worked under real mouse
  clicks in every headless run). Three silent failure modes: (1) FlyScene's
  cleanup nulls every `runtime.*` method — a Suspense/error-boundary remount
  dead-arms both buttons through the `?.` optional chaining with zero
  feedback; (2) `warpTo` returns false on `!track.fix1` (an "acquiring
  telemetry" card) — silent no-op; (3) CHASE engaged the intercept autopilot
  with no visible feedback at all.
- **Contrail delay:** ribbons grow 160m/point × 24 points ≈ 15–20s to full
  length; new tracks exist only after the first poll; `warpResetM` cuts
  regrow from zero.
- **Vertical contrails:** two distinct artifacts — (a) far-LOD billboards
  grow with distance and `applyBendAir` displaced their vertices
  independently: a rim billboard straddling the AGL blend band stretched
  into a giant class-colored vertical bar; (b) trail ribbons recorded
  points during `altBlend` vertical sweeps (3D spacing check), and trails
  seen end-on foreshortened their bend-drop gradient into columns.
- **FL300 "white spear":** the player contrail's last segments (30–70m
  ahead of the 100m-back chase cam, 8m below it) survived the old
  25/80 near-fade at ~0.5m width — a 12px screen spear; ~3km of
  behind-camera points also projected mirrored (negative w).
- **Sky/ground disconnect:** the SkyDome never bends and its horizon sat at
  flat eye level while the ground fell away d²k; three rim colors diverged
  in night/toy (fog ≠ edge-fade ≠ dome band; satellite was already unified,
  which is why Day looked right).
- **Slow load-in:** three-tile LOD descends z2→z14+ at default
  `maxThreads 5`; toy chunks additionally held up to ~30s for DEM depth
  (`drapeMaxTries 20 × 1.5s`); WarpFlash masked only 900ms.
- **POI letter flicker:** slots were index-based (any membership change
  shifted later letters to new slots → pop-in restart + troika re-shape),
  no range hysteresis, and near-equal candidates alternated per 2s tick.

## 3. What shipped (all phases green)

### A — Warp/chase made loud (+ small fixes)
`InspectModal`: WARP disabled with "ACQUIRING…" while no live fix; both
buttons check the runtime method exists AND returns true — failure shakes
the card with a "scene rebuilding — try again" notice
(`inspect-action-notice`). CHASE now blips (`audio.lockBlip`) and the HUD
grew a chase chip (`hud-chase-chip`): "◎ INTERCEPT/FORMATION · name · nm ·
C cinema". Dev `__flyStats.sceneRemounts` tripwire counts FlyScene
remounts. PauseMenu: `M` resumes + opens the Atlas. `scripts/gen-icons.mjs`
generated the 8 missing PWA icons (manifest 404s). RouteProgress states:
"route lookup…" / "no filed route" / row (the `/route` 404s are legitimate
no-route answers — endpoint verified live, no server change).
**SPICY `minTier` epic → legendary** (C172s were clearing the epic gate;
military always pings) — live-tune to taste.
**Harness:** `verify-inspect-actions.js` (10 gates) + `verify-fly-game.js`.

### B — Contrails: instant, never vertical, never a slab (+ B.5 letters)
- **Backfill (user-approved fake):** first sighting and every hard cut
  synthesize the full 24-point ring backwards along the track's velocity
  (mercator-scaled, climb slope clamped ±0.12). `TRACERS.ribbon.backfill`
  kill switch. Zero new draws.
- **Vertical bars:** ribbon spacing check is now HORIZONTAL-only (altBlend
  sweeps can't mint points), vertical steps > `vertCutM 400` hard-cut +
  re-backfill; traffic models/billboards moved to a new per-instance
  `'world-bend-air-anchor'` shader variant (rigid drop — no more AGL-band
  shear); the per-vertex `'world-bend-air'` variant (ribbons only now)
  gained a rim dissolve riding the shared `uEdgeFade` band.
- **Slab/spear:** near-fade windows widened past their geometry
  (ribbons 60/600, player contrail 60/180 — the old windows lost to point
  spacing and the 100m camera gap), nearK takes the min over neighbor
  points, ribbons collapse when viewed end-on (sin(view↔tangent) window),
  and all behind-camera points are zero-width culled (negative-w mirror
  projections were the FL300 spear).
- **B.5 POI letters:** slot-stable selection (a letter keeps its slot while
  selected), range hysteresis (keep to 1.25×range / 0.55×minDist), sticky
  0.8× sort for shown letters, and a 20s minimum hold vs newcomers.
**Harness:** `verify-tracers.js` (backfill/vert-cut/style flips),
`verify-poi.js` (40s flight: zero empty ticks, zero flicker, zero sub-4s
lifetimes), `verify-airbend.js` + `verify-globe.js` re-runs green
(draws 349/222/211 ≤ 350).

### C — Sky/ground rim unification
New `GLOBE.rim` (one color per style = the fog family) consumed by BOTH the
ground edge-fade and a new SkyDome `uRim` uniform; dome below-horizon is a
two-stop blend (horizon → rim → deep void); and the dome's horizon line
DIPS with the live bend (`setSkyDip` fed per frame from effective k + eye
AGL — same module-setter pattern as world-bend). Satellite `rimOnly` keys
off the dipped y.
**Harness:** `verify-rim.js` — 3 styles × 2 altitudes, blurred-strip
max color-step ≤ 18/255 across the horizon band (pre-fix the black band
edge read > 25). Screenshots reviewed: night FL300 now grades ground→haze→
sky with no black band.

### D — Warp arrival: speed + held cinematic
Speed: `TILES.maxThreads 10` (three-tile setter), and a 20s post-warp
window where toy chunks accept a coarse drape after 3 tries (~4.5s) instead
of 20 (~30s) — heal path re-drapes later. **Measured: London warp chunks
ready 31→51→75→89/120 across 2–3.2s (baseline 40/120 at 3s), 120/120 by
+8s.** Mask: `warpKind 'far'` (> 100km) drives WarpFlash's streak → hold
(ink overlay, destination name, readiness-polled at 4Hz via prod-safe
`runtime.toyStats` / `engine.downloading`, floor 2.2s cap 3.5s) → reveal.
Local warps keep the original 900ms flash.
**Harness:** `verify-warp-arrival.js` — toy hold resolved 3.2s with 89/120
ready; night (raster path) 3.3s; local warp still plain flash.

### E — Cinema chase camera
`lib/fly/cinema-camera.js`: wing view abeam the player↔target midpoint
(range = separation × 1.6, min 120m, slow 0.05 rad/s orbit, ground-clamped,
damped) swapped for `chase.update` inside the floating-origin bracket.
`C` toggles while intercept/formation is flying; auto-revert + `chase.snap()`
on lock loss/disengage. HUD chip flips to "◉ CINEMA · name · C to exit".
**Harness:** `verify-chase-cam.js` — camera in band (2,169m for a distant
intercept), BOTH aircraft project on-screen, toggle + auto-revert green.

### F — Contracts v1 (missions & scoring)
`lib/fly/contracts.js` (8 templates: spot-any/class/type incl. widebody
list, formation, overfly landmarks via poiSlots, atlas military visit,
FL300), `stores/fly-contracts-store.js` (persisted lifetime score only),
`hud/Contracts.jsx` (quiet INK top-left panel, 3 active, rotate on
completion, green stamp = the only color). Wiring is discrete: passport /
fly-store / fly-atlas subscriptions + ONE 1Hz interval. Progress lives in
a ref (side effects must not run inside a React state updater — caught
live as a "cannot update while rendering" error, §5.4).
**Harness:** `verify-contracts.js` — synthetic-heli completion, altitude,
formation, persistence, zero console errors.

### G — Day-style local-time light
Satellite style only: sun/hemi intensity lerps with coarse solar elevation
(UTC + lon/15; floor `SKY.dayCycle.minSunFrac 0.35`), recomputed on style
change / warp / 60s. Colors untouched; night/toy inert. Dev
`__flyStats.sunFactor` + `__flySunOverride`.
**Harness:** `verify-sun.js` — NYC noon sunFactor 1.0 / intensity 2.2;
midnight 0 / 0.77; night style authored 1.35 untouched.

### Also
- Gaza City added to `lib/fly/poi/cities.js` (user request mid-round).
- `Contracts` + `WarpFlash` mounted in FlyMode (WarpFlash now takes runtime).

## 4. Open for user review (sign-off checkpoints)

1. **SPICY gate**: epic → legendary for non-military (military always
   pings). Tune `SPICY.minTier` back if too quiet.
2. **Contrail look**: backfill on sight, nearFade 60/600 (close trails slim
   down), climb-slope clamp 0.12, rim dissolve. All in `TRACERS.ribbon`.
3. **Rim colors**: `GLOBE.rim` = fog family per style; dome two-stop blend.
   Night/toy before/after screenshots in scripts/rim-*.png.
4. **Warp hold pacing**: floor 2.2s / cap 3.5s / readiness 12 chunks or
   35% (`WARP.far`). The hold screen's type treatment is v1.
5. **Contract pool/values** (`lib/fly/contracts.js`) + panel placement
   (top-left) — one screenshot in scripts/contracts-01-panel.png.
6. **Day cycle floor** `SKY.dayCycle.minSunFrac 0.35`; dusk color tint NOT
   shipped (intensity only) — say the word if you want the tint pass.
7. **Draws-368 gate decision** (carried from round 5): the ≤350 budget was
   exceeded only by traffic-instance surges in 1,100+ track skies. Options:
   re-baseline the harness gate to 380, or cap traffic instances distance-
   sorted (~384). Constants are yours — currently unchanged.

## 5. New lessons (append-worthy)

1. **Ribbon width factors must cover the CAMERA GEOMETRY, not just look
   right at spawn.** Near-fade windows narrower than point spacing (or the
   chase-camera gap) leave full-width segments straddling the lens — the
   formation slab and the FL300 spear were both this. Behind-camera points
   in camera-facing ribbons project MIRRORED (negative w) and must be
   zero-width culled.
2. **Per-vertex world-space displacement shears rigid objects.** Any
   instanced object under a distance-dependent shader displacement needs
   the displacement evaluated at the instance anchor
   (`world-bend-air-anchor`), or growth×gradient turns it into a streak.
3. **`mesh.visible` written per frame defeats scene-walk debugging.**
   Contrail/tracers re-set `visible` every frame — hide-probes must use
   `material.colorWrite = false` (nothing re-arms that).
4. **No store writes inside React state updaters.** Contracts' completion
   side effects fired during render until progress moved into a ref.
5. **Selection UIs need hysteresis + stable slots + minimum hold.** The POI
   letters needed all three; any one alone still flickered.
6. **The 2s-cadence key test:** the earlier "M is broken" repro was the Esc
   → pause menu eating M — check modal/pause state before diagnosing input.

## 6. Verification inventory (all green on final code)

verify-inspect-actions ✓ (10 gates) · verify-fly-game ✓ (twice; final run
hover→click→card→warp 653m, lock retained, no canvas leak) ·
verify-tracers ✓ · verify-poi ✓ (40 ticks, zero flicker) ·
verify-airbend ✓ (zero below-eye violations, 73 grounded glued) ·
verify-globe ✓ (draws 349/222/211 ≤ 350) · verify-rim ✓ (6/6 strips ≤ 18) ·
verify-warp-arrival ✓ (toy reveal 3.2s @ 89/120 ready; night 3.3s; local
flash intact) · verify-chase-cam ✓ · verify-contracts ✓ (+console-clean
probe) · verify-sun ✓ · verify-atlas ✓ (Tokyo + Nellis legs, arrival
banner, visit log — far-warp path regression-free) · verify-globe2 ✓
(draws 316, contrail 160 pts live, 0 errors) · verify-spicy ✓ (after the
CAP-Cessna fix: VIPER11 pings first scan at 6.3nm, no re-fires, 3-min soak
heap 120MB).

**Note discovered during the sweep:** the "SPICY Cessna 172" flood was NOT
the rarity gate — those are Civil Air Patrol Skyhawks carrying US military
hex codes (ae…), auto-pinging via the military bypass. Fixed with
`SPICY.gaTypes` (military-flagged trivial GA must clear the tier) plus
nearest-first ping selection (the old items-order pick ran minutes-deep
queues on military-heavy evenings — that queue is also why verify-spicy's
synthetic F-16 timed out pre-fix).

**15-minute soak on final code (incl. atlas warp rotations): PASS.**
78 samples · p50 4.2ms flat throughout · worst p95 8.4ms → fps floor ≈ 119
· draws max exactly 350 (≤ budget) · maxRebase 0.3ms · zero page errors.
Heap: ~200MB NYC baseline; intercontinental warp legs spike to 700–960MB
(tile/texture decode churn — plausibly amplified by `TILES.maxThreads 10`)
and FULLY recover to 120–230MB between legs, so no leak — but the warp-leg
peak is a watch item for the still-outstanding on-hardware iGPU soak
(`node scripts/soak-fly.js 15` on the user's machine).

verify-rim's final form measures the GL canvas only (DOM label chips read
as false seams) with a per-row MEDIAN of per-column deltas AND additive
trail materials colorWrite-muted for the measurement frame — neon trails
parallel to the horizon defeat any band detector otherwise. All 6
style×altitude strips ≤ 17/255 on final code.
