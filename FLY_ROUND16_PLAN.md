# Fly Round 16 — "Living World" (2026-07-24) · STATUS: EXECUTED — see FLY_ROUND16.md

Satellite-first round off live R15 flying. User direction (explicit, collected via
structured Q&A): **visual immersion + UI/UX polish**; the two felt gaps are
**"the ground feels empty"** and **"the sky is static"**; gameplay-depth features
are explicitly NOT this round's priority; **desktop AND phone are equal
first-class targets**; R15 §6 pending checkpoints FOLD IN (one combined sign-off
at round end). Scope decisions (user-locked): (1) REAL live weather at the
player's position via keyless sources + rain/fog states + living-sky fixes;
(2) night-first ground life (city light network, runway lights, cull-fade) plus
subtle daytime road motion; (3) a full pilot logbook surfacing the passport
store; (4) time-of-day-aware tracers in satellite.

Execution model: **five Opus 5 implementor subagents in two waves** (user cap;
explicit user request for Opus implementors on usage-economy grounds) under
Fable orchestration — Fable diagnosed, designed via three Plan agents, briefs,
reviews every diff, arbitrates, runs all browser harnesses, captures evidence,
authors commits/PRs. Baseline: `64f03b4` on
`claude/satellite-mode-game-enhancements-d9604c` (clean). Record doc will be
`FLY_ROUND16.md`.

---

## 0. Why / diagnosis (all confirmed in source pre-launch)

