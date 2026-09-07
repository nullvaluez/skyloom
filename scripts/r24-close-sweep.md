# R24 CLOSE SWEEP — the per-harness ledger

Owner: **E CERT**. This is the round's certification record. Two columns, and
they are never mixed:

- **FIXTURE** — measured in this container against `scripts/r24-fixture/`
  (`FLY_TILE_FIXTURE=1`, launch shim, SwiftShader). Hardware-independent
  assertions only: counts, census, draw/tri totals, source and flag scans,
  buffer identity, program-count flatness, byte identity, fixed-pose pixel A/B.
- **LIVE** — measured on the **user's machine** against the real Esri /
  OpenFreeMap / adsb.lol bytes. Every fps / ms / governor / tearing number, and
  every frozen hash and pixel band that was calibrated on live tile bytes.

**A FIXTURE NUMBER NEVER RE-BASELINES A LIVE NUMBER** (recon HARN-GAP-6).
Where a gate cannot run in this venue at all, the row says
**"user machine only"** — not "skipped", and never a weakened bound.

Run everything here with:

```bash
scripts/r24-smoke.sh 3105          # the subset that runs in this container
```

---

## §1 Per-harness matrix

Legend: ✔ green · ✘ red · — not run · **UM** user machine only · *(fx)* fixture
column · *(live)* live column.

### 1.1 Node gates — ALL GREEN on the INTEGRATED tree (E's worktree, 2026-09-06)

Run: `node scripts/<gate>` from the merged tree at `990c7b5`.

| Gate | Result | Numbers |
|---|---|---|
| `verify-classify.mjs` | **PASS** | |
| `verify-warbirds.mjs` | **PASS** | |
| `verify-daily.mjs` | **PASS** | |
| `verify-depth-offset.mjs` | **PASS** | 7 gates |
| `verify-terra-residency.mjs` | **PASS** | 21 passed, 0 failed |
| `verify-c-flagoff.mjs` | **PASS** | 26 gates |
| `verify-worker-normals.mjs` | **PASS** | 12 gates; **node-proven, user machine for pixels** |
| `verify-skirt-worker.mjs` | **PASS** | 8 passed, 0 failed |
| `verify-lod-fade.mjs` (D's node half) | **PASS** | 51 passed, 0 failed |
| `verify-vendor-three-tile.mjs` | **PASS** | 19 passed, 0 failed |
| `verify-skirt-fast.mjs` | **PASS** | 12 passed, 0 failed |
| `verify-frame-step.mjs` | **PASS** | 10 passed, 0 failed |
| `verify-finalize-pace.mjs` | **PASS** | 11 passed, 0 failed |
| `verify-artifact-hygiene.mjs` | **PASS** | 5 passed, 0 failed |
| **`verify-seam.js` node leg (offline, fixture-pinned)** | **PASS** | 9 gates; 149 z14 tiles; Owens hatchKept **0**; worst slope 2.5; ramp 0/149 disagree; 0 seam pairs; determinism manhattan kept **311** `8d36f2aa:89218640:13605`, columbus kept **193** `2eefc447:49bbe703:8715` |

**The seam hashes are IDENTICAL to the pre-merge run on `r24/e` alone.** With
every R24 flag off, five agents' merges leave the worker's output byte-identical
on 149 fixture tiles — which is the flag-off byte-identity claim, measured
rather than asserted.

The artifact redirect is proven in the same run: `verify-seam` wrote its
calibration JSON to `scripts/r24-out/fixture-r21-e-red-seam.json` and the
tracked `scripts/r21-e-red-seam.json` was untouched (`verify-artifact-hygiene`
5/5, working tree clean).

### 1.1b Node gate inventory (what each is for)

| Gate | Fixture | Live | Notes |
|---|---|---|---|
| `verify-classify.mjs` | — | — | 38 gates; ran green throughout R24 W0 |
| `verify-warbirds.mjs` | — | — | source-parses four files |
| `verify-daily.mjs` | — | — | deterministic daily set |
| `verify-depth-offset.mjs` | — | — | C (R24); RED 6/7 on `6116fc5`, GREEN 7/7 |
| `verify-terra-residency.mjs` | — | — | A (R24); RED 22 merges / 17 replaced / 178 refetches → 0/0/0 |
| `verify-c-flagoff.mjs` | — | — | C (R24); 26 gates: every C flag `enabled:false`, every GLSL injection's FALSE branch verbatim R21, `r24VariantKey` returns the bare R19 key |
| `verify-worker-normals.mjs` | — | **UM for pixels** | C (R24); 12 gates. **node-proven; user machine for pixels** — the spliced worker cannot run in a browser here (LERC 403, terrain-rgb builds on the main thread). Mean angular error 3.34° (upstream last-writer) → 0.26° (area-weighted), orientation +z, reversed winding bit-identical |
| `verify-skirt-worker.mjs` | — | **UM for pixels** | A (R24). ⚠ its element-by-element identity leg is RED **by design** with `TERRAIN_LIGHT.workerNormals` on: the NORMAL array is meant to change while positions / uv / indices stay identical. Needs a FLAG-ON ARM, never a re-baseline of A's number |
| `verify-seam.js` (node leg) | **GREEN 9/9** | — | pinned to fixture tiles; see §1.4b |

### 1.2 R24 gates (new this round) — TWO COLUMNS PER ROW

A round that fixes defects has to be certified twice, and the two runs mean
opposite things:

- **FLAG-OFF PASS (pass 1) — the RED.** The tree with every R24 constants block
  `enabled:false`. A gate "passes" here when **the defect it was written for
  reproduces with a number attached**, which for most of these gates means the
  process **exits non-zero on purpose**. `rc != 0` in this column is the
  evidence, not the failure. A gate that comes back all-green flag-off has
  proven nothing about itself — it is either mis-aimed or vacuous, and §2.10
  is where I say which of mine are at risk of that.
- **FLIPPED PASS (pass 2) — the GREEN.** The integrated tree with the ship
  table's flags on. The defect leg reads its target (usually exactly 0) and
  **every other leg of the same gate stays green** — the second half matters,
  because a "fix" that also stops the watch from having anything to watch is
  how a gate turns into a coin.

A row is only closed when BOTH columns carry measured numbers from a named
tree. "PENDING" below means the row has not run yet in that column; **UM** means
this venue structurally cannot produce the number and the user's machine owns it
(§2).

| Gate | FLAG-OFF PASS — the RED reproduces | FLIPPED PASS — the fix holds | Un-pin / releases |
|---|---|---|---|
| `verify-fixture` | **rc 0, 10/10** — this gate certifies the venue and has no RED. Four poses settled, §1.4 | **PENDING** — re-run and diff §1.4: a flag that adds draws or triangles shows as a delta against that table | — |
| `verify-flash-guard` | **rc 1 BY DESIGN, 5 passed / 1 failed.** (2) RED > 0: Powell **2,616 / 31,576 = 8.28 %** coincident-vertex — inside R22.1's live **6.36–8.64 %** band; Manhattan **5,820 / 126,116 = 4.61 %**, worst chunk **13.98 %**. (3) FAILs as intended. **Sat-skyline 0 / 83,752 and toy 0 / 0 — those two sites are NOT EXERCISED here** | **PENDING** — (3) zero-area **exactly 0** at every resident site; (5) triangle count only ever falls, per site; (1a)/(1b) census still non-empty | `__flyFlashPin` |
| `verify-fade` | **rc 1 BY DESIGN, 4 passed / 2 failed.** (2) **14 of 14 hard births**, (3) **10 of 10 hard deaths**, presence channel **`none`** — no material carries a fade uniform, which IS the flag-off state. Watch was live: births 14 / deaths 10 over 94 frames | **PENDING** — (2) and (3) → **0 hard**, presence channel names a real uniform, and (1) (4) (5) (6) all stay green | — |
| `verify-lod-fade` | **rc 1 BY DESIGN, 2 passed / 5 failed, 317 s.** (3) **27 re-appearances on a pure yaw** — A's T1/T3, the position never moved; (4) **8 hard refines + 3 hard merges** — D's T4; (5) co-display run **0**; (6) **15 tile URLs refetched**, worst 2×; (7) Owens **174 draws / 166,659 tris** (fixture); (8) clean. (1) FAILed for an **instrument** reason, not a world reason — see below. Node leg **GREEN** in §1.1 | **PENDING — the leg now exists.** `9cba1b6` adds the ON leg (gates 9–19) against D's reviewed criteria: `refines+merges === hardSwaps+faded` on both arms, `refines+merges` FLAT across the flip, `faded` rises / `hardSwaps` drops, `active === 0 && retained === 0` at rest, `0 < peakActive ≤ 32`, `skip.{shape,noParentMap,unpatched}` each 0, Owens draws **and** tris EQUAL to 174 / 166,659 — every wait in it is a **poll**, not a frame count (D's C1/C2: no frame count is right at both 1 fps and 144 Hz), both arms settle identically, and (14)/(15) read NOT CALIBRATED when the OFF arm saw no swaps or the two arms' frame counts differ by more than ±25% | `__flyLodFadeOverride` `{enabled:true, skipBootMs:0}` |
| `verify-step-clean` | **rc 1 BY DESIGN, 4 passed / 4 failed — the round's cleanest RED.** (1) the ladder ACCEPTED **6 of 6 forced steps** across DPR 1.25↔1.5 (so nothing here is vacuous); (2) **18 of 18 canvas width/height writes outside a rAF**; (3) setPixelRatio **6/6** and setSize **12/12** outside; (3b) composer.setSize **6/6** outside; (4) **22 of 46 frames** with `bufferMatchesDrawing` false, e.g. composer 1920×1080 against a 1600×900 drawing buffer. (5) composer resized not rebuilt (1→1) and (6) clean already hold | **PENDING** — every accepted DPR/tier step resizes inside the rAF; **accepted-step count must be > 0 or the gate reads NOT CALIBRATED**, never a silent pass | `__flyGovPin` |
| `verify-frame-pace` | **INSTRUMENT ABSENT** on the 19:14 tree — `FRAME_STATS.enabled:false`, so the row is structurally vacuous there. **`6c26fe9` ships FRAME_STATS ON**, so the gate only has an instrument from the flipped tree onward. Its tear legs now print **(3a) ARMED / NOT CALIBRATED** so a window with no resize cannot read as a pass | **UM** for every pacing number — SwiftShader at ~1 fps cannot produce a p95, a long-frame rate, or a stall count | — |
| `verify-one-sun` | **rc 1 BY DESIGN, 20 passed / 7 failed, 251 s.** (2) key elevation pinned at **~45°** against a true 55 / 2 / −14 at **high AND medium** — C's L3; (6) medium azimuth spread **0.0000°**. Preconditions held: (0) both pins released, (0a)/(0b) `live=true`, (1) azimuth Δ 0 everywhere, (7) clean. **One vacuous pass caught in the read**: (5) water passed six times on `Δ undefined°` — fixed `686db21` | **PENDING** — exactly one key direction across every lit material, all tiers | `__flySunOverride` + tier |
| `verify-env-uniform` | **PENDING** — `programsDelta` non-zero across a dusk crossing and across a tier step | **PENDING** — 0 across both crossings | `__flyGovPin` + `__flySatShadowOverride` |
| `verify-ladder-fix` (A) | **RED ARM MEASURED, 7 passed / 6 failed** with the pins unset: ladder `[1/high, 1/medium, 1/low]` — **0 sub-native rungs on a DPR-1 display**, target capped at **60 against a 144 Hz** estimate, a 53.4 fps stuttering session **does not step** (rung 0), no `__flyStats.step` record. Controls held both ways: (3)(4)(8)(12)(13) green in the red arm too | **GREEN, 13 / 13.** Ladder `[1/high, 0.875/high, 0.75/high, 1/medium, 1/low]` — 2 sub-native rungs, both BEFORE the first tier rung; target **144** follows the display; the stutterer steps to rung 3 at emaFps 53.4 / longFrac 0.1 while the clean 60 fps control never steps; forced step applied **inside a frame** (`applyMs 466.8`, `viaValve:false`) and the composer buffers equal the drawing buffer 560×315 | its own pins |
| `verify-shadow-calm` | **GREEN NODE-SIDE, 32/32** (C, `a9e30cc`): the ShaderChunk patch run against three's real chunk text both ways; reversal reproduces three **byte-exact**; texel snap is a staircase, 11 positions / 10 texels | **UM** for pixels, draws and the catcher shadow — the node leg cannot see any of them | `__flySatShadowOverride` |
| `verify-linear-haze` | **VOID — INSTRUMENT, not a reading.** Both poses returned terrain L **0.0** / sky L **0.0** / an all-zero luma profile: the seam reader ran from `page.evaluate`, i.e. BETWEEN frames, and on a `preserveDrawingBuffer:false` context the default framebuffer is undefined once presented. (1a)/(1b) correctly said "no horizon"; (2a)/(2b)/(3) then **passed on Δ 0.0 — black against black**. Fixed `686db21`: the read happens inside a rAF, and (2)/(3) are NOT CALIBRATED whenever (1) fails | **PENDING** — the horizon band matches by construction | — |
| `verify-depth-roundtrip` | **NOT RUNNABLE, not RED** — rc 1, 1 passed / 1 failed, 220 s. `window.__flyDepthProbe` **ABSENT**; (0) refused and printed the contract and the owner. The gate will not reconstruct viewZ itself — a harness that re-implements the renderer's conversion tests its own copy of the bug. See §2.7c | **PENDING** — \|viewZ\| equals the known depth at all three pixels; the RED signature is all three collapsing to 2.50–2.51 m | needs C's `__flyDepthProbe` + `__flyDof` |

**`verify-ladder-fix` is the model row**, and the only one in this table with
both columns filled from measurement on the same day: a RED arm run with the
pins unset (7 / 6) and a GREEN arm run with them set (13 / 13), from the same
harness, with the same control legs passing in BOTH arms. Controls that pass in
the red arm are what make the failing legs mean something — (8) "a clean 60 fps
session never steps" is green in both, so (7) "a stuttering session steps down"
is measuring the stutter term and not the harness's ability to force a step.
Every other row in this table should end up shaped like that one.

`verify-import-integrity` and `verify-artifact-hygiene` are flag-independent
node gates and are certified once, in §1.1 — there is no second column for
them because there is no flag they can be on the wrong side of.

### 1.3 Inherited gates the round touches — TWO COLUMNS PER ROW

The two columns mean something different here, and it is the more important
pair of the two sections:

- **FLAG-OFF PASS = IDENTITY.** The frozen number comes back **unmoved** on the
  flag-off integrated tree. That is the measurement that says +N lines of R24
  compose to a no-op — the R20 idiom, and the only honest basis for a one-flag
  revert contract.
- **FLIPPED PASS = STILL THE SAME NUMBER.** A frozen number that moves when a
  flag flips is a **re-baseline**, and a re-baseline is an escalation with a
  control experiment attached, never a quiet edit. The one candidate this round
  is `verify-neon-cover` under `RING_DEDUPE`.

