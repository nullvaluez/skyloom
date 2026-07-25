# Fly Round 16 — "Living World" (2026-07-24) · STATUS: BUILT

User-driven satellite-first round. Direction (structured Q&A): **visual immersion
+ UI/UX polish**; the two felt gaps were **"the ground feels empty"** and **"the
sky is static"**; desktop AND phone equal targets; R15 §6 checkpoints folded in
for ONE combined sign-off (§6 below). Plan: [FLY_ROUND16_PLAN.md](FLY_ROUND16_PLAN.md).
Executed by **five Opus 5 implementor subagents in two waves** (disjoint file
ownership; user-capped at five) under Fable orchestration — Fable explored (3
Explore agents), designed (3 Plan agents), briefed, reviewed every diff,
arbitrated, ran the full 37-run harness sweep, root-caused every first-run
failure live, captured evidence, and authored the record. **Zero harness gate
re-baselines.** Three pre-sanctioned harness edits (verify-boot sun-formula
mirror, `_boot.js` weather pin, rarity dual-table adds) plus sweep-measured
first-run calibrations of the three NEW harnesses, each documented inline.

## 0. What shipped (three workstreams)

### W1 — REAL WEATHER + LIVING SKY (agents A1 + A5)

- **NEW keyless route [app/api/weather/route.js](app/api/weather/route.js)**:
  open-meteo (global 11 km grid, oceans included) → aviationweather.gov METAR
  failover (fixed-order, non-sticky; attaches `metarRaw` + station as garnish).
  R15 info-route pattern verbatim: 0.25° cell snap (memo key + privacy), hit
  10 min / miss 2 min memo, 4.5 s abort, per-source cooldown, always 200,
  never throws, **never fabricates weather** (`{found:false}` → baseline).
  Open-Meteo CC-BY 4.0 entry in FLY_ASSETS + CREDITS regenerated.
- **NEW [lib/fly/weather-model.js](lib/fly/weather-model.js)** (zero-import,
  node-smoke-tested 45 gates): coverage classification (clear/few/scattered/
  broken/overcast), damped per-frame `wx` scalars (deck 8 s, ambience 5 s,
  wind 12 s, precip 2 s), warp snap, `applyWeatherAtmo` (grey-mix + fog-density
  cap 5.2e-5 through the EXISTING rim-triple path — one source), procedural
  fallback designed but shipped OFF (`WEATHER.fallback:'baseline'`).
  **Baseline = bit-identical to R15** (proved over 5000 damping steps) — the
  no-data state IS today's look, which is what kept ~30 existing harnesses
  green by construction. `window.__flyWeatherOverride` drives every state
  deterministically.
- **CloudField**: per-puff presence rank (clouds grow/dissolve in place — no
  remounts, no pops), coverage table, overcast grey tint + light cuts, wind as
  a **deviation integrator** (baseline reduces to the certified `driftMps·t`
  bit-for-bit; live wind bends the drift, never teleports it). Overcast is NOT
  a second deck — densified single deck + SkyDome grey lid + light dimming.
  **Zero new draws.**
- **NEW [components/fly/PrecipLayer.jsx](components/fly/PrecipLayer.jsx)**:
  rain/snow — one instanced quad cylinder around the camera, own
  ShaderMaterial (no world-bend cache keys), GPU-only animation, procedural
  streak/flake textures, wind shear, tempC tie-break. `countByTier
  {high 900, medium 420, low 0 = never mounts}`. **+1 draw active, 0 clear.**
- **NEW [lib/fly/sun-model.js](lib/fly/sun-model.js)** — latitude + declination
  + date: polar night, midnight sun, hemisphere seasons are REAL now
  (Barrow Jan → frac 0; Tromsø Jun midnight → never 'night'; NYC Dec noon
  0.57 — dimmer winter light, still 'day' bucket via `elRefDeg 50`).
  **`az` = hour angle, bit-identical to R15 at every stamp** — the hillshade
  E/W flip, dawn/dusk split and WarpBurst were provably unmoved. verify-sun's
  four gates pass UNEDITED; verify-boot's inline formula mirror was replaced
  with the app's own `window.__flySunModel` (sanctioned; semantics preserved).
