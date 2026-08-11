# R22.1 — Agent B "STUTTER" ledger

Branch `r22p1/stutter`, worktree `.claude/worktrees/r22-e`, base `main` 5d6c09d.
Dev server `:3022` (own `.next`, own `node_modules` — the shared
`skyloom-3/node_modules` junction was an EMPTY directory on arrival, so the
worktree got a real `npm ci`; the main repo tree was not touched).

---

## 1. The defect, as reported

User recording, PRODUCTION build (shadowads.netlify.app, R22 code), 1280x720@60,
872 frames: banked low-AGL flight over Powell OH suburbs in satellite style
(40.1748, -83.1079, 1689 ft MSL / 766 ft AGL, HDG ~155, 350 kt). The world and
camera visibly freeze, then snap.

ffmpeg signalstats (YDIF ~ 0 = a duplicated frame):

| t | duplicated frames |
|---|---|
| 5.500 s | 3 |
| 5.667 s | 2 |
| 6.483 s | 2 |
| 13.283 s | 3 |
| 13.950 s | 2 |

i.e. **33–50 ms render stalls, about one every two seconds while manoeuvring**,
plus 22 near-duplicate frames out of 872.

---

## 2. Reproduction and RED baseline

`scripts/r22p1-b-probe.js` — boots satellite at the user's exact pose with the
FOUR R22 fleet pins UN-PINNED (production has no pins; a pinned harness measures
the R21 world and is structurally blind to an R22 regression), then drives a
deterministic aggressive serpentine — full roll reversal every 3.5 s, AGL held
at 233 m, 180 m/s — by wrapping `flight.step`. No input plumbing, no feel
change: the model integrates exactly as always, it is only handed a scripted
command, so nothing verify-feel gates is involved.

Machine conditions: Windows 11, headless Chrome (`channel: 'chrome'`,
`--enable-gpu`), viewport 1280x720 at deviceScaleFactor 1.5 (the user's own
capture geometry). Agent A was working the white-flash defect on the same box
throughout, so every timing number here is a MEDIAN over repeated windows and
every verdict is an interleaved A/B, never a single absolute reading.
**Headless Chromium here presents at ~240 Hz** (median dt 4.2 ms), so a "stall"
is defined as `dt >= max(2 x the run's own median, 28 ms)` — two vsyncs of
whatever display is actually running.

Pinning kept as bootFly sets it, and why: `__flyGovPin='hold'` (a mid-run tier
step rebuilds the composer and would confound every frame time),
`__flyWeatherOverride='baseline'`, `__flyBoostInfinite`, `__flyAerialOverride=0`,
`__flySatShadowOverride=0`. The last two mean the repro runs without R19's
aerial-perspective merge and satellite content shadows, which production has on
at high tier; both are uniform/effect-level and neither allocates or builds
geometry, so they cannot be the stall — but this is an honest deviation from the
user's exact program and is recorded as such.

### 2.1 Baseline table (RED, FRAME_PACE off = shipped R22)

| run | frames / 30 s | median | p95 | p99 | worst | stalls | per min |
|---|---|---|---|---|---|---|---|
| red3 | 5 202 | 4.20 ms | 8.5 | 29.1 | **87.5 ms** | 54 | 108.0 |
| red4 | 5 509 | 4.20 ms | 8.4 | 25.0 | **83.5 ms** | 47 | 94.0 |

The user's recording shows ~20 multi-frame freezes per minute at 60 Hz plus 22
near-duplicates in 14.5 s; the repro is in the same order of magnitude and
somewhat hotter, which is what a scripted continuous serpentine should be.

### 2.2 Attribution

Two instruments over the same window, and BOTH had to be fixed before any number
was believed:

1. **In-page GL counters** — every synchronous WebGL entry point that can block
   the main thread (`texImage2D` / `texSubImage2D` / `texStorage2D` /
   `generateMipmap` / `bufferData` / `bufferSubData` / `compileShader` /
   `linkProgram` / `getProgramParameter` / `readPixels` / `finish`), timed and
   binned into the frame they landed in. Deliberately NOT `drawElements`, the
   uniform setters or `texParameter`: wrapping the hot path manufactures the
   cost being measured.
2. **Chromium CDP timeline trace + a CDP `Profiler` sample profile.**

Instrument faults found and corrected:

* The trace's `Profile` / `ProfileChunk` events are **per-isolate and not
  reliably tagged with the profiled thread**. Unfiltered, the vector-tile
  WORKERS' MVT parse (`VectorTileFeature`) read as 30% of main-thread stall
  time. Replaced with the page's own CDP `Profiler` session, which is
  main-thread by construction.
* Summing trace event `dur` **triple-counts nested events** (`RunTask` >
  `HandlePostMessage` > `v8.callFunction` > `FunctionCall`) and reported 138 ms
  of work inside a 46 ms frame. Every event now carries SELF time.