| Gate | Frozen number it carries | FLAG-OFF PASS (identity) | FLIPPED PASS (unmoved unless sanctioned) | Notes |
|---|---|---|---|---|
| `verify-stability` | R21 quartet, 17 | **PENDING** | **PENDING** | **UM** for (1)/(1b); gains an INFORMATIONAL FRAME_STATS line |
| `verify-flicker` | bound of 12, never moves | **PENDING** | **PENDING** | **UM**; + the quiescence precondition (A7) |
| `verify-tier-step` | 10 | **PENDING** | **PENDING** | **UM** |
| `verify-seam` | 13; determinism hashes | **GREEN 9/9 offline** — manhattan kept **311** `8d36f2aa:89218640:13605`, columbus **193** `2eefc447:49bbe703:8715`, Owens **0**, 149 tiles (§1.4b) | **PENDING** — the same four hashes, byte-identical | node leg pinned to fixture tiles (HARN-GAP-7 closed). Hashes already proved **identical across all five agents' merges** |
| `verify-neon-cover` | five R18 FNV hashes | **PENDING** | **RE-BASELINE CANDIDATE under `RING_DEDUPE`** — record a fixture column BOTH ways; the live hashes stay frozen and become a user-machine item only if the flag ships | the one row where the two columns are *expected* to differ |
| `verify-sat-buildings` | draws 226 / kept 6,965 / columns 6,964 | **PENDING** | **PENDING** | |
| `verify-skyline` | 17 | **PENDING** | **PENDING** | |
| `verify-parcel-homes` | Powell 0 placed, bit-identical tris | **PENDING** | **PENDING** | fixture Owens/Melton legs are the cheap, trustworthy ones |
| `verify-suburbia` | nothing in (25, 35) m | **PENDING** | **PENDING** | |
| `verify-sat-depth` | hillshade A/B > 2/255, aniso ≥ 4, z16 request | **PENDING** | **PENDING** | needs the **sierra** fixture scene (394 m of relief at the crop pose) |
| `verify-aerial` | boot ≤ +20 %, quilt exactly 0 below inAglM, textures ≤ 300 MB | **PENDING** | **PENDING** | |
| `verify-rim` / `verify-dusk` / `verify-sat-night` | pixel bands | **PENDING** | **PENDING** | C's L1 one-time re-baseline lands in the FLIPPED column, with its control |
| `verify-monuments-sat` | FROZEN | **PENDING** | **PENDING** | moves only via C's sanctioned evolution |
| `verify-boot` | pct monotonic, 100 exactly at reveal | **PENDING** | **PENDING** | |
| `soak-fly --satellite --minutes 15` | p95 tris ≤ 2.2 M, p95 draws ≤ 375, heap no-climb, governor steps ≤ 4 | **UM** | **UM** | reads FRAME_STATS now that the flag ships |

### 1.4 THE FIXTURE COLUMN — four poses + the toy leg, SETTLED

`FLY_TILE_FIXTURE=1 FLY_FINALIZE_BUDGET_K=40 FLY_BOOT_SCALE=6
FLY_FIXTURE_SETTLE_MS=300000 node -r ./scripts/_pw-shim.js
scripts/verify-fixture.js` — flag-off tree, tier high, 1280×720, load 4–6.
**10 passed, 0 failed.**

| Pose | draws | tris | meshes | satBuilding | satSkyline | parcelHomes | terrain tiles | `sb` | settled | maxZ | ground |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Manhattan 40.7075/−74.0113 @792 m | **176** | 344,430 | 211 | 7 | 10 | 0 | 161 | {16, ready 4, empty 0} | **false** @300 s — "12 chunks still draping" | 16 | 14.8 m |
| Powell 40.1578/−83.0752 @900 m | *(stale)* | 385,393 | 247 | **16** | 0 | **671** | 185 | {16, **ready 16**, empty 0} | **true** in 305 s | **17** | 275.3 m |
| **Owens 36.6/−118.1 @2600 m** | **184** | 208,987 | 253 | **0** | **0** | **0** | 225 | {16, ready 0, **empty 16**} | **true in 53 s** | 17 | 1128.3 m |
| **Melton −37.68172/144.574 @700 m** | **153** | 451,149 | 165 | **0** | 0 | **1,836** | 117 | {16, ready 0, **empty 16**} | **true in 154 s** | 14 | 113.9 m |
| toy / Powell | **91** | 66,500 | 172 | — | — | — | 50 chunks | — | — | — | — |

Boot: satellite **111.9 s** wall, `pct 100` at **47.7 s**; toy **174.4 s**.
Traffic: **300 tracks**, 76 `/api/aircraft` polls. Zero page errors.

**What each row certifies.**

- **Owens is the lock, and it is cheap.** 0 building, 0 skyline, 0 parcel
  meshes; all sixteen chunks resolve `empty`, in **53 seconds**. Empty tiles
  never drape, which is why this and Melton are the two most trustworthy
  columns this venue produces.
- **Powell settled COMPLETELY** — sixteen of sixteen chunks ready, terrain at
  z17, ground 275.3 m against the fixture's true 276.3 m. And parcel homes
  read **671**, not the 2,992 an unsettled Powell reported earlier: with the
  buildings resident the two-term anti-duplication finally has a collision
  index to suppress against. That is the R20 story reproducing.
- **Melton places 1,836 homes from ZERO footprints** — the R20 carpet, exactly.
- **Manhattan does not finish in 300 s even on quiet cores at K=40**; the
  terrain settles (z16, ground converged) but four of sixteen chunks are
  resident. Its numbers are a FLOOR. Recommendation for a settled Manhattan
  column: **K=200** (the clamp allows 500) or a 900 s cap.

`draws` at Powell reads `null` because the settle returned "totals stale" —
`__flyStats` republishes only every 60 frames and the fresh-publish wait timed
out inside the cap. Not a defect; the gate says so rather than printing the
previous pose's number.

### 1.4a Draw ceilings (never re-baselineable)

| Pose | Ceiling | Fixture column (settled unless noted) | Live |
|---|---|---|---|
| Owens Valley | ≤ 261 | **184** | frozen |
| satellite | ≤ 375 | Melton **153** · Manhattan **176** *(floor)* | frozen |
| toy | ≤ 480 | Powell **91** | frozen |
| fixed-pose triangles | ≤ 2.0 M | Melton 451,149 · Powell 385,393 · Manhattan 344,430 · Owens 208,987 | frozen |

Every one is comfortably inside its live ceiling, but a fixture draw count is
NOT a live draw count — the fixture's scenes are less dense than the real
planet's, so these bound nothing on the user's machine. They are a
**regression baseline for THIS venue**: a flag that adds draws here will show
up here. They also fall under `POST_ORDER`, where C measures the merged
EffectPass count DROPPING (sat 4→3, toy 6→5), so a flag-on column reading lower
is a decrease, not drift.

---

### 1.4b `verify-seam` NODE LEG — the first full FIXTURE column

`FLY_TILE_FIXTURE=1 node scripts/verify-seam.js` — **no browser, no GPU, ~40 s**,
and it is now the fastest deterministic instrument in the fleet running
entirely offline. Measured on the flag-off tree:

| Gate | Result | Fixture number |
|---|---|---|
| (0) worker fixture loaded in-process | PASS | `api = setDiag, init, buildTile` |
| (0b) the sweep measured tiles | PASS | **149 z14 tiles** |
| (1) THE OWENS LOCK | PASS | hatchKept sum **0** |
| (2) NO CLIFF (\|Δ\| ≤ 4 per candidate) | PASS | worst slope **2.5** |
| (3) MONOTONE | PASS | — |
| (4) RAMP SPEC | PASS | **0 / 149** tiles disagree |
| (5) NO ALL-OR-NOTHING NEIGHBOURS | PASS | **0** seam pairs |
| (6) DETERMINISM (same tile twice, byte-identical) | PASS | manhattan kept **311** hash `8d36f2aa:89218640:13605` · columbus kept **193** hash `2eefc447:49bbe703:8715` · dublin `empty` |
| (6c) empty results carry a reason code | PASS | ocean `undefined`, owens `zero` |

**Two honest differences from the live planet**, recorded rather than tuned
away:

- The fixture's Owens scene yields **no z14 tiles with candidates at all**, so
  gate (1) passes "0 by construction" rather than by the ramp's lock. On live
  tiles Owens has a handful (R19 measured max 1). The gate is therefore WEAKER
  here than live; the live column stays the authority for it.
- Suburb candidate counts read 0 where R19 measured Powell 2 and Dublin 12 on
  the real planet; Columbus reads 17–97 against Chicago's 46. The fixture's
  suburb buildings are shorter and more uniform than OpenFreeMap's, so the
  far-mass selector finds nothing there. Any gate whose assertion depends on a
  SMALL NON-ZERO suburb candidate count must use the live column.

### 1.4c Cache-key registry audit (fills in at close)

C's shared tile key is `world-bend-fade-hill-r19` + tokens
`{e: ONE_SUN, f: TERRAIN_LIGHT, a: AERIAL_LAW, l: LOD_CROSSFADE}` + `'24'`,
composed by `r24VariantKey` in that fixed order, returning the bare R19 key
when every token is false. Each new key must also be in the PREWARM warm set.

---

## §1.5 The two harness-only scalers, and which gates may use them

Both live behind the ONE env-guarded branch in `scripts/_boot.js` and are
inert without it. Both default to a value that makes the arithmetic
byte-identical to R21.

### `FLY_FINALIZE_BUDGET_K` → `window.__flyFinalizeBudgetK` → `budgetK()`

Widens the per-frame drape / finalize budget at five sites (sat-building drape
+ finalize, sat-skyline drape + finalize, toy-world drape + finalize, sat-road
drape). **Absent ⇒ exactly 1 ⇒ identical arithmetic** — that is production and
every harness that does not opt in. Clamped to **[1, 500]**: a harness may only
ever make the budget MORE generous, never tighter, so it cannot manufacture a
green by starving something for frames.

Why it exists: at 1–3 fps the 1.0 ms/frame drape budget cannot get through a
chunk's ~400 full-quadtree raycasts, so satellite building chunks never become
`ready` and every content gate would certify an empty world. Full evidence in
`r24-e-cert.md` §1.2b/§1.2c.

| Gate | Sets it? | Why |
|---|---|---|
| `verify-fixture` | **yes** | asks what the world CONTAINS at four poses |
| `verify-flash-guard` | **yes** | the degenerate census needs resident chunks |
| `verify-fade` | **yes** | asserts hard-birth / hard-death COUNTS and the READY invariant — not timing |
| `verify-lod-fade` | **yes** | asserts tile-swap COUNTS and the crossfade WINDOW in frames — not timing |
| `verify-frame-pace` | **NEVER** | it measures pacing; that is the whole gate |
| `verify-step-clean` | **NEVER** | resize-inside-rAF is a per-frame ordering claim |
| `verify-env-uniform` | **NEVER** | `programsDelta` is per-frame; a wider budget changes what lands in which frame |
| `soak-fly` | **NEVER** | p95 frame time, p95 draws, governor steps |
| the R21 quartet | **NEVER** | stability / flicker / tier-step / seam all read per-frame behaviour |
| pixel A/B gates (`verify-linear-haze`, `verify-sat-depth`, …) | **yes, at a settled pose** | the pixel is a function of the settled scene |

`scripts/r24-smoke.sh` encodes this split: `content_gate` passes the env,
`browser_gate` does not.

### `FLY_BOOT_SCALE`

Multiplies bootFly's two fixed 30 s POST-REVEAL waits and `settleMs`. It does
**not** touch the boot contract — `__flyBoot.pct === 100` has already been
awaited by the time those run; what times out is Playwright's wait for the
canvas selector and for the boot-screen unmount, at 1 fps under contention.
Forced to 1 outside the fixture branch. The smoke exports 6.

Any gate may set it: it changes only how long the harness is willing to wait.

---

## §1.6 WHAT THE FLEET PINS HID — the R24 additions

R21 closed with a six-row table of ship-state visuals no gate could see, all
neutralised by `scripts/_boot.js`'s determinism pins (HARN-GAP-5). R24 found
more, and each one is a number, not a suspicion.

| Pin | What it hid | Measured | Who un-pins it now |
|---|---|---|---|
| `__flySatShadowOverride = 0` | **the satellite key light never moves with the sun** — R21's key-position write lives INSIDE the shadow gate, so the branch never executes under the fleet pin. `__flyStats.sun` reads key az −55.8° / el 47.9° = `MOODS.satellite.lightDir` (the baked kloofendal texel) to six figures, against hill az −58.3° / el 37.5°: **key ↔ hill 10.50° apart AT HIGH TIER**, `live: false` | C, Sierra pose, tier high, flag-off tree | `verify-one-sun` (gate 0a/0b asserts `live === true`; `live === false` is recorded as the RED) and `verify-env-uniform` |
| `__flyGovPin = 'hold'` | every DPR/tier step and therefore the whole resize path | `verify-step-clean` measured 0 steps until it forced them CORRECTLY (see §3.3) | `verify-step-clean`, `verify-env-uniform` |
| `__flySunOverride` (28 sites) | any claim about time of day | key azimuth spread 0 across three sun elevations on medium | `verify-one-sun`, `verify-linear-haze`, `verify-env-uniform` |
| `FRAME_STATS.enabled = false` | frame pace, long frames, program growth | `verify-frame-pace` on the integrated flag-off tree: "instrument absent — unmeasurable, not a renderer failure" | the flag itself |

The pattern is the R19 §7 lesson for the third time: **a determinism pin and a
ship-state visual can be the same switch**, and when they are, the fleet is
structurally blind to the thing the user actually sees. Every R24 feature
therefore ships its own override AND exactly one gate that releases it and
proves the released term is REACHABLE before asserting anything about it.

---

## §2 THE USER-MACHINE RUN LIST

Everything in this section is impossible in the build container. Copy-paste,
in order. `FLY_URL` assumes a dev server on 3019 from the R24 checkout.

```bash
npm install
npm run dev -- -p 3019        # leave running
```

### 2.1 The R21 quartet — the baseline this round inherits

The in-tree R21 record has **no W3 matrix**: the round was pushed mid-
certification and every result cell reads `— (W3)`. So this is not a
regression check, it is the first real measurement of the tree R24 was built on.

```bash
FLY_URL=http://localhost:3019 node scripts/verify-stability.js   # 17 gates
FLY_URL=http://localhost:3019 node scripts/verify-flicker.js     # 7,  bound of 12 never moves
FLY_URL=http://localhost:3019 node scripts/verify-tier-step.js   # 10
FLY_URL=http://localhost:3019 node scripts/verify-seam.js        # 13
```

Paste back: the PASS/FAIL block and the RED TABLE from each, plus the
`FRAME_STATS (dwell, informational)` line verify-stability now prints.

### 2.2 The 15-minute satellite soak (BLOCKING)

```bash
FLY_URL=http://localhost:3019 node scripts/soak-fly.js --satellite --minutes 15
```

Blocking bounds: p95 triangles ≤ 2,200,000 · p95 draw calls ≤ 375 · heap floor
climb < 60 MB · governor steps ≤ 4 · 0 page errors. With FRAME_STATS on, each
per-minute line also carries `FRAME p99 … worst … stalls/min … long100/min …
prog+…`. Paste the whole tail plus `scripts/soak-results-satellite.json`.

