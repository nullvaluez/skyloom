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
| `verify-seam` | 13; determinism hashes | — | — | node leg pinned to fixture tiles |
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