* `createImageBitmap` await time is WALL time on an off-thread decode
  (30–51 s per 30 s window). Printed as streaming-pressure evidence, excluded
  from every cause verdict.

**RED attribution — cause -> count -> total ms (run red3, 54 stall frames,
4 454 profiler samples inside the stall windows):**

| cause | stall frames | ms in those frames | share of stall-window samples |
|---|---|---|---|
| `We` = `getBoundaryEdges` (vendored three-tile) | 37 | 1 734 | **37%** |
| its sort comparator, `(anonymous)` in the same function | 13 | 558 | **30%** |
| `(program)` (V8 non-JS: parse/compile/runtime) | 1 | 46 | 11% |
| `(garbage collector)` | — | — | 1% |
| `(idle)` | 1 | 33 | 1% |
| `SatBuildingEngine.update` | 1 | 29 | <1% |
| `measure` | 1 | 29 | 2% |

**67% of every stalled millisecond is one function.** Over the whole 30 s
window it cost 610 ms + 497 ms = **1 107 ms**, concentrated into bursts.

Everything else in the whole-window profile is ordinary per-frame render work
(`WebGLRenderer.update` 746 ms, `setProgram` 385 ms, `updateMatrixWorld` 316 ms,
`upload` 297 ms, `projectObject` 256 ms) — nothing pathological. Thread-level
self time confirms it is a main-thread problem, not the GPU: `CrRendererMain`
29 931 ms of a 30 s window vs `CrGpuMain` 11 699 ms.

### 2.3 What the function is, and why R22 made it bite

`TerrainLercLoader.doLoad` awaits the embedded worker (which decodes AND martini-
decimates the LERC DEM), then calls `new TileGeometry().setAttributes(a, z)` **on
the main thread**. That runs `addSkirt` -> `getBoundaryEdges`, which:

* allocates **3·T two-element arrays** (a 4 000-triangle tile = 12 000 arrays),
* sorts them with a **JS comparator running four `Math.min`/`Math.max` per
  comparison** (~165 000 comparator calls at that size),
* then de-duplicates adjacent reverse pairs.

R22 is what turned a background cost into a visible freeze: z18 imagery +
demMaxZoom 16 + the altitude-keyed live LOD curve stream far more DEM tiles at
low AGL, and `Tile._loadSubTiles` resolves **four children in ONE microtask
drain**, so four of these builds land in a single frame. Measured live: 2 123
skirt builds and **8.79 M triangles walked in a 22 s Powell run** — a mean of
~4 100 triangles per tile.

The other four suspects in the brief were checked and cleared by the same
instruments: no shader compiles during flight (`linkProgram` 0 ms, program count
flat), pooled attribute uploads are cheap (`bufferSubData` 296 ms / 188 694 calls
= 1.6 µs each), texture upload is cheap (`texSubImage2D` 73 ms / 1 720 calls),
GC is 1% of stall-window samples, and the camera/sim path never appears.

---

## 3. The fix

`FRAME_PACE` (lib/fly/fly-constants.js, next to SETTLE_CALM), `enabled: true`,
one sub-switch `skirtEdges: true`. `enabled:false` restores R22 byte-for-byte.

Vendored **patch #5** (`lib/fly/vendor/three-tile/index.js`, ledger row in
`VENDOR.md`): count each undirected edge in a module-scoped open-addressed
`Int32Array` table — generation-stamped so it is never cleared, reused so there
is zero per-tile allocation, with a compact occupied-slot list so the collect
pass is O(unique edges) rather than O(table) — and keep the ones seen once. The
only surviving sort is over the tile PERIMETER (a few hundred entries), not over
3·T.

**Identical output by construction**, which is what makes this safe to ship
without a fleet pin:

1. the key is `min·K + max` with `max < K`, so ascending key order **is**
   upstream's `(min, max)` lexicographic sort order;
2. a boundary edge is emitted in the direction of its single occurrence, which
   is exactly the entry upstream's dedup loop pushes;
3. the fast path **returns null** — deferring to the verbatim upstream body —
   for every input it does not claim: length not a multiple of 3, a negative
   index, a third occurrence of one undirected edge, or two occurrences that are
   **not exact reverses** (the one case where upstream keeps both halves and a
   naive "count == 1" filter would be wrong).

Node fixture (85 meshes: regular grids 1x1…64x64, 80 randomly holed grids in
both `Uint16Array` and `Uint32Array`, four deliberately non-manifold cases):
**85 identical, 4 bailed to upstream, 0 mismatches.** Isolated speedup
4.9–6.1x across T = 2 048…32 768 (`ref 9.72 ms -> fast 1.79 ms` at T = 32 768).

