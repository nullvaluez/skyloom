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

### 1.1 Node gates (no browser, no GPU, no network — run anywhere)

| Gate | Fixture | Live | Notes |
|---|---|---|---|
| `verify-classify.mjs` | — | — | 38 gates; ran green throughout R24 W0 |
| `verify-warbirds.mjs` | — | — | source-parses four files |
| `verify-daily.mjs` | — | — | deterministic daily set |
| `verify-depth-offset.mjs` | — | — | C (R24); RED 6/7 on `6116fc5`, GREEN 7/7 |
| `verify-terra-residency.mjs` | — | — | A (R24); RED 22 merges / 17 replaced / 178 refetches → 0/0/0 |

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

### 1.4 Draw ceilings (never re-baselineable)

| Pose | Ceiling | Fixture column | Live |
|---|---|---|---|
| Owens Valley | ≤ 261 | 152 *(flag-off, 1280×720, tier high)* | frozen |
| satellite | ≤ 375 | Manhattan 110 · Powell 131 · Melton 68 *(flag-off)* | frozen |
| toy | ≤ 480 | — | frozen |
| fixed-pose triangles | ≤ 2.0 M | Manhattan 169,552 · Powell 266,114 · Melton 328,079 *(flag-off)* | frozen |

**Read those fixture draw numbers with the caveat in `r24-e-cert.md` §1.2b**:
they were taken with the satellite building chunks still draping, so they are
a FLOOR, not the settled figure. They also fall under `POST_ORDER` (C measures
the merged EffectPass count DROPPING: sat 4→3, toy 6→5), so a flag-on column
reading lower is a decrease, not drift.

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

### 2.7 What we will still not know afterwards

- Whether a tear LINE is present — only the user's eyes and a phone camera can
  answer that (a software recorder composites it away).
- How the world looks on a GPU that is not SwiftShader: precision, anisotropy
  and half-float behaviour are driver-dependent, and R16 §9 already cost this
  project one such surprise (Apple GPUs and `FloatType` HDRIs).

---

## §3 Deviations, honestly

*(filled in at close — every place a run differed from the written recipe, the
way R19 §4.1 recorded its trimmed sweep)*

## §4 Verdict

*(filled in at close)*
