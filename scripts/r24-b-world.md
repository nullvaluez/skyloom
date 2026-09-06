# R24 B WORLD — "nothing pops, nothing flashes, nothing recompiles mid-flight"

Ledger for agent **B WORLD** of Round 24 "Smooth World". Ids point into
[`scripts/r24-recon.md`](r24-recon.md): **WB-1 WB-2 WB-4 WB-5(prep) WB-6 WB-8
WB-9 · A1 A1b A5 A6 · FL-10 · T8**. Worktree `/home/user/skyloom-r24-b`,
branch `r24/b`, port 3102, cache-key suffix `-b24`.

## §0 Venue and instruments

**Environment truth.** This container cannot reach Esri, OpenFreeMap,
open-meteo or adsb.lol (403) and its WebGL is ANGLE/SwiftShader at ~1 fps
under the game's load. Therefore **every number in this ledger is either a
pure function of tile bytes / index buffers (node), or explicitly marked
"could not measure here"** (§9). No fps, ms-per-frame, stutter or tearing
number in this ledger comes from this machine.

**B's own node instrument (built W1, before E's fixture landed):**

- `scripts/r24-b-fixture.js` — a hand-rolled MVT v2 encoder (no new npm
  dependency; protobuf wire format is varints + length-delimited fields) plus
  a `globalThis.fetch` stub that serves a TileJSON and synthetic `.pbf`
  bytes. **It emits `ClosePath`**, so `@mapbox/vector-tile`'s reader appends
  `line[0].clone()` exactly as production does — the fixture reproduces the
  ring-closure duplicate that is the defect under test instead of hiding it.
  Scenes: `dense` (324 towers + 1 courtyard/hole), `suburb` (64 houses),
  `desert` (no `building` layer — the Owens control).
- `scripts/r24-b-worker-proof.js` — drives the REAL
  `lib/fly/toy-world/vector-tile.worker.js` **in-process** through
  verify-seam's two loader hooks (alias `comlink` to a stub that captures
  `expose(api)`; teach node the repo's extensionless relative imports), then
  runs five legs: degenerate census, filter effect, shading neutrality via
  three's own `computeVertexNormals`, clean-chunk zero-allocation, and an
  FNV-1a fingerprint table over every emitted buffer (the byte-identity
  baseline for any worker edit).

E CERT's `scripts/r24-fixture/` supersedes this for anything with a browser
in it; the worker fingerprints stay valid either way because they are a pure
function of the bytes.

---

## §1 M1 — FLASH_GUARD (A1 / A1b, WB-1): the one-frame pale flash

### 1.1 RED — the census on the flag-off tree

`node scripts/r24-b-worker-proof.js` with `FLASH_GUARD.enabled:false`,
census over the RAW worker output after a stand-in drape (positions only get
a per-anchor Y, so XZ degeneracy is fully decidable at finalize):

| scene | builder | tris | degenerate | % | coincident | collinear |
|---|---|---:|---:|---:|---:|---:|
| dense | sat-buildings | 20,894 | **2,972** | **14.22%** | 2,972 | 0 |
| dense | sat-skyline | 2,100 | 0 | 0.00% | 0 | 0 |
| dense | full (toy) | 16,792 | **2,492** | **14.84%** | 2,492 | 0 |
| suburb | sat-buildings | 3,638 | **512** | **14.07%** | 512 | 0 |
| suburb | sat-skyline | 448 | 0 | 0.00% | 0 | 0 |
| suburb | full (toy) | 768 | **128** | **16.67%** | 128 | 0 |
| desert | all three | — | — | — | — | — (`empty`, reason `zero`) |

**This reproduces, on this tree and in this container, the exact population
the archived R22.1 census measured on live tiles** (6.36–8.64%, 99.9%
coincident). The fixture's percentage is HIGHER because its footprints are
4-corner rectangles: the defect is 2 triangles per ring regardless of ring
length, so short rings inflate the ratio. The live 6–9% is the number to
quote for real tilesets; 14% is the fixture's own control.

Two recon claims are CONFIRMED by measurement here:

- **A1b is right about the skyline: it is CLEAN (0 degenerate).**
  `simplifyRing(poly.outer, SK.simplifyTol)` discards the closing clone
  before the skyline wall loop. The R22.1 claim that the skyline carried the
  wall-closure defect is wrong; the only degenerates possible there are the
  roof-earcut collinear kind, and the fixture produced none.
- **The toy/Neon extruder carries the defect at full strength** (14.84% /
  16.67%) — never censused before this round (A1b: "confirmed by grep, never
  censused"). Toy has both preconditions: `MeshToonMaterial` `DoubleSide`
  (toy-world-engine.js:190) and the per-vertex bend (world-bend.js:305).

### 1.2 Mechanism (as read on THIS tree)

`@mapbox/vector-tile/index.js:98` — `line.push(line[0].clone()); //
closePolygon`. `clipRing` (vector-tile.worker.js:318, Sutherland–Hodgman)
keeps an inside closing point verbatim, and `rings.filter(r => r.length >= 3)`
does not dedupe. Every wall extruder then walks the ring as if it were OPEN:

```
for (let e = 0, j = ring.length - 1; e < ring.length; j = e++)   // :1731, :4284
```

so the wrap-around edge (`ring[n-1] === ring[0]`) emits a wall quad whose four
vertices collapse onto two positions — two exactly-degenerate triangles per
ring **and per hole**. `side: DoubleSide` means winding never culls them, and
`wPos.y -= bendD*bendD*uBendK` adds a per-vertex float32 drop that perturbs
the projected coordinates. The archived drawRange bisection of a captured pale
frame landed on **one** such triangle (`[61410, 61413)`, three collinear
vertices, pr 0.731).

### 1.3 Fix

`lib/fly/toy-world/flash-guard.js` (new, ~160 lines incl. the census hook):

- `filterDegenerateTris(idx, pos, minArea2)` — for each triangle,
  `|(b−a)×(c−a)|² <= minArea2²` with `minArea2: 0` (exactly-degenerate only:
  the archived census found the `0 < area² < 1e-6` bucket EMPTY everywhere).
  In-place compaction with a write cursor on the worker-transferred index
  buffer; **the same array object comes back by reference when nothing was
  dropped**, so clean chunks allocate nothing. `subarray` (not `slice`) when
  they do, so the transferred ArrayBuffer is never copied.
- `guardIndex(idx, pos)` — the flag + runtime-pin wrapper used at the call
  sites (one line each).
- `flashGuardOn()` — `FLASH_GUARD.enabled && window.__flyFlashPin !== 'off'`
  (sanctioned `__flyWeatherOverride` accessor idiom, node-safe). **The pin
  gives a same-session RED leg without a reload.**
- `censusDegenerate(meshes)` — E CERT's hook; also exposed per engine as
  `engine.censusDegenerate()` over resident chunk meshes (draped positions,
  i.e. exactly what the rasterizer sees).

Call sites — **before `geo.setIndex` and before `computeVertexNormals`** at
all four:

| file | site | expected drop |
|---|---|---|
| `sat-building-engine.js:1224` | the A1 site | 6–9% live / 14% fixture |
| `sat-skyline-engine.js:682` | A1b, earcut-collinear kind only | ~0 |
| `toy-world-engine.js:1007` | toy buildings — the A1b twin | 15% fixture |
| `toy-world-engine.js:960` | toy water — cheap insurance | 0 |

Deliberately NOT filtered: the toy **land** mesh (`toy-world-engine.js:935`).
Its index is a plain JS array dominated by the ground grid; its polygon
overlays come from earcut (which `filterPoints` already cleans) and its road
ribbons are length-guarded (`if (len < 0.01) continue`, worker :475/:2222).
There is no wall extruder on that path, so there is nothing to find and the
scan would be the most expensive of the five. Same reasoning for the
sat-building **water** mesh (`sat-building-engine.js:625`).

Telemetry: `stats.degenerateDropped` on all three engines (additive, 0 when
the flag is off).

### 1.4 Proof (node, `scripts/r24-b-worker-proof.js`, all PASS)

- **(2) FILTER EFFECT** — re-census after the filter is exactly **0** on every
  scene × builder; index counts fall by the table's `dropped` column.
- **(3) SHADING NEUTRALITY** — three's own `computeVertexNormals` over the
  filtered index yields **bit-identical** normals to the unfiltered index, on
  every scene that had degenerates. This is the claim that licenses running
  the filter *before* normals rather than after: a degenerate's face normal is
  (0,0,0) and contributed nothing.
- **(4) CLEAN-CHUNK ZERO-ALLOC** — filtering an already-clean list returns the
  SAME object (`===`) with `dropped: 0`.
- **(1) RED** — 6,104 of 44,640 fixture triangles are degenerate on the raw
  worker output.

### 1.5 Cost, risk, frozen numbers

- CPU only; memory-bound. The archived measurement (largest real chunk,
  44,157 tris, coherent index layout) is 0.264 ms median / 0.956 ms max,
  inside `SAT_BUILDINGS.drapeBudgetMs` 1.0 with `finalizePerFrame` 1.
  **Random-index layouts measured 2.75 ms p95 — do not reorder indices
  upstream of this filter.** Could not re-time here (§9).
- Index counts fall 6–9% (live) on dense chunks: tris ceilings only ever go
  DOWN. No new draws, no cache-key move, no worker change, no protocol move.
- `chunk.tris` in the skyline engine now reports the post-filter count. It is
  identical to `totalI/3` with the flag off, and the skyline drops 0 anyway.
- Frozen gates touched: **none expected**. A1's archived flip measured
  verify-sat-buildings' draws 226 / kept 6,965 / columns 6,964 / maxR 305.9
  identical across it — `ready` counts and column grids are built from
  positions and anchors, which this filter never touches.

### 1.6 Decisions

- `minArea2` stays **0**. Raising it is a taste decision with a real risk of
  eating thin real geometry, and the census says there is nothing between 0
  and 1e-6 to catch.
- **Ships `enabled: false`** per Fable's W1 ruling: every block stays off until
  the close, where Fable flips the Level A blocks ON in ONE integration commit
  and E calibrates every new gate RED on the literal flag-off tree.
  **RECOMMENDED ON AT CLOSE** on the evidence in §1.1/§1.4. Once it is on,
  `window.__flyFlashPin = 'off'` is the same-session RED leg.

---

## §2 M-BEND — BEND_LEAD (WB-6): the on-screen chunk that gets culled

Taken OUT OF CHARTER ORDER (before CHUNK_FADE/HEAL_IN_PLACE), approved by
Fable: it is four one-line engine changes plus three pool lines, and it is the
most literal form of the user's report — a chunk that is **on screen** being
frustum-culled while the camera turns at speed.

### 2.1 RED — the false-cull window is open on EVERY ring

`node scripts/r24-b-bend-proof.mjs` (pure arithmetic over the constants; runs
anywhere). `maxLeadFrac 0.35 · pad 1.15`, metres:

| ring | ringR | halfDiag | padOFF | padON | worst drop at the alive edge | **deficit OFF** |
|---|---:|---:|---:|---:|---:|---:|
| sat-buildings z14 | 3,600 | 1,730 | 163 | 250 | 217 | **54** |
| sat-roads z13 | 12,000 | 3,459 | 1,374 | 2,222 | 1,932 | **558** |
| sat-skyline z14×2 | 14,000 | 3,459 | 1,753 | 2,875 | 2,500 | **747** |
| toy full z14 | 8,000 | 1,730 | 544 | 903 | 785 | **241** |
| toy mid z13 | 18,000 | 3,459 | 2,648 | 4,431 | 3,853 | **1,205** |
| toy far z12 | 30,000 | 6,918 | 7,837 | 12,929 | 11,242 | **3,405** |
| toy ultra z10 | 89,650 | 27,673 | 79,147 | 127,143 | 110,559 | **31,412** |

**7 of 7 rings are short with the flag off.** For scale, R21's census RED
measured a worst drop of 10,191 m on the toy ultra ring — and that census ran
on the ORBIT phase at **speed 0, where the lead is exactly 0**
(FLY_ROUND21.md:112-113). The deficit above is what opens up the moment the
aircraft moves.

### 2.2 Mechanism

`bendMarginM(ringAliveR, halfDiag)` models the worst vertex distance from the
player as `ringR + halfDiag`. R21's lookahead centres the DESIRED SET on the
lead point (`lead = min(sp·leadSec, maxLeadFrac·ringR)`,
sat-building-engine.js:414, desired set at :750), so a chunk is legitimately
alive out to `(1 + 0.35)·ringR + halfDiag`. The shader's drop is `d²·k`, so a
35% radius excess is ~82% more drop than the sphere was padded for. Same shape
at sat-road-engine.js:234/:571, sat-skyline-engine.js:198/:680,
toy-world-engine.js:342.

The pooled instanced layers have the same bug in a different clothing: they pad
with `maxD` measured at the LAST placement pass and refill only on the 2 s
cadence, so the player can be one cadence × fleet-max-speed further away before
the pad is recomputed — and a pooled layer culls **as one object** (a whole
forest, suburb or landcover sheet vanishing at once).

### 2.3 Fix

- `bendMarginM` in all four engines: `d = ringAliveR * leadMul + halfDiag`
  where `leadMul = BEND_LEAD.enabled ? 1 + maxLeadFrac : 1`. **Flag-off the
  multiplier is exactly 1 and the line is the R21 body verbatim.** The skyline
  keeps its `max(cullMarginM, …)` floor, so the flag can only ever widen.
- `SatVegLayer.jsx:521`, `SatParcelHomes.jsx:1052`, `SatTintLayer.jsx:285`:
  `leadD = maxD + (BEND_LEAD.enabled ? BEND_LEAD.poolLeadM : 0)`.
  `poolLeadM: 1500` = 2 s `SAT_VEG.placeCadenceSec` × 750 m/s (the fleet's
  fastest airframe). Stated in B's own block rather than read from
  `FLIGHT.bars.maxSpeedMps` (a hangar-UI normalizer that happens to hold the
  same number) so the coupling is deliberate.
- `SatTintLayer` is included even though the recon only named the veg and
  parcel pools: it is the same one-line pattern, the same cadence and the same
  vanish-as-one-object failure.

### 2.4 Proof, cost, frozen numbers

- Gates (1) RED / (2) GREEN / (3) SAFETY / (4) POOLS all PASS —
  `padON >= worstDrop` on every ring, and `padON >= padOFF` everywhere (the
  pad can only ever KEEP geometry, never drop it).
- Cost: a handful of extra ring-edge draw submissions. Culling stays effective
  — the pad grows ~55% on a radius that is already a small fraction of the ring.
  **Owens has no buildings, skyline, roads or parcel homes to keep, so its draw
  count cannot move** (its chunks are `empty` and issue no mesh).
- No cache keys, no worker change, no protocol move, no shader text.
- Frozen gates touched: `verify-stability`'s false-cull census reads
  `mesh.userData.bendMarginM` and asserts `dropAtCentre <= bendMarginM` — that
  assertion gets EASIER, never harder. E owns the moving-leg census sample
  (§10 hand-off).
- **Ships `enabled: false`. RECOMMENDED ON AT CLOSE.**

---

## §3 M3 — CHUNK_FADE (WB-2, A6): nothing arrives or leaves in one frame

### 3.1 RED — measured end to end, in node

`node scripts/r24-b-engine-proof.js` runs the REAL `SatBuildingEngine` in node
(it is pure three scene-graph + typed-array work — nothing touches a GL context
until something renders) driven by the REAL `vector-tile.worker.js` against the
closed-ring fixture bytes, over a 90 s / 2,700-frame serpentine at 120 m/s with
the pseudo-DEM refining twice.

The instrument is the **effective per-mesh alpha**: the value of the
`uSatBldgFade` uniform the mesh's material actually carries (a fade twin
publishes its own on `material.userData.__fadeU`; a shared material reads the
module uniform) times `visible`. A **POP** is any mesh whose effective alpha
moves by a full 1.0 between two consecutive frames.

