# R23 "NIGHT ALIVE" — CLOSE SWEEP LEDGER (skeleton, authored in W1 by C NIGHT-CERT)

> **STATUS: W1.** §1 (calibration) is FILLED but **not in the shape the charter
> asked for**, and §2 explains why in one sentence: *this session cannot reach
> the two hosts the world is made of, so no live red could be frozen.* Every
> integrated-tree cell reads `— (W3)`. `scripts/r22-close-sweep.md` is the shape
> this follows.

Dev server for every run: **this worktree's own server on its own port**
(`npm run dev -- -p 3023`), pointed at with `FLY_URL`. Never `:3000` / `:3002` /
another agent's port (the R19 §4.1 deviation note, still standing).

Two environment provisions were needed before any harness could start, and both
are recorded rather than assumed:

| Provision | Why | Effect on the tree |
|---|---|---|
| `NODE_PATH=/opt/node22/lib/node_modules` on every harness invocation | `playwright` is installed GLOBALLY in this image; `/home/user/skyloom/node_modules` does not contain it, and the repo's harnesses `require('playwright')` bare | none — resolution only, local `sharp` still wins |
| `/opt/google/chrome/chrome` symlinked to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | every harness in the fleet launches with `channel: 'chrome'`, which resolves that exact path; only the bundled chromium is present | none — the fleet runs unmodified rather than 50 files being forked |

---

## §0 THE FINDING THAT DOMINATES THIS LEDGER — the world was unreachable

**This session's egress policy denies `CONNECT` with 403 to both upstream hosts
the satellite world is built from.** Confirmed three independent ways:

| Instrument | Reading |
|---|---|
| `curl -sS http://127.0.0.1:38989/__agentproxy/status` | `connect_rejected · gateway answered 403 to CONNECT` for **`server.arcgisonline.com:443`** (Esri World_Imagery + Terrain3D DEM) and **`tiles.openfreemap.org:443`** (every building, road, parcel, landuse polygon) |
| `verify-night-alive` gate (3b), its own tally | **imagery 0 ok / 2 458 failed · vector 0 ok / 1 880 failed · zero vector chunks resident at P-MAN** |
| the frames themselves (`scripts/r23-c-red-*.png`) | a featureless grey field with POI letters and city-glow domes floating over it — no imagery, no buildings, no roads, no house lights |

Live ADS-B is down the same hole: `GET /api/aircraft` returns
`{"error":"all upstream sources unavailable","ac":[]}` — the app's own honest
failure path (R19 `d5076d0`) working correctly.

**Consequences, stated plainly:**

1. **No live RED could be frozen.** A floor measured on that grey field would
   freeze a network condition. The charter's instruction — *"if the un-pinned
   night scene does not reproduce the user's black screen, report the two legs'
   numbers honestly and gate on the most defensible deltas anyway; do not
   manufacture a red"* — is followed here in its stronger form: the scene did
   not reproduce anything at all, so the numbers are reported as **evidence of a
   blockade** and the thresholds are derived from elsewhere (§1).
2. **Essentially the whole BROWSER fleet is unrunnable here**, satellite and toy
   alike — `verify-player-nose` (toy, default boot) times out waiting for the
   canvas because the toy world streams from the same vector host. The three
   **node** gates run and pass, which is what proves the blockade is scoped to
   the two hosts and not to the machine (§4).
3. **The one thing this bought the round** is a gate that can tell the two
   states apart, which nothing in the fleet could do before — see §1c.

---

## §1 CALIBRATION — archive-derived, and honest about it

### §1a The intended calibration, and what it actually measured

`verify-night-alive` was run on base `f009263` (= shipped R22 + the R23
scaffolding commit, which adds two `enabled:false` blocks and a plan document
and changes no behaviour). Run log: **`scripts/r23-c-red-baseline.txt`**;
metrics: **`scripts/r23-c-night-alive.json`**; frames: `scripts/r23-c-red-*.png`.