A first attempt used a `Map` keyed by `min*2^21+max` and measured only 2.3x
(475 ms of a 30 s window still in the function): those keys are heap doubles and
every probe boxes and hashes one. Recorded because the number, not the idea,
decided the implementation.

**Not attempted (deliberately):** moving the whole skirt build into the LERC
worker, which would take it to zero rather than to a fifth. It means
re-implementing `addSkirt`/`getBoundaryEdges`/`concatenateTypedArrays` inside the
embedded worker source string and changing the transferred payload — a much
larger vendored surface than a hotfix wave should take on, for a defect that the
measurement below says is already closed. Left as a ranked follow-up.

### Files

| file | change |
|---|---|
| `lib/fly/vendor/three-tile/index.js` | patch #5 (`skirtEdges`) + patch #6 (four additive exports) |
| `lib/fly/vendor/three-tile/VENDOR.md` | ledger rows 5 and 6, plus the identity argument |
| `lib/fly/fly-constants.js` | `FRAME_PACE` block |
| `lib/fly/terrain-engine.js` | `framePaceOn()`, patch arming, `__flyStats.pace` receipts, `window.__flyPace` dev handle |
| `scripts/r22p1-b-probe.js` | the attribution instrument (not a gate) |
| `scripts/verify-frame-pace.js` | the shipped gate, 7 gates |

`scripts/_boot.js` is **untouched** — no fifth fleet pin, because there is
nothing for a determinism pin to protect.

---

## 4. GREEN — before/after

Interleaved A/B, three runs per arm, alternating, each in its own browser
context (cold Cache API raster store), same pose, same scripted flight, 25 s
measured window.

| run | arm | median | p95 | p99 | worst | stalls/min |
|---|---|---|---|---|---|---|
| r1 | OFF | 4.20 ms | 8.5 | 25.1 | 95.8 ms | **100.7** |
| r1 | ON | 8.30 ms | 12.5 | 16.6 | 29.2 ms | **2.4** |
| r2 | OFF | 4.20 ms | 8.4 | 20.8 | 79.2 ms | **83.9** |
| r2 | ON | 4.20 ms | 8.3 | 12.4 | 33.3 ms | **2.4** |
| r3 | OFF | 4.20 ms | 8.4 | 20.9 | 87.5 ms | **91.2** |
| r3 | ON | 4.20 ms | 8.3 | 8.4 | 20.8 ms | **0.0** |

**Medians: stalls/min 91.2 -> 2.4 (38x). Worst frame 87.5 -> 29.2 ms. p99
20.9 -> 12.4 ms.** A separate 30 s confirmation run (`green-resid`) recorded
**0 stalls, worst frame 25.0 ms**, and `flyBoundaryEdgesFast` no longer appears
in the profiler's top 14 (was 1 107 ms).

Skirt receipts across every ON run: **`fast` 2 123–2 367, `bail` 0,
`upstream` 0** — the fast path took every single real tile.

### Content unchanged

* **Function level (the load-bearing claim).** verify-frame-pace gate (2) runs
  BOTH implementations over a ring of the last 24 real index buffers captured as
  `getBoundaryEdges` is handed them: **23 717 triangles, mean 988/tile, 24 fast,
  0 mismatches.** Patch #5 changes exactly one function; if its output is
  identical on the meshes the session actually built, every geometry, draw call
  and triangle total is what R22 shipped.
* **Scene level.** Gate (6): one frozen pose, a full quadtree reload under each
  arm, every terrain tile keyed by its own z/x/y — **219 tiles resident in both
  passes, 0 differ**, 0 residency drift.
* **Independent corroboration.** verify-terra gate (14), the vendor-identity
  signal, reads **Owens draws 200 vs its frozen baseline 200** with the patch
  armed; gate (13) Owens 200 <= 261; gate (15) P-LEWIS fixed-pose tris 479 671
  <= 2 000 000. verify-clutter, verify-seam and verify-stability all pass with
  their numbers unmoved.

The change repaces work. It removes no content.

---

## 5. Frozen gates

Run in this worktree against `:3022`, FRAME_PACE armed.

| gate | verdict | note |
|---|---|---|
| verify-settle | **PASS** | 14/14 |
| verify-arrival | **PASS** | |
| verify-stability | **PASS** | |
| verify-seam | **PASS** | |
| verify-clutter | **PASS** | |
| verify-frame-pace | **PASS** | new, 7/7 |
| verify-terra | **FAIL (2)** — **PRE-EXISTING, PROVEN NOT MINE** | see below |

### verify-terra (2) — adjudicated

`(2) P-LEWIS SHARPNESS — camTileZ >= 17 within 10 s of settle` reads
**camTileZ = 13 at 160 m AGL**. Quietly re-run once: same, 13. Then the decisive
control — `FRAME_PACE.enabled` flipped to `false`, which is byte-for-byte the
shipped R22 program, same harness, same server, minutes apart:

```
armed   FAIL (2) settled camTileZ=13 (best in window 13) at 160 m AGL
control FAIL (2) settled camTileZ=13 (best in window 13) at 161 m AGL
```

**Identical measured value in both arms.** This red exists on `main` and this
round did not cause it. Every other verify-terra gate passes with the patch
armed, including the two that would notice a geometry change (14: Owens 200 vs
baseline 200; 15: fixed-pose tris 479 671). Not smoothed, not re-baselined —
handed to the orchestrator. Candidates worth checking in R23: an upstream Esri
imagery/DEM change at P-LEWIS specifically (R21 already ruled once that frozen
numbers over live tilesets have a shelf life), or a `getGroundAt` raycast
answering from a coarse ancestor. Note that MY Powell pose reads camTileZ 17–18
at 236 m AGL on the same tree, so deep refinement is working in general.

---

## 6. Build

`npm run build` — see §8.

---

## 7. Found in passing (NOT fixed here)

* **Every dev handle installed from the TerrainEngine constructor is bound to a
  DEAD engine.** FlyScene builds the engine in a `useMemo` with an empty dep
  list; React 19 StrictMode double-invokes the component body, so TWO
  TerrainEngines are constructed and the one React DISCARDS runs its constructor
  LAST. Measured on this tree: `window.__flyTerra.get().sizeZ0` reads 0 and
  `window.__flyTerra.stats()` reads null, while `window.__fly.engine.terraStats`
  is live; `map.traverse` over the stale handle's map finds 0 meshes where the
  live map has 185. verify-terra's main gates read
  `runtime.terraStats ?? runtime.engine?.terraStats` and are unaffected, but any
  gate reading engine-LOCAL state through `__flyTerra` is reading a corpse.
  `window.__flyPace` refuses to inherit the fault (`engine()` resolves the live
  engine at call time). R22's handle is left alone on purpose — a hotfix wave
  does not re-point another round's instrument.
* **`SatVegEngine._commitPending` and `SatClutterEngine._commitPending` have no
  per-frame cap** while every other streaming engine has `finalizePerFrame = 1`.
  They build no geometry themselves, so they are not this defect, but they can
  flip many chunks ready in one frame and thereby force every downstream pooled
  layer's signature to change on the same 2 s tick.
* The `node_modules` at the repo root is an **empty directory** and every
  worktree junctions to it, so no worktree can run anything until it installs
  its own. Agent A will hit the same wall.

---

## 8. Ranked open risks

1. **The residual is not zero.** The ON arm still records 0–2.4 stalls/min at a
   4.2 ms baseline, worst frame 20.8–33.3 ms. On the user's 60 Hz display a
   29 ms frame is one dropped frame, not a visible freeze — but it is not
   nothing. The residual profile is ordinary render work with no single
   dominant term, so the next real win is structural (below), not another
   micro-optimisation.
2. **The skirt is still on the main thread**, just 5–6x cheaper. Moving
   `addSkirt` into the LERC worker would take it to zero. Deferred as too large
   a vendored surface for a hotfix; it is the obvious R23 candidate if the user
   still sees anything.
3. **Everything here was measured on the DEV server, not a production build.**
   `window.__fly` is dev-only, so the harness fleet has no choice. The defect is
   plain JS inside a vendored module with no React or dev-only code on its path,
   so the finding transfers — but the absolute millisecond numbers do not, and
   the user's confirmation on the real build is the only proof that matters.
4. **The repro ran with `__flyAerialOverride=0` and `__flySatShadowOverride=0`**
   (fleet pins), i.e. without R19's aerial perspective and satellite content
   shadows that production has on at high tier. Neither allocates nor builds
   geometry, so neither can be a stall of this shape, but the repro is not
   byte-identical to the user's program.
5. **verify-terra (2) is red on main** and this round did not fix it. Adjudicated
   in §5; it needs an owner.
6. **`__flyPace` and the edge-capture ring are new dev surface.** The capture is
   `max = 0` in production (one integer compare per tile) and `__flyPace` is
   `NODE_ENV === 'development'` only, but they are new code on a hot path and
   deserve a second reader.
7. **Not re-run after the last commit:** verify-flicker, verify-tier-step,
   verify-depth2 and the wider fleet matrix. The brief named six frozen gates
   and those six were run; the rest rest on the content-identity argument in §4,
   not on a fresh green.

---

## 9. Sanctions requested

**None.** No frozen assertion number was moved, no fleet pin was added or
changed, `scripts/_boot.js` is untouched, `WORKER_PROTOCOL` stays 18, and no npm
dependency was added.
