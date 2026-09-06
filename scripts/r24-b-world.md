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

