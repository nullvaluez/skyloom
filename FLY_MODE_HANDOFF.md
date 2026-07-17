# Fly Mode — Handoff Document (Phases 3–6)

> **Audience:** a fresh Claude session with no prior context. This document is
> self-contained: read it top to bottom before writing code. The supplementary
> approved plan lives at `C:\Users\bfecho\.claude\plans\we-have-created-a-sharded-reef.md`
> (machine-local), but everything needed is here.
>
> **State as of 2026-07-15 (END OF DAY): ALL PHASES 0–6 IMPLEMENTED AND
> BROWSER-VERIFIED.** See §8 (added at the bottom) for what was built in
> phases 3–6, the verification evidence, corrections to this document's
> assumptions (⚠️ `now` is epoch MILLISECONDS, not seconds), and the short
> list of genuinely remaining polish items (GLB asset pass, LOD seams,
> 15-min iGPU soak). The per-phase specs below are kept for reference but
> are now DONE — read §8 first.

---

## 1. Mission

Skyloom (ShadowADSB) is a live ADS-B flight tracker (Next.js 16.1 App Router,
React 19.2.3, plain JS, deck.gl + MapLibre 2D map, zustand 5, react-query 5,
comlink worker, data from api.adsb.lol). We are adding **Fly Mode**: a
bruno-simon.com-style immersive experience where the user pilots an arcade
aircraft over real 3D terrain, sees **live ADS-B traffic as 3D aircraft at
true positions**, can chase/intercept a real airliner, gets a soft-lock info
card near one, and can fly in formation with it.

**Product decisions (user-confirmed, do not relitigate):**
- Fly Mode is a **mode alongside** the 2D map, not a replacement.
- **Arcade** flight feel with assists (auto-bank, cannot crash/stall).
- Real terrain + satellite imagery.
- **ZERO API keys anywhere** (user explicitly reversed an earlier Mapbox
  decision mid-implementation — see §3). Esri keyless tiles are in use.
- **Free assets only**: CC0 preferred, CC-BY allowed **with credits UI**.
- Desktop-first, target 60fps on integrated GPUs; mobile = "desktop
  recommended" note, not a blocker.

---

## 2. What is DONE and verified (do not redo)

### Phase 0 — Toolchain + mode shell ✅
- Pinned deps installed (exact versions, `package.json`): `three@0.185.1`,
  `@react-three/fiber@9.6.1`, `@react-three/drei@10.7.7`,
  `@react-three/postprocessing@3.0.4`, `three-stdlib@2.36.1`,
  `three-tile@0.12.1`, with an npm **`overrides`** entry forcing three-tile's
  `three` peer (it pins 0.183.1) to our 0.185.1 — works at runtime, verified.
- `next.config.mjs`: `transpilePackages: ['three','three-stdlib','three-tile']`,
  immutable cache headers for `/models/*` and `/hdri/*`.
- Fly mode entry: plane-icon button in `components/layout/Header.jsx`
  (desktop, `aria-label="Fly Mode"`) + a button in
  `components/panels/SettingsPanel.jsx`. State: `flyModeOpen` +
  `open/close/toggleFlyMode` in `stores/ui-store.js` (mirrors the AR pattern).
- `app/page.js`: FlightMap is **unmounted while flying**
  (`{!flyModeOpen && <FlightMap/>}`) — frees the MapLibre GL context and stops
  2D polling; it remounts and repolls on exit (verified: 323 aircraft
  repopulate within one poll). `FlyMode` is `next/dynamic` `ssr:false`.
  `PerformanceHUD` is also gated on `!flyModeOpen` (it z-stacks above the
  overlay otherwise).
- `hooks/use-keyboard-shortcuts.js`: early-returns when `flyModeOpen` — global
  `f`/`d`/`h`/`l`/`Escape` shortcuts would otherwise hijack flight keys.
- **Verified:** `npm run build` (Turbopack) clean; reversed depth buffer
  ACTIVE (`gl.capabilities.reversedDepthBuffer === true` logged in dev); a
  300km-distance depth probe rendered without z-fighting; enter/exit/re-enter
  cycles clean ("THREE.WebGLRenderer: Context Lost" on exit is three's
  intentional cleanup — harmless).

### Phase 1 — Streamed real terrain ✅
- **Tokenless sources** (`lib/fly/tile-sources.js`, the ONLY place providers
  may be defined):
  - Imagery: Esri World Imagery via three-tile plugin `ArcGisSource`
    (`style: 'World_Imagery'`), maxLevel from `TILES.satMaxZoom` (16).
  - Elevation: Esri World Elevation via `ArcGisDemSource`
    (`WorldElevation3D/Terrain3D` LERC tiles), maxLevel 15. **three-tile has a
    vendored LERC decoder running in its own worker pool** — no extra deps.