| Leg | tier | draws | roads.ready | bldg.ready | litFrac | warm %-of-lit | p5/p50/p95 |
|---|---|---|---|---|---|---|---|
| MAN / un-pinned / live | high | 0¹ | 0 | 0 | 24.104% | **0.0%** | 3/5/77 |
| MAN / un-pinned / high | high | 0¹ | 0 | 0 | 75.190% | **0.0%** | 4/59/76 |
| MAN / **pinned** / high | high | 0¹ | 0 | 0 | 85.326% | **0.0%** | 25/59/69 |
| POW / un-pinned / live | high | 58 | 0 | 0 | 0.000% | 0.0% | 6/12/21 |
| POW / un-pinned / high | high | 51 | 0 | 0 | 0.000% | 0.0% | 6/12/21 |
| POW / **pinned** / high | high | 64 | 0 | 0 | 0.000% | 0.0% | 6/12/21 |
| OWE / un-pinned / live | high | 54 | 0 | — | 23.156% | 0.0% | 2/5/76 |
| BB / un-pinned / live | high | 54 | 0 | — | 13.684% | 2.4% | 3/5/66 |

¹ `__flyStats.drawCalls` read 0 on three legs — the 60-frame publisher had not
run since the previous reset at that instant. Not chased: with no world to draw
it carries no information either way. Flagged so a future reader does not build
on it.

**These are not product numbers and this ledger does not treat them as any.**
The one row worth keeping is the last column: **warm-lit share is 0.0% on every
leg**, which is exactly what a world with no window atlas, no sodium road web
and no house lights looks like — and is the signature the gate now detects.

### §1b The thresholds that shipped, and where each came from

Derived by **`scripts/r23-c-archive-metrics.js`** (pure node, reproducible,
writes `scripts/r23-c-archive-metrics.json`) from the fleet's own archived
CERTIFIED night frames — captured in R16/R19/R20 on machines that could reach
both hosts, at (for P-MAN) the identical pose.

| Source frame | Round | Pose | litFrac | warm %-of-lit | p5/p50/p95 | white blob |
|---|---|---|---|---|---|---|
| `r16-satnight-01-manhattan-night.png` | R16 | **P-MAN, identical pose** | 20.248% | **47.7%** | 5/10/120 | 1 756 px (0.342%) |
| `r16-satnight-02-manhattan-night-after-ab.png` | R16 | P-MAN | 20.094% | **48.3%** | 5/10/117 | 1 756 px (0.342%) |
| `r19-c-night-on.png` (R19 crop) | R19 | **P-POW-down, identical pose+crop** | 1.114% | **89.1%** | 2/5/21 | 0 |
| `r19-c-night-off.png` (R19 crop) | R19 | P-POW-down, sources OFF | 0.130% | **8.0%** | 2/4/20 | 0 |
| `r20-b-melton-au-night-on.png` | R20 | P-MEL | 9.347% | 27.4% | 1/12/55 | 39 px |
| `r20-b-melton-au-night-off.png` | R20 | P-MEL | 8.487% | 22.4% | 1/11/52 | 39 px |
| `r23-c-red-man-pinned-high.png` | **R23 BLOCKED** | P-MAN | 88.549% | **0.0%** | 30/57/68 | 0 |