1. **Night satellite ground is a black void.** The worker's satellite path
   (`vector-tile.worker.js:982`, `detail === 'sat-buildings'`) parses ONLY
   `building` + `water`; the OMT `transportation`/`aeroway` layers in the SAME
   tiles are discarded. Every ground-light system (ROAD_PULSE, RUNWAY_LIGHTS,
   TOWN_GLOW/TOWN_CORES, BEACONS) is toy-only. The only satellite night light is
   building emissive windows (tier high, hard-culled above 2800 m AGL —
   `sat-building-engine.js` `_ringOn`, a pop flagged in FLY_ROUND13.md CP#2).
2. **The sky cannot vary.** One static cumulus deck (`CloudField.jsx`, 6 hashed
   clusters, band 1500–4200 m); zero precipitation/overcast/visibility code
   anywhere in `lib/` or `components/`; HDRI cycle is 4 discrete buckets with a
   HARD `<Environment key>` remount per crossing (`FlyScene.jsx:963-977`);
   `uStars`/`uMoon` are forced 0 in satellite (`FlyScene.jsx:986,988`) though the
   SkyDome shader terms exist; bloom is static per style (`Effects.jsx:27-30`).
3. **The sun model is longitude-only** (`FlyScene.jsx:501-502` — `localH = UTC +
   lon/15`, no latitude/declination/date): Alaska and the equator share a sun;
   no seasons, no polar night, hillshade sun can disagree with the HDRI's baked
   sun.
4. **The passport is a built data layer with ZERO UI.** `stores/passport-store.js`
   persists up to 1000 spots, 24 badges (`lib/badges.js`) that unlock SILENTLY,
   and rich stats — the only rendered value is `stats.totalSpotted` (one desktop
   HUD cell). `getBadgeProgress`/`getBadgesByTier`/`BADGE_TIERS` have no
   consumer. `daily_streak_7` has no unlock case (dead badge). Quality tier +
   sound are not persisted (reset every session).
5. **Neon tracer ribbons render full-strength over daylight photography**
   (`TRACERS.styleGain.satellite = 1.0`) — a toy signature clashing with the
   realistic style by day.

## 1. Verified ground truth (contracts this round must not break)

- `WORKER_PROTOCOL = 12` (`vector-tile.worker.js:56`); pins at
  `toy-world-engine.js:41` + `sat-building-engine.js:28`. Protocol-mismatch
  bundles are DROPPED by sat-building-engine (`:395-405`) — the R15 sentinel
  contract. Bump rule: any transferable-layout or detail-vocabulary change.
- `verify-sat-depth.js:148-153` gates **draws ≤ 261** at Owens Valley
  (36.601, -118.06, altM 500, tier pinned high, `__flySunOverride = null` =
  wall clock). R15 measured 246. **That scene contains roads** (US-395 trunk,
  CA-136 secondary, Lone Pine grid, 2 OSM airstrips) — the new road ring WILL
  add draws there.
- `verify-boot.js:112-114` computes its sun-at-spawn `expected` by replicating
  the longitude-only formula INLINE — it breaks under a latitude-aware model in
  non-summer months (NYC Dec: Δ0.43 > 0.2). `verify-sun.js` pins July 17 2026
  via `__flySunOverride` and survives the new model unchanged (computed).
- `scripts/_boot.js` `bootFly()` is the shared boot for the whole browser fleet;
  it already seeds localStorage via `addInitScript`.
- `CloudField.jsx:284` drift is `CLOUDS.driftMps * t` — **rate × total-elapsed
  product**; a live wind change must go through an integrator or the deck
  teleports (R13 satSmooth lesson class).
- SkyDome is a standalone ShaderMaterial (NOT a world-bend variant) — its GLSL
  edits need NO cache-key bumps. All rim-triple writes are uniform value-writes.
- Passport spot shape: `{ hex, flight, registration, type, classification,
  timestamp, rarity (number 0-100), location: {lat,lon}|null }` — multiplicity =
  multiple entries per hex (deduped per-hex-per-hour), NO count field.
  `stats.uniqueTypes` Set persistence is already correct (partialize/merge).
- Tracer gates are COUNTS (`__flyStats.tracers`, `tracerBackfills`) — never
  brightness. verify-edge-fx's 45 s stability window runs in TOY.
- `verify-classify.mjs` gates i2/i6 rebuild old/new rarity chains from CURRENT
  source: a bonus added to BOTH `EXACT_TYPE_BONUS` and legacy
  `TYPE_RARITY_BONUS` at the same value passes with zero harness edits (4-char
  patterns only self-match among ≤4-char designators; verified no substring
  stacking for the five codes below).
- Network allowlist VERIFIED 2026-07-24: `api.open-meteo.com/v1/forecast`
  (returns `current.cloud_cover` % etc., m/s wind) and
  `aviationweather.gov/api/data/metar?format=json&bbox=…` (returns `cover`,
  `clouds`, `visib` incl. the `"10+"` string, `wdir/wspd`, `rawOb`) both green.

## 2. Hard rules (ALL agents — violations are round-stoppers)

1. **NO API keys, no .env.** Keyless endpoints only, proxied via Next routes.
2. **Agents do NOT run browser harnesses or dev servers** (Fable runs the sweep
   post-integration). Node-only gates (`verify-classify.mjs`,
   `verify-warbirds.mjs`) are agent-runnable. **No commits, no pushes.**
3. **Zero harness gate re-baselines.** Three edits are PRE-SANCTIONED by Fable
   and no others: (a) `verify-boot.js` sun-formula mirror → call
   `window.__flySunModel` (semantics-preserving sync, owned by A5);
   (b) `scripts/_boot.js` one-line `window.__flyWeatherOverride='baseline'` pin
   (fleet determinism, owned by A5); (c) rarity dual-table adds (zero harness
   edits, owned by A3). **verify-sat-depth's 261 is NOT pre-sanctioned** — A2
   sheds via `SAT_ROADS.minFeatures`/`ring.r`/`maxChunks`; Fable measures at the
   Wave-1 checkpoint.
4. `lib/fly/fly-constants.js` is the user's: each agent appends ONLY its named
   blocks (table in §3); re-read the file immediately before editing; NEVER
   change existing values in `SAT_BUILDINGS`/`SKY`/`CLOUDS`/etc. (pending user
   sign-off scope). The store literal `mapStyle:'toy'` is sacred.
5. **Toy/Neon mode byte-unchanged.** New shader terms must multiply to exact 0.0
   with default uniforms; satellite-only mounts; no fetches in toy.
   verify-neon-*/verify-roofs/verify-poi are the proof gates.
6. Cache-key discipline: any generated-GLSL change bumps the FINAL
   `customProgramCacheKey` of every variant it reaches; register new variants in
   the `world-bend.js` header registry. New vertex attributes must FAIL DARK
   (missing attribute reads 0 → term multiplies to black), or the engine drops
   the bundle.
7. No per-frame React/zustand — `runtime` object + refs; zustand for discrete
   transitions only. React StrictMode is ON: idempotent creation, symmetric
   dispose.
8. Draw budgets (Appendix B): every new layer ≤ 1 draw/chunk or 0 (attribute on
   existing mesh); per-fragment cost must be tier-gated (draw gates can't see
   fill rate — R13/R15 lesson 6).
9. Assets: procedural CanvasTextures preferred; any download must be
   license-clean direct-download via `FLY_ASSETS` + `gen-credits.mjs` (never
   hand-edit CREDITS.md). Open-Meteo attribution (CC-BY 4.0) ships as a
   `kind:'data'` FLY_ASSETS entry.
10. Windows 11 + PowerShell 5.1 (no `&&` in PS). Never two dev servers on one
    `.next`. Never edit while the user live-flies.

## 3. Ownership (5 agents, 2 waves) — DISJOINT except noted seams

| # | Agent | Wave | Owns (files) | fly-constants blocks | Does NOT touch |
|---|---|---|---|---|---|
| A1 | WX-DATA | 1 | `app/api/weather/route.js` NEW · `hooks/use-fly-weather.js` NEW · `lib/fly/weather-model.js` NEW · `components/fly/CloudField.jsx` · `components/fly/PrecipLayer.jsx` NEW · `lib/fly/assets.js` (+ run gen-credits) | `WEATHER` | FlyScene, SkyDome, Effects, worker, engines |
| A2 | GND-W | 1 | `lib/fly/toy-world/vector-tile.worker.js` · `lib/fly/toy-world/sat-road-engine.js` NEW · `lib/fly/toy-world/sat-building-engine.js` · `lib/fly/toy-world/toy-world-engine.js` (pin only) · `lib/fly/toy-world/world-bend.js` | `SAT_ROADS`, `SAT_BLDG_FADE` | any component, FlyScene, SAT_BUILDINGS values |
| A3 | LOG | 1 | `components/fly/hud/Logbook.jsx` NEW · `components/fly/hud/logbook/logbook-bits.jsx` NEW · `hooks/use-sheet-layout.js` NEW (extracted from InspectModal:96-108) · `lib/fly/fly-settings.js` NEW · `components/fly/FlyMode.jsx` · `stores/fly-store.js` · `components/fly/hud/TouchControls.jsx` · `components/fly/PauseMenu.jsx` · `components/fly/hud/FlyHUD.jsx` · `components/fly/hud/SpotToast.jsx` · `components/fly/hud/InspectModal.jsx` (hook import swap ONLY) · `lib/badges.js` · `stores/passport-store.js` (getBadgeProgress only) · `components/fly/TrafficTracers.jsx` · `lib/rarity.js` (5 dual adds) · `components/fly/FlyScene.jsx` (EXACTLY 2 lines: neutralize gate ~:635, `window.__passportStore` dev handle ~:384) · `scripts/verify-logbook.js` NEW | `LOGBOOK` + `TRACERS.sun` sub-block | worker, engines, CloudField, SkyDome, Effects |
| A4 | GND-C | 2 | `components/fly/SatRoadLayer.jsx` NEW (hosts beacon pool) · `components/fly/SatCityGlow.jsx` NEW · `components/fly/FlyScene.jsx` (EXACTLY 2 mount lines beside :1023 — lands BEFORE A5's edits) · `scripts/verify-sat-night.js` NEW | `SAT_CITY_GLOW`, `SAT_AIRPORT_BEACONS` | worker, world-bend, sat-*-engine internals, SkyDome, Effects |
| A5 | WX-B | 2 | `lib/fly/sun-model.js` NEW · `components/fly/FlyScene.jsx` (sky regions: day-cycle → computeSun; −50 weather post-pass; Environment→SatEnvironment satellite branch; stars/moon props; PrecipLayer mount — RE-READ after A4) · `components/fly/SkyDome.jsx` · `components/fly/SatEnvironment.jsx` NEW · `components/fly/Effects.jsx` · `scripts/_boot.js` (1 sanctioned line) · `scripts/verify-boot.js` (sanctioned mirror) · `scripts/verify-weather.js` NEW | `SKY_LIVE` | worker, engines, CloudField internals (consumes A1's weather-model API), Logbook files |

FlyScene seam order: A3 (Wave 1, 2 lines) → A4 (2 mount lines) → A5 (sky
regions). fly-constants: append-only distinct blocks, re-read before edit.
Fable reviews the merged FlyScene before the sweep.

## 4. Phase designs (binding briefs — full rationale in the design records)

### A1 — WX-DATA: real weather, deck states, precip

**Route `app/api/weather/route.js`** — clone the R15 pattern from
`app/api/aircraft/[hex]/info/route.js`: param validation (finite, lat∈[−90,90],
lon∈[−180,180] → else `{found:false}`), snap to 0.25° cell (memo key AND
upstream coords), fixed-order failover **open-meteo → aviationweather METAR**
(non-sticky; a legit miss must not demote), per-source 30 s fail cooldown,
4.5 s abort/attempt, memo hit 10 min / miss 2 min, max 500 cells oldest-25%
eviction, always HTTP 200, never throws. Normalized payload:
`{ found, source, cell, cloudCoverPct, windMps, windDirDeg, visM, precip:
'none'|'rain'|'snow', tempC, metarRaw, station }`. METAR mapping: cover =
max layer (FEW 20/SCT 45/BKN 75/OVC 100/CLR 0), `visib` SM→m (handle `"10+"`),
`wspd` kt→m/s, precip from `wxString` regex, nearest station by haversine.
**The route never fabricates weather.**

**`lib/fly/weather-model.js`** (pure, zero-import beyond nothing — node-loadable):
`classifyCover(pct)` → baseline/clear/few/scattered/broken/overcast (<12/<35/
<60/<88/≥88; no-data → 'baseline'); `computeTargets(dataOrOverride, WEATHER)`;
`stepWeather(wx, targets, dt)` (expApproach: deck 8 s, ambience 5 s, wind 12 s,
precip 2 s); `snapWeather(wx, targets)` (warp); `applyWeatherAtmo(rimTriple,
voidTriple, wx, WEATHER)` (grey-mix toward per-channel luma + fog-density
multiplier capped `densityCap 5.2e-5` + haze widening — exported for A5's −50
block); procedural fallback fn (seeded hash — designed, shipped OFF via
`WEATHER.fallback:'baseline'`). `window.__flyWeatherOverride` honored inside
computeTargets ('baseline' | payload object).

**`hooks/use-fly-weather.js`** — `use-fly-traffic.js` mirror: enabled only when
`WEATHER.enabled && mapStyle==='satellite'` (toy NEVER fetches); 15 s
runtime.geo → 0.25° cell key with functional-set bail; React Query
refetch 10 min / staleTime 5 min; resolves into `runtime.weather.data` (never
React state). Owns `runtime.weather = { data, state, targets, wx, epoch }`
creation. Baseline wx = all-neutral (presence 1, mults 1, fogT 0, wind [5,0] =
today's +X driftMps, precipT 0) → **byte-identical to today**.

**CloudField.jsx** — per-puff presence: stable rank `r_i = hash(i*11+707)`;
`p_i = smoothstep(0, WEATHER.coverage.feather, wx.presenceFrac − r_i)` folded
into the existing wrapper scale with `wx.sizeMul`; `p_i·s ≤ 0.02` → invisible
(existing early-out; shadow lockstep). Opacity/grey tint ride the existing 10 s
sunTint cadence (lerp toward `WEATHER.overcast.cloudGrey` by `overcastT·0.7`),
bail on unchanged `runtime.weather.epoch`. **Wind = accumulated integrator**
(`driftRef += wind·dt`, both axes, toroidal wrap) replacing `driftMps*t` — at
baseline numerically ≡ `5t`. NO second deck, NO remounts, zero new draws.
Coverage table in `WEATHER.coverage`: baseline{1,1,1,0} clear{.05,.9,.9,0}
few{.30,.95,1,0} scattered{.65,1,1,0} broken{1,1.15,1.1,.45}
overcast{1,1.35,1.25,1}.

**PrecipLayer.jsx** NEW — one InstancedBufferGeometry quad, own ShaderMaterial
(no world-bend, no cache keys), camera-following cylinder r150/h90, per-instance
`aSeed` (missing → collapses at origin, invisible = dark), GPU-only animation
(one `uTime` write; wind shear from `uWindVec`), procedural streak/flake
CanvasTextures, rain 11 m/s vs snow 1.6 m/s + sway, tie-break `tempC < 1`.
`countByTier {high:900, medium:420, low:0 — never mounts}`. Visible only when
`wx.precipT > 0.02`; fades out above ~3.5 km AGL (`uFade`). **+1 draw active,
0 clear.** Export component; A5 mounts it in FlyScene (A1 does NOT touch
FlyScene — coordinate via the export only).

**assets.js**: one `kind:'data'` Open-Meteo entry (CC-BY 4.0, url, usage note);
run `node scripts/gen-credits.mjs`.

**Dev stats**: `__flyStats.weather = {state, presenceFrac, overcastT, fogT,
windMps, precip, fogDensity}` + `__flyStats.cloudDrift` (integrator vector).

### A2 — GND-W: sat-roads worker, road engine, shaders, building fade

**Worker** — new early-return detail `'sat-roads'` beside `:982` →
`buildSatRoads(vt, …)`: parse `transportation` (f.type 2, `brunnel!=='tunnel'`,
classes per `SAT_ROADS.classes` w/ cls codes 1–6) + `aeroway` class `runway`
(cls 7, port of `pushRunwayLights` walker into the same arrays — pair quads
every `spacingM` + threshold bars, arc = normalized 0..1). New functions ONLY —
zero edits to toy helpers (reuse `clipSegment` + chain-stitch by call). Ribbon
writer `pushSatRoadRibbon` (y=0; engine drapes): decimate points < `minSegM`
20 m, drop chains < 30 m, subdivide segments > `maxSegM` 250 m (drape must
follow relief), class-priority vert budget `maxVertsPerChunk 24000` (motorway
first, minor dropped first), `minFeatures` floor (rural chunk → empty → 0
draws — the Owens Valley shed knob). Output `out.satRoads {pos(n×3), col(n×3
baked class hue), arc(n×1 cumulative meters), cls(n×1, 0 reserved=dark),
idx}` — all transferred; empty tile → no key. **`WORKER_PROTOCOL 12→13`** +
header registry comment (v13: adds 'sat-roads' detail + out.satRoads; stale
v12 worker returns a toy bundle with no satRoads key → engine drops on
`v !== 13`, one dev warn). `'sat-buildings'` output byte-unchanged.

**`sat-road-engine.js`** NEW — structural clone of SatBuildingEngine. Pin
`EXPECTED_WORKER_PROTOCOL = 13`. Ring `{z:13, r:12000}` (≈9 km true; no
tile-URL overlap with the z14 building ring), `maxChunks 16`, `maxBuilds 2`,
nearest-win. Drape = per-chunk bilinear grid (toy pattern, `gridSegments 16` →
289 getGroundAt samples), raw DEM + `liftM 5`, depthTest ON / depthWrite OFF,
demZ≥12 hold + 20 s warp coarse-accept. Hysteresis `cullAglOnM 4200 /
cullAglOffM 5200`. ONE shared `MeshBasicMaterial({vertexColors, transparent,
AdditiveBlending, depthWrite:false})`, renderOrder 3, one merged Mesh per chunk
(≤16 draws). `update(now, x, z, eyeAglM, sunFrac)` writes clock/mix uniforms
itself. Stats → `window.__satRoads` + `__flyStats.satRoads`. Public contract
frozen for A4: `constructor({groundAt})`, `setWorker(api)`, `notifyWarp(now)`,
`update(...)`, `stats`, `object`, `dispose()`.

**world-bend.js** — new variant `applyBendRoadSat` (vertex: d²k bend like
waterSatProject + varyings vArc/vCls; fragment at color_fragment: 8-entry
class-weight LUT (index 0→0) × [night steady glow + streetlight `exp` dots on
`fract(vArc/uStreetSpacing)` cls 4–6 + headlight dash trains
`fract(vArc/uDashLen − uRoadT)` cls 1–3 + day glint dashes cls 1–2 + runway
steady cls 7]), uniforms via new exports `setSatRoadClock(t)` /
`setSatRoadMix(sunFrac)` (nightK = the exact setNightMix γ ramp; dayK inverse).
Cache key **`world-bend-road-satnight-r16`** — register in header. **Sun drives
uniforms ONLY — draw count identical day/night.** Building fade: extend
`applyBendAnchorSat` fragment with Bayer-4 screen-door
`if(uSatBldgFade<0.999 && bayer4(gl_FragCoord.xy)>uSatBldgFade) discard;`,
uniform default 1 (byte-identical), new exports `setSatBldgFade/getSatBldgFade`;
**bump key `world-bend-anchor-satbldg` → `world-bend-anchor-satbldg-r16`**
(update registry header — this key reaches only the sat building material).

**sat-building-engine.js** — pin 13; when `SAT_BLDG_FADE.enabled`: fade =
`1 − smoothstep(2400, 3000, eyeAGL)` written per frame; ring stays on to
`evictAglM 3200` (evict only after invisible); re-arm below 2200 unchanged;
`enabled:false` → legacy hard evict, uniform pinned 1.

**toy-world-engine.js** — pin 13 (one line; R15 lesson — forgetting it spams
false stale-worker warns in toy dev).

**Constants (append verbatim shapes, values live-tunable):**
```js
SAT_ROADS = { enabled:true, minTier:'medium', ring:{z:13,r:12000}, maxChunks:16,
  maxBuilds:2, gridSegments:16, drapeBudgetMs:1.0, demZ:12, drapeMaxTries:20,
  warpCoarseTries:3, warpCoarseWindowSec:20, refreshMoveM:900, refreshSec:2,
  liftM:5, cullAglOnM:4200, cullAglOffM:5200, minSegM:20, maxSegM:250,
  maxVertsPerChunk:24000, minFeatures:0,
  classes:{ motorway:{w:26,cls:1}, trunk:{w:22,cls:2}, primary:{w:18,cls:3},
            secondary:{w:13,cls:4}, tertiary:{w:9,cls:5}, minor:{w:6.5,cls:6} },
  colors:{ artery:'#dfe9ff', street:'#ffb066', runway:'#ffe9c4' },
  night:{ dayFrac:0.3, gamma:1.5, intensity:1.15, streetSpacingM:42,
          dashLenM:420, dashDuty:0.3, dashSpeed:0.10, streamBoost:1.8 },
  day:{ glintIntensity:0.35, dashLenM:160, dashDuty:0.05, dashSpeed:0.15 },
  runway:{ spacingM:60, sizeM:1.9, offsetM:3, boost:2.2, chase:0 } }
SAT_BLDG_FADE = { enabled:true, fadeStartAglM:2400, fadeEndAglM:3000, evictAglM:3200 }
```

### A3 — LOG: pilot logbook, badge toasts, settings persistence, TOD tracers

**Logbook** = full-screen Atlas-precedent overlay (NOT a dock). Desktop:
scrim `absolute inset-x-0 top-0 bottom-8 z-20` (attribution stays clear) +
centered panel `min(94%,980px) × min(92%,720px)`, CARD_THEME gradient/edge,
backdrop-blur. Phone (via extracted `hooks/use-sheet-layout.js`): full-bleed
100svh, 50 px touch targets, safe-area both ends. Root testid `logbook`.
Header: "PILOT LOGBOOK" (fontDisplay) + total-spots Odometer + close ✕ +
"esc / L" hint. Tabs LOG/BADGES/STATS — click/tap ONLY (1/2/3 are speed
presets even neutralized). LOG tab (`logbook-log`): chips UNIQUE|ALL,
RECENT|RAREST|TYPE, ALL|MIL|HELI|EPIC+; rows (`logbook-entry`, data-hex,
data-rarity) = silhouette SVG (`AIRCRAFT_SILHOUETTES[getBestSilhouette({t:
spot.type}, spot.classification)]`, 28 px, tier-tinted) + `flight||registration
||hex` + `getAircraftTypeName` + RarityChip (card-bits) + time + latlon;
**windowed slice 80/page + IntersectionObserver sentinel** (`logbook-more-
sentinel`) — no virtualization dep; empty-state ghost line. BADGES tab
(`logbook-badges`): 24 cards (`logbook-badge`, data-badge-id, data-earned) by
tier via getBadgesByTier + BADGE_TIERS colors; locked = grayscale 40% +
progress fill. STATS tab (`logbook-stats`): Odometer grid — total, **TYPES
COLLECTED n/269** (`[...uniqueTypes].filter(t => EXACT_TYPE_CODES.has(t))
.length` from `lib/aircraft-type-tables.js`) + raw seen count, mil/heli/
emergency, first spot, rarest find (+ resolved name), streak 🔥 when ≥2,
28-day activity strip (`logbook-activity`) from spotsByDay, week's top-5 rare
finds computed in-component (NOT the stale persisted weeklyRareFinds). All
derived data in component useMemo — NO new store fields.

**Entry/state**: `logbookOpen` + setter in fly-store (non-persisted; mapStyle
literal untouched). **L key handled in FlyMode's existing window keydown**
(NOT consumePress — the Atlas listener-order trap): guards e.repeat +
INPUT/TEXTAREA; open only when no inspect/atlas/pause. Escape chain becomes
inspect → atlas → **logbook** → credits → pause. PauseMenu: `pause-logbook`
button ("Pilot Logbook — N spots"), L-from-pause handler, CONTROL_ROWS +
TOUCH_CONTROL_ROWS entries. FlyHUD Spots cell → wrapping `<button>`
(`hud-spots-cell`; inner spans untouched — font-mono indexing). TouchControls
`covered` gains `|| logbookOpen`. FlyScene EXACTLY 2 lines: neutralize gate
`|| flyState.logbookOpen` (~:635) and `window.__passportStore = usePassportStore`
in the dev block (~:384).

**SpotToast**: 4th subscription on `badges.length` (closure cursor from
getState(), StrictMode-safe); one toast per new badge `{⬢ badge earned, icon,
name, description, tier chip}`, testid `badge-toast`, 5200 ms,
`runtime.audio?.spotBlip?.(3)`; **badge-only deferral queue** when stack ≥ 2
(`pendingRef`, drained by shared scheduleRemove) — spot/spicy/buzz push paths
BYTE-PRESERVED (verify-spicy/verify-airport-buzz untouched).

**badges.js**: export `getStreakDays(spotsByDay, now)` using logSpot's exact
UTC daykey expression; add `case 'daily_streak_7'`. passport-store: extend
`getBadgeProgress` (streak/7, cargo_king/20, military_ace/50,
type_collector_10/50/100).

**`lib/fly/fly-settings.js`** NEW (map-style.js clone): keys `fly-quality-tier`
(validated enum) + `fly-sound-on` ('1'/'0'); `resolveInitialSettings()` called
in FlyMode beside `resolveInitialMapStyle()` (pre-canvas mount);
`saveQualityTier/saveSoundOn` called at PauseMenu click sites ONLY
(PerformanceMonitor auto-degrades deliberately NOT persisted).

**TrafficTracers** (both renderers): `TRACERS.sun` sub-block
`{dayFrac:0.30, dayGain:0.38, nightGain:1.45, dayWidthK:0.6, lerpPerSec:0.6}`;
per-frame scalar `nightT = clamp01(1 − (runtime.sun?.frac ?? 1)/dayFrac)`;
`target = satellite ? dayGain + (nightGain−dayGain)·nightT : 1`; exp-damp into
`state.sunGain` (lazy init to target); multiply into the existing write-time
gain + parallel width multiplier. Toy resolves ×1 exactly; toy constants
untouched. **HARD RULE: never fold sunGain into the ≤0.02 skip predicate —
dim, never cull.** Dev stat `__flyStats.tracerSunGain`.

**rarity.js**: dual-table adds K35R 25 · C30J 20 · GLF6 35 · A124 55 ·
A225 100 (same value in `EXACT_TYPE_BONUS` AND legacy `TYPE_RARITY_BONUS`) +
comment: "R16 convention: new bonuses land in BOTH tables; the legacy table is
the provenance ledger verify-classify i2 audits." Do NOT touch
EXACT_TYPE_CLASS. **Run `node scripts/verify-classify.mjs` +
`node scripts/verify-warbirds.mjs` and report output.**

**`scripts/verify-logbook.js`** NEW — bootFly; seed passport via persist
envelope in addInitScript; gates: (1) L opens/Esc closes with phase still
'flying'; (2) pause entry; (3) 200-spot fixture renders 80 then grows on
scroll; (4) RAREST sort + MIL filter correctness; (5) 24 badge cards +
data-earned + progress element; (6) "/269" text + 28 activity cells; (7) badge
toast queue — drive via `__passportStore`, never >2 visible, drains; (8) streak
seed 6 days + logSpot today → badge earned; (9) quality low + sound off →
reload → restored; (10) 390×844 full-bleed + touch controls hidden while open;
zero pageerrors; house PASS/FAIL format.

### A4 — GND-C: SatRoadLayer, SatCityGlow, beacons, verify-sat-night

**SatRoadLayer.jsx** NEW — literal SatBuildingLayer template: own worker
instance, SatRoadEngine mount (frozen contract §A2), update loop priority −46,
warp subscription, StrictMode symmetric dispose, `window.__satRoads` dev
handle, style-off → no globals. Hosts the **beacon pool**: InstancedMesh ≤12
additive billboards at `kind==='airport'` POIs within 25 km (2 s cadence,
placement from buildPoiList), white/green alternating flash via one material
property write per frame, `SAT_AIRPORT_BEACONS.minTier:'high'`, count=0 parks
the draw. **+1 draw max.**

**SatCityGlow.jsx** NEW — TownGlow.jsx template, satellite-only: 2 instanced
draws (dome + warm core), reuse `applyBendAnchor` UNMODIFIED (no key change),
ground = raw `s.elev` (NO terrainExaggeration — the R11 monuments lesson),
sodium palette, instance colors × the γ night ramp recomputed on the 2 s
cadence from `runtime.sun.frac` (day → black, draws still issued —
deterministic counts), range fadeIn 8–14 km → maxRange 90 km, farScale, pool
byTier {96/96/48}.

**FlyScene.jsx** — EXACTLY 2 mount lines beside :1023 (re-read the file first;
A3's Wave-1 lines will already be present):
`{mapStyle==='satellite' && SAT_ROADS.enabled && qualityTier!=='low' && <SatRoadLayer/>}` and
`{mapStyle==='satellite' && SAT_CITY_GLOW.enabled && <SatCityGlow/>}`.

**Constants:** `SAT_CITY_GLOW` + `SAT_AIRPORT_BEACONS` per the shapes in the
design record (dome/core colors #ffb066/#ffd9a3, opacity .3/.55, dayFrac .3,
gamma 1.5, refreshSec 2; beacons pool 12, rangeM 25000, sizeM 14,
periodSec 3.2).

**`scripts/verify-sat-night.js`** NEW — gates: (A) Manhattan 792 m, sun pinned
~23:00 local: `__satRoads.stats.ready ≥ 3`, layer-visibility A/B ground-crop
mean |Δ| > 3/255, draws ≤ 375; (B) same pose noon: A/B Δ < 1.5/255 AND
Δ_night > 4×Δ_day AND identical draw count to (A); (C) JFK 700 m night: runway
crop Δ + cls-7 verts present; (D) 6000 m: roads evicted, glow placed ≥5;
(E) fade-not-pop: buildings ready at 2700 m, fade uniform ∈(0,1), pixel-zero at
3100 m, evicted by 3400 m; (F) protocol v13 observed + kill switches restore
control draws; (G) zero pageerrors, `__toyWorld` undefined.

### A5 — WX-B: sun model, living sky, HDRI, bloom, harness pins

**`lib/fly/sun-model.js`** NEW — `computeSun(lonDeg, latDeg, tMs)`:
`decl = −23.44°·cos(2π(N+10)/365.24)`; `localSolarH = UTC + lon/15`;
`H = (localSolarH−12)·π/12`; `sinEl = sin lat sin decl + cos lat cos decl cos H`;
**`frac = clamp(sinEl / sin(SKY_LIVE.sun.elRefDeg 50°), 0, 1)`**; **`az = H`
(KEEP — dawn/dusk split, hillshade E/W flip, WarpBurst key on H's sign)**;
`el = clamp(asin(max(0,sinEl)), HILLSHADE.minElRad, maxElRad)`. Returns
`{frac, az, el, decl, sinEl}`. FlyScene day-cycle effect becomes a thin caller
(lat from `runtime.geo?.y ?? spawn?.lat ?? 0`, behind the existing
`spawnPlacedRef` latch). Dev handle `window.__flySunModel = (lon,lat,tMs?) =>
frac` published in the dev block.

**FlyScene −50 block** (weather post-pass): after `computeSatAtmo(...)`, call
A1's `stepWeather(runtime.weather.wx, targets, dt)` +
`applyWeatherAtmo(_atmoRim, _atmoVoid, wx)` BEFORE the four existing writes
(fog color+density, setEdgeFadeRGB, setDepthHazeRGB, setSkyAtmo) — rim triple
stays single-source. Sun-intensity weather multipliers: sun ×(1−0.45·overcastT),
env ×(1−0.4·overcastT), bg ×(1−0.35·overcastT) — through the §HDRI intensity
driver. Warp → `snapWeather` under WarpFlash. Mount `<PrecipLayer/>` (A1's
export) satellite && tier!=='low' && WEATHER.enabled.

**SkyDome.jsx** — new setters `setSkyNight(nightT, mx,my,mz)` +
`setSkyWeather(overcastT, r,g,b, r2,g2,b2)` (setSkyAtmo pattern); uniforms
`uNight` (default 0) + `uOvercast/uOverH/uOverZ` (default 0); satellite passes
stars/moon props; star+moon terms × `uNight` × `(1−uOvercast)`; rimOnly alpha =
`max(bandAlpha, min(1, (star+moonLuma)·uNight))` and overcast lid
`up = mix(up, overcastGrad, uOvercast)` + alpha `max(band, uOvercast·
smoothstep(0,0.06,y))`. Defaults 0 → bit-identical everywhere (multiply-to-zero).
Moon: anti-solar az, el `SKY_LIVE.nightSky.moonElRad 0.6`, dimmer than toy
(`brightness .5, glowStrength .14`). **Eyeball: check qwantani night HDRI for a
baked moon before finalizing (double-moon).**

**SatEnvironment.jsx** NEW (satellite only — toy keeps drei `<Environment
key='toy'>` untouched): RGBELoader cache + ONE PMREMGenerator; prefetch
neighbor HDR when |frac − boundary| < 0.04; on crossing:
fromEquirectangular → assign scene.environment/background same frame → dispose
old RT next frame (no unmount flash, never two PMREMs); 0.6 s bg-intensity
dip-and-recover across the swap. Continuous env/bg intensity = piecewise-linear
f(sun.frac) anchored at bucket centers (day .75 / dawn-dusk .28 / night .03) —
equals today's constants at pinned harness fracs; weather multipliers fold in.
Keep `__flyStats.hdriBucket`; add `__flyStats.envSwapMs`, `__flyStats
.envIntensity`.

**Effects.jsx** — `<Bloom ref>`; inside the EXISTING 5 s satellite interval:
`nightT = 1 − clamp(frac/0.35)`; intensity lerp 0.7→`SKY_LIVE.bloomNight
.intensity 1.0`, threshold 0.85→`0.62`; direct property mutation; equals SKY
constants at frac ≥ 0.35. Dev stat `__flyStats.bloom`.

**Sanctioned harness edits (ONLY these):** `scripts/_boot.js` — add
`window.__flyWeatherOverride='baseline';` in the addInitScript (+ post-load
safety net); `scripts/verify-boot.js` — replace the inline sun formula
(:112-114) with `expected = page.evaluate → window.__flySunModel(lon, lat)`
(lat from the same persisted lastPos) + the same weather pin in its bespoke
init.

**`scripts/verify-weather.js`** NEW — 9 gates: baseline neutrality + draws
recorded; overcast override → overcastT>0.9, grey-lid strip saturation <0.12 +
luma in [40,170], directional light <0.62× baseline, draws == baseline;
vis 1200 m → fogDensity ≥ 0.8×cap + rim stripMaxStep ≤18; wind 90° → drift
vector within 25° after damping, flip 270° → reversal, no cloudMinAgl
violation; precip rain high → +1 draw (low → +0) + screenshots; night →
uNight>0.9 + bloom ≈ nightIntensity + overcast star-kill; HDRI continuity walk
(6 stamps across dusk: max adjacent envIntensity delta < 0.35×gap, swapCount
== 1); toy → zero /api/weather requests + state 'off'; zero pageerrors.

## 5. Risks → mitigating gates

| # | Risk | Mitigation / gate |
|---|---|---|
| 1 | Owens Valley 261 breach (roads exist in the gate scene; projected 252–256) | A2 sheds via minFeatures/ring.r/maxChunks; **Fable measures verify-sat-depth at the Wave-1 checkpoint before Wave 2**; re-baseline only measured + sanctioned |
| 2 | verify-sat-depth evening probe brightness shift (sun model: frac 0 → 0.27 at the pinned PM stamp) | Fable local re-run after A5; brighter dusk should increase relief Δ (passing direction); trip → stop-and-sanction |
| 3 | FlyScene 3-agent seam | Wave order A3 → A4 → A5, re-read before edit, Fable merged-file review pre-sweep |
| 4 | Fill rate invisible to draw gates (additive roads + precip + dither) | Tier gates everywhere; gpuFrameMs spot-check in soak; thin class widths |
| 5 | SpotToast queue regresses spicy/buzz | Push paths byte-preserved; verify-spicy + verify-airport-buzz re-run in sweep |
| 6 | Night roads read as neon tubes, not a city | Three independent fragment terms with separate knobs; mandatory Manhattan/Tokyo night eyeball before sign-off |
| 7 | Live weather nondeterminism in harnesses | `_boot.js` baseline pin fleet-wide; verify-weather drives states via override only |
| 8 | Worker vert explosion (Tokyo z13) | maxVertsPerChunk class-priority fill + decimation; tessMs telemetry |
| 9 | HDRI swap flash / double-PMREM | assign-then-dispose-next-frame; StrictMode symmetric; verify-weather gate 7 |
| 10 | Tracer sunGain culls tracers | Hard rule: never in the skip predicate; count gates prove it |

## 6. Acceptance

- Node gates green (agents run): verify-classify.mjs (38), verify-warbirds.mjs (20).
- Fable full sequential sweep green: verify-boot (mirrored) · verify-sat-depth
  (**measured, ≤261**) · verify-sat-buildings · verify-rim (+ midnight-pinned
  local run) · verify-round11 · verify-sun · verify-edge-fx · verify-tracers ·
  verify-neon-city/alt · verify-roofs · verify-poi · verify-fleet ·
  verify-inspect-actions · verify-fly-style · verify-fly-game · verify-mobile ·
  verify-contracts · verify-spicy · verify-atlas · verify-warp-arrival ·
  verify-airport-buzz · **verify-weather · verify-sat-night · verify-logbook**.
- soak-fly 15 min within budgets; `npm run lint`; `npm run build`.
- Eyeball evidence: Manhattan + Tokyo night roads; overcast/fog/rain; dusk HDRI
  walk; logbook all tabs desktop + phone; badge toast; dither-fade climb.
- FLY_ROUND16.md record + CLAUDE.md notice; combined R15 §6 + R16 sign-off
  table for the user.

## 7. Out of scope (recorded)

Distant-skyline block-mass proxy (competes for the same draw headroom — design
sketch in the round record); procedural weather fallback ON (ships 'baseline',
flip is a user sign-off decision); taxiway lights; tracer color desaturation;
contracts panel redesign; classify.js deletion (still pending user); ATN
airline-prefix ICAO-first fix (R15 §8, separate); landing/takeoff mechanics.

## Appendix B — harness-enforced budgets (unchanged unless noted)

| Gate | Value | Where |
|---|---|---|
| verify-sat-depth draws | ≤ 261 (measured 246 pre-round) | scripts/verify-sat-depth.js:153 |
| verify-sat-buildings / satellite low-AGL draws | ≤ 375 | scripts/verify-sat-buildings.js |
| Satellite general / freelook | ≤ 350 | verify-globe2 / verify-freelook |
| Toy draws | ≤ 480 | verify-neon-* / verify-roofs |
| Triangles | < 2.2 M | PERF_BUDGET / soak |
| gpuFrameMs | ≤ 12 | soak-fly |
| New-draw ledger this round | roads ≤16 · glow +2 · beacons +1 · precip +1 (active) · buildings fade +0 · clouds +0 · sky/bloom +0 | §4 |
