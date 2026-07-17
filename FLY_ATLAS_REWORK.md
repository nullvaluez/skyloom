# Fly Mode — "Atlas" Rework (Round 5 handoff: world beauty + destinations + spotting)

> **STATUS: EXECUTED 2026-07-17** (same day as the spec — phases A–D built
> and harness-verified, §8 is the record). Still open: user live-tuning of
> the new defaults (§8 "open for review"), and the §4.4c scout stays
> UNBUILT pending explicit user opt-in. The §7 open questions were resolved
> to their spec'd defaults — revisit any of them at review.

> **Audience:** a fresh Claude session with no prior context. Read this
> top to bottom, then **FLY_GLOBE_REWORK.md §6–§6.3** (what the world is
> today + round-4 record), **FLY_MODE_HANDOFF.md §3/§4** (hard
> constraints + environment), and **FLY_TOYWORLD_REWORK.md §6.5**
> (vector-pipeline gotchas). This doc EXTENDS the current art direction
> (INK+ICE mini-globe, arcade motion) — it does not change it.

---

## 1. The ask (user, 2026-07-17)

> "we obviously need to get the world looking better and start adding in
> more points of interests, methods to 'warp' to other cities, known
> area of interests, military bases to try and catch cool planes, etc."

Design goals, in priority order:

1. **The Atlas** — a fast-travel system: browse the world, warp to any
   city / airport / military base / spotting hotspot. This is the
   headline feature; everything else feeds it.
2. **Destination content** — a much bigger, richer offline POI database:
   more cities, more landmarks, and two NEW kinds: `military` (bases
   where cool planes live) and `hotspot` (famous plane-spotting areas).
3. **World beauty / "alive" pass** — the ground should feel inhabited:
   road traffic pulses, rooftop beacons, cloud shadows, airport beacons.
4. **Spotting gameplay glue** — surface rare/military traffic so
   warping to Nellis actually pays off ("SPICY TRAFFIC" pings).

The player fantasy: *open the atlas, warp to Davis-Monthan, fly over
2,000 mothballed airframes in Day style, catch a B-52 doing pattern
work, stamp it in the passport.*

---

## 2. Where the world is today (post round-4, all verified)

Full inventory in FLY_GLOBE_REWORK §6–§6.3. The parts THIS round builds on:

- **POIs:** `lib/fly/poi-data.js` — offline only. `buildPoiList()`
  returns ~300 entries: every airport from the shared `lib/airports.js`
  DB (kind `airport`, IATA as the big name), ~80 `CITIES` and ~31
  `LANDMARKS` as `[name, lat, lon]` tuples. `makePoi` precomputes
  mercator world XZ at module load; elevation is lazily sampled+cached
  by PoiLetters. Rendered by `components/fly/PoiLetters.jsx` (8 slots,
  2s selection tick, per-kind `LETTERS` constants, declutter by
  separation, clean white Archivo Black — NO decoration, taste rule).
  Round 4 added `runtime.poiSlots` + hover tooltips in LabelCanvas.
- **Warp machinery (player teleport):** `runtime.warpTo(hex)` in
  `components/fly/FlyScene.jsx` already does everything a long-range
  warp needs: set `flight.pos`, heading/speed, `engine.worldToGeo` →
  `runtime.geo` (the 1Hz poll key re-centers automatically),
  `groundElev` refresh, floating-origin `rebase()`, `chase.snap()`,
  `bumpWarpEpoch()` (WarpFlash + contrail reset). Traffic self-heals
  after any jump: poll re-centers (React Query key = rounded
  `runtime.geo`, `use-fly-traffic.js`), old tracks age out via the
  stale ladder, ribbons hard-cut on >2500m fix jumps. Toy chunks
  re-stream around the new position (refreshMoveM/refreshSec +
  maxChunks eviction); three-tile streams from `setAnchor`+camera.
  **The work is a `warpToGeo(lat, lon, opts)` generalization + UI.**
- **Shader-layer toolkit:** `lib/fly/toy-world/world-bend.js` owns three
  patch variants (`world-bend`, `world-bend-fade`,
  `world-bend-fade-foam`) sharing live uniforms. Round 4's foam proved
  the **per-vertex arc-length attribute + scrolling dash** technique:
  the worker bakes `aFoam` into the merged water group (−1 sentinel on
  non-foam verts), the material scrolls a dash train, ZERO extra draws.
  **Road pulses reuse this exactly** (§4.3).
- **Budgets:** draws ≤350/style (currently ~320/228/197), tris ≤1.5M,
  headless harnesses green (`verify-globe.js`, `verify-globe2.js`,
  `verify-edge-fx.js`, `verify-fly-game.js`, `verify-fly-style.js`).
- **Still open from round 4:** user live-tuning of the new defaults;
  on-hardware iGPU soak; terrain LOD seam "cliffs" along rivers
  (known cosmetic, see §4.5).

---

## 3. Hard constraints (inherited + new lessons — violating any is a regression)

Repeat of the standing rules (full text FLY_MODE_HANDOFF §3):