### 2.3 Frame pace — THE ROUND'S REAL RED

```bash
FRAME_PACE_STRICT=1 FLY_URL=http://localhost:3019 node scripts/verify-frame-pace.js
```

The pacing legs (stalls/min, >100 ms/min, p99, program growth) are asserted
ONLY with `FRAME_PACE_STRICT=1`, and only on this machine. The first run
establishes the numbers; do not treat a first-run failure as a regression.

### 2.4 Flash guard at the Powell pose — the one-frame white flash

```bash
FLASH_SERPENTINE_MS=180000 FLY_URL=http://localhost:3019 node scripts/verify-flash-guard.js
```

The degenerate census is deterministic and decides the gate. The pale detector
is probabilistic: the live rate was 1 pale frame per 1,600 to 1 per 20,389
composed frames, so three minutes of banked serpentine is the minimum useful
window and **absence is not proof**. Paste the census table and the
`(4) PALE DETECTOR` line.

### 2.5 Step clean — the tear mechanism, on a real display

```bash
FLY_URL=http://localhost:3019 node scripts/verify-step-clean.js
```

On a DPR-1 display the ladder has **zero DPR rungs** (recon A4), so the gate
raises `deviceScaleFactor` itself. If the user's display is already >1, run it
again with `STEP_DSF=$(node -e 'console.log(devicePixelRatio)')`-equivalent —
i.e. their real DPR — so the rungs under test are the rungs they fly on.

### 2.6 The diagnosis pack

`scripts/r24-user-diag.md`, Parts 0, A and B. **Part A must be run on the
current build BEFORE any R24 flag flips**, or the round has no before.

### 2.7 The R24 gates, one line each: what they need from the user's machine

| Gate | Runs here? | What the user's machine adds | Command |
|---|---|---|---|
| `verify-frame-pace` | instrument only | **everything**: stalls/min, worst dt, p99, >100 ms/min. The pacing legs are not asserted here at all | `FRAME_PACE_STRICT=1 FLY_URL=… node scripts/verify-frame-pace.js` |
| `verify-flash-guard` | census **yes**, pale detector **no** | the pale frame itself — the live rate was 1 per 1,600 to 1 per 20,389 composed frames, so it needs real frame rate and minutes of banked flying | `FLASH_SERPENTINE_MS=180000 FLY_URL=… node scripts/verify-flash-guard.js` |
| `verify-step-clean` | mechanism **yes** | the tear LINE, and the ladder the user's DPR actually has (a DPR-1 display has zero DPR rungs) | `STEP_DSF=<their real DPR> FLY_URL=… node scripts/verify-step-clean.js` |
| `verify-fade` | **yes** | nothing structural; the LOOK of the fade is a taste checkpoint | `FLY_URL=… node scripts/verify-fade.js` |
| `verify-lod-fade` | **yes** | the LOOK of the crossfade, and whether tile swaps are still visible at real frame rate | `FLY_URL=… node scripts/verify-lod-fade.js` |
| `verify-one-sun` | **yes** | nothing — the vectors are arithmetic. The LOOK (noon and dusk horizon) is checkpoint 5 | `FLY_URL=… node scripts/verify-one-sun.js` |
| `verify-env-uniform` | **yes** | the STALL a compile storm costs in ms; the program COUNT is honest here | `FLY_URL=… node scripts/verify-env-uniform.js` |
| `verify-linear-haze` | **yes** (fixture pixels) | whether the live Esri/OFM colours land in the same band; the fixture bound is a fixture bound | `FLY_URL=… node scripts/verify-linear-haze.js` |
| `verify-depth-roundtrip` | **only once C ships the hook** (§2.7c) | nothing — it is a reconstruction check | `FLY_URL=… node scripts/verify-depth-roundtrip.js` |
| `verify-shadow-calm` | **yes** | sparkle, which is temporal and needs real frames | `FLY_URL=… node scripts/verify-shadow-calm.js` |
| `verify-artifact-hygiene.mjs` | **yes**, anywhere | nothing | `node scripts/verify-artifact-hygiene.mjs` |
| `verify-seam` node leg | **yes**, offline | the LIVE hashes — the fixture column is a different planet | `FLY_URL=… node scripts/verify-seam.js` |

### 2.7c THE ONE HANDLE ANOTHER OWNER MUST SHIP FOR A ROW TO EXIST

`verify-depth-roundtrip` is **NOT RUNNABLE**, which is a different verdict from
RED: pass 1 printed `1 passed, 1 failed` with `window.__flyDepthProbe` **absent**,
so nothing about the defect was measured in either direction. The gate refuses
rather than reconstructing viewZ itself, deliberately — a harness that
re-implements the renderer's depth conversion is testing its own copy of the
bug.

Two handles, both **owned by C (DEPTH_FIX)**, both dev-only:

| Handle | Contract | What refuses without it |
|---|---|---|
| `window.__flyDepthProbe(x, y)` | → `{ viewZ, coc, raw, reversed }`. `x`/`y` in **drawing-buffer pixels, top-left origin**. Returns null (or a non-finite `viewZ`) when the pixel has no depth | gates (1)–(4): the whole round trip |
| `window.__flyDof` | the **live `DepthOfFieldEffect` instance**, or `null` when the chain has none | gate (0b) |

`(0b)` is the cautionary one. It used to infer the DoF pass from
`style === 'toy' && tier === 'high'` and **passed while printing `dof=null`** —
it was asserting the CONFIGURATION that is supposed to produce a pass, not the
pass. It now reads `__flyDof` and prints NOT CALIBRATED when the handle is
unpublished. A gate may not certify a thing by describing the conditions under
which that thing usually exists.

When the hook lands, the row runs unchanged and its RED signature is the one C
measured: all three pixels reconstructing to 2.50–2.51 m, i.e. `−cameraNear`,
every fragment collapsed by the double un-reversal.

### 2.7c-noise TWO NOISE FLOORS, AND WHY THE LARGER ONE BINDS

`haze-red` — both arms pinned `{ enabled: false }`, two identical trees that
cannot separate by construction — measured what this venue's seam reader does
when nothing is different:

| Floor | Measured | What it is |
|---|---|---|
| **WITHIN-RUN** | **0.00** luma noon, **0.45** night | two arms inside ONE process |
| **CROSS-BOOT** | **~1.2** luma | the same configuration in two DIFFERENT processes — `haze-red`'s OFF arms read noon 59.3 / night 40.0 · 39.5, `linear-haze`'s OFF arm read 59.9 / 38.8, same tree, same poses |

**The A/B's two arms are two boots, so cross-boot is its floor.** Judging
against the within-run number would flatter every future result by 0.75 luma.

This is only visible by putting two runs of one configuration side by side —
which is what a calibration arm is *for*, and is a second return on a row whose
stated job was merely to establish that identical arms do not separate.

Applied: `HAZE_NOISE_FLOOR` defaults to **1.2**. The parked-tree night reading
of **+2.6 clears it**, so that verdict is unchanged; what changes is the number
a future A/B must beat.

### 2.7d THE POST-BATCH RE-RUN ORDER (R24 close)

Rows that must run again, in this order, each because a named instrument or
product fix landed after the row was measured:

| # | Row | Why it re-runs |
|---|---|---|
| 1 | **`lod-fade` STANDALONE** | its 360° two-arm sweep does not fit `run()`'s 2,400 s row timeout; a killed row loses even the OFF leg |
| 2 | `one-sun` | the sun is now WAITED FOR, not waited on; (6) gated on the sun having landed; (2)/(4)/(3m) take C's moon-key contract |
| 3 | `linear-haze` | same wait-for-landing fix; without it both arms sat on the wall clock at Owens |
| 4 | `haze-red` | the noise floor is meaningless if the arms never differed |
| 5 | `fade` | `__noFade` attribution + the new (2b) attributability leg |
| 6 | `terra-live` | A's `parkOffscreen` fix, with the resident / parked / visible census — **read the drawn fraction before the draw number** |
| 7 | `verify-sat-night` (33) | C's M2 moves satellite NIGHT ground pixels |
| 8 | `verify-dusk` (15) | same |
| 9 | `verify-flicker` night legs (7) | same; **the bound of 12 never moves** |

Rows 7–9 are exposed frozen gates, not new ones. C's fix is bit-identical in
daylight by construction — `moonK` is 0 above the horizon, and the flag-off tree
is untouched at every elevation — so only the night legs can move. **If any of
the three reads red, the fix is C's to re-examine; it is not a re-baseline.**

### 2.7b What we will still not know afterwards

- Whether a tear LINE is present — only the user's eyes and a phone camera can
  answer that (a software recorder composites it away).
- How the world looks on a GPU that is not SwiftShader: precision, anisotropy
  and half-float behaviour are driver-dependent, and R16 §9 already cost this
  project one such surprise (Apple GPUs and `FloatType` HDRIs).

---

## §2.8 Harness hygiene (HARN-HYG-9), and the incident that earned it

Running R24's OFFLINE `verify-seam` leg **rewrote the tracked
`scripts/r21-e-red-seam.json` in place with fixture data**, and the commit
carried it: R21's live-tileset RED record — numbers measured against
OpenFreeMap bytes that nobody can re-measure — replaced by numbers from a
synthetic planet. Nothing failed and nothing warned; the file simply stopped
meaning what its name says. Restored from the round's base on both the branch
and integration.

Two defences now, because a mechanism alone can be bypassed by the next
harness someone writes:

1. **The redirect.** `scripts/_fixture.js` installs it at module load whenever
   `FLY_TILE_FIXTURE` is set: every write landing DIRECTLY in `scripts/` is
   rewritten to `scripts/r24-out/fixture-<name>`. It wraps `fs.writeFileSync`,
   `fs.writeFile`, `fs.promises.writeFile` (what Playwright's
   `page.screenshot({ path })` uses) and `fs.createWriteStream` — one redirect
   at the one place a file reaches disk, instead of thirty harness edits.
   Reads are untouched, so a gate that READS a committed baseline still reads
   the real one.
2. **The outcome gate.** `scripts/verify-artifact-hygiene.mjs` (node, 5 gates,
   in the smoke): `git diff --stat <base> -- 'scripts/r1*-*' 'scripts/r2[0-3]-*'
   'scripts/soak-results*.json'` must be EMPTY, plus the mechanism checks and
   an unstaged-dirty check for the run that just happened.

---

### 1.4d `verify-flash-guard` — THE A1 DEFECT REPRODUCES ON THE FIXTURE

First certification row, Powell pose, `__flyFlashPin='off'`, K=40, tree
`5ca8e15`:

```
powell: 3 meshes, 31,576 tris, 2,616 ZERO-AREA (8.28%)
   sat-buildings  meshes=3  tris=31,576  zero=2,616  worstChunk 8.34%
                  sample [1047.43, 231.91, 410.25]  coincident=TRUE
   sat-skyline    0 / 0 / 0
   toy-world      0 / 0 / 0
PASS (1a) THE CENSUS HAS SOMETHING TO COUNT at powell
PASS (2)  RED CALIBRATION — the zero-area population EXISTS with the pin off
```

Manhattan, same run:

```
manhattan: 14 meshes, 126,116 tris, 5,820 ZERO-AREA (4.61%)
   sat-buildings  meshes=4   tris=42,364  zero=5,820  worstChunk 13.98%
                  sample [342.77, 8.21, 677.18]  coincident=TRUE
   sat-skyline    meshes=10  tris=83,752  zero=0     worstChunk 0.00%
   toy-world      0 / 0 / 0
```

**8.28% against R22.1's 6.36–8.64%** measured on the LIVE planet (34,405 of
482,740 triangles, 99.9% coincident-vertex — recon A1), and the sampled
degenerate is coincident-vertex here too. The A1 defect reproduces on a
completely different planet's tiles, offline, with no GPU.

**AND THE PER-SITE ATTRIBUTION IS THE REAL PRIZE.** Over 83,752 triangles in
ten resident skyline meshes, the skyline site has **exactly zero** zero-area
triangles — which is precisely what recon A1b predicted from a code read and
nobody had measured. The skyline path runs `simplifyRing(poly.outer,
SK.simplifyTol)` BEFORE its wall loop, and `simplifyRing`'s collinearity test
discards the closing clone (`cross === 0`) *and* `ring[0]` with it. So the
skyline never emits the zero-length wall edge — at the price of losing a
genuine corner from every ring.

Two consequences for B:
- `FLASH_GUARD` at the **skyline** site is INSURANCE, not a fix: there is
  nothing there to remove. Its green at that site must not be read as having
  repaired anything.
- The skyline's actual defect — the lost first corner — is a DIFFERENT bug that
  this gate does not measure and no gate currently does.

The **toy** site reads 0/0/0 at both poses only because neither pose has toy
chunks resident in satellite. The toy extruder carries the same wrap-around
loop (A1b, `vector-tile.worker.js:4285`), so it is **NOT EXERCISED** by this
row and must not inherit the satellite green.

**RULING (Fable): no toy leg this round.** The machine belongs to the
certification run, and adding a leg now would mean calibrating a NEW gate under
load at the close — which is exactly how R20 §5 happened. The toy-world site is
therefore recorded as **NOT EXERCISED** here, in §4, and in B's ship row.
Manhattan covers the skyline site.

One number with its caveat: sat-buildings' **worst chunk is 13.98%** at
Manhattan, above R22.1's 6.36–8.64% band. That band was quoted for "every large
chunk", and a smaller chunk can be proportionally worse, so this reads as
consistent rather than contradictory — recorded with the caveat rather than
smoothed over.

That is worth more than a green: it is independent corroboration of the
diagnosis *and* of the fixture. The population exists in fixture tiles **by
construction** — `@mapbox/vector-tile` re-appends the closing clone on
`ClosePath`, the wall extruders walk the ring as if it were open, and the
zero-length wrap-around edge emits two coincident-vertex triangles per ring and
per hole. A fixture that had quietly emitted unclosed rings would have shown 0
here and certified a fix that fixes nothing.

**Row verdict: `rc=1`, 534 s, 5 passed / 1 failed — and the one failure is the
RED calibration working.** Gate (3) GREEN requires zero degenerates with the
guard armed, and `FLASH_GUARD.enabled` is FALSE in constants on this tree. The
gate releases B's RUNTIME pin (`__flyFlashPin`), which is a different switch, so
on a flag-off tree (3) CANNOT pass. Its own detail text says so. The green leg
measured 1,744 / 20,935 = 8.33% at Powell — the same population, a third boot.

**This row is therefore an expected FAIL until `FLASH_GUARD` ships ON**, and it
is the go/no-go for that flip. Today's useful signal is gates (1a)(1b)(2)(5)(6)
and the census numbers above.

Two instrument defects found by reading the row rather than trusting it, both
fixed:
- gate (5) was **vacuous** — `green.totalTris <= 0 || > 0` is a tautology, and
  it printed `pinned=n/a`. It now compares the sat-buildings degenerate RATE
  between the two legs, because the legs are separate boots that settle
  different chunk counts and absolute totals are not comparable; and when
  either leg resolves no triangles it prints NOT CALIBRATED rather than a
  verdict.
