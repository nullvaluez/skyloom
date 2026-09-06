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

### 1.2 R24 gates (new this round)

| Gate | RED (flag-off) | Fixture | Live | Releases |
|---|---|---|---|---|
| `verify-fixture` | n/a (certifies the venue) | — | n/a | — |
| `verify-flash-guard` | zero-area census > 0 | — | **UM** for the pale detector | `__flyFlashPin` |
| `verify-step-clean` | resizes outside rAF | — | **UM** for the tear line | `__flyGovPin` |
| `verify-fade` | every birth is hard | — | — | — |
| `verify-lod-fade` | tiles leave and return on a pure yaw | — | — | — |
| `verify-frame-pace` | **UM** — instrument only here | — | **UM** | — |
| `verify-one-sun` | key azimuth spread 0 on medium | — | — | `__flySunOverride` + tier |
| `verify-env-uniform` | `programsDelta` non-zero across a dusk crossing and a tier step | — | — | `__flyGovPin` + `__flySatShadowOverride` |
| `verify-shadow-calm` | `biasSign` false / `kernel` null | — | — | `__flySatShadowOverride` |
| `verify-linear-haze` | rim-seam luma delta | — | — | — |
| `verify-depth-roundtrip` | \|viewZ\| 2.50–2.51 m at all three pixels | — | — | — |

### 1.3 Inherited gates the round touches

| Gate | Frozen number it carries | Fixture | Live | Notes |
|---|---|---|---|---|
| `verify-stability` | R21 quartet, 17 | — | **UM** for (1)/(1b) | gains an INFORMATIONAL FRAME_STATS line |
| `verify-flicker` | bound of 12, never moves | — | **UM** | + the quiescence precondition (A7) |
| `verify-tier-step` | 10 | — | **UM** | |
| `verify-seam` | 13; determinism hashes | **node leg GREEN, 9/9** *(fx)* | — | node leg pinned to fixture tiles (HARN-GAP-7 closed) |
| `verify-neon-cover` | five R18 FNV hashes | — | frozen | **re-baseline candidate under `RING_DEDUPE`** — record BOTH a flag-off and a flag-on fixture column; the live hashes stay frozen and become a user-machine item only if the flag flips at close |
| `verify-sat-buildings` | draws 226 / kept 6,965 / columns 6,964 | — | frozen | |
| `verify-skyline` | 17 | — | frozen | |
| `verify-parcel-homes` | Powell 0 placed, bit-identical tris | — | frozen | fixture Owens/Melton legs are the cheap, trustworthy ones |
| `verify-suburbia` | nothing in (25, 35) m | — | frozen | |
| `verify-sat-depth` | hillshade A/B > 2/255, aniso ≥ 4, z16 request | — | frozen | needs the **sierra** fixture scene (394 m of relief at the crop pose) |
| `verify-aerial` | boot ≤ +20%, quilt exactly 0 below inAglM, textures ≤ 300 MB | — | frozen | |
| `verify-rim` / `verify-dusk` / `verify-sat-night` | pixel bands | — | frozen | C's L1 one-time re-baseline lands here |
| `verify-monuments-sat` | FROZEN | — | frozen | moves only via C's sanctioned evolution |
| `verify-boot` | pct monotonic, 100 exactly at reveal | — | — | |
| `soak-fly --satellite --minutes 15` | p95 tris ≤ 2.2 M, p95 draws ≤ 375, heap no-climb, governor steps ≤ 4 | **UM** | **UM** | reads FRAME_STATS when the flag is on |

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
| `verify-depth-roundtrip` | **yes** | nothing — it is a reconstruction check | `FLY_URL=… node scripts/verify-depth-roundtrip.js` |
| `verify-shadow-calm` | **yes** | sparkle, which is temporal and needs real frames | `FLY_URL=… node scripts/verify-shadow-calm.js` |
| `verify-artifact-hygiene.mjs` | **yes**, anywhere | nothing | `node scripts/verify-artifact-hygiene.mjs` |
| `verify-seam` node leg | **yes**, offline | the LIVE hashes — the fixture column is a different planet | `FLY_URL=… node scripts/verify-seam.js` |

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
| `verify-fade` (4) ready invariant | `ready <= chunks && ready >= 0` is nearly a tautology; it cannot fail unless the engine is corrupt | **WEAK — flag it.** The real invariant is that ready does not FALL across the window; the series is printed but not asserted |
| `verify-fade` (5) Owens lock | Owens legitimately has nothing, so 0/0 passes whether or not the fade works | it is a LOCK, not a fade test — correct as written, but it proves absence of harm only |
| `verify-lod-fade` (3)(4)(5) | if the yaw sweep produces no tile events at all, "no reappears / no hard swaps" pass vacuously | (2) asserts `frames > 20 && appears + disappears > 0` first |
| `verify-lod-fade` (6) refetch | with `/__stats` reset and a short sweep, "0 refetched" can mean "nothing was fetched" | **WEAK — flag it.** It should assert some tiles WERE fetched before claiming none were re-fetched |
| `verify-step-clean` (2)–(5) | 0-of-0 with no step observed | already fixed: prints `NOT CALIBRATED`, non-zero exit, and (1) proves the ladder accepted a forced step |
| `verify-frame-pace` (3)(4) tear mechanism | if no resize happens in the window, "0 outside rAF" passes over nothing | **WEAK — flag it.** It does not require a resize to have occurred, unlike `verify-step-clean` |
| `verify-one-sun` clauses 1–5 | a null `dome`, a missing `hillMinDeg`, or `moonK === 0` SKIPs a clause; a run where every clause skips would print no failures | clause 0 (`live === true`) must pass first, and SKIPs are printed distinctly from PASSes — but the count of skips is not asserted |
| `verify-env-uniform` (1)(2) | `programsDelta === 0` passes if the dusk walk or the tier steps never happened | (3) asserts `stepsAccepted > 0`; the dusk walk has no equivalent check that the HDRI bucket actually changed |
| `verify-linear-haze` (2) | if the frame has no horizon, terrain and sky crops are the same band and Δ ≈ 0 passes | (1) asserts a real luma step at the found horizon row |
| `verify-flash-guard` (1a)(1b) | census over an empty scene | asserts `totalTris > 10000` |
| `verify-fixture` (6) Owens lock | passes if the world never loaded at all | the settle predicate now reports `settled` and WHY; (3) proves imagery/DEM/MVT were served |
| `verify-artifact-hygiene` (1) | passes if the glob matches nothing | (0) asserts the base commit resolves; the patterns are printed |
| `verify-import-integrity` (1) | passes if the target dirs are empty or unparsed | the linted FILE COUNT is printed (200) — but not asserted |

**Four are flagged WEAK and should be tightened before anyone reads their green
as evidence**: `verify-fade` (4), `verify-lod-fade` (6), `verify-frame-pace`
(3)(4), and `verify-import-integrity` (1)'s unasserted file count. None is
wrong; each can pass over an empty population, which is the failure mode this
section exists to name.

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