1. **NO API keys, no .env, ever.** All new data in this round is
   STATIC, hand-curated, checked into the repo. The atlas coastline
   data must be public-domain **Natural Earth** (see §6 licensing).
   Tile/data providers only in `lib/fly/tile-sources.js`.
2. **No `console.*` on per-frame paths** (dev leak ~200MB/min). Dev
   stats = `window.__flyStats` field writes.
3. **Pinned three ecosystem** (three 0.185.1 / R3F 9.6.1 / drei 10.7.7
   …). No new heavy deps. r185 buffer API: `addUpdateRange`.
4. **Per-frame data never through React state/zustand** — `runtime` +
   refs; zustand on discrete transitions only. StrictMode-safe
   (idempotent init, symmetric dispose). Anything suspending inside
   FlyScene needs its OWN `<Suspense>`.
5. **Draw budget ≤350/style.** Every §4 feature is specced net-zero or
   +1 draw; the budget arithmetic is in each section. No silent extra
   per-chunk meshes.
6. **Attribution bar always visible.** New data sources (Natural Earth)
   join `lib/fly/assets.js` → CREDITS.md (`node scripts/gen-credits.mjs`).
7. **The user owns `lib/fly/fly-constants.js` + `toy-palette.js`
   values.** Add constants with sensible defaults; expect live tuning.
8. **Taste rules (twice confirmed):** neutral/quiet/premium beats
   playful/decorated. Saturated color belongs ONLY to hero elements
   (tracers, red jet, card hero color, rarity). POI letters stay clean
   white — differentiate kinds via the atlas/tooltip/minimap, NOT
   letter color/decoration. Get sign-off on ONE example before wiring
   a visual across the world.
9. **Don't touch:** `app/api/*` (see §4.6 exception process),
   `stores/aircraft-store.js`, `stores/map-store.js`, `lib/classify.js`,
   2D-map code. ONE dev server per `.next`.

**New lessons from round 4 (do not re-learn these the hard way):**

10. **Every shader variant needs its own `customProgramCacheKey`.** The
    patch closures stringify identically — a shared key serves the
    wrong cached program silently. Road pulses add
    `'world-bend-fade-pulse'` (land) — keep the registry in
    world-bend.js comments current.
11. **Test BOTH altitudes in every style.** Round 4's FL300 report:
    tuning that looks perfect at spawn height (800m) broke at cruise
    (void band, contrail wedge). Any new world visual gets a low-alt
    AND a 30k-ft screenshot in the harness.
12. **Camera-inside-ribbon:** camera-facing ribbons need near-camera
    width collapse (`nearFade*M` pattern) — anything trail-like you add
    must handle the chase camera sitting inside it.
13. **Upstream ADS-B pressure is real.** The 429 storms and the
    cross-source clock skew both came from polling behavior. Any new
    polling (the §4.6 scout) must be opt-in, slow, rounded-coord
    cache-friendly, and flagged OFF by default.
14. **Harness clicks race the mouse-steer.** Pixel-aiming in headless
    harnesses is best-effort; assert product behavior through store
    paths as the deterministic fallback (see verify-fly-game.js's
    openPath pattern).

**Lessons added by this round (2026-07-17):**

15. **A shader-declared attribute must exist on EVERY geometry that
    material draws.** A missing vertex attribute reads as constant 0 in
    WebGL — for `aArc`/`aBeacon` (0 is a VALID animated value; −1 is the
    sentinel) that means the entire surface pulses. The engine fills −1
    over the ground-grid verts before splicing worker arcs, and builds a
    −1 fallback if a payload ever lacks the array. Any future baked-
    attribute layer must do the same.
16. **Sentinels and signed encodings can't share a channel.** Reversed
    pulse direction is encoded as `total−arc` (values stay ≥0) instead of
    negating the arc, because −1 is the no-animation sentinel. If a
    future layer needs true signed data, split the sentinel into its own
    attribute or renormalize.
17. **Real data fires the features during harness runs.** SPICY pings
    from genuine military traffic appeared alongside the synthetic test
    contact (strict-mode locator violation); tracer counts RAMP through
    45s windows on heavy evenings (500→900 tracked), which inflates raw
    cv with zero instability — the stability gate now measures DETRENDED
    cv (mass-deletes still blow up residuals + maxDrop). Scope harness
    assertions to synthetic fixtures, and never assume a quiet sky.

---

## 4. Design

### 4.1 The Atlas (fast travel) — headline feature

