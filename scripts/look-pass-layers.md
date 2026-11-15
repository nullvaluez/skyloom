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

4. **Round-1 close (third instance, 2026-11-15).** Kept the paused instance's
   work as it stood after a fresh capture showed it compiling and reading at
   every hero pose. One edit: the bank's base was a ruled line a few pixels
   above the horizon; it now thins over the lowest 14% of the tower and takes
   up to +0.3 more air mix in its lowest third, so the bases sink into the
   horizon haze.

5. **Round 2 (2026-11-15, after review).**
   - Bank shape: towers gather in clusters (a low-frequency cluster field scales
     each cell's cover and height), with clear gaps between groups, a bumpy low
     mass joining a group, smooth unions between neighbouring domes, a few
     towering cumulus per cluster (height 1, a column with a rounded crown;
     ordinary towers reach 0.6) and heavier turrets. Edges are soft
     (0.05-0.18 of the bank height, softer on far rings and at coarse
     footprints). `towerH` 2.3 -> 3.6, so the tall towers rise above the near
     deck from cruise (7 km eye) and height reads there.
   - Bases: under a tower (and under a dense cluster) the bank continues below
     the deck base down to sea level as a body that takes the horizon's own
     colour, so the bases sink into the horizon haze instead of floating over a
     strip of clear sky. Off for an eye above the deck (it was a grey veil over
     the ground at cruise).
   - Atmospheric perspective by ring: air mix 0.55x..1.25x `airMix` from the
     nearest to the farthest ring, the far ring also pulled 55% to the sky colour
     and 18% less opaque.
   - Golden hour: a low-sun weight from the true sun elevation (1 below 4 deg,
     0 above 22 deg). Bodies drop their ambient by half and go 75% of the way to
     0.55x the sky colour behind them (peach toward the sun, lavender away); the
     key lights only the upper tower (the cap); self-shadow eases at low sun so
     the cap is a lit crown, not a thin rim.
   - Night: a night weight (0 above -1 deg, 1 below -12 deg) removes the key
     from the bank and takes it 90% of the way to 0.4x the sky: dark
     silhouettes with no rim.
   - High layer at low sun: optical depth x(1 + 1.6 low), opacity
     x(1 + 0.96 low), warm gain on the fibres' sun light (0.9, 0.6, 0.3) x 1.6
     low, cover floor x1.5 (under the 0.3 cap).
   - Review blockers: the fine form fetch is guarded by `uLookForm.y>0.` (and
     the edge term by `uLookForm.x+uLookForm.y>0.`), so Medium, phone and Low
     do no extra fetch. `look-layers.js` defaults now equal the block. Dead
     `uLookBank2.w` / `uLookHigh.w` values are 0.

## Dials (`LOOK_LAYERS`)

`volume`, `bank`, `high` (0 = that layer exactly as before, shader text
removed). Sub-blocks: `vol` (occK, baseDark, rim, scatterB, baseTop), `form`
(erosion, fine, edge), `bankCfg` (startM, endM, towerH, cover, scaleM, opacity,
airMix), `highCfg` (coverFloor, coverCap, opacity, fibre, slantCap, fadeM,
lowSun, lowSunCover), `sun` (goldenDeg, nightDeg).

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

- Round 2: a dome profile of (1-d^2)^0.6 read as bells; sqrt (round) kept.
- Round 2: the sinking base as a haze skirt for every eye: from cruise it laid
  a grey veil over the ground band at 60-150 km. It is off above the deck.
- Round 2: at golden hour bodies pulled fully to the sky colour vanished and
  left only the lit crowns, an outline; they now go to 0.55x the sky.

## Round 1 capture (`layers-r1`, RTX 5080, 2026-11-15)

`compare/baseline__vs__layers-r1`: mean absDiff 10.9, 28% of pixels changed.

| shot | changed | mean luma delta | shimmer base -> r1 |
|---|---|---|---|
| nyc-cruise noon | 26.7% | +2.44 | 0.116% -> 0.110% |
| nyc-cruise golden | 21.9% | +1.97 | 0.114% -> 0.081% |
| powell noon | 28.2% | +0.67 | 0.831% -> 0.512% |
| powell golden | 22.0% | +1.07 | 0.289% -> 0.104% |
| rio noon | 42.5% | -11.34 | 0.575% -> 0.361% |
| nyc-harbor golden | 16.2% | +0.53 | 0.406% -> 0.213% |
| nyc-harbor night | 20.5% | -2.55 | 0.414% -> 0.224% |
| nyc-street noon | 27.6% | +1.49 | 1.999% -> 1.243% |
| alps noon | 46.7% | -22.17 | 0.234% -> 0.153% |

Every shimmer number is at or below baseline. Rio's luma drop is 8.9% of its
127.4 mean (inside rule 7's 12%): partly the big near cumulus moving (cloud
phase), partly this flag's darker cloud bodies. Alps did not settle
(sun 35.9 deg against the baseline's 23.2): the baseline's frame-filling near
cloud is not in that capture, so its delta is the pose, not this flag.

Incident: the first r1 run went black from alps onward because a comment-only
edit to `fly-constants.js` hot-reloaded the page mid-capture; the five shots
were recaptured with no edits in flight. Do not edit while a capture runs.

## Round 2 capture (`layers-r2`, RTX 5080, 2026-11-15)

`compare/baseline__vs__layers-r2`: mean absDiff 12.1, 32% of pixels changed.
The three golden shots were re-captured into the label after the last bank
edit (low-sun only code; the noon and night frames are unaffected by it).

| shot | changed | mean luma delta | shimmer base -> r2 |
|---|---|---|---|
| nyc-cruise noon | 27.5% | +2.43 | 0.116% -> 0.076% |
| nyc-cruise golden | 37.4% | +6.28 | 0.114% -> 0.083% |
| powell noon | 29.6% | +0.74 | 0.831% -> 0.860% |
| powell golden | 31.9% | +4.12 | 0.289% -> 0.134% |
| alps noon | 42.1% | -17.48 | 0.234% -> 0.246% |
| rio noon | 39.9% | -10.31 | 0.575% -> 0.562% |
| nyc-harbor golden | 31.3% | +2.00 | 0.406% -> 0.218% |
| nyc-harbor night | 25.4% | -3.72 | 0.414% -> 0.340% |
| nyc-street noon | 25.3% | +2.14 | 1.999% -> 1.978% |

Every shimmer number is within 1.25x of baseline (worst powell noon 1.03x).
Alps: the review asked for a re-capture because "the sun was wrong". The
manifests disagree: `baseline`, `baseline-a`, `layers-r1` and `layers-r2` all
hold alps noon at sun 35.88 deg with `worldSettled:false` (the pose times out at
150 s in every label, the baseline included). A second r2 attempt
(`layers-r2-alps`) gave the same. The luma drop is the big near cumulus drifting
out of frame: the two baseline runs alone differ by absDiff 13.6 and luma 7.4 on
this shot. Rio's -10.3 (8.1% of 127) is the same effect plus the darker bodies,
inside rule 7.

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

- Round 2 re-run: `verify-true-earth-flags` 8/8, `verify-cloud-calm` 6/6,
  `verify-phys-sky` 12/12, `verify-true-scale` 14/14, `verify-hdr-guard` 4/4;
  `verify-living-sky` 20/1 (1c), `verify-ship-sky` 47/2 (SK-3 l, TEXT a),
  `verify-r25-sky` 47/2 (4h, 4i): the same rows as round 1 and as
  `look/integration`. eslint clean on the three changed files.
- Shader variants (rule 6): no `customProgramCacheKey` segment. The march is a
  ShaderMaterial keyed by its fragment source; every Look edit is in text that
  only exists with a dial above 0, so the flag-off source is byte-identical and
  cannot collide with the flag-on program.

## Cost

No new pass, target or draw. Per cloud-resolution pixel in the march: the bank
early-outs unless a ring's crossing lies in the bank's height band (a band of
rows at the horizon), then 2 tower-field reads per ring (9 cells x 3 hashes,
two octaves); the high layer is 3 noise-volume fetches where the layer is
present; the form edit is one extra 3D fetch per primary sample with a
footprint under ~100 m and at an edge. No fps reading on this machine yet.

Round 2: the bank now costs 2 field reads per ring that hits its height band,
each read 18 dome hashes (two octaves of 9 cells) plus 2 value-noise lookups
(cluster, mass), and one `cinemaSky` per pixel that meets a tower. Medium,
phone and Low: identity uniforms, the bank and high layer early-out on a
uniform compare, and the form edit fetches nothing (`uLookForm.y` is 0 there),
so the added work on those tiers is a few ALU ops per sample. No cloud-pass
timing was taken on Medium this round (no GPU timer in the capture harness).