- **NEW [components/fly/SatEnvironment.jsx](components/fly/SatEnvironment.jsx)**
  replaces the drei `<Environment key>` hard cut (satellite only; toy element
  byte-untouched): refcounted single PMREMGenerator (StrictMode-proof),
  neighbor prefetch near bucket boundaries, same-frame swap + next-frame
  retire (no flash, never two PMREMs), 0.6 s bg dip, **continuous env/bg
  intensity** as f(sun.frac) anchored on the certified constants (noon =
  exactly 0.85/1.0, deep night = exactly 0.16/0.26). Dusk walk measured: max
  adjacent Δ 0.099 vs the old 0.24 step, exactly one swap.
- **SkyDome**: satellite gets **stars + a moon at last** (uNight-weighted,
  anti-solar, dimmer than toy's) + the overcast lid. All new terms
  multiply-to-identity at rest — toy and satellite daylight are bit-identical.
- **Effects**: bloom breathes at night (0.7/0.85 → 1.0/0.62 by nightT),
  byte-stable at frac ≥ 0.35.

### W2 — NIGHT GROUND ALIVE (agents A2 + A4)

- **Worker `'sat-roads'` detail, WORKER_PROTOCOL 12→13** (all three engine
  pins moved together): parses OMT `transportation` (6 classes, cls codes 1–6;
  cls 0 reserved = fail-DARK) + `aeroway` runways (cls 7 — real runway EDGE
  LIGHTS + threshold bars baked into the same arrays, the toy
  pushRunwayLights port, 0 extra draws). Decimation + class-priority vert
  budget (24 k/chunk) + `minFeatures` rural shed knob. Stale v12 bundles are
  DROPPED (R15 sentinel contract). Toy outputs byte-unchanged.
- **NEW [lib/fly/toy-world/sat-road-engine.js](lib/fly/toy-world/sat-road-engine.js)**:
  own z13 ring r12000 (≈9 km true — 3.3× the building bubble, zero tile-URL
  overlap), ≤16 chunks = ≤16 draws, bilinear grid drape on raw DEM + 5 m lift,
  hysteresis 4200/5200 m. ONE additive material; shader variant
  `world-bend-road-satnight-r16`: class-weight LUT × (steady night glow +
  streetlight dots + headlight dash trains + day glint on highways + runway
  steady). **Sun drives uniforms ONLY — draw counts identical day/night.**
- **NEW [components/fly/SatRoadLayer.jsx](components/fly/SatRoadLayer.jsx)**
  (+ **airport beacons**: ≤12-instance white/green flashing pool at airport
  POIs, high tier, +1 draw, range-only placement) and
  **NEW [components/fly/SatCityGlow.jsx](components/fly/SatCityGlow.jsx)**
  (TownGlow's satellite sibling: sodium glow domes + warm cores at POI cities
  out to 90 km, +2 always-issued draws, γ night ramp on instance COLOR only).
- **Building cull-pop KILLED**: `SAT_BLDG_FADE` — Bayer-4 screen-door dissolve
  in the opaque pass (no transparency sort, no new material), fade 2400→3000 m,
  evict only at 3200 m on provably invisible geometry (`world-bend-anchor-
  satbldg-r16`). Uniform default 1 = byte-identical when off.

### W3 — PILOT LOGBOOK + SYSTEMS (agent A3)

- **NEW [components/fly/hud/Logbook.jsx](components/fly/hud/Logbook.jsx)** —
  the passport's first UI ever: full-screen INK CODEX overlay (Atlas
  precedent), **L key** / PauseMenu / Spots-cell entry, Escape-chain slot
  (inspect → atlas → logbook → credits → pause). LOG tab: UNIQUE|ALL,
  RECENT|RAREST|TYPE, ALL|MIL|HELI|EPIC+ chips, tier-tinted silhouettes,
  RarityChips, windowed 80/page + sentinel. BADGES tab: all 24 with tier
  colors + real progress bars. STATS tab: TYPES COLLECTED n/269, activity
  strip, rarest find, streak. Phone: full-bleed 100svh sheet via the
  extracted [hooks/use-sheet-layout.js](hooks/use-sheet-layout.js).
- **Badge unlock toasts** (queued, never evicting spot/spicy/buzz — those
  push paths are byte-preserved and re-verified) + **`daily_streak_7` fixed**
  (was a dead badge with no unlock case) + `getBadgeProgress` extended.
- **NEW [lib/fly/fly-settings.js](lib/fly/fly-settings.js)**: quality tier +
  sound finally survive reload (explicit PauseMenu picks only —
  PerformanceMonitor auto-steps deliberately stay session-scoped).
