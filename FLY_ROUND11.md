# Fly Round 11 — "Satellite, For Real" (2026-07-18)

The satellite ("Day") default shipped in round 10 §7 — but satellite was
never perf-certified (every harness seeds `'toy'`), and the user's first real
session on it lagged badly, showed sparse/random clouds, drew far low-altitude
traffic "buried" in the ground, and scattered contrails everywhere. A 3-agent
root-cause pass proved the round-10 commits touched almost no render code:
**every symptom was the satellite path itself becoming the default.** This
round makes satellite the *certified* default: perf floor + adaptive tier,
a physically-motivated traffic horizon, sunlit clustered clouds, and the
round-8 monuments finally mounting in Day.

## 1. What was wrong (root cause, confirmed)

- **Lag** — satellite streams real Esri RGB to z17 with 8× anisotropic
  filtering on every tile, DEM hillshade, z15 DEM, and satellite-only cloud
  shadows. Toy draws solid-ink tiles. On top: an unsaved player mounted the
  TOY world first and PauseMenu hot-swapped to satellite AFTER mount — both
  pipelines built on every fresh boot.
- **"Buried" planes** — the lift math was fine (labels ride the same lifted Y
  as sprites). The offenders were LOW-altitude far traffic (2–3k ft @
  26–61nm): they legitimately sink below eye on the curve, and toy's ground
  dissolved at 14–26km so you never saw them against terrain — satellite
  keeps ground visible to 60–120km, so they drew ON the farmland. There was
  no per-aircraft horizon concept (POI letters gained one in round 10;
  traffic never did).
- **Contrails "all over"** — same far-visibility story: tracers stayed alive
  4–8× farther out in satellite. (Bonus: the player's own Contrail was the
  only trail with NO world-bend patch.)
- **Clouds** — `CLOUDS.byStyle.satellite` was always different: altMin 900
  (sinks under the rim sooner than toy's 1400), unlit flat-white
  MeshBasicMaterial the day sun never touched, 54 uniform-hash puffs reading
  clumpy on bright imagery.
- **Zero landmarks** — monuments + TownGlow were toy-only mounts.

## 2. What round 11 changed

### 2a. Boot: satellite resolves BEFORE the canvas mounts
- New [lib/fly/map-style.js](lib/fly/map-style.js): `MAP_STYLE_KEY`/
  `MAP_STYLES` moved out of PauseMenu + `resolveInitialMapStyle()` (saved
  style wins; 'night'→'toy' migration; unsaved → 'satellite' persisted).
- `FlyMode` calls it synchronously in the spawn effect — FlyCanvas mounts
  only after spawn resolves, so the once-built TerrainEngine sees the final
  style. **The toy pipeline is never built for an unsaved player**
  (`window.__toyWorld` stays undefined — verify-round11 gate A).
- Store literal `mapStyle: 'toy'` unchanged (harness seeding is sacred).

### 2b. Perf floor + adaptive tier (all in fly-constants.js)
- `HILLSHADE.anisotropy` **8 → 4** + `anisotropyByTier {high:4, medium:4,
  low:2}` — applied to NEW tiles only (imperative tier read in FlyScene's
  onTileMaterial hook; no re-upload hitch on degrade).
- `HILLSHADE.strengthByTier {high:.55, medium:.55, low:.35}` — live uniform,
  FlyScene's hillshade gate is now tier-aware.
- `TILES.satMaxZoom` **17 → 16** (revert-knob; z17 quadrupled low-AGL churn).
- `CLOUDS.shadow.minTier: 'high'` — cloud shadows are a high-tier luxury
  (CloudField gates `wantShadows`; mesh.visible flip, no stale discs).
- PoiLetters deliberately untouched (round-10 horizon cull already bounds
  its cost; the 1719-city scan is 0.5Hz — measured non-factor).

### 2c. Traffic horizon fade (`TRAFFIC_HORIZON` + world-bend `horizonFade()`)
A plane is visible while its **world-XZ** distance < combined horizon
`D = sqrt(eyeAlt/k)·playerFrac + sqrt(planeAlt/k)·planeMul` (k = live
altitude-flattened bend uniform — the LETTERS sqrt(alt/k) family, so the
radius grows with cruise altitude for free). `planeMul 2.5` mirrors
`trafficBend.farLiftBoost`: deliberately-lifted high traffic never fades
while visible (FL370@42nm stays; a 2,000ft GA@28nm melts out). Smoothstep
band `[D·0.95, D·1.2]`, `minVisM 30000` floor.

Computed **once per aircraft CPU-side** in TrafficLayer (-45, after
setBendEye -50) and stamped on the shared track item — folded into the
EXISTING fade channels, so there is no new GPU uniform and no GPU/CPU mirror
to drift:
- sprites/models/billboards: `eff = opacity × horizonFade` into the fog-lerp;
  ≤0.02 skips the instance entirely (overdraw win; `__flyStats.horizonFaded`)
- tracers (ribbon + streak): × into the per-track gain, OUTSIDE
  `displayAlphaFor`'s alphaFloor (the floor defeats poll starvation and must
  not keep beyond-horizon ghosts alive)