| | flags OFF (RED) | flags ON (GREEN) |
|---|---:|---:|
| single-frame **POPS** | **92** | **2** (both attributable — see below) |
| ramp steps | **0** | 600 |
| evictions | 40 | 24 |
| heals | 16 | 21 |
| …of which patched in place | **0** | **21** |
| resident degenerate tris | **15,984 (14.19 %)** | **0** |
| fade twins live | 0 | 8 (pooled, bounded) |

**92 single-frame pops in 90 s of ordinary flight, and zero ramps: on this tree
every chunk arrival and every eviction is a cut.** That is the measurement
behind the user's "buildings appearing and disappearing".

### 3.2 Mechanism

`_finalizePending` does `this.object.add(mesh)` the frame a chunk completes;
`_evict` does `remove + geometry.dispose()` the frame the desired set changes.
The only dissolve that exists is ALTITUDE-keyed and driven by ONE
module-shared uniform (`setSatBldgFade`, world-bend.js:1473), which cannot
express a per-mesh ramp — and it cannot, because **three re-uploads a
material's uniforms only when the MATERIAL changes between draws**
(`refreshMaterial` is keyed on `currentMaterialId !== material.id`), so a
per-draw write against one shared material is simply never uploaded for the
2nd..Nth mesh.

### 3.3 Fix

