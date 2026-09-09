# FLY ROUND 22 — "TERRAIN & IMMERSION" (PLAN)

Orchestrator: Fable (this session — reviews, merges, never delegates review). Executors: **five Opus 5 agents** — **A TERRA / B SETTLE / C CLUTTER / D DEPTH / E CERT** — in worktrees `r22-a..e` off branch `claude/round22-terrain-immersion`. R21-shaped waves: W0 scaffold (Fable) → W1 parallel behind flags → W2 reviewed merges → W3 certification. **FLY_ROUND22_HANDOFF.md ("Cinematic Night") is deferred intact to R23.**

## Context

The user reported three symptoms in live satellite flight (two screenshots):

1. **The world still feels flat / not immersive at low altitude** (Lewis Center OH, ~550 ft AGL) despite the R20 buildings and R21 stability work.
2. **Post-warp terrain stays blurry** — an Atlas warp to Dublin OH at FL300 revealed low-zoom ground that never properly sharpened.
3. **Things "glitch a little" a few seconds after boot/warp** — clarified interactively to **late pop-in** (content appearing after the world is visible) and **brief stutter/hitch**, not tone shifts.

Three read-only exploration sweeps traced each symptom to named code (verified on main @3592656):

- **Warp blur (T-defects):** the satellite reveal gate polls only `engine.downloading < 3` — an instantaneous in-flight count with no content check — and force-reveals at `holdMaxMs 3500` ([WarpFlash.jsx:43-50](components/fly/hud/WarpFlash.jsx#L43-L50)); local warps get a 900 ms flash and no poll at all; `warpToGeo` never notifies the terrain quadtree ([FlyScene.jsx:587-644](components/fly/FlyScene.jsx#L587-L644)); three-tile refines one zoom level per serial round-trip (parent held until all 4 children load; imagery then DEM fetched serially per tile; LOD evaluation stalls at 6 tiles in flight — z2→z14 ≈ 12 serial rounds); **Esri imagery/DEM have zero persistent cache** (the R21 Cache API layer covers only vector pbf) so every warp/return is a cold descent; `SAT_QUILT` desaturates/flattens the ground at full strength at exactly the FL300 arrival pose; and `verify-warp-arrival.js:114` asserts only elapsed time — it cannot catch a blurry reveal.
- **Flat world (D-defects):** the satellite shadow rig is ON (2048² map, high tier) but terrain tiles are excluded from the receive set, so building/tree shadows **land on nothing**; the ground-catcher disc fix is fully built but ships `SAT_SHADOWS.catcher.enabled:false` (+1 draw — kept off in R19 only because Owens sat at exactly 261/261 draws; the R21 soak shows 179–195 there now); **zero ambient occlusion** (n8ao@1.10.3 installed as a transitive dep, never imported); trees are 42-tri untextured Lambert spheres with no trunks ([SatVegLayer.jsx:202-216](components/fly/SatVegLayer.jsx#L202-L216)); **ground clutter is absent entirely** (no cars/poles/fences); nothing atmospheric touches the first 800 m (`AERIAL_PERSPECTIVE.startM 800`; content haze built-but-off); z17 imagery only appears below ~930 m AGL; the DEM stops refining at z15 (`demMaxZoom 15`) while imagery sharpens to z17, and the terrain library's hardcoded mesh-decimation table tolerates 38–91 m vertical error at z13–z14.
- **Pop-in + stutter (S-defects):** the shader prewarm can't start until the HDRI resolves (up to 4 s) and the boot reveal proceeds at `PREWARM.maxMs 3000` whether or not the warm finished — each `compileAsync` compiles synchronously, so the compile train lands **after** reveal = the stutter ([BootScreen.jsx:145-146](components/fly/hud/BootScreen.jsx#L145-L146), [prewarm.js:584-586](lib/fly/prewarm.js#L584-L586)); every streaming layer (buildings/roads/skyline/veg/tint/parcel/traffic) appears as a **hard pop** with no birth fade; parcel homes hold ~5–8 s by design then pop ~2,000 instances with a discrete 0.55→1.0 scale step; boot/warp readiness never consults the four vector rings, so the city assembles in front of the player for ~5–8 s post-reveal; the governor ladder degenerates to **zero DPR rungs at devicePixelRatio 1** ([perf-governor.js:78-88](lib/fly/perf-governor.js#L78-L88)) so its first step is a structural tier step; raw refining-DEM `groundElev` (seeded 0 at spawn/warp) sweeps every AGL-keyed fade band undamped; troika letters / drei clouds / PrecipLayer compile cold outside the warm set.

## User decisions (locked via interactive Q&A, 2026-08-07)

| Question | Decision |
|---|---|
| Round scope | **Terrain & Immersion**; Cinematic Night stays the R23 seed |
| Perf budget | **Spend the headroom** — pre-sanctioned measured moves; soak p95 gates stay BLOCKING |
| Immersion priorities | **Sharper ground up close** + **3D ground clutter & life** (headliners) |
| Shadows+AO | **Yes, full measured workstream** (flags, A/B at fixed poses, user checkpoint before ON) |
| Cars | **Parked + moving** |
| Warp tradeoff | **Hold reveal until sharp** (content-aware gate) |
| Glitch diagnosis | **Late pop-in + brief stutter** — settle polish is first-class |
| Execution | **Five Opus 5 implementation agents** under Fable orchestration |

## Phase 0 — land the R21 close (before anything else)

> **STATUS: DONE 2026-08-07.** Close commit `3a744aa` (r21/e), merged to main
> at `09868c5`, pushed. The close-sweep ledger §6 records the honest partial
> verdict (4 harnesses + both soaks green on the final tree; the interrupted
> full-fleet matrix stays unfilled); the Phase-0 smoke below is its named
> completion mechanism and its results are recorded in FLY_ROUND22.md.

The R21 close is **uncommitted** in `.claude/worktrees/r21-e` (branch `r21/e`): FLY_ROUND21.md fully filled, `scripts/r21-close-sweep.md`, regenerated fleet PNGs, and a **green satellite soak** (worst p95 6.6 ms, p95 tris 845k ≤ 2.2M, max draws 257 ≤ 375, 0 governor steps, heap declining, 0 pageerrors). Steps (Fable): review the diff → commit in r21-e as the R21 close commit → merge `r21/e` → main → push → smoke on main (verify-boot, verify-stability, verify-flicker, verify-fleet, verify-sat-depth + node gates) → branch `claude/round22-terrain-immersion`.

## §1 Scaffolding (W0, Fable)

- **Vendor three-tile v0.12.1** (MIT): `lib/fly/vendor/three-tile/index.js` + `plugin.js` (verbatim dist copies; the plugin's two bare `from "three-tile"` imports rewritten to the vendored core — mandatory, its loaders register into the `LoaderFactory` singleton of whichever copy it imports) + upstream LICENSE + `VENDOR.md` (version pin + running diff ledger). Switch the only two import sites: [terrain-engine.js:2](lib/fly/terrain-engine.js#L2), [tile-sources.js:1-2](lib/fly/tile-sources.js#L1-L2). W0 = verbatim copy, behavior byte-identical, proven by smoke (verify-sat-depth + verify-boot). **Decision: vendor, not monkey-patch** — the martini error table is a module-private closure (`const le = Ee(21)`, dist/index.js:441) no export reaches; the R21 vendored-composer precedent applies. npm dep stays pinned as the diff base.
- **`WORKER_PROTOCOL 17→18`** at all six pin sites lockstep — needed because C emits new worker outputs (road centerline paths, parking/driveway anchors, junctions). Payloads unchanged at bump time; flag-off worker byte-identical except the `v:18` stamp.
- **Seven constants blocks** at the fly-constants.js tail, all `enabled:false`, disjoint per owner: `TERRA_SHARP` / `TERRA_PIPE` / `TERRA_CACHE` (A), `ARRIVAL_GATE` / `SETTLE_CALM` (B), `CLUTTER` (C), `DEPTH_PASS` (D). Cross-owner contracts as doc comments: the `runtime.terraStats` contract (`{camTileZ, targetZ, downloading, sharp}`; consumers treat `undefined` as legacy) and the clutter worker-output contract. `PREWARM` block ownership transfers to B.
- **FlyScene.jsx pre-seeds** (kills merge conflicts): (i) `<SatClutterLayer/>` mount behind `CLUTTER.enabled` + null-returning stub file; (ii) `engine.notifyWarp?.(geo.x, geo.y)` optional-call in `warpToGeo` (no-op until A implements); (iii) `runtime.groundElevVis` alias published in the −50 block (B damps + re-points visual consumers).
- **`scripts/_boot.js` fleet pins**: `__flyTerraPin=1`, `__flySettlePin=1`, `__flyClutterPin=1`, `__flyDepthPin=1` (legacy behavior fleet-wide; only E's new gates un-pin). Existing pins unchanged.

## §2 Ownership matrix

| Agent | Owns (exclusive unless noted) |
|---|---|
| **A TERRA** | `lib/fly/vendor/three-tile/**` patches, `terrain-engine.js`, `tile-sources.js`, NEW `lib/fly/raster-cache.js`; blocks `TERRA_*`; sanctioned `TILES`/`SAT_QUILT` value edits; debris cleanup |
| **B SETTLE** | `WarpFlash.jsx`, `BootScreen.jsx`, `PrewarmRig.jsx`, `prewarm.js`, `perf-governor.js`, `use-fly-weather.js`, `SatParcelHomes.jsx`, the five Sat*Layer files, `world-bend.js` (birth terms + key bumps only), TrafficLayer GLB-swap guard; FlyScene region: groundElev/HDRI lines; blocks `ARRIVAL_GATE`/`SETTLE_CALM` + `PREWARM` |
| **C CLUTTER** | `vector-tile.worker.js` (entire file), `SatVegLayer.jsx` (trees2 + birth ramp per B's contract), NEW `SatClutterLayer.jsx` + NEW `sat-clutter-engine.js`; block `CLUTTER` |
| **D DEPTH** | `Effects.jsx` (N8AO in `buildPassList` — single source, so B's warm auto-covers it), `AerialPerspective.jsx`; FlyScene regions: receive-set lines, SatShadowCatcher gating, light rig; block `DEPTH_PASS` + two sanctioned one-line flips (`AERIAL_PERSPECTIVE.content.enabled/minTier`, `SAT_SHADOWS.catcher.enabled`) |
| **E CERT** | NEW `verify-terra.js` / `verify-arrival.js` / `verify-settle.js` / `verify-clutter.js` / `verify-depth2.js`; sanctioned edits to `verify-warp-arrival.js`, `verify-aerial.js`, `soak-fly.js`, `_boot.js` un-pins; `r22-close-sweep.md`; `FLY_ROUND22.md` skeleton |

fly-constants.js is conflict-free by pre-seeded blocks; FlyScene.jsx regions are named and disjoint (Fable arbitrates overlap at merge).

## §3 Waves + merge order

- **W1 (five parallel):** A–D implement behind flags; E authors the five harnesses and **calibrates each RED on the pre-R22 tree** (blurry reveal, pop-in timestamps, throttled-HDRI stutter, ladder shape, shadows-land-on-nothing).
- **W2 (Fable merges A → B → C → D):** A first (the vendor substrate everyone rebases onto; flag-off identity must hold before anything stacks); B second (consumes A's terraStats/notifyWarp); C third (worker file exclusive; birth ramps need B's merged contract); **D last — shadows/AO must be measured against the post-C world** (clutter in frame changes caster/fill-rate arithmetic). E smoke-runs verify-stability + verify-terra + verify-arrival after each merge.
- **W3:** E certifies the integrated tree — full fleet, TOY + SATELLITE soaks, A/B PNGs, close-sweep ledger. **`DEPTH_PASS` is certified in BOTH states but ships `enabled:false` pending user checkpoint #3.**
- Worktree protocol per R21: dev ports A 3220 / B 3221 / C 3222 / D 3223 / E 3224; agents never commit — Fable reviews and lands one merge commit per agent.

## §4 Frozen constraints (NOT sanctioned to move)

- Draw ceilings: Owens ≤ 261 / satellite ≤ 375 / toy ≤ 480 — headroom is spent **inside** them (Owens measured 179–195 + ≤ +3 from D; satellite soak max 257 + ≤ +6 from C/D).
- Satellite soak p95 tris ≤ 2.2M BLOCKING; governor steps ≤ 4/soak; heap no-climb; toy soak green.
- R21 stability fleet green throughout (stability 17 / flicker 7 / tier-step 10 / seam 13); the five frozen R18 neon-cover hashes (R22 flags join the all-off control set).
- `verify-monuments-sat` FROZEN; verify-fleet/hangar count arithmetic; `BOOT.maxBootMs` and boot-reveal timing may NOT lengthen (the WARP hold may — §5.1).
- R21 `SURFACE_CALM` parcel **placement** logic untouched — B smooths scale/opacity transitions only.
- World-bend cache-key registry: changed shader variants get new keys AND join the PREWARM warm set in the same change. Flag-off byte-identity per block.
- Medium/low tier pixels byte-identical except the one pre-sanctioned content-haze flip (§5.4). No API keys; licensing per-source.

## §5 Pre-sanctioned moves & budget table

Each consumed move: inline `R22 SANCTIONED: old → new` comment + ledger row + measured control.

| # | Number | From → ceiling | Condition |
|---|---|---|---|
| 1 | `WARP.far.holdMaxMs` (sat far warps, gate on) | 3500 → **6500** | Content gate must exist first; holdMin stays; verify-warp-arrival bound 5600 → **7400** re-baselined WITH the new content assertion, RED-calibrated first |
| 2 | verify-aerial texture-bytes (high tier, z18) | 300 → **450 MB** | Measured at P-LEWIS; altitude-keyed LOD curve is the named fallback |
| 3 | Fixed-pose draw BANDS | ≤ +6 calls | Per-gate deltas measured before sanctioning; ceilings unmoved |
| 4 | `AERIAL_PERSPECTIVE.content` false → true, minTier → medium | one-line flips | The R19 §5b-named right fix for medium/low; verify-sat-mobile re-run MANDATORY |
| 5 | `satMaxZoomByTier.high` 17 → **18**; `demMaxZoom` 15 → **16** (high only) | behind `TERRA_SHARP` | z18: texel A/B + bytes gate. demMaxZoom: only if the probe shows real Esri z16 LERC at test poses; tris A/B ≤ +15% at P-LEWIS |
| 6 | World-bend key moves | budget **≤ 3** | Birth-fade terms on road/tint(/skyline) → `-r22` keys + warm set same-change; instancer births are SCALE ramps (zero keys) |
| 7 | `SAT_QUILT` desatMax/inAglM | knob move | Measured A/B at P-DUBLIN arrival (R19-swept values are load-bearing history) |
| 8 | `CANVAS.dprMin` 1 → **0.75** (governor ladder only) | behind `SETTLE_CALM.ladderFix` | Gate: ≥ 2 render-scale rungs before the first tier step at devicePixelRatio 1 |
| 9 | New pool budgets (C) | parked cars ≤ +1 draw/≤ 48k tris; moving ≤ +1/≤ 12k; poles ≤ +1/≤ 20k; trees2 same 1 draw, pool ≤ 320k tris (42→≤ 96 tris/instance) | Deterministic fixed-pose counts, never soak-differenced |
| 10 | Soak | + informational gpuFrameMs p95 (target ≤ 12 ms; blocking candidate R23) | Blocking gates unchanged |
| 11 | NEW fixed-pose tris gate | P-LEWIS ≤ 2.0M | The R20 idiom: fixed-pose gates are the load-bearing tris ceilings |

## §6 Agent charters

### A TERRA — sharpness, streaming speed, raster cache
Mission: ground as sharp as the pipeline can serve; warp descent seconds not minutes; every Esri byte fetched once per install.
- **Sharpness** (`TERRA_SHARP`): z18 imagery high tier (§5.5); **altitude-keyed live `LODThreshold`** via existing `setLodThreshold` — starting curve `{≤600 m AGL: 1.0, 3000 m: 0.86, ≥9000 m: 0.78}`, tuned against Owens 261 + P-LEWIS gates; vendored `setDemErrorTable()` export replacing the private closure (targets ≈ z13 45 m / z14 18 m / z15 5 m / z16 2 m, each step tris-measured); demMaxZoom 16 probe; HILLSHADE.micro/aniso re-check under z18.
- **Pipeline** (`TERRA_PIPE`, vendored patches, each behind an exported switch, OFF = verbatim upstream): parallel `Promise.all([updateMaterial, updateGeometry])`; the `_update` bail → skip-subdivide-but-keep-recursing; `TILES.maxThreads` 10 → measured burst value. Nearest-first subtile ordering = stretch goal only if descent still misses target.
- **Cache** (`TERRA_CACHE`): **registered custom loaders, NOT a Service Worker, NOT a fetch shim** (imagery rides `ImageLoader`/HTMLImageElement — never touches `window.fetch`; a SW adds Next-dev scope/HMR risk for zero gain; `LoaderFactory.registerMaterialLoader/registerGeometryLoader` is the designed seam). NEW `lib/fly/raster-cache.js`: app-owned dataType loaders doing `fetch()` + Cache API `'fly-raster-v1'` (versioned, capped, try/catch degrade to network — the R21 idiom) + `createImageBitmap` → Texture, DEM arraybuffer → vendored LERC decode. HMR-safe idempotent registration.
- **Warp descent** (`TERRA_PIPE.warp`): implement `engine.notifyWarp(lon,lat)` behind the pre-seeded call — bounded prefetch of the destination tile pyramid (≤ 48 tiles imagery+DEM through the same cache) + an 8 s maxThreads burst. No quadtree surgery.
- **SAT_QUILT arrival tune** (§5.7, checkpoint #6) and **debris**: duplicate `downloading` getter, stale "Terrarium" comment, dead `lruBudgetBytes`/`viewDistanceM`.
- Publishes `runtime.terraStats` at 2 Hz. Non-goals: reveal-gate logic (B), shader/material work (B/D), worker edits (C). Frozen: Owens 261; toy tile path byte-identical.

### B SETTLE — arrival gates, prewarm, birth fades, settle calm (first-class)
Mission: nothing pops, nothing stutters, no reveal over an unfinished world.
- **Prewarm**: pre-reveal warm runs as today (sync is free behind the overlay); any variant not compiled by reveal is **re-queued at ≤ 1 `compileAsync` per idle rAF** (kills the stutter); warm-set extension: troika letters, drei Clouds, PrecipLayer, PlayerPlane hull, WarpBurst, shadow depth-material variants, SMAA lut pre-decode; other style's chains behind `PREWARM.warmAltStyle` (default off).
- **Birth fades** (`SETTLE_CALM`): instanced layers get ~600 ms SCALE-ramp births (zero keys); chunked meshes reuse the Bayer machinery — sat-buildings via SAT_BLDG_FADE birth-keyed, roads/tint(/skyline) via §5.6 key-bumped 0-gated terms.
- **Parcel**: growK step → continuous ease (≥ 600 ms); delete fades before removal. Placement logic untouched.
- **Content-aware reveals** (`ARRIVAL_GATE`): WarpFlash satellite readiness = `terraStats.camTileZ ≥ min(targetZ − 1, sharpZCap)` AND downloads settled AND (inside their AGL bands) building/road ring ready-fractions + parcel trust; holdMax 6500 still caps; local warps get `localHold` (≤ 1500 ms) only when the tileZ deficit > 2; BootScreen's satellite gate gains the same terms; legacy fallback when terraStats undefined.
- **Governor ladder**: sub-native render-scale rungs (dprMin 0.75, §5.8) before any tier step, gate-proven.
- **groundElev**: damp `runtime.groundElevVis` (slew-limited, snap on warpEpoch), re-point VISUAL consumers only — flight model and crash floor keep RAW.
- **Arrival calm**: weather blend + 5 s HDRI re-pick get post-reveal grace + hysteresis. TrafficLayer GLB-swap remount guard.
- Publishes `runtime.popin` (per-layer first-appearance vs reveal) + long-frame counter. Non-goals: terrain/vendor (A), new geometry (C), pass-chain content (D). Frozen: BOOT.maxBootMs; SURFACE_CALM placement; verify-poi timing contracts.

### C CLUTTER — ground life
Mission: trees that read as trees, cars parked and moving, street furniture — pooled, one draw each, hash-stable, **Owens empty by construction**.
- **Trees v2** (`CLUTTER.trees2`): ONE merged trunk+crown BufferGeometry (≤ 96 tris) in the SAME single instanced draw (the old "second draw" objection rejected a second geometry, not merged geometry); conifer via scale/tint; birth scale-ramp per B's contract; `applyBendAnchor` unmodified.
- **Parked cars** (`CLUTTER.cars.parked`): pooled InstancedMesh (~24–36 tris/car, pool ≤ 1500, +1 draw only when instances > 0): anchors from worker-emitted parking polygons + parcel driveways, two-term anti-dup vs the R18 collision-column index (the PARCEL_HOMES reference pattern).
- **Moving cars** (`CLUTTER.cars.moving`): worker emits cls-3..6 centerline paths (protocol 18); movers advance deterministically — `position = f(t·speed + hash(pathId))` so a pinned clock freezes them (`__flyClutterPin`); pool ≤ 300, +1 draw, high tier only; headlight/taillight tint by heading at dusk+ (uniform, no key).
- **Poles/lamps** (`CLUTTER.poles`): client-side from the same paths at the road shader's `streetSpacingM 42` phase so lamps land ON the shader's light pools; +1 draw.
- **Owens discipline**: cars keyed to residential/parking anchors, poles to a cls-5/6 density threshold — count 0 AND +0 draws at Owens by construction, gate-asserted with bit-identical-totals flips (the R20 instrument).
- All clutter ships `castShadow:false` — **D flips casters** under `DEPTH_PASS` with measured gpuFrameMs (the cross-charter seam, owned by D).
- Non-goals: shadows/AO (D), fades beyond B's contract, toy style, Owens content ever. Frozen: worker byte-identity flag-off (v:18 excepted); SAT_VEG +1-draw invariant; existing veg/groundlife counts.

### D DEPTH — shadows, AO, near-field atmosphere
Mission: light lands on the world. Fully measured; **ships built-but-OFF pending checkpoint #3**.
- **Catcher ON** (`DEPTH_PASS.catcher`): flip `SAT_SHADOWS.catcher.enabled` with the AGL + caster-presence gate its own header demands — mounts only when casters are in the ortho frustum and AGL < band ⇒ Owens +0 by construction.
- **Receive-set experiment** (`DEPTH_PASS.nearReceive`): near-ring LEAF tiles `receiveShadow` inside orthoRadiusM — judged by **gpuFrameMs A/B** (the R13 objection was fill-rate, invisible to draw gates) + acne screenshot review at ridge poses; parcel homes join the receive set; roads stay out (additive can't receive).
- **N8AO** (`DEPTH_PASS.n8ao`): high tier only, half-res, own EffectPass appended in `buildPassList` (convolution — cannot merge); validated against `reversedDepthBuffer` (the R19 trap; AerialPerspective.jsx:131-147 is the reference detection); auto-joins the warm set via buildPassList; budget ≤ +3 calls, ≤ +1.5 ms Owens / ≤ +2.5 ms Manhattan gpuFrameMs.
- **Near-field atmosphere**: `AERIAL_PERSPECTIVE.startM` 800 → measured ~350–500 behind `DEPTH_PASS.aerialNear`; content haze ON for medium/low (§5.4).
- Clutter/tree caster flips with per-flip gpuFrameMs.
- Non-goals: night work (R23), monument materials, new shader variants beyond the pass list. Frozen: verify-flicker five-control before/after (bloom adjacency); verify-monuments-sat; SAT_SHADOWS rig numbers move only with measured A/B.

### E CERT — instruments, gates, certification
- **Instruments**: sharpness = camTileZ-by-AGL-band at fixed poses; pop-in = per-layer first-appearance vs reveal; stutter = long frames (> max(40 ms, 3× rolling median)) in reveal+10 s; gpuFrameMs A/B via dev handles + new `__flyN8AO`/`__flyCatcher`/`__flyClutterPin`.
- **Five NEW harnesses, each RED-calibrated on the pre-R22 tree**: verify-terra (~16), verify-arrival (~15 — content-at-reveal is RED today by construction), verify-settle (~12 — incl. a throttled-HDRI stutter RED leg + ladder shape), verify-clutter (~18 — Owens 0/0, anti-dup, determinism under pin, exact +N draws, five-control for movers), verify-depth2 (~14 — catcher gating arithmetic, N8AO reversed-depth sanity, receive-set gpuFrameMs ledger, medium/low haze scoping).
- **Sanctioned edits**: verify-warp-arrival (§5.1), verify-aerial (§5.2 + startM legs), soak-fly (§5.10), _boot un-pins. verify-stability gains a mountainous boot leg (Owens ridge) keeping original assertions.
- **W2 smoke per merge; W3**: full fleet + both soaks + A/B PNG set + `r22-close-sweep.md` + consumed-move ledger + FLY_ROUND22.md skeleton.

## §7 Measurement protocol (pass/fail decided BEFORE building)

**Canonical poses**: **P-LEWIS** = Lewis Center OH 40.2083 N, −83.0701 W, ~120 m AGL (the user's low-AGL screenshot); **P-DUBLIN** = far warp (> 100 km) to Dublin OH at FL300, sampled AT the reveal (the user's blurry-arrival screenshot); + Owens (empty control), Powell OH (parcel interplay), Melton AU (parcel-heavy), Manhattan (N8AO worst case).

**Pass/fail**: P-LEWIS camTileZ ≥ 17 within 10 s of settle (high tier); P-DUBLIN camTileZ ≥ targetZ−1 AT reveal with hold ≤ 6500 ms; second-visit warp descent ≤ 40% of cold via cache; no layer first-appears > reveal+2.5 s without an active birth fade; stutter ≤ 2 long frames in reveal+10 s; N8AO ≤ +1.5/2.5 ms (Owens/Manhattan); receive-set ≤ +1.0 ms or ships off; Owens ≤ 261 / sat ≤ 375 everywhere; P-LEWIS tris ≤ 2.0M; soak p95 tris ≤ 2.2M, steps ≤ 4, heap flat. A/B PNG per flag at fixed poses; deterministic counts, never soak-differenced; five-control flicker protocol for movers.

## §8 Risk register (top 8)

1. z18 texture memory on iGPU/phones → high-tier-only, 450 MB gate, LOD-curve fallback, verify-sat-mobile re-run.
2. N8AO cost at DPR 1.5 → half-res, high-only, hard gpuFrameMs gates, ships OFF until checkpoint.
3. Moving-car determinism vs the flicker fleet → clock-derived phase, `__flyClutterPin`, five-control protocol.
4. Vendored three-tile drift → verbatim-first commit, VENDOR.md ledger, flag-off identity gate, npm dep as diff base.
5. Birth fades vs byte-identity/key contracts → scale ramps for instancers (zero keys), ≤ 3 audited key bumps joining the warm set same-change.
6. Esri rate limits on prefetch bursts → ≤ 48-tile pyramid, semaphore, cache-first, backoff on 429/403.
7. Holding the reveal too long on slow networks → holdMax 6500 hard cap ALWAYS wins; content gate degrades to the time gate.
8. Near-ring receiveShadow acne/fill-rate (the R13 rejection) → leaf-tiles-only inside orthoRadius, normalBias sweep, gpuFrameMs + acne review; default-off unless clean.

## §9 User checkpoints (§6 of the round record)

1. **P-LEWIS before/after** — the round's money shot (sharpness + clutter + shadows/AO candidate).
2. **P-DUBLIN warp arrival before/after** + hold-length feel (is ≤ 6.5 s tolerable when it buys a sharp reveal?).
3. **Shadows+AO taste & perf ON THE USER'S MACHINE FIRST** — flips `DEPTH_PASS` on or keeps it built-but-off.
4. Tree/car/pole read at low AGL (density, scale, believability).
5. Moving-traffic speed/density taste.
6. SAT_QUILT arrival desaturation A/B.
7. Boot feel: stutter gone, pop-in gone (subjective confirmation of the §7 instruments).

## §10 Out of scope

Every Cinematic Night delta (R23 seed, untouched); the monument MeshToonMaterial satellite tell (noted for R23's sanctioned monuments-sat evolution); mobile beyond not-regressing; SSR/planar reflections; toy/Neon visual changes; traffic/gameplay features.

## Verification (end-to-end)

1. **Per-wave**: W0 smoke (verify-sat-depth + verify-boot prove vendor byte-identity); W1 exit = each agent's own gates green in-worktree + E's five harnesses RED-proven on the pre-R22 tree; W2 = E's smoke set after each merge (verify-stability + verify-terra + verify-arrival).
2. **W3 certification**: full harness fleet + TOY and SATELLITE 15-min soaks (blocking gates unchanged) + fixed-pose A/B PNGs at all six poses + `r22-close-sweep.md` ledger with every consumed §5 move.
3. **Live confirmation**: the three user symptoms re-checked at P-LEWIS and P-DUBLIN on the user's machine (checkpoints #1/#2/#7) before the round is called closed — the R21 lesson: a probe green on a quiet boot is not a probe green under load.

## Definition of done

Every §4 frozen number green on the integrated tree; five new gates green AND proven RED pre-R22; both soaks green; every consumed §5 move inline-commented + ledgered; vendor flag-off identity proven; the three user symptoms traced in FLY_ROUND22.md to named closed defects with the §7 instruments as evidence; `DEPTH_PASS` certified both states and parked on checkpoint #3; the R23 handoff byte-untouched.