- labels (LabelCanvas): ≤0.05 skips BEFORE the hits push (no ghost labels,
  no ghost click targets); else × alpha outside the 0.25 stale-floor
- minimap intentionally still shows beyond-horizon traffic (radar, not eyes);
  soft-lock may still range a faded plane — accepted.
- Player Contrail now rides `applyBendAir` (shared compiled program; subtle
  far-tail dip — it was the one unbent trail).

### 2d. Sunlit clustered clouds (satellite)
- Band raised `altMin 900 → 1500`, `altMax 3600 → 4200`.
- `CLOUDS.clusters {count:6, radiusM:3200}` — deterministic hash cluster
  centers, puffs on discs round-robin (`i % count`), tier cuts thin every
  cluster. Same `hash()` family — layouts stay harness-stable. (Layout is
  shared with toy — its 0.26-opacity wisps tolerate it; per-style gate is
  the fallback knob if Neon eyeballs complain.)
- `CLOUDS.dayTint {bright '#ffffff', warm '#ffd7ae', dim '#a9b6c6',
  warmBand 0.45}` — FlyScene publishes `runtime.sun {frac, az, el}` on its
  60s day-cycle cadence; CloudField samples every ~10s and lerps dim → warm
  → bright into the drei `<Cloud color>` prop (+ opacity ×(0.7+0.3·frac)).
  Material stays MeshBasicMaterial — tinted, not lit.

### 2e. Monuments in satellite
- FlyScene mounts LandmarkMonuments in BOTH styles (`key={mapStyle}` clean
  remount, `mapStyle` prop). +10 structural draws in satellite.
- Style split mirrors CloudField's `isToy`: **ground = raw DEM** (no toy
  ×1.7 + lift); material = `MeshLambertMaterial(LANDMARKS_3D.satStyle.color
  '#cfc8ba')` lit by the day sun/hemi (neon vertex palette off); halo down
  to `satStyle.haloOpacity 0.1` (0 disables the draw). `applyBendAnchor` in
  EVERY style (rigid ground objects anchor-bend — round-6 shear lesson).
- PoiLetters' three monument gates (`monumentMinDistK` near-approach,
  `sepExempt`, `letterLiftM`) dropped their toy-only check — landmark
  letters float above their monuments in satellite too.
- `LANDMARKS_3D.maxRangeM 26000` unchanged — in satellite (fade starts at
  60km) it is a range/perf knob, not the silhouette clamp it is in toy.

## 3. Files touched

`lib/fly/map-style.js` (new) · `lib/fly/fly-constants.js` (HILLSHADE, TILES,
CLOUDS, TRAFFIC_HORIZON, LANDMARKS_3D.satStyle, GLOBE comment) ·
`lib/fly/toy-world/world-bend.js` (`horizonFade`) · `lib/fly/poi/index.js`
(docstring) · `components/fly/FlyMode.jsx` · `PauseMenu.jsx` ·
`FlyScene.jsx` (tier wiring, runtime.sun, monument mount, dev
`__flyHorizonFade`) · `CloudField.jsx` · `TrafficLayer.jsx` ·
`TrafficTracers.jsx` · `hud/LabelCanvas.jsx` · `Contrail.jsx` ·
`LandmarkMonuments.jsx` · `PoiLetters.jsx` · `stores/fly-store.js` (comment)
· `scripts/verify-sat-depth.js` (aniso ≥4, z16, draws ≤375, tier pin) ·
`scripts/verify-monuments-sat.js` (new) · `scripts/verify-round11.js` (new).

## 4. Live-tune sign-offs (all knobs in fly-constants.js) — PENDING USER