- `flagOn(probe)=true` was **misleading**: it read `__flyFlashPin === undefined`
  on a page that never set the pin. It now reports the feature's telemetry and
  the runtime pin as data, and claims nothing about `FLASH_GUARD.enabled`.

---

## §2.9 Which tree the certification run actually measured

**`5ca8e15`, not `7a00df0`.** The run's banner stamped `7a00df0` at 19:14:00;
C's `verify-shadow-calm` merge landed at 19:14:14; the dev server started at
19:14:15. `next dev` compiles the WORKING TREE on demand, so every module the
rows exercised came from `5ca8e15` and the banner named a tree they never
touched.

That is a general hazard, not a one-off: **a script that stamps its commit at
startup is describing the tree it was launched from, not the tree the server
will serve.** The fix (on `r24/e`) re-stamps immediately before the boot proof,
prints `TREE UNDER TEST`, and calls out the drift explicitly rather than
leaving it in a log for someone to notice later.

Boot proof on that tree: **`BOOT OK in 62.5 s`**, zero console errors, zero
pageerrors, zero failed `/_next/` chunk requests, after 15/15 node gates.

**The same drift applies to the INSTRUMENTS, and it bit one row.** The
`flash-guard` row wrote its log at 19:24; the two fixes to that instrument
landed on `r24/e` at 19:24:04 (`8ca7bdf`, the pale detector's own RED) and
19:25:26 (`ff5d9a1`, gate (5) turned from a tautology into a degenerate-RATE
comparison). Neither was in the integrated tree the run served, so
`flash-guard.log` is the **pre-fix instrument**:

- its `(4) PALE DETECTOR` line — `pale=168 of 256 frames`, every hit reading a
  mean of exactly 212.9 — is the **false positive I later diagnosed as the
  detector reading the SKY**, not a one-frame flash. Ignore that line; the
  jump-over-median rewrite plus `__paleSelfTest()` is what pass 2 runs.
- its trailing `flagOn(probe)=true` is the **misleading line**: the probe was
  reporting an absent runtime pin as "the flag is on". Now it reports the data
  and lets the reader draw the conclusion.
- the RED numbers in that log — Powell 2,616 / 31,576 and Manhattan 5,820 /
  126,116 — are from the census, which neither fix touched, so **they stand**.

Lesson, filed with the tree-stamp one: **a harness fleet drifts on the same
clock as the source it tests.** Stamp the instrument, not just the tree.

---

## §2.10 WHICH PASSES COULD BE VACUOUS — a sceptical audit of my own gates

The R20 §5 lesson is that a probe green on a quiet boot is not a probe green
under load; the R24 version, learned twice today, is that **a gate which passes
without asserting anything is indistinguishable from a gate that works.** Two of
mine were caught by reading the PASS lines rather than the FAIL lines
(`verify-flash-guard` (5) was a tautology; its `flagOn` probe reported an absent
runtime pin as "the flag is on"). This is the audit of the rest, written BEFORE
the remaining rows land so it cannot be tuned to them.

| Gate / leg | How its PASS could be empty | Guard now in place |
|---|---|---|
| `verify-fade` (2)(3) no hard birth / death | if the serpentine never leaves the resident ring, births = deaths = 0 and both "pass" over an empty population | (1) asserts `births + deaths > 0` FIRST and says "lengthen FADE_RUN_MS, do not weaken the gate" |
| `verify-fade` (4) ready invariant | `ready <= chunks && ready >= 0` is nearly a tautology; it cannot fail unless the engine is corrupt | **STILL WEAK.** "ready never falls" is not the fix either — the measured serpentine series `[[2,0]…[4,0],[0,0],[0,1]…]` falls legitimately when the run leaves the ring. The honest invariant is per-chunk: a RESIDENT chunk must never go ready → not-ready. Needs a per-chunk watch the fade census does not yet keep |
| `verify-fade` (5) Owens lock | Owens legitimately has nothing, so 0/0 passes whether or not the fade works | it is a LOCK, not a fade test — correct as written, but it proves absence of harm only |
| `verify-lod-fade` (3)(4)(5) | if the yaw sweep produces no tile events at all, "no reappears / no hard swaps" pass vacuously | (2) asserts `frames > 20 && appears + disappears > 0` first |
| `verify-lod-fade` (6) refetch | with `/__stats` reset and a short sweep, "0 refetched" can mean "nothing was fetched" | **CLOSED `9cba1b6`** — (6a) asserts ≥ 8 distinct tile URLs were fetched in the window first, and prints the denominator beside the numerator |
| `verify-step-clean` (2)–(5) | 0-of-0 with no step observed | already fixed: prints `NOT CALIBRATED`, non-zero exit, and (1) proves the ladder accepted a forced step |
| `verify-frame-pace` (3)(4) tear mechanism | if no resize happens in the window, "0 outside rAF" passes over nothing | **CLOSED `9cba1b6`** — (3a) prints ARMED with the resize count, or NOT CALIBRATED, and both tear legs carry the caveat inline when nothing resized |
| `verify-one-sun` clauses 1–5 | a null `dome`, a missing `hillMinDeg`, or `moonK === 0` SKIPs a clause; a run where every clause skips would print no failures | clause 0 (`live === true`) must pass first, and SKIPs are printed distinctly from PASSes — but the count of skips is not asserted |
| `verify-env-uniform` (1)(2) | `programsDelta === 0` passes if the dusk walk or the tier steps never happened | (3) asserts `stepsAccepted > 0`; the dusk walk has no equivalent check that the HDRI bucket actually changed |
| `verify-linear-haze` (2) | if the frame has no horizon, terrain and sky crops are the same band and Δ ≈ 0 passes | (1) asserts a real luma step at the found horizon row |
| `verify-flash-guard` (1a)(1b) | census over an empty scene | asserts `totalTris > 10000` |
| `verify-fixture` (6) Owens lock | passes if the world never loaded at all | the settle predicate now reports `settled` and WHY; (3) proves imagery/DEM/MVT were served |
| `verify-artifact-hygiene` (1) | passes if the glob matches nothing | (0) asserts the base commit resolves; the patterns are printed |
| `verify-import-integrity` (1) | passes if the target dirs are empty or unparsed | **CLOSED `9cba1b6`** — (1a) asserts ≥ 120 files linted (floor far under the real 200, so it catches a COLLAPSE, not growth) |

**Three of the four are now CLOSED** (`9cba1b6`): `verify-lod-fade` (6),
`verify-frame-pace` (3)(4) and `verify-import-integrity` (1) each assert their
denominator before reading their numerator. `verify-fade` (4) stays open, and
the audit was wrong about its fix — see the row.

### 2.10a THE FAILURE MODE THIS SECTION MISSED: a counter read by the wrong name

The audit above looks for gates that pass over an EMPTY population. The
`lod-fade` row exposed a second shape, and it is worse, because the gate prints
its own defect and passes anyway:

```
__flyTerra.lod(): refines NaN · merges NaN · parentRefetches NaN · replacedOnScreen 3
```

`tile-residency.js` publishes `{ refine, merge, refetchParent, replacedOnScreen }`
— **singular** — and my gate asked for the plural names. Three of four reads
were `undefined - 0 = NaN`. **NaN compares false against every threshold**, so
a gate built on `x > 0` goes silent exactly when it should shout, and one built
on `x === 0` fails for a reason that has nothing to do with the world. The
fourth name happened to match, which is why the line looked half-alive.

Two other reads in the same gate were wrong in the same family: `mem().estMB`
(the field is `residentMB`) and, worse, a PRECONDITION built on
`residentTiles`, which only moves when `TERRA_PACE.keepResident` is ON —
`terrain-engine.js` wraps `map.update` only in that arm — so flag-off it is 0
**by construction**. I read `residentTiles=0 estMB=undefined` as "the fixture
is too small". It was neither. The gate now does its own tile-tree census with
residency's own predicate (`isTile && model`), which reads the same in both
arms.

**The rule, for every gate in the fleet:** a counter read across an ownership
boundary must be read BY NAME with an existence check, and an absent name must
be a LOUD failure that prints the keys actually present. `verify-lod-fade` (1b)
now does exactly that. And a precondition must be readable in BOTH arms, or it
is not a precondition — it is the feature under test, asserted before it
exists.

---

## §3 Deviations, honestly

Every place a run differed from the written recipe, the way R19 §4.1 recorded
its trimmed sweep.

1. **Two harness-only scalers were added mid-round** (`FLY_FINALIZE_BUDGET_K`,
   `FLY_BOOT_SCALE`) and both are ON for the fixture runs in this sweep. Both
   are inert without the fixture env and both were sanctioned; §1.5 enumerates
   which gates may set which. Any fixture number below was taken with the K
   named in its row.
2. **The Manhattan fixture column is a FLOOR, not a settled figure.** At K=40
   with a 300 s cap, four of sixteen building chunks were resident; the settle
   predicate reported `settled=false — 12 chunks still draping`. The
   certification run re-takes it at K=200 with a 900 s cap. Do not compare a
   K=40 Manhattan row with a K=200 one.
3. **`draws` is `null` in the Powell row.** `__flyStats` republishes only every
   60 frames, and the fresh-publish wait expired inside the cap; the gate
   reports "totals stale" rather than printing the previous pose's number.
4. **Wall-clock numbers here are contended.** Five agents share four cores. The
   SAME Manhattan pose gave up at z11 of 14 after 427 s at load 15 and reached
   z16 in 300 s at load 5. Every settle time in this sweep carries its load
   average; no wall-clock number here is a budget.
5. **One certification row was VOIDED BY E.** A `ps | grep | kill` loop of mine
   matched Fable's `verify-fixture` row and killed it 62 s in
   (`Target page, context or browser has been closed at bootFly`). That `rc=1
   62s` is not a result. The rule that came out of it — kill only PIDs you
   spawned, never by pattern, never `fuser -k` on a port that is not yours —
   applies to every agent and is in `r24-e-cert.md` §5.
6. **`verify-seam` runs its NODE leg in the smoke with `FLY_URL` unset.** The
   smoke exports `FLY_URL` for the whole run, and `verify-seam.js:452` reads
   that as "also run the browser leg", which then `require`s playwright with no
   shim preload and dies AFTER nine green node gates. The browser leg is a
   separate row with the shim.
7. **`verify-frame-pace` and `verify-env-uniform` cannot be green on the
   flag-off tree by construction**: both read `__flyStats.frame`, which does
   not exist while `FRAME_STATS.enabled` is false. Their flag-off line
   ("instrument absent — unmeasurable, not a renderer failure") is the correct
   calibration output, not a failure to be fixed.
8. **FOUR BROWSER ROWS ARE VOID, AND THE MEASURED CAUSE IS A MODULE THAT
   COULD NOT EVALUATE.** `components/fly/AerialPerspective.jsx` used
   `ATMO_GLSL_DECL`, `ATMO_GLSL_FRAGMENT`, `AERIAL_LAW`, `atmoUniforms` and
   `getAtmoLaw` with no import — two of them inside a module-scope template
   literal — so the whole `components/fly` chunk threw
   `ReferenceError: ATMO_GLSL_DECL is not defined` at MODULE EVALUATION, in
   both styles. `app/page.js` mounts FlyMode through
   `dynamic(..., { ssr: false })` whose `loading` is one empty dark div, so the
   page sat there in silence: **zero canvas elements, `__flyBoot` undefined, no
   error visible to a gate.** Two more of the same class were in the same tree
   (`CloudField.jsx` calling an unimported `pinned()`, `FlyScene.jsx` calling an
   unimported `offsetUnits()`), all three on the branches rather than in the
   merges. Fixed on `8b68ae5`; `scripts/verify-import-integrity.mjs` now
   calibrates RED on `bf319ca` and GREEN on `8b68ae5`, and runs FIRST in both
   the smoke and the certification script.

   Two of the void rows had a second, independent cause of their own, both
   mine, and neither is the demonstrated cause of anything:
   - the first run's `fixture` row (`rc=1 62s`) was killed by my
     process-pattern kill;
   - my pale-detector probe raced three for the canvas context — a real latent
     race, fixed at `cbd7c8a`, **not** the demonstrated cause of the 601 s
     `flash-guard` timeout.

   **Fixing the right bug and explaining the wrong failure are different acts.**
   I reported the `getContext` race as the cause of a timeout whose evidence —
   zero canvas, no `__flyBoot`, at 140 s — is upstream of any canvas, so the
   race could not have produced it. The cost of that conflation is someone
   else's re-run, and the correction belongs in the record beside the fix.

9. **`verify-depth-roundtrip` needs a hook that may not exist yet.** It refuses
   to reconstruct viewZ with harness-side arithmetic — that would test the
   harness's copy of the bug — and instead fails loudly with the required
   signature `window.__flyDepthProbe(x, y) → { viewZ, coc, raw, reversed }`.
   If C has not published it, the row reads NOT RUNNABLE, not RED.

## §4 Verdict

*(Fable fills this at close. The honest shape it must take, given this venue:)*

- **What this container certified:** every structural, count, census,
  determinism, source-scan, byte-identity and fixed-pose claim — 15 node gates
  green on the integrated tree, the worker's output byte-identical across five
  merges on 149 fixture tiles, the Owens lock and the Melton carpet reproduced,
  and the flag-off RED calibrated for each new gate.
- **NOT EXERCISED (not the same as green):** the **toy-world** site of
  `FLASH_GUARD`. Both `verify-flash-guard` poses boot satellite, so no toy
  chunk was resident and its census read 0/0/0 for absence, not for health. The
  toy extruder carries the same wrap-around loop as the satellite one
  (`vector-tile.worker.js:4285`). Fable's ruling: no toy leg this round,
  because calibrating a new gate under load at the close is how R20 §5
  happened. It must appear in B's ship row as NOT EXERCISED.
- **INSURANCE, not a repair:** the **skyline** site. Measured zero degenerates
  over 83,752 triangles before any fix, because `simplifyRing` already removes
  the closing clone (and a genuine corner with it). A green there repaired
  nothing.
- **What it did not, and could not:** every fps, frame-time, stall, governor,
  tearing and driver claim, and the LOOK of anything on a real GPU over real
  Esri and OpenFreeMap bytes. Those are §2's user-machine list, and until the
  user runs it the round has no performance verdict at all — only a structural
  one.
- **The round's real RED is still pending**: `scripts/r24-user-diag.md` Part A
  on the CURRENT build, before any flag flips. Without it there is no before,
  and "smoother" is an opinion.

---

## §5 THE PER-LEG RECORD — every browser row, both passes, gate by gate

**Fable's ruling (2026-09-06): this section is the canonical home for every
browser row.** `FLY_ROUND24.md` §4 carries ONE line per gate and cites the
subsection here; the numbers themselves live only in this file, transcribed
from the run logs in `scripts/r24-out/cert/` rather than summarised. §1.2 and
§1.3 stay as the two-column INDEX — the shape of the round at a glance — and
every cell there points into a subsection below.

**How to read a leg.** Each subsection carries the two passes as separate
blocks, because they mean opposite things (§1.2's preamble):

- **PASS 1 — FLAG-OFF.** The R24 constants blocks are `enabled:false`. A
  new gate passes here when its defect REPRODUCES WITH A NUMBER, which usually
  means `rc != 0` on purpose; an inherited gate passes here by IDENTITY, its
  frozen number unmoved.
- **PASS 2 — FLIPPED.** The ship table's flags are on. The defect leg reads its
  target and every other leg of the same gate stays green.

**Three verdicts, not two.** `PASS` / `FAIL` / **`NOTCAL`**. NOT CALIBRATED
(`scripts/_notcal.js`) means the leg could not measure: an operand was absent,
a precondition failed, a population was empty. It is not a pass and not a
failure of the thing under test, it counts toward a non-zero exit, and it is
recorded here verbatim — a leg that measured nothing must never be summarised
as a green. Two further row-level verdicts appear below and are distinct from
RED:

- **VOID** — the instrument, not the world, produced the reading (the pass-1
  `linear-haze` black frame).
- **NOT RUNNABLE** — a handle the gate depends on does not exist yet, so
  nothing was measured in either direction (the pass-1 `depth-rt` row).

### 5.0 Citation index

| Leg | Subsection | Owner of the feature | Pass 1 | Pass 2 |
|---|---|---|---|---|
| `verify-fixture` | §5.1 | E (the venue itself) | **10/10** | **9/1** — all four settled; the red is the toy byteLength |
| `verify-flash-guard` | §5.2 | B (`FLASH_GUARD`) | **RED, 5/1** | **2c GREEN 8/0** — 8.32 % → 0.00 %, both legs settled |
| `verify-fade` | §5.3 | B (`CHUNK_FADE`) | **RED, 4/2** | 2b **VOID** (probe blind), re-take pending |
| `verify-lod-fade` | §5.4 | D (`LOD_CROSSFADE`) + A (streamer) | **RED, 2/5** | pending |
| `verify-step-clean` | §5.5 | A (`STEP_SAFE`) | **RED, 4/4** | pending |
| `verify-ladder-fix` | §5.6 | A (`PERF_LADDER`) | **RED arm 7/6** | **GREEN 13/13** |
| `verify-one-sun` | §5.7 | C (`ONE_SUN`) | **RED, 20/7** | pending |
| `verify-linear-haze` | §5.8 | C/D (colour space) | **VOID — instrument** | pending |
| `verify-depth-roundtrip` | §5.9 | C (`DEPTH_FIX`) | **NOT RUNNABLE** | pending |
| `verify-terra-live` | §5.10 | A (`TERRA_PACE`) | **8/1 — leg 6 FAIL** | pending |
| `verify-frame-pace` | §5.11 | E (`FRAME_STATS`) | **instrument absent** | **5/0/1 NOTCAL** — instrument live, tear legs uncalibrated |
| `verify-env-uniform` | §5.12 | C (`ENV_UNIFORM`) | pending | pending |
| `verify-shadow-calm` | §5.13 | C (`SHADOW_CALM`) | **GREEN node-side 32/32** | pixels UM |

---

### 5.1 `verify-fixture` — the venue certifies itself

**PASS 1 (flag-off).** `10 passed, 0 failed`. Four poses settled; the table,
the boot times and what each row certifies are in §1.4 and are not repeated
here. This gate has no RED: it is the only one whose job is to prove the
instrument, not the world.

**Re-run at `FK` with a 900 s per-pose cap — Manhattan finally settles.** The
§1.4 table's Manhattan row was a FLOOR (four of sixteen chunks still resident at
300 s / K=40); at the higher budget it settles in **256 s** at **189 draws /
496,466 tris / sb 16 of 16**. Powell and Melton settle in **200 s**. **Owens
settles in 38 s at 166 draws / 183,709 tris, sb ready 0 / empty 16** — the lock,
and still the cheapest trustworthy column this venue produces. Toy leg to
follow; §1.4 is superseded by these numbers where they differ.

**PASS 2b: 9 passed, 1 failed — ALL FOUR POSES SETTLED, and the one red is not
this gate's.** rc 1, 1,464 s, K=200 with the 900 s per-pose cap. Satellite boot
**122.2 s** (`pct 100` at 53.4 s); toy boot **130.2 s**; fixture served img 625
/ dem 810 / mvt 442 / tilejson 27 / aircraft 145 / weather 5.

| Pose | draws | tris | meshes | satBldg | skyline | parcel | toyChunk | `sb` | settled | maxZ | ground |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Manhattan | 233 | 549,471 | 259 | **23** | 10 | 0 | 152 | 16/16 ready | **287 s** | 14 | 14.8 m |
| Powell | 288 | 662,426 | 318 | **16** | 0 | **555** | 230 | 16/16 ready | **238 s** | 16 | 276.3 m |
| **Owens** | **219** | 266,720 | 310 | **0** | **0** | **0** | 254 | **16 empty** | **45 s** | 17 | 1114.6 m |
| Melton | 81 | 193,342 | 88 | 0 | 0 | **1,836** | 21 | 16 empty | **29 s** | 17 | 0.0 m |
| toy / Powell | 112 | 375,424 | 598 | — | — | — | **302** | — | — | — | — |

**Every pose settled for the first time**, Manhattan included — the row that was
a FLOOR in §1.4 (four of sixteen chunks still resident at 300 s / K=40) now
resolves all sixteen in 287 s. The Owens lock holds at **0 / 0 / 0** in 45 s,
Melton still places 1,836 homes from zero footprints, and traffic reaches the
engine (300 tracks, 53 requests).

**(10) is the only red, and it is the toy `byteLength` throw** — A's
`FINALIZE_PACE` `setIndex(new Uint32Array(…))`, the same defect the two ladder
rows found, on the same `ec53fd3` tree that predates A's fix. Not a venue defect
and not this gate's: the fixture served every byte the toy pipeline asked for,
and 302 chunks finalised before the upload threw.

**PASS 2c (re-take).** *pending* — re-run and diff this table. The Owens row is
the one to read first, and (10) should be clean on `9bcaace`, where
`r24-b-attr-proof.js` already reads `BROKEN=0` in node.

---

### 5.2 `verify-flash-guard` — the one-frame white flash (A1)

**PASS 1 (flag-off).** `5 passed, 1 failed`, **rc 1 by design**.

| Leg | Verdict | Number |
|---|---|---|
| (1a) census has something to count, Powell | PASS | 31,576 tris over 3 meshes |
| (1b) census has something to count, Manhattan | PASS | 126,116 tris over 14 meshes |
| (2) RED CALIBRATION — the zero-area population EXISTS | PASS | **Powell 2,616 (8.28 %)**, worst chunk 8.34 %; **Manhattan 5,820 (4.61 %)**, worst chunk **13.98 %**; both `coincident=true` |
| (3) GREEN — exactly 0 with the guard armed | **FAIL (intended)** | 1,744 of 20,935 |
| (5) triangle count only ever falls | PASS | (see caveat) |
| (6) no page errors | PASS | clean |

**Powell's 8.28 % sits inside R22.1's live 6.36–8.64 % band**, which is what
makes the offline fixture a legitimate stand-in for this defect.

**Two sites are NOT EXERCISED here**, and the row must not be read as covering
them: `sat-skyline` measured **0 of 83,752** — `simplifyRing` already drops the
closing clone, so FLASH_GUARD at that site is insurance, not a repair — and
`toy-world` measured **0 of 0** because no toy leg runs this round.

**Instrument caveat (§2.9).** This log is the PRE-FIX instrument. Its
`(4) PALE DETECTOR` line (`pale=168 of 256`, every hit a mean of exactly 212.9)
is the false positive later diagnosed as the detector reading the SKY, and its
trailing `flagOn(probe)=true` reported an absent runtime pin as "the flag is
on". Both are fixed (`8ca7bdf`, `ff5d9a1`); the census numbers above are
untouched by either fix and stand.

**PASS 2 (attempt 1, integration `91141fe`): VOID — VENUE STARVATION, not a
reading.** `3 passed, 4 failed`, rc 1, 542 s.

The census found **0 meshes / 0 triangles at BOTH poses** — sat-buildings,
sat-skyline and toy-world all empty, where pass 1 at the same K=40 resolved
Powell 3 meshes / 31,576 tris and Manhattan 14 meshes / 126,116 tris.

| Leg | Verdict | Number |
|---|---|---|
| (1a) census has something to count, Powell | **FAIL** | tris **0** across **0** meshes |
| (1b) census has something to count, Manhattan | **FAIL** | tris **0** across **0** meshes |
| (2) RED calibration — the population exists | **FAIL** | **0** zero-area (0.00 %) |
| (3) GREEN — exactly 0 with the guard armed | "PASS" — **on an empty census** | `zero=0 tris=0` |
| (4a) no false positive | **FAIL** | 8 in 290 frames (see below) |
| (4b) the detector fires | PASS | exactly 1 from `__paleSelfTest()` |
| (5) triangle count only ever falls | **NOT CALIBRATED** | one leg resolved no triangles |
| (6) no page errors | PASS | clean |

`FLASH_GUARD telemetry: {"telemetry":null,"runtimePin":null}` — the module
published nothing, because no builder ever ran.

**(3) is the shape this whole ledger exists to catch.** "Zero-area count is
exactly 0" is trivially true of a world with no triangles in it, and on its own
it reads as the round's headline fix landing. Only (1a)/(1b) — the census
preconditions added because §2.10 asked what an empty population would do —
stop it being reported as a green. Had those legs not existed, this run would
have produced a PASS line for the A1 fix on a scene that contained no buildings.

**MECHANISM** (A, from `lib/fly/finalize-pace.js:74-79`): `mayFinalize(done)`
with `done === 0` returned `lastDtMs <= FINALIZE_PACE.longFrameMs` (24 ms).
Every SwiftShader frame here is 300–1000 ms, so **the first finalize of every
frame was refused** and no sat-building chunk ever became ready. `budgetK()`
scales the COUNT budget (`S.finalizePerFrame * budgetK()`), but that wall-clock
rule sits in front of it at `sat-building-engine.js:1362`, so the scaler never
got a say. Every content row in the pass — flash-guard, fade, lod-fade,
terra-live's poses, fixture — would have starved identically. Not a product
regression and not a harness bug: a venue property that the flag-off tree
happened not to expose.

Fixed in integration `3d388ec`: rule 1 is now a SPIKE test (frame >
`longFrameMs` **and** > `spikeK` 2 × the EMA of the frames before it) with a
`maxRefuseFrames` 3 cap, so a steady venue makes it a no-op by construction and
rule 1 needs no harness seam at all. Cold-seed note for reading pass 2b: the
EMA seeds at 24 ms, so this venue refuses ~6 of its first 40 frames (worst run
3) and then never again — comfortably inside every settle.

**(4a)'s 8 hits were the detector, not the world.** The hits came in
CONSECUTIVE pairs at identical levels — `f:141` and `f:142` both mean 222.1 /
med 145.5; `f:229` and `f:230` both 240.8 / 153.8. Two adjacent frames at the
same level are a sustained bright FIELD, not a one-frame flash, which is a
different picture with a different cause. The detector now counts a candidate
only when its run length is exactly 1, and reports longer runs separately as
`sustained`. Replayed against this run's own pattern: **8 → 0 isolated, 2
sustained runs**, while the self-test's single white frame still scores exactly
1 (so (4b) is unmoved). Note the naive form of the rule — "the previous frame
was not a candidate" — still admits the LAST frame of every run; only run
length works.

**PASS 2b (attempt 2, integration `ec53fd3`): CENSUS PROVEN · GREEN LEG VOID ·
SELF-TEST RED.** `6 passed, 1 failed`, rc 1, 571 s.

**The census is alive again, and it reproduces pass 1 EXACTLY** — which is the
cleanest possible confirmation of A's rule-1 fix, because the same instrument
that read 0 meshes in 2a now reads pass 1's numbers to the triangle:

| | Powell | Manhattan |
|---|---|---|
| meshes / tris | **3 / 31,576** | **14 / 126,116** |
| zero-area | **2,616 (8.28 %)**, worst chunk 8.34 % | **5,820 (4.61 %)**, worst chunk 13.98 % |
| identical to pass 1? | **yes, to the triangle** | **yes** |

(1a) and (1b) PASS. (2) RED PASS. Sat-skyline is still 0 / 83,752 and toy 0 / 0
— **NOT EXERCISED**, unchanged.

**But (3) passed on an empty census for the SECOND time**: the green leg read
`powell (no pin): 0 meshes, 0 tris`, (5) read NOT CALIBRATED, and
`FLASH_GUARD telemetry: {"telemetry":null,"runtimePin":null}`. **FLASH_GUARD's
green is still unmeasured.** `FLASH_GUARD.enabled` IS `true` on this tree, so
this is not a flag-state question.

**MECHANISM — page starvation, and it is the gate's fault.** The gate never
closed page 1 before `context.newPage()`, so the green leg booted while the RED
page was still alive and rendering: two pages of the same app sharing four
cores at ~1 fps are not two independent measurements, they are one measurement
and its handicap. Pass 1's green leg scraped **2 meshes / 20,935 tris** —
marginal, and it passed unnoticed. On the flipped tree, with more work per
frame, it settled **none**. Fixed: page 1 is closed (its rAF chain stopped on
purpose, not torn down mid-read) before page 2 is created, and **both legs now
settle on `_settle.js`'s CONDITION under a cap instead of a fixed 60 s**, with
the settle time and reason printed.

**(4a) reads correctly and the isolation rule works.** `0 isolated in 266
frames`, with **3 sustained runs recorded separately** — `107–111` (len 5),
`221–226` (len 6), `240–241` (len 2), means 214–238 against medians 140–173.
Those are the sky at the scanline, exactly the false positive the rule was
written for, and they are now visible as fields rather than counted as flashes.

**(4b) went RED — my own rule broke my own self-test, and the self-test caught
it.** `0 hits from __paleSelfTest()`. Two independent causes, both real:

1. **The run only closes on the next NON-candidate frame**, and the gate read
   the counter in the same round trip that armed the test — at ~1 fps that race
   is lost more often than won.
2. **The synthetic frame can land adjacent to a real sustained run** (this venue
   produced one at 240–241) and be absorbed into it, so (4b) would fail for a
   reason with nothing to do with the detector.

The harness's own frame is now accounted **apart** from the world's run
bookkeeping: the open run is closed under the normal rule, the synthetic frame
is scored on its own counter, the bookkeeping restarts clean, and the gate
**waits for `selfDone`** rather than for a duration. Replayed against this run's
own shape — self-test immediately after a sustained pair, read with no trailing
frame — it now scores exactly 1, while a self-test that genuinely read no pale
frame still scores 0 and fails.

**The row is RE-TAKEN STANDALONE after pass 2b's end line, on the same tree.**
That re-run, not this one, decides FLASH_GUARD's green.

---

#### PASS 2c (re-take, integration `9bcaace`): **8 passed, 0 failed, rc 0** — FLASH_GUARD's first real green

Three passes, three different reasons the row meant nothing. This is the first
in which **every leg measured something**.

| | pin off (RED leg) | armed (GREEN leg) |
|---|---|---|
| Powell settle | **SETTLED 422 s**, 16/16 ready, maxZ 17 | **SETTLED 274 s**, 16/16 ready, maxZ 17 |
| meshes / tris | 16 / 165,520 | 16 / **151,754** |
| zero-area | **13,766 = 8.32 %** (worst chunk 8.45 %, `coincident=true`) | **0 = 0.00 %** |

**(3) is a verdict rather than a green over an empty scene.** 2a and 2b both
printed `zero=0 tris=0` and passed; this reads `zero=0 tris=151,754`. Powell's
8.32 % is still inside R22.1's live **6.36–8.64 %** band, so the fixture is
standing in for the real defect.

**(5) is deliberately a RATIO — 8.32 % → 0.00 %.** The two legs are separate
boots that settle different chunk counts, so absolute totals across them are not
comparable; the degenerate RATE is. A degenerate contributes nothing to
`computeVertexNormals`, so its removal is provably shading-neutral.

**Both instrument fixes proved out.** Closing page 1 before the armed leg boots
is what let the green leg settle at all (274 s, against starving to zero while
page 1 rendered). And **(4b) reads exactly 1** —
`{"f":670,"mean":255,"med":20.2,"cand":true}` — after reading **0** in 2b when
my own isolation rule swallowed the synthetic frame; scoring it outside the
run-length bookkeeping fixed it. **(4a): 0 isolated in 668 frames, 0 sustained**
(2b had 3 sustained runs) because the baseline here is **20.2**, a genuinely
dark ground scene, rather than 2b's 237.8 sky at the scanline.

**Two caveats, not smoothed over:**

1. **Manhattan did NOT settle** — 12 of 16 chunks still draping at 420 s,
   `ready 4`, maxZ 16. Its census (6 sat-building meshes / 87,680 tris / worst
   chunk **13.97 %**) is a **FLOOR**, and (1b) passing means only that the
   census had something to count. **The Powell pair is where the A/B lives**;
   Manhattan corroborates at best.
2. **`FLASH_GUARD telemetry: null`.** The gate's note is right that the runtime
   pin and the constant are different switches — but it means (3)'s green rests
   on the census rather than on the feature announcing itself. Worth B
   publishing something.

1,423 s, and the settles are both what cost it and what made it valid.

---

### 5.3 `verify-fade` — chunk birth and death (WB-2)

**PASS 1 (flag-off).** `4 passed, 2 failed`, **rc 1 by design**. Serpentine of
94 frames; births 14 (HARD 14), deaths 10 (HARD 10); **presence channel =
`none`** — no material carries a fade uniform or transparent opacity, which IS
the flag-off state.

| Leg | Verdict | Number |
|---|---|---|
| (1) the watch has something to watch | PASS | births 14, deaths 10 over 94 frames |
| (2) NO HARD BIRTH | **FAIL (intended)** | **14 of 14 hard** |
| (3) NO HARD DEATH | **FAIL (intended)** | **10 of 10 hard** |
| (4) a fade never changes what is ready | PASS | ready 0 of 16 chunks; series printed |
| (5) THE OWENS LOCK | PASS | sbReady 0 · skyReady 0 · draws 156 |
| (6) no page errors | PASS | clean |

`readySeries` (every 5th frame, `[sb, skyline]`):
`[[2,0],[2,0],[2,0],[3,0],[3,0],[3,0],[3,0],[3,0],[3,0],[3,0],[3,0],[4,0],[0,0],[0,1],[0,3],[0,4],[0,6],[0,8]]`
— note the legitimate fall from 4 to 0 when the run leaves the ring, which is
why "ready never falls" is NOT the invariant (§2.10).

Since this run, (4) requires finite readings and (5) no longer coerces `?? 0`:
an absent ready count would have certified the Owens lock on no data.

**PASS 2b (integration `ec53fd3`): VOID — THE PROBE WAS BLIND TO THE CHANNEL.**
`4 passed, 2 failed`, rc 1, 346 s. Serpentine 122 frames, births 29 (HARD 29),
deaths 20 (HARD 20), `presence channel = none`, evictions 40, **heals 9**.

**`CHUNK_FADE.enabled` is `true` on this tree** — B shipped it, with an engine
proof of single-frame pops **92 → 2** over a 2,700-frame serpentine, both
residuals attributable to `fadeBudgetMiss`. So 29/29 hard is not a product
reading. The mismatch is the probe's, arbitrated from both sides at `ec53fd3`:

| | file:line | what it does |
|---|---|---|
| **my probe** | `verify-fade.js:81-95` | reads `material.userData.shader.uniforms` / `material.uniforms` for four **guessed** names (`uBirth`, `uChunkFade`, `uFade`, `uChunkBirth`), then `transparent` + `opacity`, then `'none'` → presence 1 |
| **B's fade** | `chunk-fade.js:98-102` | publishes the pooled twin's uniform at **`material.userData.__fadeU`**, explicitly "so a probe can read the EFFECTIVE per-mesh alpha the GPU will see" |

The GLSL uniforms behind it are `uSatBldgFade` / `uSkyFade`, injected through
`applyBendAnchor*`'s `onBeforeCompile` — so they are **not** `material.uniforms`
entries and the guessed names could never have found them. Both engines build
twins through the one pool (`sat-building-engine.js:345`,
`sat-skyline-engine.js:167`), and the twin is swapped onto the mesh at `:848`
(birth) and `:874` (death), so the census was looking at the right object and
the wrong property. Same family as the lod-fade NaN, §2.10a.

**A SECOND defect, which the first fix would not have cured.** The channel label
used `??=` — first-write-wins. B's twin is on a mesh **only during a ramp**: on
birth completion `b.mesh.material = this.material` and the twin returns to the
pool; dying meshes leave the scene. A resident chunk **at rest therefore has no
`__fadeU`**, and that is the correct steady state, not a missing instrument. The
first mesh sampled is almost always one at rest, so the label would have latched
to `'none'` for the whole run **even after reading `__fadeU` correctly**. The
label is now the most specific channel seen anywhere in the run; self-test (5c)
is that exact sequence.

**What the re-take should show, per B:**

- **(2) births → SOFT.** `_startBirth` writes `value 0` in the same synchronous
  block as `object.add` (`:847`), so the first displayed frame is presence 0.
- **(3) deaths are HARD BY CONSTRUCTION HERE, whatever the feature does.**
  `_startDeath` writes `value = _altFade` (1.0 at these poses, `:873`) and the
  value only moves on the **next** `_stepFades`; at ~2.84 s per rendered frame a
  0.3 s `evictSec` ramp cannot span two samples. B's fix is a frame-count floor
  — `progress = min(elapsed/sec, framesSince/CHUNK_FADE.minFrames)`, `minFrames`
  3 — so a ramp spans ≥ 3 partial samples at any frame rate while `elapsed`
  still governs at 60 fps. The gate prints this as a venue note rather than
  letting the number read as a defect.
- **(3) is read against the CAP, not against 0.** `maxDying` is 4, and both the
  eviction loop (`:1077`) and the AGL cull (`:1020`) can present more at once;
  every refusal is counted as `fadeBudgetMiss` (`:857`). B's own rule, now
  applied and printed: `hardDeaths ≤ fadeBudgetMiss` = capped as designed;
  `hardDeaths > fadeBudgetMiss` = the unexplained remainder that is the defect.

**B's ramp floor is committed (`r24/b 45e2cde`)** — `progress = min(elapsed/sec,
framesSince/minFrames)` through `rampT`, in both engines and both ramps, with
**`minFrames` 4, not 3**. Births and deaths do not give the same sample count
and the gate now says so: **a birth starts at 0, so N frames give N partial
samples; a death starts at FULL presence, so N frames give N−1.** The venue
should therefore show deaths spanning **≥ 3** partial samples, not ≥ 4. At 60 Hz
a 0.3 s ramp is 18 frames, far above the floor, so `elapsed` still governs and
the shipped look is unchanged. B's proof rows: dt 2.84 s → **pops 0** (was 92
flag-off); dt 16.7 ms → 4 pops, **all `fadeBudgetMiss`**; a 500 ms hitch
mid-ramp cannot complete a ramp; `--off` → 92 pops **byte-identical**.

**HEAL_IN_PLACE: the heal TOTAL is not the hole count.** B's engine now counts
every outcome exhaustively, with equality asserted in B's own gate, and only one
of them is a hole:

| Outcome | Is it a hole? |
|---|---|
| `healsInPlace` | no — the drape landed on the resident mesh; this IS the fix |
| `healsNoop` | no — nothing to do |
| **`healsQueueFull`** | **YES — the budget was spent. The only hole.** |
| `healsAborted` | no — the chunk was evicted under the job: **moot, no chunk no hole** |
| `healsNoRecord` | no — water-only |
| `healsCoalesced` | no — a re-drape for that key was already in flight |
| `redraping` | no — still draining |

So a residual heal hole in any browser row is read against **`healsQueueFull`
only**. Reading it against `heals` would indict four outcomes working exactly as
designed — the same mistake shape as counting a sustained field as a flash, or
an absent `__fadeU` as a missing instrument. This row's `heals 9` is, on its
own, uninterpretable; the re-take prints the full taxonomy.

**Expected re-take reading on this venue:** births **29/29 SOFT**, deaths
spanning **≥ 3 partial samples**, hard deaths **≤ `fadeBudgetMiss`**.

**The legs that did read correctly** — a VOID row is not a worthless row: (1)
the watch had 29 births / 20 deaths to watch; (4) ready 4 of 16, series
`[[5,0]…[7,0],[0,0],[0,1]…[3,10]]`; **(5) the Owens lock held — sbReady 0 /
skyReady 0 / draws 190** (up from 156 flag-off, still far under the live 261
ceiling); (6) clean.

**The probe now has its own RED** (`FADE_PROBE_SELFTEST=1`, 7/7): it extracts
the REAL `presenceOf` from this file's own source — not a copy, so it cannot
drift — and asserts a shared material still reads `none`/1, which keeps pass 1's
14/14 and this run's 29/29 exactly reproducible on a flag-off tree.

**PASS 2c (standalone re-take).** *pending* — with `flash-guard`, after B's
`minFrames` merge.

---

### 5.4 `verify-lod-fade` — tiles swapping for other tiles (T1/T3/T4)

**PASS 1 (flag-off).** `2 passed, 5 failed`, **rc 1 by design**, 317 s.

| Leg | Verdict | Number |
|---|---|---|
| (1) fixture produces a real resident tile field | FAIL — **instrument, not world** | `residentTiles=0 estMB=undefined` |
| (2) the census has something to count | PASS | 47 frames, 61 events |
| (3) NO TILE LEAVES AND COMES BACK ON A PURE YAW | **FAIL (intended)** | **27 re-appearances** |
| (4) NO HARD LOD SWAP | **FAIL (intended)** | **8 hard refines + 3 hard merges** |
| (5) a parent-retained crossfade window exists | **FAIL** | longest co-display run **0** |
| (6) no unbounded tile refetch | **FAIL (intended)** | **15 URLs refetched**, worst 2× `/img/6/23/17` |
| (7) Owens draw column | INFO | **174 draws / 166,659 tris** (fixture) |
| (8) no page errors | PASS | clean |

Sweep detail: 35 appearances / 26 disappearances over 47 frames, position
frozen. **(3) is A's T1/T3 measured directly** — the camera never moved, so
anything that came back left because it was culled.

**(1) and the NaN line are MY defect, not the world's** (§2.10a): A's counters
are singular (`refine`/`merge`/`refetchParent`) and I read plurals, so
`__flyTerra.lod()` printed `refines NaN · merges NaN · parentRefetches NaN ·
replacedOnScreen 3`; `mem().estMB` does not exist (it is `residentMB`); and
`residentTiles` only moves when `TERRA_PACE.keepResident` is on, so 0 was
correct and my precondition was not. Fixed in `9cba1b6`.

**(5) is not a criterion this flag moves.** `mode: 'parentBlend'` blends the
parent's TEXTURE into the child and disposes the parent model as before — it
deliberately never co-displays. The ON leg recomputes (5) only to say so.

**PASS 2b (integration `ec53fd3`): THE ON LEG PROVED THE REFINE PATH, THEN THE
GATE CRASHED.** rc 1, 860 s, ending at
`ReferenceError: notCalibrated is not defined` — gate (14)'s NOT CALIBRATED
path calling a helper the file never imported. The require was written in the
same batch as the other seven gates, but that one replace had **no assert** and
matched nothing. Seven files had it; this one did not.

**What the ON leg produced before it died — D reads this as the refine path
PROVEN:**

| | OFF arm | ON arm |
|---|---|---|
| `refines` / `merges` | 4 / 0 | 4 / 0 |
| `hardSwaps` | **4** | **0** |
| `faded` | **0** | **4** |
| `skip.*` | `disabled 4` | **all seven 0** |
| ladder identity | 4 = 4+0 ✓ | 4 = 0+4 ✓ |

`skip.disabled 0` proves the pin reached the ladder; `skip.unpatched 0` proves it
reached it **before the materials were patched**. Warp settle steady at 3 after
17 frames; `peakActive` 8 of 32; Owens 229 draws (OFF, fixture).

**(3) went 27 → 0 re-appearances on a pure yaw** — A's residency trio, measured
by this instrument. D's crossfade baseline is therefore **4 hard refines, not
20**.

**Three things in that row were the instrument, not the world:**

1. **`active 8 / retained 2` is not a leak and not stuck.** `waitUntil` returned
   *held*, so `active === 0` **was** observed; `retained` counts distinct parent
   TEXTURES while `active` counts MATERIALS, and a refine arms four children off
   one parent — 8/2 is exactly **two refine events in flight**, a 4:1 ratio no
   stuck set lands on by coincidence. The yaw interval keeps pinning the final
   heading, so the camera stops but the streamer does not, and each round trip
   is several rendered frames.
2. **(6)'s 20-of-59 refetch was my yaw step.** `START_YAW` swept `h0 + u·4π`
   over 40 wall-clock seconds — **~51° of heading between displayed frames** at
   this venue, precisely A's measured refetch regime (51°/frame → 28,
   0.85°/frame → 0). (3) was the same experiment.
3. **(5) asserted a mechanism D did not build.** `parentBlend` blends the parent
   TEXTURE into the child material via clip-UV and disposes the parent model
   exactly as upstream does, so a mesh co-display census reads **0 by
   construction forever** — and its 0 was being written into the RED table as a
   defect measurement.

**Fixed for the re-take** (`cba7b45`, `356e32d`, `1187c47`, `b5a638a`): the yaw
is per RENDERED frame at 0.85°/frame with a 360° minimum arc and
`FLY_LOD_SWEEP_MS`; (3)/(6) read NOT CALIBRATED on a short arc; the drain
returns **the snapshot that satisfied it**; a second read 12 frames later
attributes a non-zero `active` to arrivals or calls it stuck; the leak signature
is asserted on both reads as `active === 0 && retained > 0`; the free invariant
`retained ≤ active ≤ 4 × retained` runs where the active set is non-empty; and
(5) is replaced by D's handle — `terra.fades.active` sampled per frame, giving
`maxBlendRun`, the crossfade window.

**(14)'s ±25 % comparability guard would have fired on this run** — 46 vs 26
frames, ratio 0.57. The refines matching at 4 was luck, not control.

**PASS 2c (standalone re-take).** *pending* — the ON leg (gates 9–19) as of
`9cba1b6`/`f7fe5f2`: `refines+merges === hardSwaps+faded` on both arms,
`refines+merges` flat within ±25 % frame-count tolerance, `faded` rises /
`hardSwaps` drops, `active === 0 && retained === 0` by poll, `0 < peakActive ≤ 32`,
`skip.{shape,noParentMap,unpatched}` each 0, Owens draws AND tris equal
174 / 166,659 with both arms settled through `_settle.js`.

---

### 5.5 `verify-step-clean` — the DPR-step tear mechanism (A3)

**PASS 1 (flag-off).** `4 passed, 4 failed`, **rc 1 by design — the round's
cleanest RED**, because its calibration leg is unambiguous.

| Leg | Verdict | Number |
|---|---|---|
| (0) the pin is released | PASS | fleet attempted `hold`, live pin null, `__flyGov` object, DPR 1.5 |
| (1) THE RELEASED TERM IS REACHABLE | PASS | **6 of 6 forced steps accepted**, 6 DPR applications, dprs seen [1.25, 1.5] |
| (2) every canvas width/height write inside a rAF | **FAIL (intended)** | **18 of 18 outside** |
| (3) every setPixelRatio / setSize inside a rAF | **FAIL (intended)** | setPixelRatio **6/6**, setSize **12/12** outside |
| (3b) every composer.setSize inside a rAF | **FAIL (intended)** | **6/6 outside** |
| (4) bufferMatchesDrawing never false | **FAIL (intended)** | **22 of 46 frames**, e.g. composer [1920,1080] vs drawing buffer [1600,900] |
| (5) composer resized, not rebuilt | PASS | rebuilds 1 → 1 over 6 resizes |
| (6) no page errors | PASS | clean |

(1) is what makes the rest mean something: the ladder demonstrably took six
steps, so none of the four failures is a 0-of-0. **Not measurable here: the
tear LINE** — that is a compositor/vsync property, user-machine only, and a
phone camera beats a software recorder because a recorder composites.

**PASS 2b (integration `ec53fd3`): HALF THE WRITES MOVED INSIDE THE FRAME.**
`4 passed, 4 failed`, rc 1, 241 s — and the shape of the remainder is what
attributed it.

| Leg | Pass 1 (flag-off) | Pass 2b |
|---|---|---|
| (2) canvas width/height outside a rAF | **18 of 18** | **12 of 30** |
| (3) `setPixelRatio` outside | 6 of 6 | **6 of 12** |
| (3) `setSize` outside | 12 of 12 | **12 of 24** |

**The totals DOUBLED while the outside count stayed flat** — 6 → 12
`setPixelRatio`, 12 → 24 `setSize`, with exactly half outside in each case.
That is not a partial fix; it is a **double apply**, and A attributed it from
source: the rig applies inside the frame, its React `setDpr` schedules a commit,
r3f's `Canvas` layout effect runs an awaited `root.configure({dpr})`, and r3f's
zustand subscriber re-applies `gl.setPixelRatio` + `gl.setSize` **outside any
frame**. Six rig + six r3f.

A's fix is `installResizeGuard` (`r24/a a0c1484`): a resize request for the
state the renderer is already in never reaches the canvas, with
`window.__flyStats.stepGuard` counting suppressions, plus a new
`verify-step-guard.mjs` (13/13, standing RED control). **A says this gate needs
no change** — (2)/(3) failed honestly and the guard makes them true — and
expects (2) 0 of ~18, (3) 0 of 6 / 0 of 12, **with the totals falling** as the
redundant calls stop.

The gate gains one leg for the re-take, in A's own safest form: **(7) exactly
one application per governor step, inside the frame** — per accepted step,
`step.n` +1 **and** zero writes outside a rAF **and** `stepGuard` strictly
increased. Not the obvious assertion, because `stepGuard` counts SUPPRESSED
calls, is cumulative for the page's life, and counts redundant in-frame calls
too, so `suppressed == outside-writes` is not a safe equality; and ABSENT is
ambiguous unless paired with `step.n`. The expected totals drop is printed, not
failed on.

**PASS 2c (standalone re-take).** *pending* — all four failing legs to 0 with
(1) still showing accepted steps > 0, and (7) green.

---

### 5.6 `verify-ladder-fix` — sub-native rungs, native refresh, the stutter term

**THE MODEL ROW: both arms measured the same day, with the same control legs
green in both.**

**PASS 1 (RED arm, pins unset).** `7 passed, 6 failed`. Ladder
`[1/high, 1/medium, 1/low]`.

| Leg | Verdict | Number |
|---|---|---|
| 1 sub-native rungs exist on a DPR-1 display | **FAIL (intended)** | **0 rungs below native** |
| 2 …all before the first tier rung | **FAIL (intended)** | last sub-native at −1, first tier rung at 1 |
| 3 boot rung still index 0 | PASS (control) | 1/high |
| 4 tier rungs unchanged | PASS (control) | 1/medium, 1/low |
| 5 refresh estimated from cadence | PASS | 144 Hz |
| 6 target follows the display | **FAIL (intended)** | **target 60 against 144 Hz** |
| 7 a stuttering session steps down | **FAIL (intended)** | rung **0** at emaFps 53.4, longFrac 0 |
| 8 CONTROL: a clean 60 fps session never steps | PASS (control) | rung 0, 0 steps |
| 9 render-scale rungs spent before any tier step | **FAIL (intended)** | dpr steps [] then tiers [] |
| 10 a forced step moved the ladder | PASS | 0 → 1 |
| 11 STEP_SAFE applied it inside a frame | **FAIL (intended)** | **no record** (`__flyStats.step` null) |
| 12 composer buffers are the drawing buffer | PASS (control) | [640,360] / [640,360] |
| 13 no page errors | PASS | clean |

**PASS 2 (GREEN arm).** `13 passed, 0 failed`. Ladder
`[1/high, 0.875/high, 0.75/high, 1/medium, 1/low]` — 2 sub-native rungs, last
at index 2, first tier rung at 3; refresh 144 Hz and **target 144**; the
stutterer reaches **rung 3 at emaFps 53.4 / longFrac 0.1** while the clean
60 fps control still never steps; dpr steps [0.875, 0.75, 1] spent before the
single tier step; forced step 0 → 1 with `{"n":1,"dpr":0.875,"applyMs":466.8,
"canvasW":560,"canvasH":315,"composer":true,"viaValve":false}` — **inside a
frame, not through the safety valve** — and composer buffers [560,315] equal
the drawing buffer.

**PASS 2b: 12/13 and 7/6 — the ladder is green, and gate 13 found something
else entirely.** Every ladder leg passed on the flipped tree (rungs
`0.875`/`0.75` before the tier rungs, refresh 144 with target **144**, the
stutterer steps down, the clean control never does, dpr `[0.875, 0.75, 1]` then
`["medium"]`, forced step 0 → 1 applied **inside a frame** with `applyMs` **2.5**
against pass 1's 466.8, buffers `[560,315]` equal to the drawing buffer). The
RED arm still fails 1, 2, 6, 7, 9 and 11 with the flags pinned off, so the
calibration holds both ways.

**But gate 13 fails on BOTH arms with a repeated uncaught exception:**
`Cannot read properties of undefined (reading 'byteLength')` — ×31 on the fix
arm, ×3 on the red arm. Pass 1 was clean, so it is a flipped-flag path; and
because it appears with the pins **set and unset**, it is not `LADDER_FIX` or
`STEP_SAFE`. These two rows are also **the only TOY boots in the pass** — every
satellite row is clean — which is the bisection that pointed at the toy chunk
path.

**Attributed** (B, by headless attribute census): A's `FINALIZE_PACE`,
`toy-world-engine.js:972` `geo.setIndex(idx)` with a raw `Uint32Array` under the
paced branch. three wraps only plain arrays, so the typed array becomes
`geometry.index` with no `.array` and `WebGLAttributes` throws at first upload.
2×2 proof: `FINALIZE_PACE` ON → **80 broken LAND meshes**, OFF → **0**;
`FLASH_GUARD` irrelevant.

**The lesson this row pays for:** the gate printed the message thirty-one times
and nothing else. Thirty-one copies of one message is ONE finding, and without a
stack frame the row can only say it happened — attribution then costs two rows
and three hypotheses. Every "no page errors" gate in the fleet now prints the
first three UNIQUE exceptions **with stacks**, deduplicated by message
(`scripts/_pageerrors.js`). One line would have attributed this in the first
run.

Why this row is the template: legs 3, 4, 8, 12 and 13 are green in BOTH arms.
A control that passes in the red arm is what makes a failing leg mean
something — (8) holding in both is why (7) measures the stutter term rather
than the harness's ability to force a step.

---

### 5.7 `verify-one-sun` — four sun directions per frame (L3)

**PASS 1 (flag-off).** `20 passed, 7 failed`, **rc 1 by design**, 251 s.

Preconditions all held: (0) both pins released, (0a)/(0b) `live=true` at every
tier and hour, (1) azimuth Δ 0 everywhere, (7) clean.

| Leg | Verdict | Number |
|---|---|---|
| (2) key elevation === true | **FAIL (intended)** | key pinned at **~45°** against a true **55 / 2 / −14**, at **high AND medium** |
| (6) THE MEDIUM-TIER RED | **FAIL (intended)** | key azimuth spread **0.0000°** across three sun elevations |

**One vacuous pass, caught by reading the PASS lines** (§2.10a): (5) WATER
READS THE SAME DIRECTIONAL AS KEY passed **six times** on `Δ undefined°`.
`angleBetween` returns null when a vector is absent or zero-length, and
`null < 1e-4` is TRUE in JavaScript. Fixed in `686db21`; that leg now reads
NOT CALIBRATED with the two vectors printed.

**PASS 2b: VOID — THE SUN NEVER MOVED.** `14 passed, 7 failed, 6 NOT
CALIBRATED`, rc 1, 263 s.

Commanded 55° / 2° / −14°; the key measured **23.132 → 23.132 → 22.938**, and
the key azimuth drifted monotonically **−64.6081 → −64.8665 → −65.1123** across
the six samples. A 69° commanded swing cannot produce a 0.2° key drift, and a
monotone azimuth walk across four minutes is a **clock**, not a command.

**Cause, arbitrated from source:** the gate redefined `window.__flySunOverride`
as an accessor backed by `__r24Sun` and wrote `{ elDeg: 55 }` into it — but the
app consumes that override as a **TIMESTAMP IN MILLISECONDS**
(`FlyScene.jsx:939`, `:1155`), and nothing in `lib/` or `components/` reads
`__r24Sun` or an `elDeg` field at all. An object where a number belongs yields
NaN inside `computeSun` or a truthy fall-through, so the app kept its wall
clock. **`ONE_SUN.enabled` is `true` on this tree**, so without this arbitration
the row read as C's feature failing.

The six NOT CALIBRATED lines are the §2.10a fix working: clause (5) would have
printed `PASS … Δ undefined°` six times on this same tree.

**Two contract mismatches also surfaced, both now fixed:**

- **`water` was the string `'key'`** — a documented sentinel meaning "one
  directional in the rig, the same vector by construction". C's `ad0849f` now
  publishes a real vector plus `waterSource`, and the gate asserts **both** the
  angle ≤ 0.5° **and** `waterSource === 'key-light'`: an angle of 0 between two
  INDEPENDENT lights is a coincidence that holds until someone moves one. New
  **(8)** counts `<directionalLight>` in `FlyScene.jsx` from SOURCE and requires
  exactly 1 (measured: 1) — teeth without a runtime census that would perturb
  FRAME_STATS.
- **`casting` reads `undefined`** because it lives on `stats.shadow`, not
  `stats.sun`. C's `ad0849f` publishes it on both, along with `minElRadDeg`,
  `hillMinDeg`, `hillMaxDeg` — which also un-SKIPs clause (3).

**Fixed for the re-take** (`d9e5d57`): the sun is commanded by TIME, searched
with the app's own `computeSun` (`scripts/_sun-time.mjs` reading raw `sinEl`, so
a night target is reachable at all), and **no clause runs until the app reports
the commanded elevation within 0.5°** — the precondition whose absence let a
stationary sun read as a stationary key.

**PASS 2c (standalone re-take).** *pending* — exactly one key direction across
every lit material at every tier, with the azimuth spread tracking the sun.

---

### 5.8 `verify-linear-haze` — sRGB haze mixed as linear (L1)

**PASS 1 (flag-off): VOID — the instrument, not the world.**

Both poses returned `960x540 · horizon row 6 (step 0.0) · terrain L 0.0 ·
sky L 0.0 · Δ 0.0`, with an all-zero luma profile. The seam reader ran from
`page.evaluate`, i.e. BETWEEN frames, and on a `preserveDrawingBuffer:false`
context the default framebuffer's contents are undefined once presented —
here, black.

(1a) and (1b) correctly reported "no horizon". **(2a), (2b) and (3) then
PASSED on Δ 0.0 — black against black** — and the run printed
`4 passed, 2 failed` while having measured nothing at all. The RED table even
recorded "measured Δ 0.0" as if it were a reading of the defect.

Fixed in `686db21`: the read happens inside a rAF (the pale detector's idiom,
which is why its census rows read real pixels), and (2)/(3) are NOT CALIBRATED
whenever (1) fails.

**PASS 2b: THE INSTRUMENT FIX WORKED, AND THE ROW IS STILL VOID AS POSED.**
`4 passed, 2 failed`, rc 1, 243 s.

The rAF read fixed the black frame — this row produced the pass's first
genuine seam measurement:

```
noon   horizon row 227 (step 54.6) · terrain L 212.4 · sky L 161.5 · Δ 50.9
night  horizon row 227 (step 54.7) · terrain L 212.3 · sky L 161.5 · Δ 50.8
```

(1a)/(1b) found a real horizon with a 54-luma step and the profile shows the
seam cleanly (`…208.2, 159.5, 160.0…`), against pass 2a's all-zero profile.

**But C proved from source that the frame has ZERO PERCENT MELT in it.**
`bootFly` pins `__flyAerialOverride = 0` (`_boot.js:95`, `:143`), which drives
`aerialGate` to 0, so all three atmosphere channels take their R19 identity
paths, `WORLD_EDGE.fade.satellite` (60–120 km) never enters a fixture frame, and
`setDepthHaze` is literally 0 in satellite (`FlyScene.jsx:1011`). **The gate's
own luma profile says so** if you read it: thirteen terrain rows flat at 210–214
and then a one-row cliff. A delta measured across a seam with no melt is not a
reading of the seam.

**And both legs were the same frame** — the sun defect above — which is why noon
and night agreed to 0.1. That agreement proved nothing.

**The bound was unreachable too**, and must not be sourced from C's node proof:
`maxMix` 0.55 leaves 0.45 × 51 ≈ **23** even fully unpinned, and an eye at
4200 m is 3.5 e-folds over `heightFalloffM` 1200. C's node proof predicts 0.000
for the **decode round trip only**, never for a seam.

**Re-expressed for the re-take** (`d9e5d57`): the aerial pin is released with
the same accessor idiom as the sun; tier high **and** `aerialGate > 0` are a
precondition or the row is NOT CALIBRATED; the absolute bound is gone and the
claim is the **A/B** — same pose, `LINEAR_HAZE` on must read a smaller Δ than
off; (3)'s spread tightens to **≤ 0.5** as the one-colour-function tell, the
assertion that needs no absolute bound; and C's free check is asserted —
**`moonK` must read 1** at a landed −14° sun, since it keys on
`trueElevationDeg`. The ON arm stays NOT CALIBRATED until C's
`__flyLinearHazeOverride` lands. A toy pose, where `setDepthHaze` carries
`haze.max`, is a second INFORMATIONAL leg only.

**PASS 2c (standalone re-take).** *pending*.

---

### 5.9 `verify-depth-roundtrip` — reversed depth double-converted (L2/FL-07)

**PASS 1 (flag-off): NOT RUNNABLE — which is not RED.** `1 passed, 1 failed`,
220 s. `window.__flyDepthProbe` **ABSENT**; (0) refused and printed the required
signature and the owner. Nothing about the defect was measured in either
direction.

The gate refuses rather than reconstructing viewZ itself, deliberately: a
harness that re-implements the renderer's depth conversion is testing its own
copy of the bug.

**(0b) was a second vacuous pass**: it PASSED while printing `dof=null`,
because it inferred the DoF pass from `style === 'toy' && tier === 'high'` —
asserting the configuration that usually produces a pass, not the pass. Fixed
in `14238d9`; it now reads `window.__flyDof`.

The renderer state that run: `reversedDepth=true · style=toy · tier=high`.

Handles required, both C-owned — see §2.7c for the contracts.

**PASS 2b: THE HOOK ARRIVED AND THE GATE STILL MEASURED NOTHING.**
`3 passed, 1 failed, 1 NOT CALIBRATED`, rc 1, 244 s.

C's hook works: **(0) `__flyDepthProbe` PRESENT**, **(0b) `__flyDof` true** —
the gate reads the live handle now instead of inferring the pass from
`style`/`tier`, which is the fix that stopped it passing while printing
`dof=null`. Renderer `reversedDepth=true`, style toy, tier high.

**But (1) failed with `0 raycast hits`**, so the probe was never called on a
real pixel, and (3)/(4) read NOT CALIBRATED for want of a finite `coc` — the
third verdict doing its job on a row that measured nothing.

**Cause: the row ran with no budget scaler.** It sat in cert-run's PACING list,
so on the flipped tree with `FINALIZE_PACE`'s cold seed and a fixed settle the
toy chunks were not resident at the moment of the pick. By the §1.5 table this
is a **settled-pose pixel probe — a content gate**, and it takes `K`.

**Fixed for the re-take** (`d9e5d57`): the row moves to the `K` list; it settles
on `_settle.js`'s condition before picking; the raycast returns a REASON when it
misses (which handle was absent, or no intersection) instead of a bare null;
the hits are printed with their distances and the objects they struck; and fewer
than three picks reads **NOT CALIBRATED, not FAIL** — the round trip was never
exercised, which is not the same as failing it.

**PASS 2c (standalone re-take).** *pending* — the RED signature to look for is
all three pixels reconstructing to **2.50–2.51 m**, i.e. `−cameraNear`, every
fragment collapsed.

---

### 5.10 `verify-terra-live` — the residency trio, both arms

This gate runs BOTH arms in one process, so its two columns are internal to the
row: arm A is `TERRA_PACE` off, arm B is the trio on.

**PASS 1 (flag-off tree, both arms).** `8 passed, 1 failed`, rc 1, 715 s.

| Leg | Verdict | Number |
|---|---|---|
| 1 content: every resident tile displays its OWN z/x/y (arm A) | PASS | 62 tiles, **0 mismatches** |
| 2 content: quadtree address matches world position (arm A) | PASS | 64 tiles, 0 mismatches |
| 3 content: the same with the trio on (arm B) | PASS | 59 url / 65 pos, 0 mismatches |
| 4 the engine stops merging tiles the camera turned away from | PASS | merges **1 → 0** |
| 5 no tile replaced while on screen | PASS | 0 → 0 |
| **6 the same tile URL is not fetched twice** | **FAIL** | **1 → 17 URLs fetched more than once** (imagery requests 33 → 36) |
| 7 Owens draws ≤ 261 in every arm | PASS | off **161** / on **185** |
| 8 satellite draws ≤ 375 at the suburb pose | PASS | off **161** / on **183** |
| 9 no page errors in either arm | PASS | clean |

Also measured: `refetchParent` **1 → 0**; resident MB **0 → 41.3** (Powell) and
**0 → 50** (Owens), i.e. the byte LRU only tracks in the ON arm; triangles fall
in the ON arm at both poses (294,870 → 273,085 and 182,645 → 157,297).

**THE `/__stats` SEMANTICS BEHIND LEG 6** (asked for before attribution):

- `/__stats/reset` **clears `byUrl`, `byKind` and `total` outright**
  (`server.mjs`: `stats.byUrl.clear()`), so a URL's count restarts at 0 and a
  later first fetch reads 1.
- `runArm` calls `fx.resetStats()` **after that arm's `bootFly`** and
  immediately **before** the yaw pin, and reads `fx.stats()` right after the
  sweep and before the pose walk.
- Arm A's page is **closed** before arm B's page is created, so no background
  page contributes to arm B's window.
- Both arms share one fixture server (`ensureServer` caches it), but the
  per-arm reset makes that irrelevant.

**So the counter is NOT cumulative across arms.** Leg 6 measures each arm's own
45 s yaw sweep; a second boot's first fetch of a URL the first boot already
pulled does **not** count. A's reading stands on the LRU.

**Two instrument caveats to fold in before attributing**, both recorded in the
gate itself:

1. **The numerator and the denominator are different populations.** `imagery
   requests` is `byKind.img`; `URLs fetched >1 time` filters `byUrl` with **no
   prefix test**, so `/dem/`, `/mvt/`, `/api/aircraft`, `/api/weather` and
   `/planet` are all inside the 17. The two lines printed adjacently invite
   "17 of 36 imagery tiles", which is not what was measured. A per-prefix
   breakdown now prints under that line (`img` / `dem` / `mvt` / `api` /
   `other`, each as `dup/urls, reqs, worst Nx`); an eviction-refetch cycle
   appears in `img` and `dem` and nowhere else. The **assertion is unchanged** —
   this is A's gate and A's number.
2. **The reset is not atomic with the pin.** Between `resetStats()` and
   `PIN_YAW` there is an in-page `__flyTerra.reset()` and the warp itself, so
   requests still in flight from boot/settle land in the new window. Symmetric
   in principle; the ON arm holds more resident state at that moment, so not
   guaranteed symmetric in practice.

**A fixture refetch count is an upper bound on live behaviour.** Every fixture
response carries `cache-control: no-store`, and imagery and DEM are served as
SOURCES straight to the fixture server rather than through `context.route`, so
the browser never satisfies a tile from cache — every re-request is a real
server hit. The live planet has Esri/OFM cache headers and R21's persistent
Cache API tile cache in front of it.

Note also fixed since this run: leg 7/8 read `v == null || v <= 261`, i.e. "an
absent draw count is under the ceiling". It is not. `686db21` — absence is NOT
CALIBRATED; only a finite number gets a verdict.

**PASS 2 (flipped).** *pending* — and it runs LONGER. A's `b74e5be` makes the
yaw **frame-based** (0.85°/frame, **360° minimum arc**) instead of wall-clock,
so pass 2 invokes the row with `FLY_TERRA_SWEEP_MS=600000`: ~424 rendered
frames, 7–8 minutes per arm here, ~30–35 minutes for the row. That is the price
of leg 6 meaning what it says — under a wall-clock window at 1–3 fps the sweep
never completed a revolution, so "the same tile URL is not fetched twice **as
the heading comes back round**" was asserting over a heading that never came
back round.

---

### 5.11 `verify-frame-pace` — the pacing instrument

**PASS 1 (flag-off): INSTRUMENT ABSENT.** The 19:14 tree still had
`FRAME_STATS.enabled:false`, so the row was structurally vacuous.
**`6c26fe9` ships FRAME_STATS ON**, so the gate has an instrument only from the
flipped tree onward.

Since that run the tear legs print **(3a) ARMED** with the resize count, or
**NOT CALIBRATED** — "0 of 0 outside a rAF" is what a window that never crossed
a DPR or tier step reports, and that was passing (§2.10).

**PASS 2b: THE INSTRUMENT WORKS, AND THE VACUITY GUARD EARNED ITS PLACE.**
`5 passed, 0 failed, 1 NOT CALIBRATED`, rc 1, 260 s.

(1) `window.__flyStats.frame` publishes **27 fields** with `sample()`/`ring()`/
`reset()`; (2) the 13 the ledger quotes are all present. FRAME_STATS shipping ON
(`6c26fe9`) is what made this row exist at all — pass 2a had no instrument.

**(3a) fired: `no resize occurred in the window — resizes 0 over 107 frames`.**
Without the §2.10 guard added in `9cba1b6`, this row would have printed
`(3) EVERY RESIZE / DPR COMMIT IS INSIDE A rAF — 0 of 0 outside  PASS` and
`(4) bufferMatchesDrawing NEVER GOES FALSE — 0 of 107 frames  PASS`, and the
tear mechanism would have read **clean** on a window in which nothing resized.
Both legs now carry `[NOT CALIBRATED — nothing resized; this is not evidence]`
inline.

**The phase attribution works, and it names an owner.** Serpentine 90 s, 100
frames: p50 **829 ms**, p95 **3,641 ms**, p99 **4,062 ms**; stalls 21 (11/min
against a 1,658 ms threshold); longtasks 68 (92,897 ms); **programs delta 0** —
no recompile storm. And:

```
last stall 3660ms during [finalize:sat-roads ×16]
```

**A finding for A that follows from it:** `sat-road-engine.js:526` bounds its
finalize with a module const `FINALIZE_PER_FRAME = 1` that is **not multiplied
by `budgetK()`** — unlike the other engines, which all read
`S.finalizePerFrame * budgetK()`. It is therefore the **seventh** budget site
and the one the harness scaler now misses (veg was the sixth, fixed in
`59b4e97`). At K=40 or K=200 every other engine speeds up and roads does not,
which both starves the road ring and concentrates the stall there — exactly
where the phase marker points. Not fixed here: it is A's engine, and the veg
site was changed only on A's request.

The pacing legs (5)–(8) print INFORMATIONAL by design and the numbers are the
container's, not the product's: at ~1 fps every dt is a stall and any bound
would be a statement about SwiftShader. `FRAME_PACE_STRICT=1` on the user's
machine arms them, and that first run establishes the RED.

**PASS 2c / user machine.** Structural legs only here. **Every pacing number is
UM**; §2.3 is where the user's machine owns this row, and the tear LINE is not
measurable anywhere in software.

---

### 5.12 `verify-env-uniform` — program recompiles across dusk and tier steps

**PASS 1 (flag-off).** *pending* — `programsDelta` non-zero across a dusk
crossing and across a tier step.

**PASS 2 (flipped).** *pending* — 0 across both crossings, with (3)'s
`stepsAccepted > 0` proving the tier walk happened. Noted in §2.10: the dusk
walk has no equivalent check that the HDRI bucket actually changed.

---

### 5.13 `verify-shadow-calm` — the shadow kernel and texel snap

**PASS 1: GREEN NODE-SIDE, 32/32** (C, `a9e30cc`). The ShaderChunk patch run
against three's real chunk text both ways; the reversal reproduces three
**byte-exact**; the texel snap is a staircase, 11 positions over 10 texels. The
gate also caught a real defect in its own module (`PHI_TO` defaulting unknown
names to world), which is why it carries a kernel allow-list.

**PASS 2 / user machine: UM for everything visual** — pixels, draws, the
catcher shadow and sparkle. The node leg cannot see any of them; sparkle in
particular is temporal and needs real frames.

---

## §6 THE ROUND'S INSTRUMENT LESSON — a number read across an ownership boundary

Five times in two passes, a gate reported a number that was about the gate
rather than about the world. They look like five unrelated bugs. They are one:

| The reading | What it was taken to mean | What it actually meant |
|---|---|---|
| `refines NaN · merges NaN · parentRefetches NaN` | nothing — it printed and passed | A publishes `refine` / `merge` / `refetchParent`, **singular**. NaN compares false against every threshold, so the gate went quiet exactly where it should shout |
| `presence channel = none`, 29/29 hard births | CHUNK_FADE is not fading | B publishes the twin's uniform at `material.userData.__fadeU`; my four guessed names could never have found an `onBeforeCompile` uniform |
| `heals 9` | nine holes | six exhaustive outcomes, of which **one** (`healsQueueFull`) is a hole; `healsInPlace` is the fix working |
| `pale 8 in 290 frames` | eight one-frame flashes | two-frame runs at identical means — a sustained **field**, a different picture with a different cause |
| `residentTiles=0` | the fixture is too small | the residency pass is only installed when `TERRA_PACE.keepResident` is on; 0 was correct |

**The rule this round earned:** *a value read across an ownership boundary must
be read by the name its owner publishes, with the owner's definition of what it
counts, and an absent reading must be a loud failure rather than a default.*

Three corollaries, each paid for:

1. **Absence must never coerce.** `?? 0` on the Owens lock, `v == null ||
   v <= 261` on a ceiling, `null < 1e-4` on an angle, `undefined === undefined`
   on a rebuild count — every one of them turns "I could not measure" into
   "PASS". That is what `NOTCAL` (§2.10a, `scripts/_notcal.js`) exists for.
2. **A precondition must be readable in BOTH arms.** A precondition that only
   the feature can satisfy is not a precondition; it is the feature under test,
   asserted before it exists.
3. **The label must be the best reading of the run, not the first.** `??=` on a
   channel name latched `none` from the first mesh sampled — and would have
   done so again *after* the channel was read correctly.

**Why it kept happening:** every one of these gates was written against a
feature that did not exist yet, from a plan describing what it would do. The
plan says "the fade rides a uniform"; the implementation publishes
`userData.__fadeU`. Nothing is wrong with writing the gate first — it is how the
RED gets calibrated — but **a gate written before its feature must be re-read
against the implementation before its output is trusted**, and the cheapest
moment to do that is when the owner merges, not when the row is red at 21:30.

**What actually caught them:** not the FAIL lines. Every one of these was found
by reading a **PASS** line sceptically, or by a self-test the gate ran against
itself (`__paleSelfTest`, `FADE_PROBE_SELFTEST`). §2.10 was written before the
rows landed for exactly this reason, and it earned its place.
