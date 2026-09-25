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
  range is 10–12 km), the body recedes to a faint hairline by 36 km, the
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
(> ~20°). They now draw after the cloud composite (they were erased against
the sky before).

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
  fixture's own ~300 tracks, engine and camera frozen, max-channel ON/OFF Δ.
  RESULTS: see §4.1.
- `verify-tracers.js` gained a satellite rerun of its backfill/cut gates.

### 4.1 Pixel gate results

(filled in below)

## 5. Not certified

- The pixel legs for the cloud gate (trail behind a deck), the 150–185 km
  range fade, the 100 km R11 over-terrain ghost probe, the 600-track priority
  cap and tier low were specified but not built into the browser gate.
- By day a trail BELOW the eye crosses the bright horizon haze, where white
  vapour is low-contrast (Δ 6–12 on the fixture's bright procedural ground);
  its head glint carries it within reach. Real imagery is darker — check on
  the user's machine.
- Every fps / frame-time number belongs to the user's machine.