`lib/fly/toy-world/chunk-fade.js` + a **twin material**: a ramping chunk wears
a POOLED clone of its engine's shared material carrying its OWN fade uniform,
and is handed back to the shared material the frame the ramp completes.
Steady state is therefore ONE shared material per engine, exactly as today.

- `applyBendAnchorSat(material, fadeUniform)` and
  `applyBendAnchorSatSkyline(material, fadeUniform)` gain ONE optional
  argument. **No GLSL text changes — same declarations, same discard, same
  cache key — so this is uniform plumbing, NOT a key move**, and a caller that
  omits the argument gets the R21 behaviour verbatim.
- Per-mesh value = `altitudeFade × ramp(t)`: a chunk born at 2.8 km AGL
  arrives already thinned rather than solid, and the ramp MULTIPLIES the
  existing altitude law instead of replacing it.
- A chunk evicted mid-birth carries its ramp value across (`k0`) so it dims
  from where it actually is instead of flashing to solid for one frame.
- **Warp, tier arm, style flip and `dispose()` all land every ramp
  immediately** — a cut is never a crossfade, and a twin's program key follows
  `USE_MAP`/`USE_EMISSIVEMAP` so a tier arm must not leave one behind.
- Parcel homes: `growK` is eased over `parcelGrowSec` 0.6 s by applying the
  scale RATIO to the resident instance matrices in place (uniform scale on the
  3×3 basis, translation untouched) with a ranged upload — R22's RED measured
  1,874 Melton homes arriving in one 100 ms sample at 100 % of settled scale.
  Zero keys, zero draws, and the buffer is walked only while an ease runs.