- `lib/fly/terrain-engine.js` — `TerrainEngine` class, the ONLY file that
  imports three-tile core. API: `.object` (mount via `<primitive>`),
  `geoToWorld(lon,lat,altM)`, `worldToGeo(pos)`, `getElevationAt(lon,lat)`
  (→ meters or null), `getGroundInfoAtWorld(pos)`, `.downloading`, `dispose()`.
  The TileMap is rotated `-90°` about X (three-tile's documented convention)
  so ground = XZ plane, +Y up. TileMap has `isLOD=true`/`autoUpdate` — three's
  renderer drives quadtree LOD from the active camera automatically; no
  manual update loop needed.
- **Verified:** 472 tiles streamed with **zero HTTP errors**; requests fully
  **plateau (+0 in 12s)** when stationary; DEM sampling correct (NYC harbor
  ~0–12m, Central Park 5.9m, **Palisades ridge 109.6m** ≈ real 90–120m);
  recognizable Manhattan from 1,500m; dispose leaves no runaway requests.
- `components/fly/hud/AttributionBar.jsx` renders
  "© Esri, Maxar, Earthstar Geographics · Terrain © Esri · Flight data ©
  adsb.lol" — **must stay visible in every Fly-mode state incl. pause/credits
  (Esri terms).**

### Phase 2 — Flight model, chase cam, HUD ✅
- `lib/fly/flight-model.js` — `FlightModel`: War-Thunder-"instructor" arcade
  scheme. Player commands TURN + PITCH; bank derives from coordinated-turn
  physics `atan(v·ω/g)`. State: `pos` (Vector3, world units), `heading`
  (rad, 0=north, clockwise+), `pitch`, `bank`, `speed` (TRUE m/s), `agl`,
  `latDeg`, `groundElev`; `forward(target)` gives the world unit vector.
  Soft floor: descent scales to 0 approaching `terrain + 50m`, then slides
  along terrain — **cannot crash**. Ceiling ~15km with thrust fade.
  Auto-level of pitch and bank after idle. All smoothing is
  frame-rate-independent exponential (`expApproach` in `coords.js`).
- `lib/fly/input-controller.js` — `InputController.read()` →
  `{turn:-1..1, pitch:-1..1(+=pull up), speedPreset:'slow'|'cruise'|'boost',
  boost:bool(Shift), freeLook:{active,dx,dy}}`. Mouse-steer = cursor offset
  from screen center (deadzone 2.5%, expo^1.8); WASD/arrows/QE add on top;
  RMB-hold = free-look deltas; 1/2/3 select presets. `attach(el)/detach()`.
- `lib/fly/chase-camera.js` — `ChaseCamera.update(dt, flight, camera,
  freeLook, k)`: damped follow (position lambda 4), look-ahead slerp
  (lambda 9), camera inherits 42% of bank, FOV widens with speed
  (62→78 at boost), RMB free-look orbits with snap-back.
- `lib/fly/coords.js` — **critical coordinate model, read this first**:
  the terrain world is **Web-Mercator meters** horizontally (stretched by
  `k = 1/cos(lat)` vs true meters, ≈1.32 at NYC) but **true meters
  vertically**. Flight speeds are TRUE m/s; horizontal displacement is
  multiplied by `mercatorScale(latDeg)` at application time. Helpers:
  `mercatorScale`, `wrapAngle`, `expApproach`, `expApproachAngle`, and
  conversion consts (`MPS_TO_KT`, `M_TO_FT`, `DEG2RAD`, `RAD2DEG`).
- `components/fly/FlyScene.jsx` — the frame loop. One `useFrame` at priority
  **-50**: read input → sample ground every 3rd frame
  (`runtime.geo = engine.worldToGeo(flight.pos)`; Vector3 x=lon, y=lat,
  z=altM) → `flight.step(dt,cmd)` → `chase.update(...)`. PlayerPlane pose
  updates at priority **-30**. Zustand is touched only on discrete preset
  changes. Scene also owns background color, `fogExp2` haze (doubles as the
  horizon cap bounding tile loads), lights, `<primitive object={engine.object}>`.
- `components/fly/PlayerPlane.jsx` — primitive-built stylized red/cream plane
  (placeholder until Phase 4 asset pass). Rig mapping (rotation order 'YXZ'):
  `rotation.set(pitch, -heading, -bank)`.
- `components/fly/hud/FlyHUD.jsx` — DOM readouts (SPD kt / ALT ft / AGL ft /
  HDG / throttle) updated at 10Hz from `runtime` via refs (no React state per
  tick), center steering dot, controls hint bar.
- **The `runtime` object pattern:** `FlyMode` owns `useRef({}).current`,
  passes it to `FlyCanvas → FlyScene` (which writes `runtime.engine`,
  `runtime.flight`, `runtime.input`, `runtime.geo`) and to DOM overlays
  (which read at low Hz). Per-frame data NEVER goes through React state or
  zustand.
- **Verified by automated browser flight test:** HUD correct (350kt/2,625ft
  at spawn = 180 m/s/800m ✓); 76° heading change in a 2s turn; **80° under
  4x CPU throttle** (5% delta — frame-rate independence proven); 8s full
  nose-dive ends **sliding at 169ft AGL vs the 164ft floor** (no clip, no
  crash); boost accelerates at exactly 40 m/s²; zero page errors.

### Files that exist (Fly mode)

```
stores/fly-store.js                  discrete state only (phase, spawn, speedPreset,
                                     qualityTier, lockedHex, lockState, infoCardHex,
                                     creditsOpen, trafficCount, lastPollAt, tileStats)
                                     + subscribeWithSelector; reset() on exit
lib/fly/fly-constants.js             EVERY tunable: CANVAS, PERF_BUDGET, FLIGHT,
                                     CAMERA, WORLD, TRAFFIC, TARGETING, TILES,
                                     KT_TO_MPS, FPM_TO_MPS, FT_TO_M
lib/fly/coords.js                    mercator scale, angle/exp helpers, unit consts
lib/fly/flight-model.js              FlightModel (pure, no React)
lib/fly/input-controller.js          InputController (pure)
lib/fly/chase-camera.js              ChaseCamera (pure)
lib/fly/tile-sources.js              Esri sources + TERRAIN_ATTRIBUTIONS
lib/fly/terrain-engine.js            TerrainEngine (only importer of three-tile)
components/fly/FlyMode.jsx           fullscreen shell, spawn resolution, Esc=exit,
                                     runtime owner, store reset on unmount
components/fly/FlyCanvas.jsx         Canvas: dpr [1..1.5] w/ PerformanceMonitor
                                     DPR ladder, gl={powerPreference,antialias:false,
                                     stencil:false,alpha:false,reversedDepthBuffer:true},
                                     near 2.5 far 600000, frameloop="always"
components/fly/FlyScene.jsx          scene graph + frame loop (see above)
components/fly/PlayerPlane.jsx       placeholder player aircraft
components/fly/Effects.jsx           EffectComposer(multisampling 0) Bloom(mipmap)
                                     + Vignette + SMAA
components/fly/FlyErrorBoundary.jsx  catches WebGL/context loss, offers exit
components/fly/hud/FlyHUD.jsx        10Hz DOM readouts + controls hint
components/fly/hud/AttributionBar.jsx  Esri/adsb.lol attribution (always visible)
scripts/verify-fly.js                Playwright browser flight-test harness (§6)
```

**Spawn logic** (`FlyMode`): `userLocation || map center || NYC [40.6892,-74.0445]`
from `stores/map-store.js` (`getState()`, not hooks). Map default center is
already NYC `[40.7,-74.0]` (`lib/constants.js` `MAP_CONFIG.defaultCenter`).

---

## 3. Hard constraints (violating any of these is a regression)

1. **NO API keys, no `.env`, ever.** The user first approved Mapbox free tier,
   then reversed it when they saw the token in `.env.example` (file since
   deleted). Tile providers live ONLY in `lib/fly/tile-sources.js`. Fallback
   DEM if Esri ever breaks: AWS Terrarium
   (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`,
   decode `h=(R*256+G+B/256)-32768`, z≤15) via three-tile `registerDEMLoader`.
2. **No r3f-perf.** Its `dist/roboto.woff.mjs` (binary bytes in an .mjs)
   crashes Turbopack's dev chunker ("invalid utf-8 sequence" → all routes
   500). It was removed from package.json and FlyCanvas. If you need draw
   call/triangle numbers, sample `gl.info.render` in a dev-only useFrame and
   warn against `PERF_BUDGET`.
3. **Do not enable Next `cacheComponents`** (breaks R3F canvas re-init;
   pmndrs/react-three-fiber#3595).
4. **Pin exact versions** for the three ecosystem (no `^`). three 0.x minors
   are breaking. Note: the user separately bumped deck.gl to `^9.3.6` and
   added `@deck.gl/widgets` for the 2D map — unrelated to Fly mode, leave it.
5. **Attribution must remain visible in every Fly-mode UI state.**
6. **CC-BY assets require a credits UI** (Phase 6) + `CREDITS.md`, rendered
   from ONE manifest (planned: `lib/fly/assets.js`) so they can't diverge.
7. **Never route per-frame data through React state/zustand.** Use the
   `runtime` object + refs; zustand only on discrete transitions
   (subscribeWithSelector is enabled on fly-store for transient reads).
8. **Don't touch** `app/api/*`, `stores/aircraft-store.js`,
   `stores/map-store.js`, `lib/classify.js`, or any deck.gl/2D map code —
   Fly mode reads shared data but never writes those stores. (Exception:
   Phase 4 extends `lib/workers/aircraft-processor.worker.js` — see §5.)
9. The user actively tunes `lib/fly/fly-constants.js` — treat its values as
   theirs; add new constants there rather than hardcoding.

---

## 4. Environment & gotchas (learned the hard way)

- **Windows 11, PowerShell 5.1 primary** (no `&&`; use `;` or `if ($?)`).
  Git Bash available.
- **Dev server:** `npm run dev` (Turbopack) on :3000. GOTCHA: background-
  launched dev servers can orphan their node child, which then holds :3000
  and — after a second instance corrupts the shared `.next` — serves 404s.
  If :3000 misbehaves: find the node PID via
  `Get-NetTCPConnection -LocalPort 3000`, kill it, delete `.next`, restart.
  Never run two dev servers against one `.next`.
- **React StrictMode is ON** → dev double-mounts. TerrainEngine/worker/
  listener creation must stay idempotent with symmetric dispose (currently
  true — keep it that way for new engines in phases 3–5).
- Pre-existing, NOT ours, ignore: 404 for `/icons/icon-192x192.png`
  (manifest icons never existed); `maxTextureDimension2D` pageerrors in
  headless Chrome (deck.gl/maplibre WebGPU probing on the 2D map);
  "THREE.Clock deprecated" warning (drei internal).
- Known cosmetic issues to address opportunistically: terrain LOD seam
  "cliffs" (visible along the Hudson at low altitude — tune three-tile
  `LODThreshold`/`updateInterval`, or accept); ~20s imagery refinement lag
  at spawn (consider a brief "descending through haze" intro to mask it).

---

## 5. REMAINING WORK — Phases 3–6

Constants referenced below (TRAFFIC, TARGETING, WORLD, PERF_BUDGET…) already
exist in `lib/fly/fly-constants.js` with the intended values.

### Phase 3 — Sky, clouds, floating origin (est. 2–4 days)

Goal: long flights look great and stay numerically stable.

1. **Sky:** download Poly Haven **"Kloofendal 48d Partly Cloudy (Pure Sky)"**
   HDRI, 2K `.hdr` (CC0) → `public/hdri/kloofendal_48d_partly_cloudy_2k.hdr`.
   Use drei `<Environment files="/hdri/..." background />` + keep a
   DirectionalLight matched to the HDRI sun direction. Delete the flat
   `<color>` background. Keep (retune) the fogExp2 haze; fog color should
   blend toward the HDRI horizon.
2. **Clouds:** drei `<Clouds>` billboards, 20–60 puffs between ~600–3,600m
   near the player, drifting slowly. **MUST self-host the texture** — drei's
   default cloud texture fetches from a githack CDN at runtime (forbidden).
   CC0 source: "Clouds with Transparency" by WickedInsignia,
   https://opengameart.org/content/clouds-with-transparency → pick one PNG →
   `public/textures/cloud.png`, pass via the `texture` prop. Cloud count is
   a quality-tier knob (fly-store `qualityTier`).
3. **Contrail** behind the player above ~6km alt (simple ribbon/particles;
   Kenney Particle Pack CC0 https://kenney.nl/assets/particle-pack has smoke
   puffs) — keep it cheap, depthWrite:false.
4. **Floating origin:** currently the world origin is three-tile's Mercator
   origin and the camera flies at |pos| ~10⁷ world units at NYC — float32
   jitter WILL appear (it's subtle at 1500m alt but real; check hand shake at
   low AGL). Implement rebasing: keep a root `<group ref={worldRoot}>` around
   `<primitive>` + PlayerPlane + (later) traffic; when
   `flight.pos.length() > WORLD.rebaseDistance` from the current anchor,
   subtract the offset from `worldRoot.position`… **CAUTION:** three-tile's
   `geo2world/getLocalInfoFromWorld` assume the TileMap's own world matrix —
   the simplest correct scheme is: leave TileMap at its natural transform,
   instead offset THE WHOLE SCENE: put everything (including the TileMap) in
   `worldRoot`, set `worldRoot.position = -anchorWorld` each rebase, call
   `worldRoot.updateMatrixWorld(true)`, and keep `flight.pos`/camera in
   ABSOLUTE map coordinates while rendering happens in rebased coordinates…
   That inverts the usual pattern; alternatively keep flight.pos absolute and
   set `camera/plane` positions relative each frame (`renderPos = absPos -
   anchor`). Choose one, verify with the harness: boost 50km one heading —
   no vertex jitter, no camera pops (no frame >25ms at rebase), tiles keep
   streaming (three-tile raycasts must still hit: pass ABSOLUTE positions to
   `getLocalInfoFromWorld`, rebased ones to the GPU). Write this carefully;
   it is the trickiest remaining engineering.
5. **Quality ladder:** PerformanceMonitor already steps DPR; extend
   `onDecline` to also lower bloom `resolutionScale` and cloud count via
   fly-store `qualityTier`.

Exit: 50km boost run with no jitter/seams/pops; clouds/HDRI at altitude;
throttled CPU visibly steps quality down and back.

### Phase 4 — Live traffic (est. 5–7 days) — THE core feature

Data plumbing facts (verified in this codebase):
- Poll endpoint: client `fetchAircraftByLocation(lat, lon, distNm)` in
  `lib/api.js` → Next proxy `app/api/aircraft/route.js` →
  `https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{dist}` → returns
  `{ac: [...], now, ...}`. **`now` = server epoch SECONDS (float).**
- Aircraft fields: `hex, flight, r, t, lat, lon, alt_baro (num|'ground'),
  alt_geom, gs (kt), track (deg), baro_rate (ft/min), category, squawk,
  emergency, dbFlags, seen, seen_pos (sec since last position fix)`.
- Worker `lib/workers/aircraft-processor.worker.js` (comlink) already
  classifies and stamps `_iconType` ∈ {airliner, jet, prop, helicopter,
  military, cargo, glider, drone, unknown}, `_color`. Fly mode instantiates
  its OWN worker from this file (pattern: `hooks/use-aircraft-worker.js`).
- **Do NOT reuse `useAircraftByLocation`** (couples to map-store zoom +
  dev-store, wrong key rounding). Build `hooks/use-fly-traffic.js`: React
  Query, `refetchInterval: TRAFFIC.pollIntervalMs` (2000), query key =
  player lat/lon rounded to `TRAFFIC.queryKeyRoundDeg` (0.05°) + dist
  `TRAFFIC.pollDistNm` (200), fetch with FULL precision `runtime.geo`.
- **Server proxy caches 3s while we poll at 2s** → consecutive identical
  payloads. Ingest MUST dedup per (hex, tFix) and not reset blend state.
- `{ac: [], error: 'timeout'}` payloads = "no new data" (keep dead
  reckoning), NEVER "all aircraft left".
- Seed each fix time `tFix = now - seen_pos` (both seconds). Dev assertion:
  warn if computed fix age <0 or >300s.

Build:
1. **Worker extension** (add methods, don't break existing):
   `setFlyAnchor(originLon, originLat, epoch)` and
   `processForFly(rawAc, serverNow)` → for each aircraft with lat/lon:
   classify (existing fns) → archetype index; project to the SAME
   Web-Mercator world frame the terrain uses (replicate three-tile's
   mercator formula — verify against `engine.geoToWorld` output for one
   point at runtime in dev); compute velocity in TRUE m/s:
   `vN = gs*0.514444*cos(track°)`, `vE = gs*0.514444*sin(track°)`,
   `vUp = baro_rate*0.00508`; altitude = `alt_geom ?? alt_baro`, `'ground'`
   → 0 (traffic-engine substitutes terrain elevation). Pack ONE transferable
   `Float32Array` (stride: worldX, worldY(alt m), worldZ, vE, vUp, vN, tFix,
   archetypeIdx, flags) + a small metadata array `{hex, flight, r, t,
   squawk}` for new/changed hexes only. Return with `Comlink.transfer`.
2. **`lib/fly/traffic-engine.js`** (pure class):
   - `ingest(batch, meta)` — merge into per-hex track records (Map), keep
     last 2 fixes, dedup identical tFix.
   - `update(nowSec, playerPos, playerFwd)` per frame: dead-reckon
     `renderPos = fix + v*age` (horizontal components × `mercatorScale(lat)`
     — velocities are true m/s, world is mercator); if Δtrack between the 2
     fixes > `TRAFFIC.arcTrackThresholdDeg`, extrapolate along the arc
     (turnRate = Δtrack/Δt); on a NEW fix, if error < `blendMaxErrorM` blend
     over `blendDurationSec` (projective velocity blending: render from old
     projection lerped to new projection), else snap with an opacity dip;
     altitude corrections blend over `altBlendDurationSec`. Stale ladder by
     `nowSec - tFix`: >15s zero vUp + dim, >30s freeze + fade to 30%,
     >60s remove (1s fade). Write instance matrices (position + yaw from
     track, slerped; fake bank from est. turn rate clamp ±30°; scale =
     `WORLD.trafficDisplayScale` × per-archetype base size). Maintain
     `getNearest(n, playerPos)` for labels/targeting.
3. **`components/fly/TrafficLayer.jsx`** — one `THREE.InstancedMesh` per
   archetype (**raw, NOT drei `<Instances>`** — documented per-frame update
   overhead), `DynamicDrawUsage`, `frustumCulled=false`, `instanceColor` for
   tint; plus one shared billboard/sprite InstancedMesh for beyond
   `TRAFFIC.modelLodDistanceM` (25km). Phase 4 first milestone can ship ALL
   archetypes as simple primitive meshes (like PlayerPlane) and swap GLBs in
   the asset pass below. useFrame priority -45 (after flight -50, before
   camera -40).
4. **Assets** (verified free; download → normalize in Blender: nose -Z,
   +Y up, origin CG, real meters → `gltf-transform resize 512 / prune /
   dedup` → `public/models/*.glb`; budgets: traffic ≤1.5k tris & ≤1MB each,
   player ≤15k tris ≤4MB, total <15MB; NO Draco):
   | Role | Model | License |
   |---|---|---|
   | airliner (narrowbody) | "Low Poly Airliner" sketchfab.com/3d-models/low-poly-airliner-f06d488f08764e3ca26f2917d4053c69 | CC-BY 4.0 Mauro3D, 3.5k tris |
   | widebody + cargo tint | "Boeing 747" poly.pizza/m/49CLof4tP2V | CC-BY 3.0 Miha Lunar |
   | jet (biz/regional) | "Private Jet" (Sketchfab, decimate 16.5k→~2k) | CC-BY 4.0 raasaqib4; alt "Low Poly Jet" Tom Coldenhoff 1.2k CC-BY |
   | prop (+glider/drone/unknown) | "Small Airplane" poly.pizza/m/7cvx6ex-xfL | CC-BY 3.0 Vojtěch Balák |
   | helicopter | "Helicopter" poly.pizza/m/hG2Qr0A3zR | CC-BY 3.0 Zsky (keep rotor node, spin it) |
   | military | "Lowpoly Military Jet" (Sketchfab, decimate 14.4k→~2.5k) | CC-BY kolani3d |
   | PLAYER | "Cartoon-Stylized Airplane 4K PBR" (Sketchfab) | CC-BY 4.0 MHKstudio; alt "Spitfire cartoon!" overheat CC-BY |
   Create `lib/fly/assets.js`: manifest (file, license, author, url,
   modifications) + `_iconType`→archetype mapping + per-model correction
   transforms + display scales. Credits UI reads THIS manifest.
   Sketchfab downloads need a free account login — if that blocks automation,
   ship primitive-mesh archetypes and hand the user a download checklist.
5. **`components/fly/hud/LabelCanvas.jsx`** — ONE absolutely-positioned
   `<canvas>` overlay redrawn per frame (never per-label DOM):
   `TRAFFIC.maxLabels` (15) nearest, project via camera, cull z>1,
   screen-grid declutter, dim when terrain-occluded
   (`engine.getGroundInfoAtWorld` ray toward target or elevation compare).
   Callsign + FL + distance.
6. **`components/fly/hud/Minimap.jsx`** — small north-up canvas, 5Hz, player
   wedge + traffic dots.
7. fly-store: `setTrafficStats(count, lastPollAt)` on each poll (exists).

Exit criteria: over NYC dozens of aircraft move CONTINUOUSLY between 2s
polls (no per-poll jumping — the thing the 2D map can't do); side-by-side
one callsign vs adsb.lol (pos ~1km, alt 500ft, hdg 5°); DevTools offline
45s → coast/dim/freeze/fade ladder; 60fps with 150+ aircraft; draw calls
<300 (log `gl.info.render.calls` in dev).

### Phase 5 — Targeting, intercept, formation, info card (est. 4–6 days)

All numbers already in `TARGETING` constants.
1. **`lib/fly/targeting.js`** — soft-lock state machine: acquire when a
   traffic target is <10km AND <10° off the nose (score
   `angErr*(1+dist/10km)`, best wins; hysteresis: release at 15°/12km, min
   hold 0.5s). Emits lock state to fly-store ONLY on transitions
   (`setLock(hex, state)`).
2. Reticle: bracket + leading pip + range/closure drawn on LabelCanvas.
3. **Intercept autopilot** (F key on soft-lock): lead-pursuit at boost
   (aim at `targetPos + targetVel * dist/closingSpeed`), exponential decel
   from `interceptDecelStartM` to arrive at targetGS + 15 m/s, hand back at
   `interceptHandoffM` (400m) → offer formation. Implement as a virtual
   command generator that REPLACES user commands in the frame loop
   (priority -55, between input and flight) — hard input (>50% deflection
   0.3s) breaks out.
4. **Formation mode:** hold wing slot (target-local right 80 / up 20 /
   back 60 m), loose position controller λ≈1.8; stick input nudges the
   slot; breakout same as intercept; auto-release if target stale >30s
   (toast).
5. **`components/fly/hud/InfoCard.jsx`** — auto-shows <2km of locked
   target, hides >3km, 30s re-trigger suppression after dismiss. REUSE the
   existing data hooks: `useRoute(hex, callsign)` (`hooks/use-route.js`),
   `useAircraftPhoto(hex)` (`hooks/use-aircraft.js`),
   `getAirlineFromCallsign` (`lib/airlines.js`), formatters (`lib/format.js`).
   Content: callsign/reg/type/alt/GS/squawk/route origin→dest/photo.
6. **Passport:** `usePassportStore.getState().logSpot(aircraft)` on first
   lock-acquire per hex (`stores/passport-store.js` dedups).

Exit: no lock flicker skimming the cone edge; card in/out at 2/3km with
photo+route; F from 40km ends in stable 400m handoff + formation through the
target's real turns; spot appears in passport once.

### Phase 6 — Polish & ship (est. 3–5 days)

1. Pause menu (Esc = pause instead of exit; exit moves into the menu),
   controls help on first entry (`controlsHelpSeen` in fly-store),
   quality tier setting, credits panel.
2. **CREDITS.md + CreditsPanel** rendered from `lib/fly/assets.js` manifest
   (CC-BY hard requirement) + HDRI/cloud/Kenney courtesy credits + Esri
   attribution note.
3. Context-loss recovery in FlyErrorBoundary (retry restores).
4. Mobile: "desktop recommended" toast; touch = virtual stick later
   (non-blocking).
5. Perf audit on an iGPU laptop: 15-min session ≥55fps p5, GPU <12ms
   median, draw calls <300, tris <1.5M, textures <300MB (`renderer.info`),
   heap stable, attribution visible in all states, `npm run build` clean.

---

## 6. Verification harness

`scripts/verify-fly.js` — Playwright flight-test protocol used to verify
phases 0–2 (enter fly → HUD readouts → 2s turn measurement → 8s dive
(floor/slide check) → boost accel → 4x-CPU-throttle turn comparison →
Esc exit). Adapt it per phase (tile counting via `page.on('response')`
filtering `arcgisonline.com`, stale-ladder via CDP network offline, etc.).

Run it:
```powershell
# one-time, anywhere outside the repo (or npm i -D playwright):
#   npm i playwright        (uses installed Chrome via channel:'chrome')
npm run dev                  # serve on :3000 first
node scripts/verify-fly.js
```
Screenshots land next to the script. ALWAYS look at the screenshots — a
blank canvas "passes" selectors but is a failure.

HUD scraping contract: the five `.font-mono` spans are, in order,
SPD / ALT / AGL / HDG / THROTTLE.

---

## 7. Suggested first moves for the next session

1. Read `lib/fly/fly-constants.js`, `lib/fly/coords.js`,
   `components/fly/FlyScene.jsx` — the coordinate model and frame loop are
   the foundation everything else hangs on.
2. Run the app, fly for two minutes, feel it (user may have retuned
   constants — respect their values).
3. Start Phase 3 with the floating origin (hardest), verify with a 50km
   boost run in the harness, THEN do sky/clouds (fast, gratifying).
4. Phase 4: build the worker projection + traffic engine against primitive
   meshes first; swap GLB assets only once motion is verified against
   adsb.lol.
```

---

## 8. COMPLETION REPORT — phases 3–6 (2026-07-15, second session)

All four remaining phases were implemented and browser-verified in one
session. `npm run build` (Turbopack) is clean. What follows is the delta
against the specs above: what exists, what the harnesses proved, where this
document's assumptions were WRONG, and what genuinely remains.

### 8.1 Phase 3 — sky/clouds/floating origin ✅ (verified)

- **Floating origin** (the chosen scheme): TileMap + PlayerPlane live inside
  a `worldRoot` group positioned at `-anchor`; anchor = player X/Z snapped
  every `WORLD.rebaseDistance` (Y is NEVER rebased — world Y stays true
  altitude, so the flight model's floor/ceiling logic is untouched).
  `flight.pos`, ChaseCamera math and every consumer stay in ABSOLUTE
  Web-Mercator units; `TerrainEngine.setAnchor()` hides the conversion for
  geo↔world/raycast calls (map.matrixWorld includes the worldRoot shift, so
  three-tile sees rebased coords internally). The camera is NOT in worldRoot:
  the frame loop shifts it to absolute around `chase.update(...)` and back.
  `fly-store.rebaseEpoch` bumps per rebase so world-frame-history components
  (Contrail's meshline) remount. Traffic instance matrices are written
  REBASED (float32 GPU attribute) — `TrafficLayer` must stay OUTSIDE
  worldRoot.
  **Verified** (`scripts/verify-fly3.js`): 75s boost ≈55km, 7 rebases,
  max rebase cost 0.4ms (budget 25), 0 of 17,869 frames >25ms, tiles still
  streaming at run end (389 responses in final 15s), DEM/AGL sane throughout.
- **Sky:** `public/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr`
  (CC0 Poly Haven) via drei `<Environment background>` in its own Suspense;
  `<color>` background retained as pre-load fallback. DirectionalLight
  matches the baked sun: `SKY.sunDirection = [0.555, 0.742, 0.377]`
  computed by `scripts/hdr-sun.mjs` (brightest-texel scan; elevation came
  out 47.9° — matches the asset's "48d" name). fog color `#c6d7e8`.
- **Clouds:** `components/fly/CloudField.jsx` — drei `<Clouds>` with
  SELF-HOSTED texture `public/textures/cloud.png` (CC0 WickedInsignia/OGA,
  downscaled 512px, **RGB flattened to white** — the raw PNG's grey RGB
  rendered as smoke blobs). Material is **MeshBasicMaterial (unlit)** —
  always bright, zero lighting cost. Toroidal wrap cell (36km) around the
  player computed in ABSOLUTE frame per frame → rebase-immune; puff count
  by quality tier; `g.updateMatrixWorld(true)` after moving each puff or
  rebase frames show a one-frame 10km pop (drei reads matrixWorld).
- **Contrail:** `components/fly/Contrail.jsx`, drei Trail off an emitter
  object; visible above `CONTRAIL.minAltM` (6km); NOTE drei Trail portals
  its mesh to scene root — visibility/material flags go through the
  forwarded mesh ref, not JSX wrappers.
- **Quality ladder:** PerformanceMonitor now also steps
  `fly-store.qualityTier` (high/medium/low) alongside DPR; Effects maps
  tier → bloom resolutionScale 0.5/0.3/off; CloudField maps tier → puff
  count 40/22/8.

### 8.2 Phase 4 — live traffic ✅ (verified with real data)

Files: worker extension in `lib/workers/aircraft-processor.worker.js`
(`setFlyAnchor`, `processForFly`), `lib/fly/traffic-engine.js`
(TrafficEngine + `mercatorWorldXZ`), `hooks/use-fly-traffic.js`,
`components/fly/TrafficLayer.jsx`, `lib/fly/traffic-geometries.js`
(9 primitive archetypes ≤1k tris, one merged BufferGeometry each),
`components/fly/hud/LabelCanvas.jsx`, `components/fly/hud/Minimap.jsx`.

**⚠️ CORRECTIONS to §5.4's data facts — learned from live payloads:**

1. **`now` is epoch MILLISECONDS**, not seconds (seen/seen_pos ARE
   seconds). The worker normalizes (`>1e11 → /1000`) defensively.
2. **Never pack epoch seconds through Float32Array** — ulp at 1.7e9 is
   ±128s. The packed row carries `fixAge = seen_pos` (small) and the
   engine reconstructs `tFix = serverNow − fixAge` in float64.
3. **Clock skew must be estimated NTP-style (minimum over observations,
   +25ms/poll upward creep), NOT an average.** Every observed
   `clientSec − serverNow` includes that response's transport delay; with
   the EMA, slow responses inflated the skew, the engine's server-now
   lagged reality, fresh fixes looked like the future, `age` clamped to 0
   and dead reckoning silently FROZE (planes 9.6km behind truth). The
   min-skew fix took measured continuity from 0u to 1116u/6s (expected
   ≈1125u) and accuracy to Δ229–331m / Δalt ≤17m / Δhdg 0°.
4. **`pollDistNm` is 100, not 200.** 200nm around NYC (~1000 aircraft) is
   heavy enough to trip adsb.lol's rate limiting/timeouts (observed:
   requests degrading to 20s+, proxy 504s at its 10s timeout, client
   aborts at 12s). 100nm ≈ 185km is still 7× the 25km model-LOD radius.
   **adsb.lol health oscillates** — the stale ladder + DR is the designed
   coping mechanism; `{ac:[], error}` and repeated-`now` payloads are
   skipped before the worker round-trip.

Worker → engine contract: one transferable Float32Array, stride 9
`[x, y(altM), z, vE, vUp, vN, fixAge, archetypeIdx, flags]`, positions
relative to the spawn-fixed worker origin (float32-precise), velocities
TRUE m/s; `meta` array only for new/changed hexes. Engine: per-hex tracks,
dedup per (hex, tFix), projective velocity blending ≤400m / snap+opacity
dip beyond, arc extrapolation when Δtrack > threshold, stale ladder
15/30/60s (dim / freeze / shrink-out), grounded aircraft pinned to sampled
terrain elevation, `getNearest()` for labels/targeting.

**Verified** (`scripts/verify-fly4.js`, live NYC data): 213 tracks
ingested; continuity 120 samples @20Hz — zero teleports, smooth ~10u
steps; accuracy vs the API's own extrapolated fix Δ229m/Δ13ft-class/Δ0°;
offline (CDP) 40s — 0 dim violations at t+17s, 0 freeze violations at
t+35s, DR still moving planes (303u/2s) while offline; polls resume after
reconnect (recovery confirmed end-to-end in a separate run where the API
came back mid-test: 213→362 tracks). Draw calls 216–228 (budget 300) with
~220 live aircraft + labels + minimap; frames p95 4.3ms headless.
NOTE for dev telemetry: EffectComposer resets `gl.info` per pass — the
scene sets `gl.info.autoReset=false` + manual reset (dev only) so
`window.__flyStats.drawCalls` is whole-frame.

### 8.3 Phase 5 — targeting / intercept / formation / info card ✅ (verified)

Files: `lib/fly/targeting.js` (soft-lock state machine),
`lib/fly/autopilot.js` (intercept + formation command generator),
reticle in LabelCanvas, `components/fly/hud/InfoCard.jsx`, passport
logging on first lock-acquire, `FlightModel` gained `cmd.speedOverride`
(m/s, autopilot only), `InputController` gained `consumePress(key)` and
`neutralize()`.

Two design corrections vs §5.5 worth knowing:

1. **The release cone must be suspended while the autopilot holds the
   target** (`targeting.update(..., holding)`) — the formation slot is
   ~53° off the nose BY DESIGN; without the flag the lock self-released
   the moment intercept handed off.
2. **A fixed `interceptDecelStartM` cannot work with FLIGHT.accel=40** —
   shedding boost (750→95 m/s) needs ~7km, not 1km. Both intercept and
   formation now use braking-curve speed laws:
   `v(d) = min(boost, √(arrive² + 2·a·0.85·(d − handoff)))` for intercept,
   and formation's speed = `targetGS + 0.8·√(2·a·slotError)` (direction
   still from `slotError·λ + targetVel`). Before the fix the plane
   overshot at 700m/s and orbited away (862→4034m); after it converges
   233→72m around the ~102m ideal slot and holds.

**Verified** (`scripts/verify-fly5.js` — synthetic target injected into
the live engine so it works regardless of API health; synthetic batches
MUST be stamped in the engine's estimated server timebase via
`traffic.serverNow()`): auto soft-lock among 216 real tracks; F →
intercept with braking-curve arrival; formation handoff at 400m (~13.5s
from 2km); slot hold stable; info card appears <2km with live readouts
(and photo/route for real hexes via the existing `useRoute` /
`useAircraftPhoto` hooks); passport spot logged (`shadowadsb-passport`);
hard-stick breakout works; zero page errors.

### 8.4 Phase 6 — polish ✅ (mostly done, see remaining)

- Esc now PAUSES (menu with Resume / quality tier / credits / exit);
  world + live traffic keep running behind the dim, input is neutralized
  (`InputController.neutralize()` also re-arms mouse-steer so resume
  can't inherit a stale cursor offset). Exit = menu or the X button.
- First-entry controls card (localStorage `fly-controls-seen`).
- **Credits:** `lib/fly/assets.js` is THE manifest; CreditsPanel (in
  `components/fly/PauseMenu.jsx`) renders from it +
  `TERRAIN_ATTRIBUTIONS`; `CREDITS.md` regenerates via
  `node scripts/gen-credits.mjs`. Both current assets are CC0 (no CC-BY
  obligations yet — that starts with the GLB pass).
- Mobile: "desktop recommended" toast on coarse-pointer/narrow screens.
- AttributionBar confirmed visible in every state incl. pause/credits.
- Perf snapshot (headless GPU): draw calls 216–228, tris ~27k with ~220
  aircraft, frames p95 4.3ms, zero >25ms frames in the 75s boost run.

### 8.5 Genuinely remaining (in priority order)

1. **GLB asset pass** (§5.4.4 table still accurate): Sketchfab items need
   an account login, so automation ships primitives; download checklist
   for the user, then normalize (Blender: nose -Z/+Y up/CG origin/meters →
   gltf-transform resize 512/prune/dedup) → `public/models/*.glb`, add to
   `lib/fly/assets.js` (license/author/url/modifications — CC-BY entries
   make the credits UI a hard requirement), map archetype→model in
   TrafficLayer, swap PlayerPlane. Budgets in §5.4.4.
2. **15-min soak on a real iGPU laptop** (§5.6.5 targets) — headless
   numbers are green but texture-memory and heap-stability need real
   hardware; `window.__flyStats` (dev) has drawCalls/triangles/traffic.
3. Cosmetics from §4: terrain LOD seam "cliffs" at low AGL (tune
   `LODThreshold`/accept), ~20s imagery refinement at spawn (intro haze
   idea), lock-flicker polish at the exact cone edge if observed.
4. Touch controls (virtual stick) — explicitly non-blocking.

### 8.5.1 — 2026-07-16 session: game-feel pass + GLB assets ✅

The "make it feel like a video game" pass (user-driven) plus the §8.5.1 GLB
asset pass, all browser-verified (`scripts/verify-fly-game.js`,
`verify-fly-models.js`, `verify-fly-style.js`):

- **Waypoint POIs** (`lib/fly/poi-data.js`, `components/fly/hud/
  WaypointCanvas.jsx`, `WAYPOINTS` constants): every airport from
  `lib/airports.js` + ~80 cities + ~30 landmarks as capsule-chip markers
  (icon + name + distance, stem to the anchor, 3-row stagger declutter,
  nearest chip pulses). `runtime.nearestPoi` feeds the FlyHUD "◆ MANHATTAN
  · 1.2NM NE" line. Offline data only — no geocoding API.
- **Click-to-inspect + WARP** (`hud/InspectModal.jsx`, `hud/WarpFlash.jsx`):
  LabelCanvas hover-picks projected traffic (56px radius, label rects
  clickable, hover hysteresis; `T` inspects the soft-lock with zero aiming).
  Modal (game-styled, reuses useRoute/useAircraftPhoto) offers WARP /
  INTERCEPT. `runtime.warpTo(hex)` teleports 650m behind the target
  (rebase + ChaseCamera.snap() + WarpFlash masking tile stream-in);
  `runtime.interceptHex(hex)` force-locks + engages the autopilot from ANY
  range — targeting now suspends range AND cone release while `holding`.
  While the modal is open the stick is neutralized (world keeps running).
- **Procedural audio** (`lib/fly/audio-engine.js`, `hooks/use-fly-audio.js`,
  `AUDIO` constants): synthesized wind + engine bed chasing speed, lock
  blip, warp sweep, UI click. Zero asset files. Pause-menu Sound toggle.
- **GLB fleet — poly.pizza direct downloads, NO Sketchfab/login** (user
  request): 7 CC-BY models in `public/models/` (airliner/jet/military/
  cargo-747/prop/helicopter + player jet), manifest + archetype map in
  `lib/fly/assets.js` (drone/unknown stay primitives). Loader
  (`lib/fly/model-loader.js`) merges to ONE vertex-colored geometry per
  archetype for the InstancedMeshes (instance tint white; stale-dim still
  works) and normalizes nose -Z / CG origin / real meters. Orientation
  heuristic = tail-fin Y-asymmetry (longest-axis fails on wide wingspans);
  manifest `yawFixRad` (absolute) / `extraYawRad` (additive) override it —
  the player jet needs `extraYawRad: π` (was flying backwards).
  Direct-download trick: GLB uuid is in the model page HTML →
  `https://static.poly.pizza/<uuid>.glb`. CREDITS.md regenerated.
- **Night Ops map style** (pause menu, persisted `fly-map-style`): CARTO
  dark_all raster via generic three-tile `TileSource` (tokenless;
  attribution swaps to OSM/CARTO — `ATTRIBUTIONS_BY_STYLE`), hot-swapped
  at runtime via `TerrainEngine.setImagery()` (DEM/quadtree untouched).
  `NIGHT` constants: dark bg/fog, cool near-full lighting — the tiles
  carry the darkness; dimming lights buries the street grid.
- **Contrail fix:** drei Trail's buffer starts zero-filled and rebased
  (0,0,0) is ground level under the plane → every rebase/warp smeared a
  vertical ribbon to the deck. Now frame-count-gated
  (`WARMUP_FRAMES = length·10 + 20`) — wall-clock gates fail at low fps.
- Known open polish: helicopter/military/cargo orientations not yet
  eyeballed in-scene (rare in NYC airspace during verification; fix is a
  one-line `extraYawRad` if one flies backwards); textured GLBs bake to
  their material color factor (bizjet loses its pinstripes — acceptable);
  user wants a further art-direction review pass (POI styling, arcade
  feel) — solicit feedback in-session.

### 8.6 Harnesses & environment notes (additions)

- `scripts/verify-fly3.js` (origin/sky), `verify-fly4.js` (live traffic;
  includes per-step age histograms + poll-status forensics),
  `verify-fly5.js` (synthetic-target gameplay chain incl. pause/credits),
  `p3-quick.js` (fast visual spot-check). Playwright lives OUTSIDE the
  repo at `C:\Users\bfecho\node_modules` (drives installed Chrome).
- The dev-only globals: `window.__fly` (runtime: engine/flight/traffic/
  targeting/autopilot/origin/camera/geo) and `window.__flyStats`
  (rebases, maxRebaseMs, drawCalls, triangles, traffic).
- `scripts/hdr-sun.mjs <file.hdr>` prints an HDRI's sun direction for
  `SKY.sunDirection` if the sky asset ever changes.