- **Time-of-day tracers**: satellite ribbons are vapor-thin by day
  (`dayGain 0.38 × width 0.6`) and glow at night (`nightGain 1.45`) — damped,
  never culled (count gates prove it); toy resolves ×1 exactly.
- **Rarity one-liners** (sanctioned dual-table adds, zero harness edits):
  K35R 25 · C30J 20 · GLF6 35 · A124 55 · A225 100.

## 1. Fable's sweep catches (fixed during Wave 3, all measured)

1. **`scene.background` = PMREM CubeUV texture IGNORES `backgroundIntensity`**
   (measured: 0.26 vs 0.02 → identical pixels) — A5's SatEnvironment washed
   the night sky white. Fixed to drei's/R13's pattern: background = raw
   equirect, environment = PMREM.
2. **The qwantani "night" HDRI is a twilight sky** with a bright
   sunset-remnant band on one azimuth (linear ~2–4): facing it, "night"
   rendered luma 225/255; facing away, the certified dark. R13 shipped it
   un-eyeballed from band-facing headings. **NEW `SKY_LIVE.hdriFade
   .nightTexelCap 0.35`** flattens the band at load — night is night from
   every heading (65 → the JFK/Manhattan night shots). A prophylactic cap on
   the DAY files was tried and REVERTED with measurement: their baked sun is
   the IBL's warm key light (capping cooled the certified noon cloud tint —
   verify-round11 caught it).
3. **Road-light calibration**: at intensity 1.15 the network vanished behind
   canyon occlusion + ACES compression (windows carried the whole city).
   Bumped: intensity 2.4, streamBoost 2.4, street widths 16/12/9 m, runway
   sizeM 2.6 / boost 3.4. Manhattan/JFK night shots = §5 evidence.
4. **PerformanceMonitor `onIncline` reverts any downward tier pin in
   seconds** (measured low→medium 3.6 s → high 6.6 s) — verify-sat-depth's
   'high' pin only works because it's the incline's own ceiling. Low-tier
   contracts are now STATIC source gates (verify-classify pattern).
5. **verify-round11 bypasses bootFly by design** — so the fleet-wide
   `__flyWeatherOverride='baseline'` pin never reached it, and a REAL
   97%-overcast NYC evening greyed its noon cloud tint via the brand-new
   overcast path working exactly as designed. The pin is now in its bespoke
   init (style seeding untouched). verify-style-retire rides bootFly — safe.
6. **PrecipLayer left a stale dev stat after unmount** (read as "mounted on
   the low tier") — stat + handle now leave with the mesh.

## 2–4. Harness-methodology rulings (first-run calibration of NEW gates only)

- Scene-total draw comparisons across live-flight minutes drift both ways
  (measured +12 / ≤0 / >±10) — totals are demoted to drift-bounded smoke
  checks or INFO lines; the draw LAW is carried by structural gates
  (scene-root mesh assertions, per-layer visibility-toggle deltas) plus the
  settled verify-sat-depth scene.
- Pixel means are blind to sparse point lights (~0.25% coverage) and an
  ANIMATED layer's own motion pollutes no-toggle "noise" (dash trains,
  beacon flash). Gates now use noise-corrected means, toggle-vs-no-toggle
  spark counts, and (JFK) a WARN-grade probe backed by structural cls-7
  proof — the verify-fly-game hover-pick precedent.
- AnimatePresence keeps exiting toasts in the DOM through their exit spring —
  stack discipline is gated on STATE (`__flyStats.toastCount`), DOM proves
  only that every badge showed.