### 3.4 Why it compiles nothing

The twin is built with the same constructor parameters, the same
`map`/`emissiveMap`/`emissive` state (mirrored on every acquire) and the same
`customProgramCacheKey`, so three's program cache returns the SAME
`WebGLProgram` and increments its refcount. Releasing a twin cannot delete the
program because the shared material still holds a reference. **This is E's
proof obligation, not an assumption** — `programs.length` must be flat across
a serpentine and across a tier step (§10).

### 3.5 Counts, draws and budgets

- **A birth changes NO count.** The chunk is `ready` from the frame it
  finalizes exactly as before, so verify-sat-buildings / verify-roof-variety /
  verify-skyline see what they see today; only pixels move for ~0.4 s.
- **Only the DYING set adds draws.** A dying mesh has already left
  `this.chunks` (so every `ready`/`columns` count is unchanged) and keeps
  drawing while it dims, bounded by `maxDying` 4. **Owens has nothing to fade,
  so it takes exactly 0 extra draws BY CONSTRUCTION.**
- When a budget is spent the engine degrades to today's instant behaviour and
  COUNTS it (`stats.fadeBudgetMiss`). The gate asserts
  `pops <= fadeBudgetMiss`: **both residual pops in the GREEN run are
  attributable**, so nothing unexplained survives the feature.