**Instrument validation, and it is a strong one.** Given R19's own archived A/B
pair and R19's own crop, this module reproduces R19's published `litFrac` (mine
1.114% vs R19's reported 1.156% for the ON state). And on that same pair the
**warm metric separates the two states 11×** (89.1% vs 8.0%) where **`litFrac`
separates them 8.6×** — the warm term is the discriminator this round needed,
and the S3 symptom ("very few show lights in windows") is precisely a warm-share
collapse that a brightness metric cannot see.

| Threshold | Value | Derivation |
|---|---|---|
| `MAN_LIT` | 0.10 | half the weakest certified P-MAN sample (20.09%) |
| `MAN_WARM` | 0.24 | half the weakest certified P-MAN sample (47.7%); reads 0.0% on every unlit frame measured |
| `MAN_P95` | 58 | half certified 117. Supporting only — a grey wash clears it |
| `MAN_P50_MAX` | 40 | 4× certified 10, to catch the grey wash (blocked leg reads 57–59) |
| `MAN_BLOB` | 0.0025 | under the certified 0.342%, **which is itself the POI letters and the HUD hint row** — this gate parks both, so the number is provisional and marked so |
| `POW_LIT` | 0.005 | **between** R19 ON 1.114% and OFF 0.130% |
| `POW_WARM` | 0.40 | **between** R19 ON 89.1% and OFF 8.0% |
| `RATIO_LIT` / `RATIO_WARM` / `TIER_RATIO` | 0.8 | **not calibrated and not calibratable — by design.** Both legs of every ratio run in the same session against the same tileset at the same tier |
| `OWE_LIT_MAX` / `OWE_DARK_MIN` | 0.02 / 0.50 | ⚠️ **the weakest numbers in the file.** No certified Owens NIGHT frame exists in the archive; set from R19's Powell lights-OFF state with a wide margin |
| `OWE_DRAWS` | 261 | plan §5.1, FROZEN, untouched |
| `BB_LIT` | 0.05 | half `MAN_LIT` — the bridge pose is mostly water |

**Every absolute floor above is PROVISIONAL.** The harness prints a `SUGGEST`
block every run; the first run in a session with egress must paste it in and
record the move here.

### §1c What this round bought that the fleet did not have — the third outcome

`verify-night-alive` exits **0 = PASS · 1 = FAIL · 2 = BLOCKED**, and gate (3b)
counts imagery responses, vector responses and resident vector chunks before any
pixel gate is evaluated. **A sweep must read 2 as "not run" — never as green,
never as a product red.**

This is the R22 §1b.6 ruling (*a red produced by a missing instrument is an
instrument artefact*) with **the environment counted as an instrument**. It
exists because the first run of this very file produced a frame that looks
exactly like a catastrophic product regression and was a firewall rule. Nothing
in the fleet could tell those two apart; now one thing can.

### §1d Poses frozen, and the one that is a stand-in

| Pose | Camera | Band (fractions of frame) | Provenance |
|---|---|---|---|
| **P-MAN** | 40.7075, −74.0113, 792 m MSL, hdg 2.6, pitch −0.12 | y 0.55–0.98, x 0.02–0.85 | verify-sat-night's certified Manhattan night pose, VERBATIM |
| **P-POW** | 40.1584, −83.0752, 600 m, hdg 1.9, **pitch −1.15** | y 430/900–830/900, x 260/1600–1340/1600 | verify-groundlife's `POWELL_DOWN` pose **and `CROP`**, VERBATIM — R19's own reason: at cruise pitch the crop's top third is sky |
| **P-OWE** | 36.601, −118.06, 500 m, hdg 1.5, pitch −0.28 | y 0.45–1.0 | the fleet's Owens control (terra/clutter/depth2/aerial) with groundlife's night attitude |
| **P-BB** | 40.698, −73.993, 300 m, hdg −0.35, pitch −0.14 | y 0.50–0.98 | ⚠️ **BEST-EFFORT STAND-IN.** The handoff describes "the user's Brooklyn Bridge chase pose" from a screenshot whose framing is not recoverable from text. Frozen here, so it is a valid regression pose; **the round record must not claim it reproduces the user's screenshot** |

P-MEL (Melton parcel-homes night, plan §3) is **not built** — it is named as a
follow-up, not silently dropped.

### §1e What the instruments cannot see (the R22 §1c section, up front)

- **The metric cannot attribute a pixel to a layer.** Attribution is an A/B with
  one layer's root parked (the R19 method), and belongs to A's memo.
- **The band is a fixed fraction, not a horizon detector**, deliberately — a
  detector's reference moves with the content under test (the R20 coin lesson),
  and R22 moved both camera pitch handling and the bend curve. A fixed band can
  be wrong; it cannot be wrong *differently* between two legs.
- **The tier gate (11) is vacuous on this machine.** Both legs resolve `high` at
  1600×900 desktop. It is a live tripwire only on a machine that resolves lower
  — which is the user's, and is plan §2 H1. Printed as an ANCHOR so nobody reads
  its PASS as evidence about tier.
- **`__flyGovPin='hold'` is left at the fleet default**, so the "live tier" leg
  measures the BOOT-RESOLVED tier, not a tier the governor stepped to under
  load. R21's determinism argument wins for a pixel gate; the cost is that a
  governor-driven tier collapse (H1's core mechanism) is invisible here. Naming
  it rather than pretending otherwise.
- **No soak, no timing claim.** This gate photographs frozen poses.

---

## §2 W2/W3 — what must be re-run the moment egress exists

Ordered. Nothing below has been validated in this session.

| # | Action | Why |
|---|---|---|
| 1 | `verify-night-alive` on the BASE tree (`f009263`) | produces the real RED. Paste its `SUGGEST` block into `T`, record the move in §1b |
| 2 | `verify-night-alive` on the integrated tree | the green, with the §1b thresholds UNCHANGED from step 1 |
| 3 | `verify-settle` gate (8), specifically | C lifted `__flyTerraPin` on the parcel leg (see §3); the frozen birth-ramp numbers were not re-measured under it. If (8) moves, adjudicate harness-vs-product — do not absorb |
| 4 | `verify-sat-night` (33) | the R16 deep-night contract; it must STAY green. §4 records exactly how it fails under the blockade so a real failure is distinguishable |
| 5 | The rest of §4's table | every row currently BLOCKED |
| 6 | Re-derive `MAN_BLOB` and the Owens pair | the two weakest numbers in §1b |

---

## §3 Inherited R22 harness debts — outcomes

| Debt (R22 close §6.3 / B-W3) | Outcome |
|---|---|
| `__flyTerraPin` in **verify-arrival**'s un-pin array | **ALREADY CLOSED IN R22** — its single un-pin site (line 227) carries `['__flySettlePin','__flyTerraPin']`. Recorded rather than assumed |
| `__flyTerraPin` in **verify-settle**'s un-pin arrays | **PARTIALLY closed in R22, now finished.** `newFlyPage` lifted both pins; the **parcel leg (Melton, gate 8)** builds its page by hand and lifted only SETTLE, so a shipped SETTLE_CALM feature was being measured over R21 terrain. Now lifts both. **Both sides of the call are written into the comment** (the R22 un-pin table withheld terra from verify-settle deliberately; unlike the reveal legs this one measures a birth ramp at a frozen pose) — and it is marked **UNVALIDATED** at the assertion, with §2 item 3 as the owed check |
| **verify-fly-models** prints no VERIFY line, exits 0 | **FIXED.** The file already COMPUTED every swapped model's bbox and printed *"want z = length"* as prose without checking it. Now gated: z-longest on every model, plus pageerrors. Empty `dims` ⇒ **SKIP**, not pass |
| **verify-fly-formation** prints no VERIFY line, exits 0 | **FIXED.** pageerrors + a third outcome: the archetype loop can find no live candidate, and the old file returned 0 identically whether it shot four archetypes or none. Now `VERIFY: SKIPPED` when nothing was photographed |
| **verify-player-nose** prints no VERIFY line, exits 0 | **FIXED.** The thinnest in the fleet — it did not even collect pageerrors, so a run that threw inside the app returned 0 with two black PNGs on disk. Now pageerrors + both files written with real bytes |
| **verify-globe2** prints no VERIFY line, exits 0 | **FIXED (one line).** The near miss: it already exited 1 on a pageerror but only printed a VERIFY line from its catch block, so a clean run was silent to any sweep scraping for `VERIFY:`. Exit code unmoved |

All four remain **CAPTURE scripts** and say so in their own output: the PNGs are
the artifact, and each VERIFY line names exactly how thin its claim is so a green
is never over-read as "the models are correct".

---

## §4 BASELINE FLEET TABLE (on base `f009263`)

**Legend:** PASS / FAIL / **BLOCKED** (upstream unreachable — not a product
result) / NOT RUN.

### 4a Node gates — these are the control that proves the machine is sound

| Harness | Result | Evidence |
|---|---|---|
| `verify-classify.mjs` | **PASS** | 38 gates, `VERIFY: PASS` |
| `verify-warbirds.mjs` | **PASS** | `VERIFY: PASS` |
| `verify-daily.mjs` | **PASS** | `VERIFY: PASS` |

*Three pure-node gates pass. The blockade is scoped to two hosts, not to this
machine.*

### 4b Browser harnesses — the night-relevant subset the charter names

| Harness | Baseline | Note |
|---|---|---|
| `verify-night-alive` (NEW) | **BLOCKED** (exit 2) | its own gate (3b) reports the blockade by name; `r23-c-red-baseline.txt` |
| `verify-sat-night` (33) | **BLOCKED** | see §4c for the exact failure signature |
| `verify-dusk` (15) | **BLOCKED** — not run | needs Powell imagery + the sky ladder |
| `verify-terra` (17) | **BLOCKED** — not run | every gate is a tile-zoom or a request count; with 0 successful requests it can only report the network |
| `verify-settle` (14) | **BLOCKED** — not run | ⚠️ also carries C's unvalidated un-pin (§2 item 3) |
| `verify-clutter` (17) | **BLOCKED** — not run | clutter anchors off road/service chains that never arrive |
| `verify-stability` (17) | **BLOCKED** — not run | |
| `verify-flicker` (7) | **BLOCKED** — not run | |
| `verify-sat-depth` | **BLOCKED** — not run | |
| `verify-skyline` (17) | **BLOCKED** — not run | |
| `verify-player-nose` | **BLOCKED** | boot times out at `.fixed.inset-0 canvas` — the TOY world streams from the same vector host, so the blockade is not satellite-only |

**The rows marked "not run" were not run**, and that is a deliberate call rather
than an omission: each costs 5–20 minutes to produce a foregone conclusion, and
the two that WERE run (`verify-night-alive`, `verify-sat-night`) establish the
signature the rest would repeat. The R22 §6.3 idiom applies — **UNRUN, by name,
not assumed.**

### 4c `verify-sat-night` under the blockade — the signature

*(filled from `scripts/r23-c-satnight-blocked.txt`)*

<!-- FILLED AT THE END OF W1 — see the file. -->

---

## §5 Instrument asks for A (read-only `__flyStats` fields)

None of these is a product change; each is a field C could not read.

1. **`__flyStats.satBuildings.nightOn`** — the live boolean of
   `SAT_BUILDINGS.night.enabled && atLeastTier(qualityTier, minTier)`. It is the
   single most load-bearing switch in the user's report (S3) and today it is
   inferable only from the tier plus a constant read out of source. Plan §2 H1
   asks for exactly this sampled live.
2. **`__flyStats.satBuildings.emissiveMapReady`** — whether the night facade
   atlas texture actually resolved (`image` non-null, `version > 0`). The
   scene-traverse census here answers "is there an `emissiveMap` object", which
   is NOT the same as "the texture decoded" — an emissive with an unresolved map
   is the S2 white-glow mechanism and this instrument cannot see it.
3. **`__flyStats.governor.tierHistory`** — a bounded ring of
   `{t, tier, dpr, reason}`. The gate can prove the tier AT the shot; it cannot
   prove the tier never dipped during the dwell, which is H1's actual claim.
4. **`__flyStats.satRoads.nightIntensity`** (and the sibling for house lights) —
   the effective post-envelope gain, not the mix. B's road re-sweep is a knob
   move that needs an A/B on the value the shader actually used.
5. **A `window.__flyPoiLetters` root**, in the `__flyClouds`/`__flyTraffic`
   idiom. Letters are parked here by walking scene children for the `popT`
   userData key — a private contract this harness reverse-engineered from
   verify-sat-night's `parkE`. Two harnesses now depend on a key neither owns.

---

## §5b Observations for A — and one candidate CLOSED before it cost anyone a day

Everything here was measured in a world with no tiles. That makes it useless as
evidence about the user's defect and useful for exactly one thing: the degenerate
world is the LIMIT CASE of "content never arrives", which is plan §2 **H4**
(*SETTLE/BIRTH HOLD-DOWN … check for a sibling hole at first-stream under live
tile latency*).

**1. `satBldgFade` reads 0 on every un-pinned leg and 1 on every pinned leg.**
That looks exactly like "the building ring is dithered fully out at 792 m AGL,
so there are no windows to light" — a clean H4 confirmation. **It is not one,
and the mechanism explains itself:** `SatBuildingLayer` calls
`birthK(..., ready > 0, ...)`, and `settle.js:206` reads

```js
if (b.t0 < 0) { if (!hasContent) return b.k; }   // b.k initialised to 0
```

so while `satBuildings.ready === 0` the birth never starts and
`applyUniformBirth` holds `uSatBldgFade` at `base × 0`. With zero vector tiles
`ready` is always 0, hence fade 0. **Correct by construction — nothing to show, so
nothing is shown.** The pinned legs read 1 only because `settleOn()` is false
there and `birthK` returns 1 immediately.

**A CANDIDATE IS THEREFORE CLOSED, not opened:** the shared `uSatBldgFade`
uniform is injected only by `applyBendAnchorSat`, which only the sat-building
material uses (the skyline has its own `applyBendAnchorSatSkyline` variant), so
a held-at-0 fade cannot dissolve anything except the buildings that are absent
anyway. **H4 has no leverage on the building fade through this path.** A did not
need to spend a morning on it.

**2. `emissive` census: 4 live emissives on every un-pinned leg vs 1 on every
pinned leg**, with **0 unmapped** in every case. In a world with no buildings
the count is structural (R22 families mount extra emissive actors), not a light
measurement — but the ZERO in the second column is worth carrying: whatever the
S2 white glow is, this census found no emissive-without-a-map anywhere, on any
leg, in either pin state. It also could not have found one on a building that
never streamed, which is exactly why instrument ask #2 in §5 exists.

**3. The road engine reports `errorRetries: 18` with `ready 0, queued 10,
building 2, ringOn true` at Manhattan night** (`verify-sat-night`'s own probe,
§4c). The engine's reason codes stay at `{noData:0, zero:0, legacy:0}` — i.e.
the R21 reason-coded TTL/backoff classifies a hard upstream failure as *retry*,
not as any of its three named empty reasons. Not a defect; noting it because a
user on a flaky connection lands in the same state, and no field in
`__flyStats.satRoads` says "the network is refusing me".

## §6 VERDICT (W1)

- **Built and committed:** `scripts/_night-metrics.js` (the shared instrument),
  `scripts/verify-night-alive.js` (the un-pinned night gate — **19 gate
  assertions** across 8 pose-legs on 3 pin/tier pages, plus a third BLOCKED
  outcome), `scripts/r23-c-archive-metrics.js` (the threshold
  derivation, reproducible), five inherited harness debts closed.
- **Proven in this session:** the un-pin mechanism (with `__r22PinAttempt`
  receipts); per-pose deep-night pinning (−26.8° / −27.4° / −30.8°); the
  DEPTH_PASS source guard; the metric reproducing R19's published numbers on
  R19's own archived frames; the blockade, three ways.
- **NOT proven in this session, and named:** every absolute threshold, every
  legacy fleet row, `verify-settle` gate (8) under C's un-pin, and whether the
  user's defect reproduces here at all.
- **The honest verdict:** the never-again gate exists and is structurally sound;
  its calibration is borrowed and must be re-frozen on the first run with
  egress, and until then §2 is the standing to-do list.
