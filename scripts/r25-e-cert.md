# R25 — E CERT LEDGER ("a green means something here AND there")

Owner: **E CERT**. Worktree `/home/user/skyloom-r25-e`, branch `r25/e`, dev
server port **3134**, fixture port **3199**.
Plan: [FLY_ROUND25_PLAN.md](../FLY_ROUND25_PLAN.md) §3 E + §4 (E's row).
Kickoff: [FLY_ROUND25_KICKOFF.md](../FLY_ROUND25_KICKOFF.md).
Evidence: [scripts/r25-recon.md](r25-recon.md) §5 (protocol and certification
infrastructure), §4 M1–M7 (mobile).
Precedent: [scripts/r24-e-cert.md](r24-e-cert.md).

> **VENUE TRUTH, stated once and applied without exception.** This container
> renders the game on **ANGLE / SwiftShader at 1–3 fps**; Google Chrome is
> absent; Esri imagery + elevation, OpenFreeMap and adsb are **403-blocked at
> the proxy**, so the only world here is E's offline fixture
> (`scripts/r24-fixture/*`, `FLY_TILE_FIXTURE=1`, port 3199) served through the
> `node -r ./scripts/_pw-shim.js` launch shim. **Every fps / ms / stutter /
> tearing / bloom-feel / "does it look better" number in this round belongs to
> the user's RTX 5080 and phone.** A number measured here NEVER re-baselines a
> live number; frozen gates get a **separate FIXTURE column**. What IS
> assertable here: counts, census, draws/tris per pose, uniform reads, program
> counts, cache keys, protocol/flag/source scans, byte identity, boot
> monotonicity, fixed-pose pixel A/B, and DOM geometry.

This ledger is kept CURRENT. Everything below is either a measured number with
the command that produced it, or an explicit "could not measure here".

---

## §0 The venue, in one table

| Capability | Here (cloud container) | User's machine |
|---|---|---|
| GPU | ANGLE / SwiftShader (software), **1–3 fps at the game's load** | RTX 5080 |
| Google Chrome | **absent** (chromium via `/opt/pw-browsers` + shim) | present |
| `playwright` | global only (`/opt/node22/lib/node_modules`, 1.56.1) | repo/global |
| Esri imagery + elevation | **403 at the proxy** | reachable |
| OpenFreeMap | **403** | reachable |
| adsb.lol / open-meteo | **403** | reachable |
| Phone | emulated viewport only (390×844 / 844×390) | a real thumb |
| Pixel determinism | **bit-stable** at a fixed pose | driver-dependent |
| Frame pacing / tearing | **unobservable** | the only place it exists |

One venue fact that is NEW this round and worth writing down: a settled-pose
census takes **427 s per pose** here (`verify-fixture`, §1 below) and the two
city poses did not settle at all inside their budget. Six agents share four
cores; **two browser runs at once make every wall-clock number here
meaningless**, which is why `SMOKE_NODE_ONLY=1` exists and why the node smoke
is the per-merge check.

---

## §1 The W1 baseline row

### 1.1 Node smoke on the untouched R25 base

```
cd /home/user/skyloom-r25-e && SMOKE_NODE_ONLY=1 bash scripts/r24-smoke.sh 3134
```

on `r25/e` at the W0 tip **`6bf628e`**, tree untouched:

> **14 passed, 3 failed, 0 skipped.**

| Red | Reading |
|---|---|
| `verify-import-integrity.mjs` | 3 passed / 1 failed — `scripts/r24-c-agl.js:355,363` `'agl' is not defined` / `'speed' is not defined` |
| `verify-lod-fade.mjs` | 60 passed / 4 failed — all four in section `[1] vendor patches` |
| `verify-skirt-worker.mjs` | 8 passed / 1 failed — gate 2, "1 matches" where 2 were expected |

All three reproduce on the untouched `f0cd81e` (verified by the orchestrator and
again here). **None was caused by this round.** §2 attributes each.

After E's W1 work, on the same command against `scripts/r25-smoke.sh`:

> **23 passed, 1 failed, 1 skipped.**

The one red is `verify-skirt-worker` gate 2b, which is a **product defect** E
added a gate for and cannot fix (§2c). The one skip is `verify-moon-light.mjs`,
which C LIGHT ships.

### 1.2 Fixture health

```
FLY_TILE_FIXTURE=1 FLY_BOOT_SCALE=6 FLY_URL=http://localhost:3134 \
  node -r ./scripts/_pw-shim.js scripts/verify-fixture.js
```

| Gate | Result |
|---|---|
| (1) deterministic bytes on re-fetch | **PASS** — mvt 12 021 B · dem 1 817 B · img 46 864 B |
| (2) the 200-with-empty-body tile is reachable | **PASS** — status 200, bytes 0 |
| (3) satellite boots on the fixture | **PASS** — img 72 / dem 69 / mvt 69 / tilejson 23; boot **96.5 s**, pct 100 at **46.6 s** |

Pose census on the same run, and **read the caveat before quoting either
number**:

| Pose | draws | tris | meshes | settled? |
|---|---|---|---|---|
| manhattan | **144** | 263 808 | 268 | **NO** — 427 s, load 5.55, 15 chunks still draping, maxZ 16 |
| powell | **154** | 187 464 | 262 | **NO** — 428 s, load 9.69, 16 chunks still draping, maxZ 17 |

**Informational only. Neither bounds anything.** They are UNSETTLED-pose
readings on a software rasteriser, recorded because an unsettled number is
still a number and because "settled is a state of the streamer, not an identity
of the scene" (R24 §7). The frozen ceilings — Owens ≤ 261, satellite ≤ 375, toy
≤ 480 — are unaffected and unmoved.

Powell's ground reads **275.3 m** here, which is what `scripts/r25-user-diag.md`
derives its `altM: 360` (≈ 85 m AGL) from rather than guessing.

---

## §2 The three pre-existing reds — attribution and decision

### 2a. `verify-import-integrity.mjs` — a ReferenceError in a previous round's probe

**The defect.** `scripts/r24-c-agl.js:326` opens a `page.evaluate` callback as
`({ hdg }) => { … }` and is handed `{ hdg: LEG.hdg, agl: LEG.aglM, speed:
SPEED_MPS }` at `:367`. The body then reads `agl` (`:355`) and `speed`
(`:363`). **The values were always passed; only the binding was missing.** A
`page.evaluate` callback is serialised and run in the page, so no outer scope
saves it: the probe throws a ReferenceError the moment it runs.

One nuance worth stating, because the gate's own failure message overstates it
for this file: the message says "each one throws a ReferenceError at MODULE
EVALUATION, which takes the whole chunk down". That is true of app source. Here
it throws at CALL time inside the page. It is still a real defect — the probe
cannot run at all — just not that one.

**Decision: FIX the script.** A probe that cannot execute is not evidence being
preserved, it is taxidermy. The repair is the destructure and nothing else.

**...which collides with the hygiene gate,** whose `PATTERNS` glob
`scripts/r2[0-4]-*` freezes that file. The choice offered was: narrow PATTERNS
to artifact extensions, or add a one-file allowance. **Narrowing the glob is
the worse of the two** — it would silently un-freeze every previous-round
`.js`, which is most of the frozen set, to solve a one-file problem.

So `verify-artifact-hygiene.mjs` gains a NAMED ALLOWANCE list, and with it the
one rule that keeps gate (1) meaning what its own header says:

> **An allowance may only ever name an INSTRUMENT (`.js` / `.mjs`), never
> EVIDENCE (`.json` / `.png` / `.md` / …).** What the gate exists to protect is
> the measured record — RED files and calibration pairs taken on live
> third-party tile bytes that nobody can re-measure. A script can be re-read
> and re-judged; a number measured on a planet that has since changed cannot.

New gate **(1b)** asserts that of the LIST, not of today's entry, so it binds
every future allowance. New gate **(1c)** refuses a stale allowance (one that
is no longer in use), so the list cannot rot into a standing permission.

| | |
|---|---|
| Before | 5 passed, 0 failed (with `r24-c-agl.js` unrepaired) |
| After | **7 passed, 0 failed** |
| RED calibration | On a scratch copy, pointing the allowance at `scripts/r21-e-red-seam.json`: **3 passed, 4 failed** — (1) red naming the now-unallowed `r24-c-agl.js`, (1b) red "evidence extension", (1c) red "unused". Tree restored; the RED tree was never committed. |
| `verify-import-integrity` after | **4 passed, 0 failed**, 495 files linted |

### 2b. `verify-lod-fade.mjs` 60/4 — four assertions about TEXT, re-baselined

**What changed, and the commits.** `be711f2` + `7c9cde0` (the Codex "overhaul
satellite graphics and terrain recovery" pair, `main` = `f0cd81e`) rewrote
`Tile._loadSubTiles` and `Tile._removeSubTiles` to wrap both bodies in A's
PATCH #7 (`unlockOnReject`) try/catch, and added the merge-completion repair
documented as VENDOR.md **patch 7a**. Measured from
`git diff 0ff2a3f f0cd81e -- lib/fly/vendor/three-tile/index.js`:

| Red assertion | What it actually measured | Verdict |
|---|---|---|
| "the three D patch markers are present" (`markers=[5,5]`) | the `// R24 D PATCH 6` and `// R24 D PATCH 7` COMMENTS were deleted with the re-indent. `ir && ir.onRefine(this, o, h);` and `ir.onMerge(this, o)` are both still there, in their required positions | **structural — re-baselined.** The marker census is replaced by the CALL SITES: a comment can be re-indented away, a call cannot |
| "D's vendor hunks are INSERT-ONLY" (`2 D hunks, +65 / -0`) | the `>= 3` hunk count derived from the same comment text. **Deletions were already 0** | **structural — re-baselined to `>= 2`.** The load-bearing half (zero deletions) never moved. Per-owner hunk scoping is no longer decidable from the diff at all now that D's hooks sit inside A's try blocks; the whole-bundle budget is `verify-vendor-three-tile.mjs`, green |
| "patch 7 holds `_loadState` at loading across its await" | the block was sliced from `indexOf('const _w = ir.onMerge…')`, and the overhaul renamed `_w` → `wait`, so `indexOf` returned −1 and the slice was empty | **structural — re-baselined.** **THE BEHAVIOUR IS STILL PRESENT**, read in source at `index.js:697-701`: `const wait = …; if (wait) { this._loadState = "loading"; await wait; this._loadState = "loaded"; }`. A rename, not a removal |
| "patch 7 runs before the merge return expression" | the same −1 slice | same |

**And one thing the re-baseline found that is not a re-baseline.** Patch 7a
re-reads `_inFrustum` and RE-EVALUATES the LOD verdict AFTER the blend await, so
**a merge the crossfade was already blending toward can now be CANCELLED.** The
overhaul added `onMergeEnd` to `lib/fly/lod-crossfade.js` in the same change to
release those blends (`export const lodFadeHook = { onRefine, onMerge,
onMergeEnd }`). `LOD_CROSSFADE` **ships ON** since the R24 close, so that path
is live and had no gate. Three new rows now cover it: `onMergeEnd` on the
success path, `onMergeEnd` in the catch, and the app side actually implementing
the method the library calls — a `?.` no-op there would leak the blend.

One more instrument lesson paid for in this file: the row "the library reads
the hook nowhere else" counted CODE LINES mentioning `ir` and froze the number
at **4**. It survived the overhaul **by luck** — both new `onMergeEnd` calls
begin their line, and the regex required a non-space before the identifier. A
line census is the wrong instrument for that claim; it is now a METHOD SET
(`onMerge, onMergeEnd, onRefine`), which goes red the moment the library calls
something the app's hook object does not implement.

| | |
|---|---|
| Before | 60 passed, 4 failed |
| After | **69 passed, 0 failed** |

**FINDING for the orchestrator (E cannot fix it).** The deleted `R24 D PATCH
6/7` markers are a real loss: VENDOR.md's switch idiom attributes patches BY
those markers, and `scripts/verify-lod-fade.mjs`'s per-owner insert-only census
was built on them. E owns `scripts/`, not a vendored file. Someone should
restore the two comments in `lib/fly/vendor/three-tile/index.js` beside the
surviving hooks.

### 2c. `verify-skirt-worker.mjs` 8/1 — a re-baseline, and a DEFECT underneath it

**The shape change (re-baselined).** The overhaul re-applied VENDOR.md patch #3
(`demErrorTable`) into the LERC worker source string. Measured:

```
0ff2a3f   fe tail: self.onmessage=y=>{const d=y.data,k=le(d.demData,d.z,d.clipBounds);…}          errTable ×0
f0cd81e   fe tail: self.onmessage=y=>{const d=y.data,k=le(d.demData,d.z,d.clipBounds,d.errTable);…} errTable ×2
          ge tail: self.onmessage=i=>{const o=i.data,t=Z(o.demData,o.z,o.clipBounds);…}            (unchanged)
```

`ie()`'s signature moved `function ie(y,d)` → `function ie(y,d,ET)` in the same
change. The gate's expectation gains an optional fourth argument. Structural,
commit cited, no measured number moves. Gate 2 is green again: **2 matches**.

**THE DEFECT (not re-baselined; gate 2b is RED on purpose).**
`R24_WORKER_TAIL_RE` **inside the shipped vendored bundle**
(`lib/fly/vendor/three-tile/index.js`, the `r24SpliceWorkerTail` site) was NOT
widened with it. Measured directly:

```
fe (LERC)        splice regex match: false
ge (terrain-rgb) splice regex match: true
```

So `r24SpliceWorkerTail(fe)` returns `null`, `r24MakeWorker` returns `null`,
and three-tile builds the **verbatim upstream worker** instead. Consequences:

- **`TERRA_PACE.skirtWorker` silently degrades to OFF on the LERC path.**
- **`TERRAIN_LIGHT.workerNormals` silently degrades to OFF on the LERC path.**
- **LERC is the only DEM path the live app uses** (Esri). The terrain-rgb
  worker still matches — and terrain-rgb is exactly what E's fixture serves, so
  **nothing in this container and no browser row in the fleet can observe it.**
- **R25 A GROUND's charter item 6** is the `workerNormals` user A/B via
  `__flyTerrainLightOverride`. On today's tree that A/B reads "no difference" —
  **for this reason, not for a graphics one.** A false negative on the user's
  own machine is exactly the class of result this round must not produce.

New gate **2b** reads the splice regex OUT of the bundle (never retyped, so the
gate cannot drift from the code it judges) and asserts it matches every tail it
will be handed: **1 of 2**.

| | |
|---|---|
| Before | 8 passed, 1 failed |
| After | **10 passed, 1 failed** — gate 2 green, 2a green, **2b RED by design** |
| Owner | **A GROUND / vendor arbitration.** The fix is one regex: make the fourth argument optional at the splice site too. E may not edit a vendored file |

---

## §2d. A FOURTH pre-existing defect, found while looking at the third

`scripts/verify-night-city-identity.mjs` (R23 B's flag-off byte-identity gate)
**has been unrunnable since R24 C**, and nothing noticed because it is a row in
no smoke. Its own header says *"world-bend.js imports NOTHING (the module is
deliberately constants-free)"*; R24 C gave it `@/lib/fly/fly-constants`, so
`import()` dies with `Cannot find package '@/lib'` **before a single gate
prints** — and the process exits **0** on the unhandled rejection.

> **A gate that cannot load is worse than a red: it is silence, with a zero
> exit code.**

Fixed by registering `./_alias-loader.mjs` (the `verify-lod-fade` idiom), which
keeps it on the REAL module — text identity is the whole claim, so downgrading
it to source-parsing would not do. **Now 10/10, VERIFY PASS**, and it is a node
row in `scripts/r25-smoke.sh` so it can never go quiet again.

The same pass also fixed the stale label at `:224` ("WORKER_PROTOCOL stays 18"
→ **20**, plan §3 E.5) and added `graphics-unit.mjs` to the smoke, which is the
gate that actually asserts `20` at all seven pin sites — R25 §0 rules it stays
there.

---

## §3 What E built this round

### 3.1 `scripts/_mobile-boot.js` — `openFan` / `closeFan` / `hasFan`

Written against **D MOBILE's DOM contract** (plan §3 D) before D's code exists:
FAB `[data-testid="touch-fab"]` with `aria-expanded`; container
`[data-testid="touch-fan"]` with `data-open="1"|"0"`; petals keep every existing
`touch-*` testid and add `touch-hangar`.

Two properties, both load-bearing:

- **No-op without a FAB.** `openFan` returns `false` and touches nothing, so
  every mobile gate runs unchanged on the flag-off tree. A helper that threw —
  or that waited 30 s — with `MOBILE_FAN_R25` off would make the flag-off
  identity leg *unrunnable* rather than green.
- **Idempotent.** An already-open fan is not tapped again. A second tap closes
  it, which is the exact shape of a flaky harness.

It also waits 450 ms after the toggle: the spring settles over ~250 ms, and a
44 px assertion against a still-scaling element is a coin.

### 3.2 The mobile harness edits (plan §3 D's table)

Line numbers were re-read on this tree, not taken from the plan. What changed
and why:

| File | Edit |
|---|---|
| `verify-mobile.js` | a local `tapAction()` opens the fan before each petal tap (each petal tap CLOSES the fan, so it is per-interaction); the mount census, the cluster census and the contextual census are taken with the arc OPEN; `clusterState` gains `hangar` and `fab`; `FAN` is printed, not inferred |
| `verify-mobile.js` | NEW rows: the hangar petal and the FAB at ≥44 px **on a fan tree**, and their ABSENCE on the flag-off tree — neither tree passes by default |
| `verify-mobile.js` | the TAP-LEAK set: the FAB joins it (twice, so the fan ends closed); **LOOK leaves it on a fan tree** (see below). Flag-off, the list is R17's character for character |
| `verify-mobile-layout.js` | a SECOND in-viewport + pairwise-disjointness census with the fan OPEN (same `collectBoxes` — petals are pointer-events-auto descendants of `controls-right`), plus a precondition row: **the census must have GROWN**, or both greens are vacuous. The file gains a `skip()` so a flag-off run says "not asked", not "passed" |
| `verify-hangar.js` | `openFan` before the pause click; NEW **gate 14b** — the `touch-hangar` petal opens the hangar and hides the stick |
| `verify-logbook.js` | `openFan` before the pause click |

**Why LOOK leaves the tap-leak set on a fan tree.** There it is a PETAL: it is
not in the DOM with the fan shut, and `dispatchEvent` at a missing selector
THROWS. Re-opening the fan between taps does not fix it either — `openFan` uses
a real `page.click`, whose `pointerdown` the leak listener this gate arms would
COUNT, and the gate would go red for the instrument rather than for a leak.

**Why the censuses move.** A census of a shut fan is a census of an empty arc.
It would be green, and it would be green *because nothing mounted* — the R24
lesson this round is most exposed to.

### 3.3 `scripts/r25-smoke.sh`

r24's shape: `run name script cmd` rows, `SMOKE_NODE_ONLY`, `SMOKE_SKIP_SLOW`,
the NOT-COVERED note. Default port **3134**, `SMOKE_OUT` default
`scripts/r25-out`. Node rows = R24's + `graphics-unit.mjs` +
`verify-terrain-merge.mjs` + `verify-raster-retry.mjs` +
`verify-night-city-identity.mjs` + `verify-r25-flagoff.mjs` +
`verify-registry-inventory.mjs` + `verify-ground-bubble-k.mjs` +
`verify-moon-light.mjs`. Browser rows = the R24 fixture fleet + the six owner
gates, each a `content_gate`.

**An absent row SKIPs and makes the run exit 3 INCOMPLETE, never 0.** On day 1
five of the six owner gates are genuinely absent, and a smoke that reported that
as a clean green is the R20 false-green shape exactly.

Its NOT-COVERED note carries one line the R24 version did not:

> *THE ROUND'S OWN QUESTION. R25 exists because the ground reads flat at
> 50–500 ft and the night ground reads as a black photo with copper roads.
> Nothing in this file can see either.*

### 3.4 `scripts/verify-r25-flagoff.mjs` — **20/20, 9 of them VACUOUS**

The `verify-c-flagoff.mjs` idiom re-aimed at R25's six owners.

| Section | What it proves |
|---|---|
| (1) / (1a) | `r25On()` is false for all six blocks and all 18 pre-seeded sub-switches — **EXECUTED**, not parsed |
| **(1b) / (1c)** | each block **ARMS** through `window.__fly<Name>Override` and un-arms again |
| (2a–2c) | no `customProgramCacheKey` expression can emit an R25 token; the token list is re-derived from the registry header so gate and registry cannot drift |
| (3a–3c) | `hillKey` carries exactly R24's four tokens `e f a l`; the all-false key is the bare `world-bend-fade-hill-r19`; the LIVE key compiled off the real module carries no R25 token (`world-bend-fade-hill-r19-ef24`) |
| (4) / (4b) | every R25 rig is guarded by `r25On(...) &&` **in the same JSX expression**; every R25 block is read through `r25-pins.js`, never off the constant |
| (5) | every R25 GLSL injection site reads `r25On` before injecting |

**(1b) is the row that stops this file being a lie.** A gate that only ever
proves "false" would be equally green against an accessor hard-wired to return
false — which would silently disarm every armed leg in the round.

**Nine rows are VACUOUS on this tree and say so on their own line**, with a
separate count in the verdict: the R25 rigs, keys and GLSL do not exist yet.
They become load-bearing at the merge that creates the code, which is exactly
when they are needed. *Re-run after EVERY W2 merge and read the vacuous count
down to zero.*

**RED calibration:** flipping `GROUND_DETAIL_R25.enabled` to `true` in a scratch
`fly-constants.js` → **17/20**, with (1) naming `GroundDetail=true` and (1a)
naming its four live sub-switches. Tree restored.

**One instrument correction inside the gate itself.** The first version scanned
raw source and reported three reds — `ground-bubble.js`, `world-bend.js`,
`FlyCanvas.jsx`, `GroundBubbleRig.jsx` "reading the constant directly". Every
one was a COMMENT: the registry header reserves each R25 key by name, and the
scaffolding names its block in prose. **The gate was reading its own reference
material and indicting it.** Comments are stripped before every source scan
now — block comments and whole-line `//` / ` *`, but *not* an in-line `//`,
because cutting at one would also cut a `https://…` out of a string literal and
could hide a real token.

### 3.5 `scripts/verify-registry-inventory.mjs` — **6/6, and it found a real gap**

Every program-cache-key string this tree can emit — plain literals, the static
segments of template literals that DERIVE a key from a parent's, and
module-level `*_KEY` constants — must be named in the `world-bend.js` registry
header, which calls itself *"the one place that lists shader identities"*.

**ELEVEN key fragments are not:**

| Key fragment | Where it came from |
|---|---|
| `-cinematic-canopy-v1` | Codex overhaul, `cinematic-ground.js:102` |
| `-immersive-leaves-v1` | Codex overhaul, `cinematic-ground.js:102` |
| `-cinematic-parcel-v1` | Codex overhaul, `cinematic-ground.js:147` |
| `-cinematic-model-v1` | Codex overhaul, `cinematic-models.js:90` |
| `-merged` | Codex overhaul, `cinematic-models.js:90` |
| `\|cinematic-architecture-v3-` | Codex overhaul, `satellite-architecture-material.js:127` |
| `\|immersive-surface-v1` | Codex overhaul, same line — the v1 the R25 stub supersedes as v2 |
| `world-bend-road-satnight-cinematic-v1` | Codex overhaul, `world-bend.js:2706` |
| `world-bend-water-cinematic-v1` | Codex overhaul, `satellite-water.js:4` (`SATELLITE_WATER_KEY`) |
| `\|immersive-landcover-v1` | Codex overhaul, `SatTintLayer.jsx:186` |
| `player-hull-rim` | R17-era, `prewarm.js:779` + `PlayerPlane.jsx:159` |

E owns `scripts/`, not `world-bend.js`. So the gap is **NAMED, COUNTED and
FROZEN** in a `BASELINE_GAP` the gate refuses to let grow — which is the
property R25 actually needs: **every key this round adds must be registered in
the same change.** Gate (3) also reports a STALE entry, so the list cannot rot
into a standing permission. **FINDING for the header's owner (Fable, W0 row).**

Gates (4) and (5) are the two halves of the R25 stub contract: every reserved
key is still reserved, and none of them is EMITTED yet.

**RED calibration:** redacting the header's `'world-bend-anchor-monument-r20'`
line on a scratch copy → **5/6**, gate (2) red naming that exact key. Tree
restored; `git status` clean.

**One extraction bug worth its line.** A min-length quote scan
`/'([^']{2,})'/g` **MISALIGNS on an empty string literal**: it skips the empty
pair, marries its closing quote to the NEXT literal's opening quote, captures
the ternary source between them as if it were a key, and eats the real key that
followed. Measured — it swallowed `'-immersive-leaves-v1'` whole and reported
`}${immersive ? ` in its place. Match everything, filter after.

### 3.6 `scripts/_alias-loader.mjs`

Extended to resolve extensionless RELATIVE specifiers, so a node gate can
**EXECUTE** `lib/fly/r25-pins.js` (which imports `./fly-constants` and
`./fly-pins` the way the bundler resolves them) rather than source-parse the one
accessor every R25 feature reads. `verify-lod-fade` (69/0) and
`verify-worker-normals` are unaffected.

### 3.7 `scripts/r25-user-diag.md` — the pack the user gets TODAY

Written for someone who has never opened a console: Part A the prelude, B the
console (including Chrome's "allow pasting"), C the DAY run at Powell
80–150 m AGL, D the NIGHT run + three "before" screenshots, E the phone, F one
harness row proven now.

**Two corrections against the plan's draft, both from reading the source:**

1. The plan asked for `copy(__flyStats.night)`. **There is no such handle.** The
   pack asks for the ones that exist and together answer the same question
   (`sunFactor`, `skyState`, `envIntensity`, `bgIntensity`, `houseLights`,
   `satNightGate`, `satClutter`, `drawCalls`, `triangles`) and says so in the
   document.
2. **`window.__flySunOverride` on its own does not make it night.** The
   day-cycle effect re-reads it on a `warpEpoch` bump
   (`verify-sat-night.js:104`), so the pack pins the clock and THEN warps. A
   pack that only set the global would have produced a daylight "night"
   screenshot and a wasted round-trip.

Every handle is cited by file:line in the footer so the next person can check
them rather than trust them.

### 3.8 `scripts/r25-close-sweep.md`

Skeleton in r24's heading shape, opened on day 1 so every row has a home before
it has a number: §1.1 the node baseline, §1.2 the six owner gates with the pin
each releases, §1.3 the inherited gates (and what a flag-off pass vs a flipped
pass MEANS), §1.4 the fixture pose column + frozen ceilings + the W1 health row,
§1.4a the five fixed-pose gates un-recertified since the overhaul, §2 the
user-machine run list with the §2.7 four-column table, §3 deviations, §4 the
verdict.

---

## §4 Fixed-pose pixel gates — what was and was not re-baselined here

*(fills in as runs complete; see §6 for what could not be run)*

| Gate | FIXTURE column | Evidence under `scripts/r25-out/` | LIVE column |
|---|---|---|---|
| `verify-fixture.js` | gates 1–3 **PASS** (§1.2) | `smoke-verify-fixture.js.log` | n/a |
| `verify-sat-night.js` | **NOT RUN** (§6) | — | **NOT CALIBRATED** |
| `verify-dusk.js` | **NOT RUN** (§6) | — | **NOT CALIBRATED** |
| `verify-seam.js` node leg | **PASS** (in the node smoke) | `smoke-verify-seam.js.log` | **NOT CALIBRATED** |
| `verify-monuments-sat.js` | **NOT RUN** (§6) | — | **NOT CALIBRATED** |
| NEON_COVER FNV hashes | **NOT RUN** (§6) | — | **NOT CALIBRATED** |

---

## §5 Deviations, honestly

1. **`node_modules` could not be symlinked.** The setup instructions said to
   symlink `/home/user/skyloom/node_modules` into the worktree. Next 16's
   Turbopack refuses it: *"Symlink node_modules is invalid, it points out of
   the filesystem root"*, and `next dev` exits 1. Replaced with a hard-link
   copy (`cp -al`) — same inodes, no extra disk, 0.37 s. Recorded because it is
   a deviation from the written instruction and every other owner will hit it.
2. **`verify-skirt-worker` ships with gate 2b RED.** Deliberate; see §2c. It is
   a product defect, not a stale bound, and absorbing it into a re-baseline
   would hide the one thing in this round that makes another owner's user A/B
   read a false negative.
3. **`verify-registry-inventory` ships with an 11-key `BASELINE_GAP`.** E owns
   `scripts/`, not `world-bend.js`; see §3.5.
4. **An unexplained +1 in the `verify-import-integrity` file count.** The
   baseline smoke reported 494 files linted; every run since reports 495, on
   both the clean and the repaired tree, with and without `FLY_TILE_FIXTURE`,
   with and without `scripts/r25-out/`. The only environmental difference is
   that the baseline ran while `node_modules` was still a symlink. Immaterial
   (the gate's own floor is 120, and the notice count is 14 in both), but it is
   a number I could not explain, so it is written down rather than smoothed
   over.

---

## §6 Could not measure here

- **Every fps / frame-ms / p99 / stall / tearing number.** SwiftShader at 1–3
  fps. The mechanism gates (`verify-step-clean`, `verify-frame-pace`) assert
  the MECHANISM; the tear line itself is a vsync property no harness can see.
- **The round's own question.** Whether the ground reads flat at 50–500 ft and
  whether the night ground reads as a black photo. Both are the user's eyes.
- **Any live tile byte.** Esri / OpenFreeMap / adsb are 403-blocked, so every
  frozen hash and pixel band calibrated on live bytes has a FIXTURE column
  only.
- **The LERC DEM path** (§2c) — 403-blocked here, and the fixture serves
  terrain-rgb, which is precisely why the splice defect was invisible to the
  whole fleet.
- **A settled city pose.** `verify-fixture` spent 427 s on manhattan and 428 s
  on powell and neither settled; both draw numbers are unsettled readings.
- *(the fixed-pose pixel re-baselines of §4, per run — filled in below as they
  land or fail to)*

---

## §7 What E needs from the other owners

| From | What | Why |
|---|---|---|
| **A GROUND** | widen `R24_WORKER_TAIL_RE` in the vendored bundle to accept the optional `errTable` argument | otherwise `skirtWorker` and `workerNormals` are dead on the live LERC path and A's own charter item 6 A/B reads a false negative (§2c) |
| **A GROUND** | `window.__flyGroundDetail = { read, set }` | `verify-ground-bubble` |
| **B NIGHT** | `window.__flyNightGround = { arm, set, read, forceUpdate }` | `verify-night-ground` |
| **C LIGHT** | `window.__flyStats.shadow` | `verify-shadow-bubble` |
| **D MOBILE** | the DOM contract exactly as §3.1 spells it — FAB `touch-fab` + `aria-expanded`, container `touch-fan` + `data-open`, petals keep their testids and add `touch-hangar` | every mobile gate edit is written against it already |
| **F FEEL** | `window.__flyDof` | `verify-feel-ground` |
| **Fable (W0 row)** | register the 11 `BASELINE_GAP` keys in the `world-bend.js` header; restore the two deleted `R24 D PATCH 6/7` markers in the vendored bundle | §3.5, §2b |
