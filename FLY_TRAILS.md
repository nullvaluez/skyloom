# Spotter Trails — traffic trails you can see again (2026-09-25)

Branch `claude/contrails-visibility-enhancement-elh1ea`. User report: *"We used
to be able to see contrails of other planes as indicators with long lines, it
seems like they're gone now … so we can spot other crafts in the distance."*
Follow-up after the first build: *"they now appear TOO prevalent and almost
like a star"*, especially far traffic you cannot click.

## 1. Why they vanished (three stacked causes, all satellite)

1. **The cloud composite erased them.** `ImmersiveCloudPass` (always on
   since `f0cd81e`) treats every pixel with no depth as sky and does
   `scene = mix(scene, sky, day)`. Tracers, far billboards, engine plumes and
   the player's contrail are all `depthWrite:false`, so against the sky they
   contributed exactly 0 at any sun above ~16°. The player's twin contrails
   (`798885a`) are drawn the same way, so the same pass wiped them wherever
   sky was behind them.
2. **They were dimmed to nothing.** `SATELLITE_VISUALS.presentation`
   (`be711f2`) set `trailGain 0.18` / `trailWidth 0.25` — a sun gain of 0.068.
3. **They were sub-pixel and rim-killed.** World-metre widths collapse below
   a pixel past ~10 km, and the ground rim fade (`uEdgeFade`, 60–120 km
   world) killed sky-backed traffic along with the terrain.

## 2. What shipped

- **`SkyOverlayPass`** (`lib/fly/sky-overlay-pass.js`): registered
  depth-less airborne marks move to layer 29 while the cloud pass is in the
  chain and are drawn right after it, before bloom, depth-tested against the
  real scene depth. Draw totals are unchanged. The toy (Neon) style never
  mounts the cloud pass, so its frame is unchanged.
- **Overlay cloud gate** (`lib/fly/overlay-gate.js`): a cloud in FRONT of a
  mark still hides it — this frame's cloud-march transmittance raised to the
  fraction of the slab in front of the mark. Lines are fully occluded; point
  marks keep `SKY_OVERLAYS.cloudGate.markFloor`.
- **Spotter trails** (`TRACERS.spot`, `lib/fly/tracer-spot.js`,
  `<SpotTracers>` in `TrafficTracers.jsx`): one draw, 96 near + 416 far rank
  slots by priority (in view, then distance); trail length grows with range
  (4 km → 14 km); a pixel-width floor corrected for the air bend so far lines
  never break into dots; premultiplied optical blend — by day near-white
  vapour that cannot bloom (R16), by night the altitude-band neon; a soft head
  glint dot; tracer-owned range fade (150–185 km true) for sky-backed traffic.
- **Calm far traffic.** Prominence follows reach
  (`TRACERS.spot.prominence`, `spotProminence()`): full within 15 km (lock-on
  range is 10–12 km), the body recedes to a faint hairline by 34 km, the
  glint, head boost and white core are gone by 30 km, and at night every
  emissive mark also dims to 0.22 by 32 km (additive light over a black sky
  reads at any level). The locked/inspected target is exempt.
- **Far-LOD dots** recede toward the LIVE scene haze (`scene.fog`, driven by
  the time-of-day rim) past 30 km, so they sink into the night instead of
  turning pale.

Rollback: `TRACERS.spot.enabled:false` restores the legacy satellite ribbon —
still drawn after the clouds but without the cloud gate.
`SKY_OVERLAYS.cloudGate.enabled:false` restores the pre-gate program keys.

## 3. Player contrails

`798885a`'s twin engine contrails are unchanged in behaviour: they form above
`AIRCRAFT_EFFECTS.minAltM` 5,800 m (~FL190), full by 9,200 m, at 55–115 m/s+.
Below ~6,500 m you get wingtip vapour instead, in fast (> 105 m/s) hard banks
(> ~20°). They now draw after the cloud composite. Side view at FL310 on the
fixture (fighter, 180 m/s, orbit ~80°): with the overlays deferred the two
engine lines stream off behind the jet; the same frame drawn in the main
pass (`window.__flySkyOverlays.setDeferred(false)`, the pre-branch path)
shows neither them nor any traffic trail against the sky.

## 4. Verification (offline fixture — NOT a GPU)

The cloud container 403-blocks the tile hosts and renders with SwiftShader at
~1 fps, so every number below is the fixture's. Nothing here has been seen on
the user's machine.

- Node gates: `verify-tracer-spot.mjs` 32/32 (layout, gains, night falloff,
  R16 chroma incl. overcast, pixel floors vs the real `airDrop`, length law,
  decimation, shader integrity vs three's `ShaderLib.basic`, program keys,
  source contracts); `verify-aircraft-effects.mjs`, `verify-import-integrity.mjs`,
  `verify-c-flagoff.mjs`, `graphics-unit.mjs` pass.
- Browser gate `verify-traffic-trails.cjs` (`FLY_TILE_FIXTURE=1`): 15
  synthetic targets 4–80 km above and below the eye, ISOLATED from the
  fixture's own ~300 tracks, fixes stamped on the engine clock and pinned at
  full opacity, engine and camera frozen, ON/OFF Δ per probe window
  (max-channel for visibility, luma for "subtle"). **24/24 PASS** — §4.1.
- `verify-tracers.js` gained a satellite rerun of its backfill/cut gates:
  9/9 PASS (toy and satellite, zero page errors).

### 4.1 Pixel gate results

Final run (tip of the branch), head Δ as `max-channel / luma`, 3,000 m eye,
distances are the harness's WORLD km (true ≈ ÷1.32 at 40.7°N):

| leg | in reach, sky-backed (9 / 16 / 26 km) | far (40 / 60 / 80 km) luma | head-on 26 km |
|---|---|---|---|
| noon | 112/74 · 160/110 · 167/115 | 26 · 24 · 23 | 182/130 |
| dusk | 108/90 · 92/75 · 80/61 | 12 · 12 · 11 | 88/69 |
| night | 197/195 · 196/186 · 187/167 | 15 · 13 · 12 | 183/167 |

Far lines stay PRESENT (16/16 continuity samples at every far range, every
leg). For comparison, the pre-fix night (isolated targets, before the
opacity pin — so a lower bound) read far heads at max-channel 120 / 65 / 60
against 23 / 19 / 19 now.

How the harness got here matters as much as the numbers — four instrument
defects were found and fixed before a number was trusted:
1. The A/B toggled the whole tracer group while the fixture's ~300 tracks
   drew trails through every sample window (far rows all read ~130–150).
2. Targets shared elevations (trails overlapped); later, a shared 700 m
   altitude clamp stacked the four far below-eye targets on one line.
3. Outward-flying targets drifted their near heads off-screen.
4. Fixes stamped with the fixture's newest fix time froze some runs at the
   engine's 0.6 stale opacity and others at 1.0 — a 1.6× swing between runs.
The "subtle" bound is judged in luma because a white hairline over the
deep-blue upper sky moves the dark red channel most (max-channel ≈ 1.6×
luma there).

## 5. Not certified

- The pixel legs for the cloud gate (trail behind a deck), the 150–185 km
  range fade, the 100 km R11 over-terrain ghost probe, the 600-track priority
  cap and tier low were specified but not built into the browser gate.
- By day a trail BELOW the eye crosses the bright horizon haze, where white
  vapour is low-contrast (Δ 6–12 on the fixture's bright procedural ground);
  its head glint carries it within reach. Real imagery is darker — check on
  the user's machine.
- Every fps / frame-time number belongs to the user's machine.
