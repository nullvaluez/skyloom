# Look Pass, stream D (LAYERS): ledger

Flag `LOOK_LAYERS` (block at the end of `lib/fly/fly-constants.js`, read only
through `lib/fly/look-layers.js`). `?flags=-LOOK_LAYERS` is the baseline look.
Desktop High and Ultra cinema profiles only (`lookLayersProfile`); Medium,
phone and Low get the identity uniforms.

## What was wrong (baseline frames, `main` at 2a0c563e)

- One cloud layer. Above the 1.5-2.6 km cumulus deck the sky was empty blue at
  every pose; `CIRRUS` ships off (fish-scale value-noise ridges, 2026-10-20).
- Nothing on the horizon. From Powell, the harbour and Rio the horizon is a
  bare line: the volume fades out at 16-22 km (`R25_SKY.cloudAir`) and the far
  deck is one mid-deck shell sample, which from below collapses into thin
  lenses a few pixels above the horizon.
- Cumulus were evenly white blobs: the ambient was not shaded by the cloud
  above a sample, the deck floor saw as much sky as the crown, and the cellular
  body (85 m voxels, trilinear) with a weak 0.18 erosion octave gave soft
  cotton edges with no lobes.

## What changed (all in `lib/fly/living-clouds.js`, gated by dials)

1. **Horizon bank** (`bank` dial). Four rings of cumulus towers at fixed ground
   distances (~59, ~85, ~115, ~150 km), front to back, in the Enhanced march.
   Each ring is one exact sample: where the ray crosses that distance it is
   inside a tower when the tower field's top stands above the ray's true
   height. Towers are a union of rounded domes on a jittered periodic lattice
   with a 3x finer crop of turrets on top, flat bases, self-shadowed sunward,
   darker low on the tower, hazed by the far-deck air law (`airMix` 0.6). The
   bank stands down for an eye above the bank tops (cruise), where its rings
   would read as cards.
2. **High layer** (`high` dial). The CIRRUS layer re-enabled under this flag on
   a new field: fibres from the cellular noise volume stretched 6:1 and bent by
   a kilometre-scale field (the checkpoint's work), with a cover floor/cap,
   a lower grazing slant cap (8 -> 2) and a fade at 30-120 km so grazing fibres
   no longer stack into rows of white ripples near the horizon.
3. **Cloud body** (`volume` dial). Sky light is shaded by the key's optical
   depth (bulk above), the deck floor keeps 50% of the ambient rising to full
   by 60% of the deck height (flat shaded bases), a sunward silver rim, and
   lower octave scattering persistence (0.52 -> 0.40). New: the density's
   edges billow (`form`): the existing erosion octave and a finer cellular
   octave (10/8 frequency, ~100-200 m lobes) are added zero-mean where the
   density is low, so coverage holds and silhouettes break into lobes. The fine
   octave fades to its mean by footprint and is not fetched past it.

## Dials (`LOOK_LAYERS`)

`volume`, `bank`, `high` (0 = that layer exactly as before, shader text
removed). Sub-blocks: `vol` (occK, baseDark, rim, scatterB, baseTop), `form`
(erosion, fine, edge), `bankCfg` (startM, endM, towerH, cover, scaleM, opacity,
airMix), `highCfg` (coverFloor, coverCap, opacity, fibre, slantCap, fadeM).

## Tried and rejected

- Bank as stacked shells (checkpoint): edge-on from below the deck the shells
  collapse into one white band on the horizon; nothing read as towers.
- Bank as a 20-28 step ray march over a value-noise heightfield: speckle with a
  white per-step jitter, diagonal hatching with an interleaved-gradient jitter,
  ripple terraces and translucent curtains seen from cruise.
- Value-noise tower tops on rings: crisp but pointed, read as snow mountains.
  Replaced by the union of domes.
- Bank from cruise: tombstone cards; it now stands down above the bank tops.
- LIGHT_SHAFTS: not attempted this round (the plan allows it only with clean
  stills and burst; no time to certify). It stays off.

## Gates

- `verify-true-earth-flags` 8/8, `verify-cloud-calm` 6/6, `verify-phys-sky`
  12/12, `verify-true-scale` 14/14, `verify-hdr-guard` 4/4.
- `verify-living-sky` 20/1, `verify-ship-sky` 47/2, `verify-r25-sky` 47/2: the
  same failures as `look/integration` (c0f11f36) with no LOOK edits (1c is the
  shipped REAL_MOON merging the Living uniforms; SK-3 (l) and TEXT (a)
  aerialEnhanced/aerialMerged; r25 4h/4i), measured on that worktree.
- `verify-ship-sky.mjs` edited: every leg pins `LOOK_LAYERS` off, because its
  TEXT rows hash the Ship Pass program texts against main (the march gained
  this flag's text). Without the pin TEXT (a) also listed `march`.
- The checkpoint's bank and high layer were not gated on the Living World
  flags, so `verify-living-sky` (1a) failed (Living code in the march with
  every Living flag off). Both now ride `FAR_CLOUDS` / `LIVING_CLOUDS`.
- `npx eslint` on the changed files: clean.

## Cost

No new pass, target or draw. Per cloud-resolution pixel in the march: the bank
early-outs unless a ring's crossing lies in the bank's height band (a band of
rows at the horizon), then 2 tower-field reads per ring (9 cells x 3 hashes,
two octaves); the high layer is 3 noise-volume fetches where the layer is
present; the form edit is one extra 3D fetch per primary sample with a
footprint under ~100 m and at an edge. No fps reading on this machine yet.