| Knob | Default | Question for the eyeball |
| --- | --- | --- |
| `HILLSHADE.anisotropy` / `anisotropyByTier` | 4 / {4,4,2} | Far terrain sharp enough at grazing angles? |
| `TILES.satMaxZoom` | 16 (was 17) | Low passes crisp enough? (17 = revert knob) |
| `HILLSHADE.strengthByTier.low` | 0.35 | Relief still readable on a degraded tier? |
| `TRAFFIC_HORIZON.planeMul` | 2.5 | High traffic never melts while visibly lifted? |
| `TRAFFIC_HORIZON.fadeStartFrac/fadeEndFrac` | 0.95 / 1.2 | Fade band smooth, no popping ring? |
| `TRAFFIC_HORIZON.minVisM` | 30000 | Nearby low GA never fades? |
| `CLOUDS.byStyle.satellite.altMin/altMax` | 1500 / 4200 | Deck height feels right at cruise? |
| `CLOUDS.clusters.count/radiusM` | 6 / 3200 | Reads as weather, not blobs? |
| `CLOUDS.dayTint.*` | see block | Golden hour warm enough, pre-dawn not muddy? |
| `CLOUDS.shadow.minTier` | 'high' | OK that medium loses cloud shadows? |
| `LANDMARKS_3D.satStyle.color/haloOpacity` | '#cfc8ba' / 0.1 | Stone reads under daylight; halo subtle enough? |
| `TRACERS.styleGain.satellite` | 1.0 (unchanged) | Contrail density OK now that far ones fade? |

## 5. Verification

- `npm run build` — clean.
- **verify-round11** (new): (A) unsaved-player boot → satellite pre-mount,
  key persisted, `__toyWorld` never defined; (B) horizon fade — 610m@52km
  ≤0.05, 11,280m@78km ≥0.95, minVisM floor, live tracks stamped, stat
  matches skip-count; (C) noon tint ~white / dusk tint off-white,
  cloudMinAgl clears; (D) draws ≤480, zero errors. — RESULT PENDING
- **verify-monuments-sat** (new): 9 pools + halo in satellite; Christ the
  Redeemer placed ≤300m; **raw-DEM ground gate** (Corcovado ~700m — toy
  exaggeration would read ×1.7); height sane; toggle draw-delta 1–15; draws
  ≤480. — RESULT PENDING
- **verify-sat-depth** (updated): aniso gate ≥4, z16 regex, draws ≤375
  (monuments +10), tier pinned high. — RESULT PENDING
- Regression sweep (toy invariants): verify-poi ×2, verify-monuments,
  verify-atlas, verify-neon-city, verify-boot, verify-tracers,
  verify-airbend, verify-chase-cam, verify-sun, verify-style-retire. —
  RESULT PENDING
- Do NOT run harnesses while the user live-tests (round-7 lesson).

## 6. Lessons

1. **A default flip is a certification event.** Round 10 §7 flipped the
   default to a path no harness ever exercised — the perf suite stayed green
   while real users lagged. When the default changes, the certified path
   must change with it (verify-round11 gate A now boots the REAL default).
2. **The horizon is a two-body problem.** The round-10 letter cull
   (`sqrt(alt/k)`) only needed the player's altitude; traffic needs
   `sqrt(eye/k) + sqrt(alt/k)` — and the plane's term must carry the same
   boost the lift gives it, or the fix fights the round-7 fix.
3. **Fold new fades into existing channels.** horizonFade rides the
   opacity/gain/alpha paths that already existed — no new uniform, no
   GPU/CPU mirror pair to drift, and the floors (alphaFloor, label 0.25)
   stay meaningful by multiplying OUTSIDE them.
4. **Style-conditional costs hide in configs, not code.** Clouds "regressed"
   without a single cloud commit — `byStyle.satellite` was simply never the
   daily driver. Grep the per-style config blocks when a style flip changes
   behavior.
5. **Anchor assertions where the delta is loud.** The raw-DEM monument gate
   at sea-level Liberty would pass under toy exaggeration too (0×1.7=0);
   Corcovado's 700m makes the same bug a 490m failure.
6. **Resolve-once caches freeze stream-in races.** PoiLetters cached
   `poi.elev` on first non-null answer — a mountain letter selected before
   its DEM streamed stood at ~0m forever while its monument (re-sampling
   every placement tick) healed to the summit. Anything sampled from a
   streaming source needs a heal path, not a one-shot cache. (Found by the
   new Corcovado gate on its first run.)