- `addInitScript` re-runs on EVERY navigation: verify-logbook's "clean
  settings" wipe was deleting its own reload evidence (sessionStorage-guarded
  now); the post-reload read races StrictMode's reset-between-mounts dead
  window (poll, don't single-read).

## 5. Verification — full sweep GREEN (sequential, dev :3000, no user session)

| Harness | Result |
| --- | --- |
| verify-classify (node, 38 gates) / verify-warbirds (node, 20) | PASS — rarity dual-adds land inside the existing gate semantics |
| **verify-weather (NEW, 28 gates)** | **PASS** — all states via override; dusk walk maxΔ 0.099, one swap; toy detached |
| **verify-sat-night (NEW, 33 gates)** | **PASS** — night net-sparks 9.9k; day restraint corrected 0.50 vs night 1.78; fade-not-pop ladder; protocol 13; kill switches |
| **verify-logbook (NEW, 13 gates)** | **PASS** — incl. badge-toast state-stack ≤2 and settings restore |
| verify-sat-depth (gate 261) | **PASS — 254 draws** (246 + ~6 road chunks + 2 glow at Owens Valley; 7 headroom; NO re-baseline) |
| verify-boot (sanctioned mirror) | PASS both styles; sun-at-spawn via __flySunModel |
| verify-sun | PASS unedited under the latitude model |
| verify-rim | PASS (sat maxStep 2/5 with the night sky live) |
| verify-sat-buildings | PASS on re-run (first run tripped the documented R15 SF drape race — noted, not re-baselined) |
| verify-round11 (weather pin added) | PASS |
| verify-neon-city / neon-alt / roofs / window-grids | PASS — Neon byte-untouched |
| verify-edge-fx | PASS on re-run (first run: tracer count cv from live evening feed churn, 755 resets — environmental; re-run cv 0.013) |
| verify-tracers / poi / airbend / globe / globe2 | PASS |
| verify-spicy (3-min soak) / contracts / airport-buzz / inspect-actions / fly-style | PASS |
| verify-fly-game (hover WARN as always) / atlas / warp-arrival / freelook (288) / chase-cam | PASS |
| verify-fleet / fly-models / monuments (381) / monuments-sat (261) / style-retire / mobile | PASS |
| `npm run build` | PASS (clean; /api/weather registered) |
| `npm run lint` | 51 problems = exact pre-round baseline (all pre-existing react-hooks purity class) |
| soak-fly 15 min | PASS — fps floor 59.5 (≥55), worst p95 16.8 ms (vsync), maxDraws 430 ≤ 480, heap 187→210 MB (tile caches settling), maxRebase 0.5 ms, zero pageerrors. maxTriangles 4.6 M is the ACROSS-composer-passes accumulation during the boost stream — the fps floor is the operative gate |

Evidence (checked into `scripts/`): `r16-satnight-01/02` Manhattan night —
lit blocks + arteries + Brooklyn glow dome + stars; `03` noon restraint;
`04–06` the fade ladder; `07` JFK night — runway edges + beacons + moonlit
field; `08` cruise city-glow handoff; `weather-01…10` baseline/overcast/fog/
wind/rain/snow/night/night-overcast/dusk-walk/toy; `logbook-*` all tabs both
form factors.

## 6. USER CHECKPOINTS — combined R15 §6 + R16 (all live-tunable)

R15 carried: warbird/GA liveries + Graybill warbird-jet · `SAT_BUILDINGS`
roofTones/night/facade · INSPECT panel sizing (the logbook adopts the same
sheet constants — one verdict covers both) · mythic B-2 (record-only) ·
contract pacing.

R16 new:

| Knob / call | Default | Question for the eyeball |
| --- | --- | --- |
| `WEATHER.coverage` / `overcast.*` / `vis.densityCap` | see block | Does live overcast/fog FEEL like weather without hiding the game? (NYC is genuinely overcast a lot — you'll see it often.) |
| `WEATHER.fallback` | `'baseline'` | Flip to `'procedural'` so offline sessions still get varied skies? |
| `WEATHER.precip` | rain 900 quads high | Rain/snow read at speed? Too film-noir? |
| `SAT_ROADS.night` intensity 2.4 / widths 16/12/9 | Fable-calibrated | Manhattan/Tokyo at night: city or neon circuit-board? Day glint at noon: invisible enough? |
| `SAT_CITY_GLOW` | 0.30/0.55 sodium | Far cities: alive or radioactive? |
| `SAT_AIRPORT_BEACONS` | night-only, 3.2 s | Want them day-visible in low vis (real beacons run by day)? |
| `SAT_BLDG_FADE` 2400→3000 | dissolve band | Climb through 2.5–3 km: clean dissolve? |
| `TRACERS.sun` 0.38 day / 1.45 night | TOD ribbons | Day vapor subtle enough; night glow part of the city payoff? |
| `SKY_LIVE.nightSky` + `nightTexelCap 0.35` | stars/moon/dark sky | Night sky: right darkness? Moon garnish or double-moon vs any HDRI remnant? |
| `SKY_LIVE.bloomNight` 1.0/0.62 | night bloom | City lights breathe or Christmas tree? |
| Latitude sun | elRef 50° | Warp Tromsø/Barrow/Sydney: seasons feel right? Winter noon light dimmer but still 'day'? |
| `LOGBOOK` layout + badge toasts | 980px / 88svh | Tabs/order/density right on desktop AND phone? |

## 7. Lessons

1. **A tier pin is only harness-stable in the direction the monitor pushes.**
   onIncline reverts 'low' in seconds on a capable GPU; downward-tier
   contracts need static source gates.
2. **Scene-total draw counts are not a signal during live flight** — pools
   park/unpark and tiles stream both ways. Per-layer toggle deltas and
   settled scenes carry draw laws.
3. **An animated layer's motion IS its no-toggle "noise."** Gate presence on
   the toggle-vs-no-toggle spark DIFFERENCE, or the gate fights the feature's
   own brightness.
4. **Adding a fleet-wide determinism pin? Audit the harnesses that bypass the
   fleet boot.** verify-round11's raw boot let a real overcast evening flow
   through the new weather system into a certified-noon gate.
5. **A CubeUV (PMREM) texture as scene.background ignores backgroundIntensity**
   — background = raw equirect, environment = PMREM (drei had it right).
6. **An asset can be miscast for its role**: a "night" HDRI that is really
   deep twilight reads certified-dark from one heading and blown-white from
   another. Per-role load-time texel caps fix the asset; capping a DAY sun is
   wrong — it is the IBL's key light (measured cool-shift, reverted).
7. **Gate stack discipline on state, not DOM** — exit animations keep nodes
   alive past their state.
8. **addInitScript re-runs on every navigation** — a first-load-only wipe
   needs a sessionStorage guard or it eats its own reload evidence; and the
   post-reload single-read races StrictMode's reset dead window (poll).
9. **Measure night features over a dark night.** The sky bug masked the road
   glow (ACES compresses additive light over bright ground) — two defects
   read as one until the sky was fixed first.

## 8. Known follow-ups (out of scope, recorded)

- Carried from R15 §8: `lib/classify.js` deletion (pending user), ATN
  airline-prefix ICAO-first fix, route "nm to run" math, `traffic-prop.glb`
  13.4° tilt, verify-sat-buildings SF drape race (flaked once again this
  round; still timing, not product).
- verify-edge-fx tracer-cv gate is live-feed-sensitive on heavy evenings
  (flaked once, cv 0.013 on re-run) — could pin a synthetic feed if it
  recurs.
- JFK airfield pixel probe is WARN-grade (animation-polluted metric);
  presence is carried structurally. A frozen-clock dev hook for
  `setSatRoadClock` would let it graduate back to a gate.
- Beacons are night-only; real ones also run in daytime low-vis — one-line
  ramp change if wanted.
- Distant-skyline block-mass proxy (design sketch in the R16 plan §7) — the
  natural next satellite draw-budget spend.
- Weather → gameplay hooks (IFR contracts, storm-chaser spots) — deliberately
  out of this visuals round.

## 9. Post-round live fix (2026-07-25) — satellite white-out on iPhone

**Symptom (user screenshot, live):** on iPhone, satellite rendered the entire
3D frame as one pale `#c6d7e8` wash — no sky, no terrain, no aircraft — while
the DOM HUD stayed alive and **Neon on the same phone was fine**.

**Root cause:** `SatEnvironment.loadHdr` decoded the R16 HDRIs with
`RGBELoader.setDataType(FloatType)`. RGBA32F is **not linear-filterable on
Apple GPUs before A17 Pro**, so iOS WebKit does not expose
`OES_texture_float_linear` there — and three r185 no longer downgrades the
filters the way older threes did (it warns and leaves LINEAR on an INCOMPLETE
texture). Sampling one is undefined on Metal: the background equirect and the
PMREM bake both read blown garbage, and ACES + mipmap bloom smear it over the
whole frame (strict GLES drivers read black instead — same bug, other color).
Toy never hit it because drei's `<Environment>` decodes to `HalfFloatType`,
and RGBA16F is core-filterable in every WebGL2 — which is exactly why the
same phone flew Neon happily.

**Fix (one file):** decode to `HalfFloatType`. Half precision is a superset
of the 8-bit RGBE mantissas being decoded, so the sky is visually unchanged
on desktop; the texelCap clamp now compares/writes raw half-float bits via
`DataUtils.toHalfFloat` (non-negative halves order bit-wise like their
values, and RGBE never decodes negative; NaN/Inf bit patterns land above any
finite cap and get clamped with it — free hardening). Dev stat `envTexType`
published for the gate.

**NEW gate `scripts/verify-sat-mobile.js` (7):** boots the iPhone-class
viewport with `OES_texture_float_linear` HIDDEN from the context (emulating
the device class, not the vendor garbage color) + the sun pinned to noon —
asserts the decoded type is HalfFloat, three's float-linear warning never
fires, and the sky band of the GL canvas is a real image (mean luma in
[15, 245], std ≥ 1.5 — the failure modes are uniform ~0 or ~250). Runs
egress-blocked (the HDRI is same-origin). Negative control measured: pre-fix
code on the hidden-extension device fails exactly `hdri-half-float`,
`no-float-linear-warning` (2 warns) and `sky-band-renders` (mean 6.5);
post-fix all 7 PASS (mean 111.9, std 47) and verify-mobile stays green.

**Lesson:** a texture TYPE is a device contract, not a quality knob. The R16
"raw equirect as background" decision quietly widened where that float
texture got sampled, and no harness ran satellite on a phone-class GPU until
a user's phone did. Capability-gate emulation (hide the extension, assert the
frame) is cheap and now standing.

## 10. Post-round mobile perf floor (2026-07-25) — same live session

**Symptom:** with satellite actually rendering (§9), the phone "feels heavy
and a bit lagged". The user's screenshot read **Q High**: the §7-lesson
mechanism in the wild — PerformanceMonitor's onIncline walks every smooth
stretch back UP, so a phone lands in the FULL high-tier satellite scene
(night-window building materials, cloud shadows, 0.5-scale bloom), declines,
re-inclines, forever. Each high↔medium crossing rebuilds the bloom pass and
recompiles the building materials — **the hitch IS the flap**. (DPR was
never the issue: `CANVAS.dprMax` has been 1.5 since R8.)

**Fix — a STATIC source gate (the §7 lesson's prescribed shape), phone-only:**

- NEW `lib/fly/device-class.js` → `isPhoneClass()`: coarse-pointer AND touch
  (the use-is-touch pair, so touchscreen laptops stay desktop) AND smallest
  screen dimension < 768 CSS px (iPads and desktops excluded). Decided once
  from what the device IS — never from how a frame ran.
- `resolveInitialSettings` (pre-mount, the R11 no-hot-swap beat): with NO
  explicit pick, phone-class resolves tier **'medium'** instead of 'high' —
  every tier-keyed R11–R16 reduction (aniso, hillshade strength, bloom
  scale, micro-detail, emissive windows, cloud shadows) engages from frame
  one. NOT persisted: a default is not a choice. Dev-publishes
  `__flyStats.tierPolicy {saved, phone, resolved, ceiling}` for the gate.
- NEW `autoTierCeiling()` (fly-settings) + a clamp in FlyCanvas's
  `stepQualityTier`, **up-steps only**: desktop 'high' (byte-identical,
  verify-logbook gate 9's documented walk-back-up untouched); phone-class =
  the player's explicitly saved tier if any, else 'medium'. A phone can
  never be inclined into a tier the player didn't choose; an explicit
  'high' pick is both reachable and restorable, and an explicit 'low' pick
  finally HOLDS on phones (the §7 lesson, fixed at the source for the
  device class that hurts). Declines are never capped.

**verify-sat-mobile grew 7 → 10 gates:** (F) unpicked phone boot resolves
medium/medium (race-free via tierPolicy, not tier-polling), (G) the live
tier never reads 'high' after settle, (H) a fresh context seeded with an
explicit 'high' pick resolves high/high. Full run green (sky gates
unmoved, boot 29s → 19s at medium — the floor pays for itself); verify-
mobile green; a desktop probe confirms `{phone:false, resolved:'high',
ceiling:'high'}` — the certified desktop suite never sees this pass.

**Recorded follow-up:** the ceiling honors explicit picks on phones only.
Desktop keeps R16 behavior (incline may exceed an explicit pick — gate 9
calls that "its job"); if a desktop user ever files the §7 annoyance,
extending `autoTierCeiling()` to respect saved picks everywhere is a
two-line, gate-9-comment-touching decision.