### 3.6 Decisions

- **sat-roads is DELIBERATELY EXCLUDED.** `verify-sat-night`'s frozen gate
  asserts that ONE material instance carries every road mesh (by uuid, at two
  legs minutes apart) and that `meshes === ready === visible`. A twin material
  or a dying mesh turns that assertion into a load-decided coin — the exact
  R21 anti-pattern (a load-decided instrument gets one quiet re-run and a
  CONTROL, never a new bound). Road ribbons are also the least visible pop in
  the set. Revisiting this needs a sanctioned gate change and is not worth it
  this round.
- **The skyline's binary `visible` flip is NOT a visual pop and is left
  alone.** A group is parked only when its FARTHEST corner is inside
  `uSkyHole.x`, at which point every one of its anchors already fails
  `smoothstep(hole, hole+feather, vSkyDist)` and every fragment is discarded —
  the engine's own comment says so ("a draw call, a vertex shader pass and a
  full fragment-kill for zero pixels. Park it"). It is a DRAW-COUNT
  optimization on already-invisible geometry, i.e. pixel-neutral by
  construction. R21's inline reading of it as "a 4.9 km block of city blinking
  on and off" is not supported by the shader; the real blink sources are the
  bend-margin false cull (§2) and the arrival/eviction cut (§3). Marked
  hypothesis-level in §7 pending a fixture pixel A/B.
- **Ships `enabled: false`. RECOMMENDED ON AT CLOSE.**

---

## §4 M4a — HEAL_IN_PLACE (WB-8, T8): a heal is no longer a hole

### 4.1 RED

Same run: **16 heals with the flag off, every one of them an evict + refetch**
— the chunk is GONE for the whole worker roundtrip + drape + finalize latency,
up to `healCap` 3 times per key on hilly terrain. R21 bounded how MANY times
that can happen; it never stopped a single heal from being a HOLE. Each one
also takes the chunk's collision columns and house anchors with it, which is
what replays the R21 parcel-home placement race on every DEM refinement.

### 4.2 Fix

At finalize the engine now retains a **per-run drape record** — one entry per
BUILDING (its chunk-local anchor, its vertex span, and the ground it was draped
on), built inside the anchor-run walk that already exists, plus a
`houseRun` index so a porch light moves with its own building. A few thousand
floats per chunk, not per-vertex.

A heal then re-samples the DEM per building on its OWN budget
(`HEAL_IN_PLACE.budgetMs` 0.6 ms, below `SAT_BUILDINGS.drapeBudgetMs` so a heal
can never cost more than the arrival it replaces) and patches:

- the **resident position buffer** (`arr[v*3+1] += delta` over the run's span),
  with a **ranged upload** over the touched span only;
- the collision **column tops** (`buildColumnGrid` preserves run order, so
  column `r` IS run `r`);
- the **porch-light anchors** via `houseRun`;
- the bounding sphere (+ the R21/R24 bend pad).

A run whose ground moved less than `minDeltaM` is skipped, and a heal that
moves nothing at all marks the chunk's `drapeZ` so it stops asking (that is
evidence, not a transient). The job is invalidated by RECORD IDENTITY
(`chunks.get(key) !== chunk`), which is what an evict-and-re-stream actually
does — a generation counter would not catch it.

**GREEN: 21 heals, 21 patched in place, 0 holes.** Evictions fall 40 → 24 in
the same run because a heal is no longer an eviction at all.

### 4.3 Scope and follow-ups

Scoped to the **satellite building ring** — the user's symptom, and the only
engine whose drape is per-anchor. `sat-road-engine.js:333-354` and
`toy-world-engine.js:598-615` carry the identical evict-then-rebuild shape but
drape on bilinear GRIDS, so an in-place patch there means retaining the chunk's
sample grid and computing `heightNew(x,z) − heightOld(x,z)` per vertex from the
mesh's own (unchanged) XZ. That is a clean follow-up, not a port. Named in §8.

- **Ships `enabled: false`. RECOMMENDED ON AT CLOSE.**