**Entry points:** `M` key (new `input.consumePress('m')` branch in
FlyScene, same pattern as T/F), a PauseMenu button ("ATLAS — warp the
world"), and clicking the Minimap. Esc priority order in `FlyMode.jsx`
becomes: inspect → **atlas** → credits → pause.

**Store:** `stores/fly-store.js` gains `atlasOpen: false` +
`setAtlasOpen`. FlyScene neutralizes input while open (same as
`inspectHex`). World keeps flying behind it.

**UI (`components/fly/hud/Atlas.jsx` + `hud/atlas/` folder):** a
full-screen INK CODEX surface (reuse `CARD_THEME` from
`hud/inspect/inspect-tokens.js` — ink glass, ice text, hero accents):

```
┌──────────────────────────────────────────────────────────────┐
│  ATLAS                    [search field]            esc/close │
│ ┌──────────────────────────────────────────┐ ┌─────────────┐ │
│ │                                          │ │ DESTINATION │ │
│ │   canvas world map (ink ocean, ice       │ │ card:       │ │
│ │   coastlines, POI dots by kind,          │ │ name, kind, │ │
│ │   player marker, hover tooltip)          │ │ blurb, tags,│ │
│ │                                          │ │ local time, │ │
│ │                                          │ │ [⚡ WARP]   │ │
│ └──────────────────────────────────────────┘ └─────────────┘ │
│  [✈ random city]  [recents: …]  filter: ● city ● base ● spot │
└──────────────────────────────────────────────────────────────┘
```

- **Map rendering:** ONE 2D `<canvas>` (like Minimap/LabelCanvas — no
  GL). Equirectangular projection, ink ocean (`PALETTE.skyZenith`
  family), coastlines stroked in ice at ~35% alpha from the packed
  Natural Earth polylines (§6). POI dots: cities ice, airports dim
  cyan, military `#f87171`-family, hotspots amber — the atlas is a UI
  surface, class-color accents are allowed (card precedent). Player
  position = the red jet marker. Zoom/pan: wheel + drag (clamp), or
  v1 fixed world view + a zoomed inset on hover — keep v1 SIMPLE.
- **Search:** text input filters the POI list (name/ICAO/tags),
  arrow-keys + enter to warp. Type "nellis" → enter → gone.
- **Destination card:** kind badge, curated blurb (military: "what
  flies here" tags — §4.2 data), distance from current position,
  **local time** (static `tzOffsetH` per city entry; show "03:12 —
  suggest Night style" hint when dark, do NOT auto-switch).
- **Recents + favorites:** localStorage (`fly-atlas-recents`), plus a
  "random city" die button (cheap delight, uses `Math.random` — fine
  here, this is DOM UI not a workflow script).

**Warp mechanics (`runtime.warpToGeo(lat, lon, opts)` in FlyScene,
generalizing `warpTo`):**

```js
// opts: { altM = 800, headingRad = 0, offsetM = 0, offsetBearingRad }
// military/hotspot destinations spawn OFFSET ~4km outside the point
// (the planes are AROUND a base, not on it) at ~1200m, nose toward it.
flight.pos.copy(engine.geoToWorld(lon2, lat2, altM));
flight.heading = headingRad; …zero rates…
flight.speed = FLIGHT.speeds.cruise;
runtime.geo = engine.worldToGeo(flight.pos);   // poll re-centers next tick
flight.groundElev = engine.getElevationAt(...) ?? 0;
rebase(flight.pos.x, flight.pos.z);
chase.snap();
store.bumpWarpEpoch();                          // flash + contrail reset
store.setAtlasOpen(false);
```

Everything downstream self-heals (verified machinery, §2): traffic
repopulates in 1–2 polls, tiles/chunks stream, ribbons cut cleanly,
letters re-pick on the 2s tick. **Known rough edge:** cross-continent
tile stream-in takes ~10–25s. V1 arrival treatment = WarpFlash (900ms)
+ an **arrival banner** (DOM, destination name in Archivo Black, fades
over ~3s — same language as the nearest-POI line). The world visibly
streaming in UNDER the banner is acceptable (the edge-fade hides raw
tiles well). A full "hyperlane" cinematic is §7 open question, not v1.

Also generalize the passport: log an atlas warp in a new
`visitedPois` list persisted in the fly store (hex-visits already live
in passport-store; POI visits are fly-specific — keep them in
`fly-store` persist or a tiny `fly-atlas-store`; decision at build
time, keep it OUT of the shared 2D stores).

**Draw/perf cost:** zero GL. One DOM canvas redrawn on interaction
(not per frame; the player marker can tick at 2Hz while open).

### 4.2 Destination content — the POI database expansion

All static, hand-curated, offline. Restructure `lib/fly/poi-data.js`
into a folder (module size stays trivial):

```
lib/fly/poi/
  cities.js      // grow ~80 → ~250 world cities [name, lat, lon, tzOffsetH]
  landmarks.js   // grow ~31 → ~120 (global spread)
  military.js    // NEW ~45 entries (see below)
  hotspots.js    // NEW ~25 famous spotting locations
  index.js       // buildPoiList() (same export path re-exported from poi-data.js)
```

`military.js` entry shape (this powers letters, tooltips, AND atlas):

```js
// [name, icao, lat, lon, tags[], blurb]
['Nellis AFB', 'KLSV', 36.2362, -115.0343,
  ['fighters', 'red-flag', 'aggressors'],
  'Red Flag exercises — F-16/F-35 aggressors daily; the Vegas jackpot.'],
['Davis-Monthan AFB', 'KDMA', 32.1665, -110.883,
  ['boneyard', 'a10'],
  'AMARG boneyard: ~3,000 stored airframes visible in Day style. A-10s active.'],
['Whiteman AFB', 'KSZL', 38.7303, -93.5479, ['b2'],
  'Home of the B-2 fleet — patience required, payoff enormous.'],
// … Edwards, Groom Lake (mark lat/lon of the range boundary, tag
// 'test'), China Lake, Pax River, Eglin, Barksdale (B-52), Dyess (B-1),
// Langley (F-22), Luke/Hill (F-35), Miramar, Oceana, Lemoore, Travis /
// Dover / Charleston (heavies), McConnell (tankers), Wright-Patterson,
// Ramstein, Lakenheath, Mildenhall, Fairford, Aviano, Kadena, Yokota,
// Osan, Iwakuni, Nellis ranges, Tonopah …
```

`hotspots.js`: Maho Beach SXM, LAX In-N-Out, Heathrow 27L approach,
Gravelly Point DCA, Anchorage cargo ramp, Gander, Keflavík ferry stop,
Frankfurt spotting hills, Amsterdam Polderbaan, Tokyo Haneda park,
Sydney beach approach, Oshkosh (tag `airventure`), Mojave storage,
Victorville, Pinal Airpark, Everett Paine Field, Toulouse/Hamburg
Airbus, Charleston Boeing…

**In-world presentation:** new `LETTERS.military` (sizeM ~120, rangeM
60000, max 2) and `LETTERS.hotspot` (sizeM ~85, rangeM 35000, max 2).
Letters STAY white Archivo Black (constraint 8). Kind differentiation:
- the LabelCanvas hover tooltip (round 4) gains the kind badge line +
  the blurb's first clause for military/hotspot;
- the Minimap draws military POIs in range as small hollow triangles;
- `SLOTS` in PoiLetters bumps 8 → 10 (two new kinds; declutter
  separation already prevents pile-ups).

**Elevation note:** POI elev is lazily sampled — unchanged. Warp
spawn uses `getElevationAt` at arrival (already in warpToGeo).

### 4.3 World-alive pass (the "looking better" batch)

Priority-ordered; each is independent and net-zero/+1 draw.

**(a) Road traffic pulses (toy style) — the big one.** Mirror the foam
technique exactly (round 4, §6.3): in
`lib/fly/toy-world/vector-tile.worker.js`, the road `pushRibbon` calls
for classes `motorway|trunk|primary` write an `aArc` accumulated
arc-length; every other LAND-group vertex gets −1. Pack `aArc` for the
land group (like water's foam array). `toy-world-engine.js` sets the
attribute; the LAND material gets a pulse layer after `applyBendFade`
(new `applyRoadPulse(material, lenM)` in world-bend.js, cache key
**`'world-bend-fade-pulse'`**): a short bright dash train scrolling
along the arc, brightness ABOVE the bloom threshold so pulses glow like
data packets. Constants `ROAD_PULSE = { lenM: 420, speed: 0.5,
duty: 0.12, boost: 1.35 }`. Direction variety: alternate sign per
feature hash (worker knows the feature id — flip arc sign). **Zero
extra draws.** Memory: +4 bytes/vert on the land group (~10–15MB across
120 chunks — acceptable vs the 140MB LRU budget; measure in the phase).
⚠️ Keep the pulse OFF the minor-road classes — quiet grid, loud
arteries (taste rule).

**(b) Rooftop beacons (toy).** The worker already extrudes buildings
with per-building heights; for buildings above ~0.8 × `maxH`, emit one
tiny top-face quad (≈1.5m) into the BUILDING group with vertex color
`#ff6b6b`-family at luminance just above the bloom threshold, plus an
`aArc`-style per-beacon phase so the pulse layer can blink them slowly
(reuse the same uniform clock, different duty). Baked into existing
geometry — zero draws. Aviation obstruction lights on the skyline:
extremely on-theme.

**(c) Cloud shadows (Day).** One extra instanced draw: a pool of dark
soft-ellipse billboards (shared radial-gradient texture or vertex-alpha
disc), one under each visible puff at `groundY + 2` (CloudField already
samples per-puff ground!), scale ≈ puff size, opacity ~0.12, rotated
flat (XZ plane), same toroidal wrap + distance dissolve. Day style
only (`CLOUDS.byStyle.satellite.shadows: true`). Budget: +1 draw → Day
~198. Skip in dark styles (ground is already dark).

**(d) Airport beacons (all styles, night-leaning).** For `airport`
POIs within letter range, a slow white-green alternating blink point at
the field: piggyback PoiLetters' slot system — a tiny additive quad per
airport slot (max 3 airports shown) pulsed by uniform clock. +1 draw
via one shared InstancedMesh (pool 8). Optional; smallest payoff of
the four — build LAST.

**(e) Terrain LOD seam cliffs (investigation, time-boxed).** The
jagged river-edge steps (visible in the FL315 shots). Options, in
order: (1) raise three-tile `LODThreshold` a notch and measure draw
delta; (2) accept + note. Do NOT sink time into three-tile internals —
timebox to one session-hour, document the verdict in §8.

### 4.4 Spotting gameplay glue

**(a) SPICY TRAFFIC pings (local, v1 — data already on hand).** In the
existing 2s label/selection cadence (NOT per frame), scan
`traffic.items` for tracks with `meta.iconType === 'military'` OR
rarity ≥ epic (compute rarity lazily ONCE per hex, cache on a Map —
`calculateRarity` is pure). First sighting of a qualifying hex →
`SpotToast`-style ping ("◆ SPICY · F-16 · 12nm NE") + minimap pulse
ring on that contact + `FlyAudio.spotBlip(tier)` reuse. Store a
session-scoped `seenSpicy` Set (no persistence). New
`components/fly/hud/SpicyPing.jsx` OR fold into SpotToast with a
variant prop — decide at build time (folding is less DOM; keep one
toast stack, cap 2 stands).

**(b) Base visit log.** `warpToGeo` to a military/hotspot POI records
`{poiName, ts}` in the persisted atlas store; the atlas card shows
"visited ×N". Badge definitions live in shared `lib/badges.js` — do
NOT modify it this round (shared-file constraint); note as future.

**(c) The scout (global rare-watch) — OPTIONAL, FLAG OFF, build LAST
or not at all.** One background poll per 60s rotating through the
user's FAVORITED bases (max 3), using the existing `/api/aircraft`
proxy with 0.01°-rounded coords (cache-dedup friendly). Results feed a
passive atlas notification ("B-1 activity at Dyess"). ⚠️ Constraint 13:
this is the ONLY net-new upstream load in the round; it ships behind
`ATLAS.scoutEnabled: false` and the user turns it on knowingly. If 429s
reappear in `use-fly-traffic` logs, it dies first.

### 4.5 Explicitly OUT of scope this round

- Time-of-day / sun cycle (suggest-style hint in the atlas is in; a
  real dawn/dusk lighting system is not).
- Hyperlane warp cinematic (v1 = flash + arrival banner; see §7).
- Multiplayer/ghosts, ATC audio, weather radar.
- Any change to the 2D map app or shared stores.

---

## 5. Phased plan (each phase lands green before the next starts)

### Phase A — Atlas core (data + warp + UI)
1. Restructure `lib/fly/poi/` (cities/landmarks unchanged content-wise,
   + `tzOffsetH` on cities); keep `poi-data.js` re-export so PoiLetters
   is untouched by the move.
2. Curate `military.js` (~45) + `hotspots.js` (~25) with tags/blurbs.
3. Natural Earth coastline asset + generator script (§6).
4. `warpToGeo` in FlyScene (+ arrival banner component), fly-store
   `atlasOpen`, Esc-order update, input `m` binding.
5. `hud/Atlas.jsx` (canvas map, search, destination card, recents,
   random). INK CODEX styling from `inspect-tokens.js`.
6. **Verify — new `scripts/verify-atlas.js`:** enter fly → press M →
   assert `[data-testid="atlas"]` visible + screenshot → search
   "Tokyo" → warp → assert: `runtime.geo` within 1° of Tokyo, warp
   flash fired, toy chunks `ready > 8` within 30s, `traffic > 10`
   within 20s, zero pageerrors; screenshot arrival (low alt) AND after
   climbing to 8km (constraint 11). Then warp "Nellis" (military
   spawn-offset path) → assert offset ≈4km from field center +
   military letter present in `runtime.poiSlots` within 10s.
   Re-run `verify-globe.js` (budget unchanged — atlas adds no GL).

### Phase B — POI kinds in-world
1. `LETTERS.military` / `LETTERS.hotspot` constants; PoiLetters SLOTS
   8→10; tooltip kind badge + blurb line; minimap military triangles.
2. **Verify:** extend verify-atlas.js Nellis leg (tooltip render via
   `runtime.poiSlots` kinds; minimap pixel-sample optional); statics:
   letters stay white (screenshot eyeball), draws unchanged.

### Phase C — World-alive
1. Road pulses (worker `aArc` + `applyRoadPulse`, cache key registry
   updated). Measure: draws unchanged, land-group memory delta logged
   in §8, screenshot at night + FL300 (constraint 11).
2. Rooftop beacons (worker top-quads + blink phase).
3. Cloud shadows (Day, +1 draw — budget note in §8).
4. (Optional) airport beacons.
5. **Verify — extend `verify-edge-fx.js`:** draws ≤350 all styles
   post-C; two frames 1s apart pixel-diff along a known motorway
   (pulse movement > threshold = animation alive — same technique as a
   screenshot pair, keep it crude); FL300 + spawn screenshots per
   style. Full `verify-globe2.js` re-run.

### Phase D — Spotting glue
1. Spicy pings (2s cadence scan + rarity cache + toast/minimap ring).
2. Visit log + atlas card "visited ×N".
3. (Flag-off) scout, ONLY if the user opts in at review.
4. **Verify:** synthetic spicy test — verify-fly5.js pattern (synthetic
   targets) injects a military archetype; assert ping toast appears
   once and never re-fires for the same hex; zero errors soak 3 min.

### Phase E — Polish + review + soak
1. User live-tuning loop (atlas colors, pulse speed/duty, beacon
   brightness, spawn offsets — all constants).
2. Full harness sweep + screenshot review (EVERY screenshot, both
   altitudes, all styles).
3. The still-outstanding on-hardware iGPU soak (`scripts/soak-fly.js
   15` on the user's machine) — now with atlas open/closed segments.
4. Docs: §8 progress log, CLAUDE.md notice, memory update, CREDITS
   regen if assets changed.

---

## 6. Data curation + licensing

- **Coastlines:** Natural Earth 110m (`ne_110m_coastline` or
  `ne_110m_land`) — **public domain** (no permission/attribution
  required, but we credit anyway). One-time generator
  `scripts/gen-atlas-map.mjs`: reads a downloaded NE GeoJSON, quantizes
  to a packed `Float32Array` polyline blob (`public/atlas/coastlines.bin`,
  target <150KB) + a tiny JS index. Add a `kind: 'data'` entry to
  `lib/fly/assets.js` (author "Natural Earth", license "Public
  Domain") → `gen-credits.mjs` regen. The generator is run BY THE
  DEVELOPER once; the repo ships the packed blob (no runtime fetch of
  third-party hosts — constraint 1).
- **Cities/tz offsets:** hand-curated static (offsets are coarse hints
  for the "it's night there" nudge — DST exactness explicitly does not
  matter; note that in the entry comment).
- **Military/hotspot lat/lons:** public-knowledge coordinates
  (airfield reference points). Blurbs are original text. Groom Lake et
  al are public-map coordinates — fine.
- **No new binary art assets** planned; if any get added (e.g. a cloud
  shadow texture), manifest + CREDITS first (constraint 6).

---

## 7. Open questions for the user (ask before the relevant phase)

1. **Atlas map style:** flat ink canvas map (spec'd v1) — or invest in
   a spinning 3D mini-globe picker later? (V1 ships flat; globe is a
   showpiece upgrade.)
2. **Military letter differentiation:** pure white letters + tooltip
   badge (spec'd, taste-safe) — or a SUBTLE marker (small hollow ▲
   prefix on the letter)? One example screenshot before wiring wide.
3. **Warp arrival:** is flash + name banner enough, or do you want the
   hyperlane cinematic (camera pull-up → streak tunnel → dive-in,
   ~2.5s)? Costs a session; pure juice.
4. **The scout** (§4.4c): ship at all? It's the only new upstream load.
5. **Random-city die:** include drift toward "interesting" (weights
   military/hotspots in) or pure uniform?
6. **SLOTS bump 8→10:** more names on screen at once — or keep 8 and
   let military/hotspot COMPETE with cities (quieter skyline)?

---

## 8. Progress log (fill as you go — the round-4 doc's §6.3 is the model)

### 2026-07-17 — Phases A+B: Atlas core + POI kinds in-world (EXECUTED)

**Shipped:**
- `lib/fly/poi/` folder: `cities.js` (~300 cities, all with coarse
  `tzOffsetH`), `landmarks.js` (~120), `military.js` (63 bases with
  icao/tags/blurbs), `hotspots.js` (30 spotting locations), `index.js`
  (`buildPoiList` unchanged contract + new `buildAtlasList`).
  `poi-data.js` is a re-export shim.
- Natural Earth 110m coastlines → `public/atlas/coastlines.bin` (40.5KB,
  134 lines / 5,116 pts; generator `scripts/gen-atlas-map.mjs`; loader
  `lib/fly/atlas/coastlines.js`). Manifest entry in `lib/fly/assets.js`
  (Public Domain) + CREDITS.md regenerated (13 assets).
- `runtime.warpToGeo(lat, lon, {altM, headingRad, offsetM,
  offsetBearingRad, name, kind})` in FlyScene — military/hotspot warps
  spawn 4km out at 1,200m, nose on the point (bearing randomized per
  warp). DEM-less arrivals ride the flight-model soft floor up once
  terrain streams (verified at Denver-class elevations implicitly via the
  floor clamp; no special casing).
- `hud/Atlas.jsx` + `hud/atlas/` (AtlasMap canvas: equirect, ink ocean,
  ice coastlines, kind-colored dots — military hollow triangles, hotspot
  diamonds — wheel zoom/drag pan/click select/hover labels, red player
  wedge, 2Hz tick while open, zero GL). Search with ↑/↓ + Enter-warps,
  destination card (kind badge, blurb, tags, live distance, coarse local
  time + "dark — try Night style" nudge, favorite star, visited ×N, WARP),
  recents/favorites chips, random-city die, kind filter toggles.
- Entry points: `M` (InputController now ignores keydowns targeted at
  INPUT/TEXTAREA so the search field can't steer the plane), PauseMenu
  "Atlas — warp the world", Minimap click. Esc order: inspect → atlas →
  credits → pause. Input neutralized while open (same as inspect).
  LabelCanvas suppresses plane hover/click + POI tooltips under the atlas.
- `stores/fly-atlas-store.js` (zustand persist `fly-atlas`): recents,
  favorites, per-destination visit counts. `fly-store` gains
  `atlasOpen`/`arrival`. `ArrivalBanner.jsx`: destination name in Archivo
  Black fading ~3.2s over the streaming world.
- Phase B: `LETTERS.military` (120m/60km/max2) + `LETTERS.hotspot`
  (85m/35km/max2); PoiLetters SLOTS 8→10, kind order
  city>airport>military>landmark>hotspot; poiSlots snapshot carries
  `blurb`; LabelCanvas tooltip gets the BASE/SPOT badge line (class color,
  atlas precedent) + first blurb clause; Minimap draws in-range military
  POIs as hollow red triangles. Letters stay clean white (constraint 8).

**Harness evidence** (`scripts/verify-atlas.js`, 2 green runs): M → atlas
visible; "Tokyo" → Enter → atlasOpen false, warpEpoch 1, arrival banner
visible, geo within 0.001° of Tokyo; toy chunks ready 36 ≤30s; traffic 369
≤20s; "Nellis" → offset 3,889m (band 2.8–5.5km), Nellis AFB letter in
poiSlots with blurb (alongside city:Las Vegas, airport:LAS,
landmark:Las Vegas Strip), visit logged in `fly-atlas`; zero pageerrors.
Screenshots reviewed: atlas open, Tokyo arrival (low), Tokyo 8km
(constraint 11 — bend flattens, no void band), Nellis arrival (letters +
drawn runways + LAS VEGAS beyond). `verify-globe.js` re-run: draws
347/227/233 ≤350 (2 extra letter slots are inside normal variance).

### 2026-07-17 — Phase C: world-alive pass (EXECUTED)

**Shipped:**
- **(a) Road pulses** — worker `pushRibbon` gained `arcDir` (0/±1):
  motorway/trunk/primary write accumulated arc into the land group's
  shared per-vertex array (−1 sentinel elsewhere; REVERSED features write
  `total−arc` so values stay ≥0 and the sentinel stays unambiguous; flip
  hashed off the feature id). Packed as `aArc` (+4 bytes/vert on land);
  engine fills −1 over the ground-grid verts and splices the worker arcs.
  `applyRoadPulse` in world-bend.js (cache key **`world-bend-fade-pulse`**,
  registry comment updated) scrolls a smoothstepped dash head;
  `ROAD_PULSE = {lenM 420, speed 0.5, duty 0.12, boost 1.35}`. Clock via
  `setPulseTime` from ToyWorldLayer. Zero extra draws.
- **(b) Rooftop beacons** — worker emits a 1.6m top quad on buildings
  ≥0.8×maxH (72m), vertex-colored `BEACONS.color`, per-beacon phase
  hashed off the id, packed as `aBeacon` (−1 elsewhere);
  `applyBeaconBlink` (cache key **`world-bend-fade-beacon`**) blinks
  dim 0.35 ↔ boost 1.8 on a shared slow clock. Zero extra draws.
- **(c) Cloud shadows (Day)** — one InstancedMesh pool (54 discs,
  procedural radial alphaMap, opacity 0.12) in CloudField, placed on each
  puff's already-sampled ground +3m, dissolving with the puff's distance
  scale; material rides `applyBend` so discs curve with the mini-planet.
  `CLOUDS.byStyle.*.shadows` + `CLOUDS.shadow`. +1 draw, Day only
  (probe: 49/54 instances live, meanY +15m, visible=false in toy).
- **(d) Airport beacons: NOT BUILT** (spec-ranked lowest payoff; toy draws
  sit 347/350 — the headroom belongs to nothing).
- **(e) LOD seam cliffs: ACCEPTED.** The knob is `lodThreshold` (1) on the
  three-tile TileMap (terrain-engine.js:41). Raising it subdivides sooner
  globally = more tiles/draws in every style; with toy at 347/350 there is
  no headroom for a cosmetic fix visible mainly at cruise over rivers.
  Revisit only if the budget ever drops ~30 draws.

**Harness evidence** (`scripts/verify-edge-fx.js` extended): pulse/beacon
programs patched with their own cache keys; 120/120 land chunks carry
aArc, ~20.9k live arc verts; 88 beacon verts (22 beacons — data-driven,
`render_height` is sparse outside cores); pulse clock advancing; crude
two-frame diff 28.8% (alive); FL300+spawn screenshots per style reviewed
(new 06/07/08 shots; toy FL300 clean — flattened bend, no void band).
Close-pass pair over the NJ motorway braid shows the bright dash train
displaced between frames 1.6s apart. Draws: toy 332–347, night 204–222,
day 198–210 — all ≤350; pulses/beacons measurably zero-draw (347 pre = 347
post at the same location). Toy tris peaked 2.32M during an evening rush
(724 tracked, tracers capped 512) — traffic-instance driven, not world
geometry; the 1.5M PERF_BUDGET note is exceeded by DATA on heavy evenings,
unchanged by this round.

### 2026-07-17 — Phase D: spotting glue (EXECUTED)

**Shipped:** SPICY pings folded into SpotToast (one stack, cap 2): 2s scan
over `traffic.items` for `meta.iconType === 'military'` OR cached
`calculateRarity ≥ epic` within `SPICY.maxRangeNm` (50); first sighting →
"◆ SPICY · <callsign> · <type> · <nm> <dir>" toast (military accent
#f87171, else tier color), `runtime.spicyPulse` expanding ring on the
minimap contact, `spotBlip(tier)`; session `seen` Set, one fresh ping per
scan tick (no warp-arrival bursts). Base visit log + card "visited ×N"
landed with Phase A. **Scout (§4.4c): NOT BUILT** — flag-off feature,
needs explicit user opt-in first (constraint 13).

**Harness evidence** (`scripts/verify-spicy.js`): synthetic F-16
(VIPER11, military archetype+iconType) → toast "◆ SPICY VIPER11 Lockheed
F-16 Fighting Falcon 5.2nm NE" within one scan, spicyPulse set, retired
after TTL, zero re-fires over 12s, 3-minute zero-pageerror soak (heap
115MB). Live-data note: REAL evening traffic pinged legitimately during
the run (genuine military contacts) — and one Cessna 172 cleared the epic
gate via rarity bonuses, so `SPICY.minTier`/scoring generosity is a
live-tuning candidate.

### 2026-07-17 — User-reported fix: altitude-aware traffic bend

**User (during round-5 review, at 3,000ft over Philadelphia):** "we still
have the problem with planes that are clearly higher up in the air appear
lower than us at 3k feet....."

**Root cause:** traffic rode the same raw d²k mini-globe drop as the
ground. At full toy curvature (R=80km) a jet at FL210 25nm out drops
~13km — far below the visual horizon — so its label ("FL210") pinned to
the ground band while the player flew at 3k ft. Round 4's altFlatten only
relaxed k with the PLAYER's altitude, not the target's.

**Fix:** new `'world-bend-air'` shader variant (`applyBendAir`, registry
updated) for traffic models + billboards + tracer ribbons/streaks, with a
CPU mirror `airDrop(d, y)` reading the SAME live uniforms (used by
LabelCanvas labels/reticle and harness aim via the dev handle
`window.__flyAirDrop`). Formula: full d²k drop near the ground
(proxy AGL = y − player groundElev, blended over
`GLOBE.trafficBend.aglLoM..aglHiM` = 150..900m) so taxiing/landing
traffic stays glued to the drawn terrain; airborne, the drop caps at
`(y − eyeY) × (1 − keepFrac)` so a target above the player asymptotes
toward the horizon at range — like real distant traffic — and can NEVER
sink below eye level. `setBendEye(eyeY, groundY)` rides the -50 frame
loop next to setBend. Ground objects (letters, chunks, tiles, cloud
shadows) and clouds keep the pure globe bend — the aesthetic is
unchanged; only aircraft altitude-order is corrected.

**Harness evidence:** new `scripts/verify-airbend.js` — at 914m with 449
live tracks: 54 targets ≥300m above the player, ZERO below-eye
violations; 73 grounded tracks (>8km, agl<120m) all retain ≥90% of the
raw drop (glue intact); screenshot at 3k ft reviewed (17,100ft contact
high in the sky, 6,300ft above the horizon, 1,300ft and below correctly
under it). verify-fly-game re-run green through the new aim path
(arrival 653m).

### Full sweep (Phase E)

- verify-atlas ✓✓ · verify-globe ✓ (pre-C and post-C) · verify-globe2 ✓
  (draws 293, 0 errors) · verify-fly-game ✓ (hover→card→warp arrival
  653m, no canvas leak) · verify-spicy ✓ (incl. 3-min soak) ·
  verify-edge-fx: all Phase-C gates green; the round-4 `tracer cv < 0.15`
  gate read 0.156 once during a traffic RAMP (count climbing 300→400 as
  polls filled a heavy evening sky; maxDrop 2.1% — the wink-out detector —
  was clean). Data-conditions flake, threshold left alone.
- `scripts/soak-fly.js` gained atlas open/close segments + occasional
  long-range atlas warps (London/Tokyo/LA rotations — worst-case
  re-stream under load).
- **15-minute soak on final code (incl. the air-bend fix): PASS.** 78
  samples; worst p95 frame 8.5ms → fps floor ≈118 (target ≥55); heap
  207→209MB (flat across atlas opens + intercontinental warps — no leak);
  maxRebase 0.4ms; zero page errors. One caveat: draws peaked 368 (>350)
  for a few samples during a Tokyo warp leg tracking 1,119 aircraft —
  traffic-instance surge in a rush-hour sky, not world geometry (NYC legs
  ran 286–354). The budget was calibrated on ~400-track skies; frame time
  never moved (p50 4.2ms throughout). Flagged for the tuning review
  rather than silently re-baselining the gate.

**Open for review (the §7 questions, resolved to defaults):** flat ink
atlas map (no 3D globe picker yet); pure-white military letters + tooltip
badge; flash+banner arrival (no hyperlane cinematic); scout unbuilt;
random-city die is uniform over cities; SLOTS went 8→10. Live-tuning
candidates: ROAD_PULSE (len/speed/duty/boost), BEACONS (threshold/rate/
brightness), CLOUDS.shadow.opacity (0.12 is deliberately subtle),
SPICY.minTier + rarity generosity, atlas kind colors, military spawn
offset/altitude.

**Log format per entry:** what shipped, harness evidence (script +
numbers), screenshots reviewed (both altitudes), budget deltas
(draws/tris/memory), gotchas discovered (append to §3 if load-bearing),
user verdicts verbatim.
