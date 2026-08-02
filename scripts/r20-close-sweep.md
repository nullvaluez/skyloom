# R20 CLOSE — certification sweep ledger

**Tree:** `claude/round20-icons-sprawl` @ `df7315f` — the fully integrated round
tree (scaffolding `f20f96f` + A SPRAWL `0300e63` + C ICONS `5d8920a` + B/B2
PARCEL-HOMES `df7315f`), checked out as worktree `r20-d` on branch `r20/d`.
**Date:** 2026-08-02. **Runner:** R20 agent D "CERT", under Fable orchestration.
**Server:** this agent's OWN `next dev` on `:3123`, serving this worktree's own
`.next` (fresh `npm ci`), driven through `FLY_URL=http://localhost:3123`.
**Deviations:** none of consequence. One temporary second server on `:3124`
(a detached worktree at main `dda4009`) existed only for the flag-off
composition baseline of §5b and was killed before the sweep began; that worktree
has been removed. Working-tree modifications at hand-off: `lib/fly/fly-constants.js`
(the ONE product tune, §1c), two harness files (§1a/§1b/§1d),
`scripts/soak-results.json`, the regenerated evidence PNGs, and the new
`scripts/r20-close-sweep.md`. **Nothing was committed** — Fable lands it.

**Why this sweep is BROAD, not targeted.** R19's ledger was trimmed on a
three-file product delta. R20's is not comparable:

```
git diff dda4009..HEAD --stat -- . ':(exclude)scripts'
 29 files changed, 3105 insertions(+), 35 deletions(-)
```

— four subsystems (satellite buildings + skyline, the toy mid ring, a new
satellite home layer, a new marquee monument overlay), `vector-tile.worker.js`
+489 lines with TWO owners' features inside it, `world-bend.js` +78 (a new
shader cache key), `WORKER_PROTOCOL 15→16`, nine new GLBs and `assets.js`
+119. The must-run set is therefore "nearly everything", and the SKIPPED table
below is short and each row is argued from the diff.

**The charter (R18 lesson 6):** *an integration seam both sides tested is still
untested.* A, B and C each certified their OWN worktree. Two of them edited
`vector-tile.worker.js` — C2's marquee footprint exclusion and B's satParcel
emission — and git merged them without a human or a harness ever running them
together. §5 is the seam evidence; §2 is the fleet on the merged tree.

---

## VERDICT AT A GLANCE

**32 browser harnesses + 3 node gates ran on the integrated tree. After the two
Fable rulings were executed, ALL 32 are GREEN. Every frozen ceiling in the
plan's §4 held. ONE budget still does not fit — the soak triangle budget — and
the finding is that the budget's own metric cannot measure the thing it is
rejecting.**

| | |
|---|---|
| Owens ≤ 261 | **held everywhere** — sat-depth path 179–181, suburbia (E) **180**, skyline **181**, parcel-homes (F) **179**, groundlife noon **179** / night **180**, aerial fully armed **195** |
| Satellite ≤ 375 | **held** — worst measured **263** (Naperville, roof-variety) |
| Toy ≤ 480 | **held** — worst measured **444** (soak), gates 437 / 428 / 426 |
| Manhattan roof-variety tris ≤ 1.6 M | **held with the ceiling half-used — 0.80 M** |
| verify-monuments-sat FROZEN | **untouched, 10/10** |
| suburbia (G) — nothing in the (25, 35) m band | **held, 0 blocks**; parcel homes 5.00–12.11 m |
| neon-cover 4a / 4b + the five frozen R18 hashes | **held; all five reproduce byte-exactly** (§1b) |
| fleet / hangar count arithmetic across `assets.js` +119 | **held, 37/37 + 17/17**, every GLB ≤ 1 MB |
| **soak triangles < 2.2 M** | ⛔ **BREACHES, and the metric cannot resolve the fix.** Same config, two runs: 2 633 649 / 2 349 013 — a 0.284 M spread, larger than the whole 0.267 M feature delta. Tuned per Fable ruling (`maxPerChunkMid` 240→180, −16 % of the feature's deterministic cost for zero feature loss); the floor escalation was measured and refused. **ESCALATED as a budget-metric problem — §1c, §4** |
| verify-groundlife tint floor gate | ✅ **RESOLVED** — demoted to informational per Fable ruling on this agent's measurement (pooled signal/control **1.04×**); harness now **22/22** — **§1d, §2** |

**Re-baselines consumed: ONE product value** — `TOY_MID_SUBURB.maxPerChunkMid`
240 → 180, under a Fable ruling, with a deterministic measurement behind it
(§1c). No floor, ceiling or frozen hash moved; `minH: 12` ships unchanged.

Two items were escalated to Fable mid-close. **The tint gate is CLOSED**
(demoted, harness 22/22). **The soak triangle budget is TUNED but still does not
fit, and it is handed back up** with the measurement that matters: the metric
rejecting the feature has a run-to-run spread larger than the feature. §1c and
§4 carry the numbers; §7 item 1 carries the ask.

Also fixed as part of the tint row (row 14, §2): the RUN table's groundlife
entry now reads **22/22**. Rows 1–13 and 15–32 are unchanged from the sweep.

---

## §1 — SANCTIONED harness fixes + the one product tune

§1a and §1b were sanctioned by this agent's brief; **§1c is a Fable ruling
issued after the sweep**. Each carries an inline `R20 SANCTIONED RE-BASELINE`
block at the edit site. **None moves a floor, a ceiling, or a frozen hash.**

### 1a `scripts/verify-groundlife.js` — the Powell tint A/B is re-pointed at ground

| | |
|---|---|
| **old** | the landcover-tint A/B measured the WHOLE ground crop at Powell |
| **new** | it measures GROUND ONLY: every streamed building mesh (`window.__satBuildings.object`) and the parcel-home instancer (`window.__satVeg.homeMesh`) are parked for BOTH pairs of the A/B |
| **why** | A SPRAWL took Powell from 15 streamed footprints to 1,863. The tint is a landcover multiply that only ever touches GROUND, so the pixels under test were evicted from the crop by roofs. |
| **A's control experiment** (the numbers this row re-bases) | `SAT_POLY_COVER` **off** → dL **−0.229** vs noise **−0.075** = PASS (3.1×) · `SAT_POLY_COVER` **on** → dL **−0.016** vs noise **0.074** = FAIL (0.2×) |
| **post-fix, measured here** | see the run row for verify-groundlife in §2 |
| **blast radius** | one `ab()` call. No constant moves. `TINT_NOISE_RATIO` 2.0 and `TINT_MAX_DELTA` 6.0 are UNTOUCHED, and the ceiling half gets *stricter* under the re-point (roofs parked ⇒ the crop is ~all landcover ⇒ |dL| is measured on the tint's worst case). Every other groundlife gate — canopy count, occupancy, shed, daylight-costs-nothing, road seam, night (E), Owens (G), toy (H) — is byte-unchanged. |

This is R17 §7.1 in its exact original form (*a pixel-probe gate must not
contain an actor it does not control*) and the fix is the same one that lesson
prescribed: park the actor. The hero and the traffic were already parked here;
the buildings joined that list the round they became real.

### 1b `scripts/verify-neon-cover.js` gate 3 — the OFF-branch control state widens

| | |
|---|---|
| **old** | the five frozen R18 toy hashes had to reproduce with `NEON_COVER.enabled:false` **alone** |
| **new** | they must reproduce with every R20 **toy-path** flag off: `NEON_COVER` + `TOY_MID_SUBURB` + `MONUMENT_MODELS` |
| **what did NOT move** | **the five hashes themselves.** `powell-full 33d299d9` / `powell-mid 8b699579` / `manhattan-full 176e2e75` / `manhattan-mid a6805b95` / `manhattan-far 473596c0` are R18 byte truth and stay R18 byte truth. Only the state a tree must be put in to reproduce them widened, because R20 landed two MORE toy-path coverage levers on top of F's. |
| **why** | `TOY_MID_SUBURB` (A) drops the z13 mid-ring floor 30→12 m and lifts `maxPerChunkMid` 180→240 ⇒ the two `-mid` rings move. `MONUMENT_MODELS` (C2) punches marquee footprint-exclusion discs inside `api`'s toy building pass ⇒ `manhattan-full` moves. C2 measured exactly this during W1: NEON_COVER-off alone left `powell-mid` and `manhattan-full` differing — a red that meant "two other features are also on", not "the revert path is broken". |

Rather than hard-code that list, the harness now **recomputes it from the
worker source every run** (new gate **3a**): it slices `vector-tile.worker.js`
into top-level function bodies, takes the part of `api` AFTER the satellite
early-returns as the toy pass, closes over the top-level helpers that pass
calls, and reports which R20 flags are reachable from it. Measured on this
tree:

```
3a  toy-reachable: {NEON_COVER, TOY_MID_SUBURB, MONUMENT_MODELS}
    satellite-only: {PARCEL_HOMES, SAT_POLY_COVER}
```

`PARCEL_HOMES` therefore does **not** touch toy-path bundles — asked explicitly
in the brief, and now asserted rather than asserted-by-comment: every one of its
references sits inside `buildSatVeg`, which the toy pass never calls. The day a
future round reaches a new flag from the toy path, gate 3a says so *by name*
instead of five hashes silently going red.

The OFF branch also gained an explicit control-state precondition, so a MIXED
state is reported as a control failure rather than as five broken hashes. That
distinction is the entire point of the row.

**Verified, not asserted.** With `NEON_COVER` + `TOY_MID_SUBURB` +
`MONUMENT_MODELS` + `PARCEL_HOMES` + `SAT_POLY_COVER` all flipped to `false`,
verify-neon-cover ran **ALL GREEN (11/11 gates, 2 m 27 s)** and gate 3 reported

```
powell-full 33d299d9/33d299d9   powell-mid 8b699579/8b699579
manhattan-full 176e2e75/176e2e75  manhattan-mid a6805b95/a6805b95
manhattan-far 473596c0/473596c0
```

— five for five, byte-exact, plus gate 5's `Powell chunk reproduces the void
(flag off) — bldgVerts 0`. **Cleanup verified:** the flags were restored with
`git checkout -- lib/fly/fly-constants.js` and `git status --porcelain` shows
`lib/fly/fly-constants.js` absent from the working set; the shipped state is
back to all five `enabled: true`. The only modified files are the two harnesses
named in this section.

### 1c `lib/fly/fly-constants.js` — `TOY_MID_SUBURB.maxPerChunkMid` 240 → 180

**The ONLY product value this round changed, and it changed under an explicit
Fable ruling** issued after the §4 soak breach was reported.

| | |
|---|---|
| **SHIPPED** | `enabled: true`, **`minH: 12` (unchanged)**, **`maxPerChunkMid: 180`** (was 240) |
| **ruling** | *the floor is the feature; the cap is the cost driver.* Sub-30 m buildings existing in the toy mid ring at all is what the user asked for; the raised per-chunk budget is what was assumed to be spending the triangles. |
| **trigger** | two armed 15-min soaks measured **2 633 649** and **2 349 013** triangles against a frozen 2.2 M budget; flag-off control **2 078 469** (§4) |

The 2.2 M budget did not move. `SAT_POLY_COVER`, `PARCEL_HOMES`,
`MONUMENT_MODELS`, `NEON_COVER`, `TOY_MID_SUBURB.enabled` and
`TOY_MID_SUBURB.minH` were not touched.

#### The ruling had a step 2. It was measured and REJECTED — here is why

Fable's ladder said: *if 180 still breaches, escalate to `minH 14` + 180.* **180
did still breach** (2 345 383), so step 2 was tried — and it produced a
**worse** number: `minH 14`'s probe soak came back at **2 581 118**. That is not
a regression, it is the acceptance metric failing, and chasing it would have
been R19 lesson 3 in a new costume:

> **The soak's `maxTriangles` cannot resolve this lever.** It is the maximum of
> a 15-minute time series that depends on the flown route, live ADS-B load and
> tile arrival order. **Same configuration, two runs: 2 633 649 and 2 349 013 —
> a spread of 0.284 M, LARGER than the entire feature delta of 0.267 M.**

So the lever was measured where it is deterministic: the worker's own
`buildTile(z, x, y, 'mid')` output — a pure function of the tile bytes plus
these constants, with no renderer, no traffic and no route in it. Building
triangles summed over five fixed z13 mid tiles (Powell / Columbus / Dublin /
Manhattan / Naperville):

| config | mid-ring building tris | vs flag-off | share of the feature's cost |
|---|---|---|---|
| `minH 30, cap 180` — flag OFF = R19 | **10 558** | baseline | — |
| `minH 14, cap 180` | 35 944 | +25 386 | — |
| **`minH 12, cap 180` — SHIPPED** | **37 826** | **+27 268** | — |
| `minH 12, cap 240` — as A shipped | 43 083 | +32 525 | — |
| **cap 240 → 180** (at `minH 12`) | | **−5 257** | **−16 % of the feature, ZERO feature loss** |
| `minH 12 → 14` (at cap 180) | | −1 882 | −5.8 %, and it costs real suburb |

**Verdict: ship the 16 %-for-free half, refuse the 5.8 %-for-feature half.** The
cap only bites in the densest chunks, so lowering it removes triangles nobody
can resolve; the 12–14 m band is thin, so raising the floor buys almost nothing
while deleting two-storey buildings. Extrapolating the curve, fitting under
2.2 M by floor alone needs `minH` around **20 m** — a six-storey building. No
suburb survives that, and "suburbs are visible past 8 km" is the round's point.

**The residual budget question is escalated in §4.** It is a budget-metric
problem, not a value this agent can tune away.

**Re-verification of the SHIPPED config** (`minH 12`, `maxPerChunkMid 180`), all
on the same server and tree:

| harness | result | the number that matters |
|---|---|---|
| verify-neon-cover | **10/10** | worst toy tris **1.691 M** (pre-tune 1.725 M); draws cruise 360 / powell 383 / **nyclow 427 ≤ 480** |
| verify-neon-city | **10/10** | unmoved |
| verify-neon-alt | **19/19** | cruise draws **336 ≤ 480**, ultra ring 22/22, void 0.0 % |
| verify-suburbia | **21/21** | Powell **kept 1 863 / houses 1 233 UNMOVED**, (G) 0 blocks in the band, **(E) Owens 179 ≤ 261** |
| verify-groundlife | **22/22** | §1d — the demotion landed |

An honest note on the ruling's premise: it expected the fixed-pose triangle
number to fall "back near the R19 1.448 M band". It did not — **1.725 M →
1.691 M, a 2 % move** — because the cap was never what bound those three poses;
at NYC-low the full/ultra rings dominate, not the mid ring. The deterministic
table above is what the cap actually buys.

### 1d `scripts/verify-groundlife.js` — the tint FLOOR half is demoted to informational

**Fable ruling, accepting this agent's §2 recommendation**, on the R17 §7.1
precedent (the same demotion verify-sat-night's residual road-pixel gates
received once they were shown to be measuring something they did not control).

| | |
|---|---|
| **old** | `gate('landcover tint darkens, and beats its live noise control by 2x', …)` |
| **new** | a `console.log` prefixed **INFORMATIONAL (demoted R20)** that still prints the numbers and states which way the retired bar would have gone; the gate slot is replaced by a real one — **the tint mesh streamed and is drawing at this pose** |

**A's earlier 3.1× PASS was the same coin as this agent's 0.83× FAIL.** That is
the whole finding, and it is recorded in the inline comment: nothing in the tint
changed between those two draws. The 6-pair distribution diagnostic
(signal 0.152 ± 0.179, control 0.146 ± 0.148, **A/A-with-nothing-toggled
0.109 ± 0.201**, pooled ratio **1.04×**, crop drift **0.13 luma per 1.6 s
interval**) is reproduced in full at the edit site so the next round does not
have to rediscover it.

**Still load-bearing, all passing:** the tint STREAMS (Powell 738 tris / 8
chunks), it SHEDS (`visible === tris >= minPolys` — the lever the Owens draw
ledger rests on), it stays a GRADE not paint (|dL| ≤ 6.0, passing with ~18×
margin), and Owens holds **179 ≤ 261** with it armed. verify-groundlife is
**22/22** after the demotion, and the informational line on that run read
`-0.339 vs noise -0.188 → would fail the retired 2x bar` — a frame in which the
tint is demonstrably present and drawing.

---

---

## §2 — RUN TABLE

| # | Harness | Result | Wall | Notable numbers vs ceilings | Retry / notes |
|---|---|---|---|---|---|
| 1 | **verify-sat-night** | **33/33** | 231 s | road census night 14/14 meshes (ready 14), noon 14/14, ONE material uuid both legs, uRoadNight 1→0 · Manhattan night draws **220 ≤ 375** at 782 m AGL · (E) solid Δ **19.81**, gone **0.71**, A/A noise **0.14** — eviction is 3.6 % of the solid signal against a 15 % bar · fade 1 → 0.503 → 0 across 2000/2700/3100 m | none — first run green |
| — | verify-classify (node) | **PASS** | <1 s | bonus change set is exactly the audited 20 over 538 codes; 170 warbird bonuses byte-unchanged | none |
| — | verify-warbirds (node) | **PASS** | <1 s | 58 modern codes OLD===NEW; B29 exact 47 vs substring 60 | none |
| — | verify-daily (node) | **PASS** | <1 s | pickDaily clamps to pool 9; spotAdvances 10/10 | none |
| 2 | **verify-neon-cover** (post-§1b) | **10/10** | 152 s | flag ON, all five toy rings differ from R18 · **3a inventory recomputed clean** · 4b 6 sat scenes rebuilt identically · Powell chunk bldgVerts **11 973** / landIdx 13 359 / water 585 · **toy draws cruise 359 / powell 382 / nyclow 428 ≤ 480**, worst tris **1.725 M ≤ 2 M** | none. The OFF branch was separately verified in §1b (11/11). |
| 3 | **verify-icons** | **49/49** | 92 s | 10 GLBs legal + ≤ 1 MB + COLOR_0 · exclusion radii 25–190 m (max 190 ≤ 250) · ESB top **626.78 = hM×1.35 exactly** (toy) and **613.48** (sat) · marquee = **+1 draw median in BOTH styles** · toy draws **437 ≤ 480**, sat **240 ≤ 375** · **F: 0 streamed centroids inside ESB 60 m / Taj 105 m discs** (control 8 @4.4 m, 10 @8.3 m) with non-vacuity witnesses 119 / 24 neighbours still streaming · toy nearest building vertex **91.6 m** (control 3.7 m) | none |
| 4 | **verify-monuments** | **12/12** | 51 s | statue placed d=0 m, sy 126, letter clears the top, monument reads 16.245 % of frame · **`landmark-*` still exactly 10 meshes** (gate 8 unmoved) · Δ-draw 9 inside [1,15] · toy draws **399 ≤ 480** | none. §5.1's sanctioned union re-point was consumed by C, values unchanged. |
| 5 | **verify-monuments-sat** | **10/10** | 41 s | **FROZEN harness, untouched all round** — statue on raw DEM y=690=dem, sy 51, letter contract intact, Δ-draw 10, draws **227 ≤ 480** | none |
| 6 | **verify-parcel-homes** | **21/21** | 241 s | Melton **2 068 homes off 449 anchors**, regK 0.73, **Δ-draw median exactly 1** ([1,1,1]), draws **233 ≤ 375** · heights **5.00–12.11 m — nothing in the (25,35) band** · night emissive **0.780** through an emissiveMap, day **exactly 0** · Powell **75 anchors, 0 placed, 75/75 suppressed, regK 0.00, Δ-draw [−1,0,0]** (A's real footprints win) · Blagnac 181/0 · Plain City 173 at regK 0.44 (the ramp) · **Owens 0 anchors / 0 homes / no mesh, draws 179 ≤ 261**, Lone Pine non-vacuity 69 anchors all suppressed | none |
| 7 | **verify-suburbia** | **21/21** | 121 s | **Powell kept 1 863 of 1 863 parsed** across 16 chunks (pre-R20: 15) · **houses 1 233** (pre-R20: 0), 66.2 % small share · suburban invented max **13.3 m** (pre-R19 42.0) · Columbus kept **7 971** of 26 869 · 13 distinct roof forms, flat-only **0.00 %** · far-mass **1 774 low blocks** · **(G) 0 blocks in the forbidden (25,35) m band** · **(E) Owens skyline ready 0, draws 180 ≤ 261**, non-vacuity **769 columns** in Owens' detail ring (pre-R20 ~10) | none |
| 8 | **verify-sat-buildings** | **17/17** | 94 s | **(F1) per-chunk POLYGON cap 500 binding** over Manhattan (16 chunks, 6 966 total) · **(F2) widest collision cylinder 305.9 m across 6 965 columns — control 3 391** (the latent R18 per-feature-column defect stays retired) · **(F3) kept 6 966 vs 3 483 control** · Manhattan draws **220 ≤ 375**, Tokyo **221** · buildings on raw DEM base 103 / dem 109 at z17 | none |
| 9 | **verify-skyline** | **18/18** | 125 s | **(E) Owens skyline ready 0 / 10 chunks empty, draws 181 ≤ 261** · hole 4000 → 1912 → 0 across the crossfade, skyline solid at fade 1 · mass A/B flip **7.945 % vs 1.310 % noise** · NYC cruise **169**, NYC low **233** ≤ 375 | none |
| 10 | **verify-veg** | **24/25 → 25/25 on retry** | 215 s | Central Park canopy **1 177 placed**, Owens **1 157** at **1 draw**, Owens draws **179** · NY Upper Bay 48 boats + 21 plumes · Bayonne 993 canopies | **RED on one gate — diagnosed below and retried.** |
| 11 | **verify-roof-variety** | **18/18** | 119 s | **Manhattan triangles 0.80 M ≤ 1.6 M** (the frozen ceiling, half-used) · small-footprint share **49.7 %** (R15 measured 0.000) · building-vs-imagery delta **−27.8** inside the pinned [8,38] band · per-building luma std 46.5 · draws Manhattan **233** / Loop **217** / Naperville **263** / Upper Bay **213**, all ≤ 375 · 13 roof forms, flat-only 0.00 % | none |
| 12 | **verify-sat-depth** | **6/6** | 61 s | hillshade mean \|Δ\| 10.85, strength 0.55, aniso **8**, z17 streams | none |
| 13 | **verify-aerial** | **16/16** | 173 s | satellite boot **11.3 s** vs a 28.8 s cap · mid-band Δ **7.29**/255 (floor 2.0, noise 0.21) · **near field Δ exactly 0.000** (the sat-depth contract) · aniso 8, tiles **≈66 MB across 197** (cap 300) · quilt desat 0.350 = ramp · shadow crop darkened 4.71 luma · **Owens draws 195 ≤ 261 with EVERYTHING armed** | none |
| 14 | **verify-groundlife** | **21/22 → 22/22 after the §1d demotion** | 225 s / 210 s | Powell residential canopy **227** placed · tint 738 tris / 8 chunks, sheds correctly · night house lights **2 232** (4 000 on the subdivision pose) · **Owens noon 179 / night 180 ≤ 261** · toy mounts none of it | RED on one gate — the §1a gate itself. Diagnosed, retried, measured, and CLOSED by Fable ruling §1d. Post-demotion run: **22/22**, Owens **179**, informational line `-0.339 vs noise -0.188`. |
| 15 | **verify-neon-city** | **10/10** | 57 s | facade grid / runway glow / beacons / pulses all armed · skyline windows 1.11 % (floor 0.2), no white-out · beacon minY exactly **150 m** · town glow pool 72 | none |
| 16 | **verify-neon-alt** | **19/19** | 43 s | spawn band EXACTLY 14 000 / 26 000 static, grid 0.42, ultra 0 · cruise band **47 346 → 81 576**, ultra **22/22 ready**, grid 0, TownGlow to 73 756 m · **cruise draws 342 ≤ 480** · void fraction **0.0 %** · descend re-clamps to 26 339 and the grid returns | none |
| 17 | **verify-roofs** | **10/10** | 52 s | toy draws **415 ≤ 480** | none. Run because `TOY_MID_SUBURB` moves the toy building admission path. |
| 18 | **verify-window-grids** | **8/8** | 50 s | toy draws **420 ≤ 480** | none. Same reason. |
| 19 | **verify-edge-fx** | **20/20** | 169 s | toy draws 426 / 408 / 348, day 214 — all ≤ 480 · toy cloud floor 1 641 m AGL | none. Run because `world-bend.js` gained a cache-key variant. |
| 20 | **verify-poi** | **4/4** | 77 s | letters unmoved | none. Run because `LandmarkMonuments.jsx` changed and the marquee has a letter contract. |
| 21 | **verify-rim** | **5/5** | 61 s | rim/sky dip intact | none. `world-bend.js` consumer. |
| 22 | **verify-round11** | **13/13** | 50 s | draws **233**, satellite perf floor intact | none. `SatBuildingLayer.jsx` consumer. |
| 23 | **verify-crash** | **23/23** | 274 s | **A changed the collision columns, so this is a must-run.** Building crash fires above 45 m/s off the REAL engine (epoch 2→3, kind building) and is silent at 32.7 m/s · toy never crashes on the same column · respawn at **EXACTLY ground+400.000 m** · arm gate 7.0 s · boost meter drains to 0.011, blocks, re-arms to 0.517 · autopilot exempt both ways · Forgiving restores the R17 slide | none |
| 24 | **verify-fleet** | **37/37** | 40 s | **the count arithmetic survives `assets.js` +119**: manifest **19 model GLB entries**, TRAFFIC_MODELS **9 mapped slots of 13 meshes**, no primitive fallbacks · **every GLB ≤ 1 MB incl. all nine monuments** (ESB 10 KB … Colosseum 407 KB) | none |
| 25 | **verify-hangar** | **17/17** | 196 s | 9 aircraft, flight.cfg seam, phone leg clean | none. `assets.js` consumer. |
| 26 | **verify-boot** | **PASS both styles** | 53 s | toy ready **12.96 s**, satellite ready **11.99 s**; monotone progress traces; **sun-at-spawn 0.968 vs model 0.968** · monument GLBs do NOT gate boot (the §4 `runtime.modelsReady` contract) | none |
| 27 | **verify-tracers** | **6/6** | 49 s | tracers still drawing across style flips | none |
| 28 | **verify-dusk** | **15/15** | 152 s | pinned noon frame **0.0510** vs control **0.1198** (indistinguishable) · golden band Δwarm **1.84** / Δluma **7.47** · P9 el **+2.064° reads dusk with stars EXACTLY 0** · night at −8.343° with glow exactly 0 · **cirrus costs exactly +1 draw (221 vs 220)** | none |
| 29 | **verify-feel** | **13/13** | 125 s | cruise strength **exactly 0** (speedFrac 0.240) · **cruise draws 410 armed === 410 unmounted** · boost FOV **+2.96°** vs flag-off control +0.79° · post-warp hands-off **2300 → 2300 m (Δ 0.0)**, parked cursor at pitch −0.471 also 0.0 · cinema refuses 21 nm, close pair standoff **987 m** both framed · FL180 = 6 letters | none. The documented-marginal streak gates were COMFORTABLE this run: gate 2 A/B 0.0166 vs A/A 0.0508, gate 7 frame A/B 4.37 vs floor 3.03. |
| 30 | **verify-fly-game** | **PASS** | 38 s | inspect modal + turntable, canvases 3→4→3, warp jump 14 549 u, arrival 654 m, lock held across the warp, audio ctx running, **no hover flake this run** | none |
| 31 | **verify-airbend** | **PASS** | 40 s | 391 samples, **0 violations**, 93 grounded-OK / 0 soft | none. `world-bend.js` consumer. |
| 32 | **verify-sat-mobile** | **10/10** | 79 s | phone satellite renders; tier policy resolve/never-high/explicit-pick all hold with the NEW parcel-home layer in the tree | none. Run because `SatVegLayer.jsx` now mounts a new layer and low/medium tiers must not pay for it. |

---

## §5 — INTEGRATION-SEAM SPOT CHECKS

These ran BEFORE the sweep, are cheap, and are the reason this agent exists.

### 5a — a marquee monument and a parcel-homes suburb over the same ground

A marquee monument INSIDE a `PARCEL_HOMES` suburb cannot exist by construction:
the marquee set is ten city landmarks and the home layer arms on a regional
residential DEFICIT. The nearest real interaction is **ESB / Manhattan**, where
both features are armed over the same tiles. Live probe, satellite, tier high,
900 m over ESB (45 s settle):

```
parcelHomes  placed 0  anchors 0  tris 0  regK 0.00
             regionalDens 23 306.6 /km²res   realCols 3 337   meanScalar 0
monuments    style satellite · placed [Empire State Building, Statue of Liberty]
             loaded 10/10 models
draws 229 · tris 536 428 · satBuilding chunks 16 · pageerrors 0
```

`regK` is exactly **0**, so the home layer places **nothing** at Manhattan and
the two features never contend for a parcel. The worker-level probe agrees and
shows why the term saturates — `scripts/r20-b-parcels.js` on this tree, 3×3 z14:

| scene | residential km² | real footprints kept | kept per km² res | cls-4 anchors |
|---|---|---|---|---|
| manhattan | 1.58 | 4 335 | **2 749.7** | 414 |
| powell | 1.64 | 873 | 533.3 | 657 |
| dublin | 11.16 | 2 914 | 261.2 | 506 |
| craigieburn-au | 22.72 | 1 206 | 53.1 | **0** |
| owens (gate pose) | 0.99 | 580 | 587.5 | 137 |

Manhattan sits at 5× Powell's real-footprint density; the deficit term cannot
open. **Both W1/W2 features were confirmed live in the same frame** — C's
marquee mesh placed ESB + Liberty while B's instancer stayed at zero.

### 5b — the two worker features COMPOSE to a byte-exact no-op when off

C2's marquee footprint exclusion and B's satParcel emission were merged into
`vector-tile.worker.js` by git, on top of A's per-polygon explosion, and each
agent proved only its OWN flag-off identity. The composition was untested.

Method: a second detached worktree at **main `dda4009`** (the last certified
R19 tree), its own `next dev` on `:3124`, and `scripts/r19-f-fingerprint.js`
run against BOTH servers — the R19 baseline, and this integrated tree with all
**four** R20 flags (`SAT_POLY_COVER`, `TOY_MID_SUBURB`, `PARCEL_HOMES`,
`MONUMENT_MODELS`) flipped to `false`. `NEON_COVER` stayed ON in both legs
because it is R19's flag and is on in main.

| scene | R19 baseline `dda4009` | R20 tree, four flags off |
|---|---|---|
| powell-full | `449e732e` | `449e732e` |
| powell-mid | `5df2231b` | `5df2231b` |
| manhattan-full | `ea7b3588` | `ea7b3588` |
| manhattan-mid | `469f5a79` | `469f5a79` |
| manhattan-far | `b594c910` | `b594c910` |
| sat-buildings-manhattan | `e6b44c38` | `e6b44c38` |
| sat-buildings-powell | `8a8a67f5` | `8a8a67f5` |
| sat-veg-manhattan | `cc5328a6` | `cc5328a6` |
| sat-veg-powell | `a64098f8` | `a64098f8` |
| sat-roads-powell | `0d8b4300` | `0d8b4300` |
| sat-skyline-manhattan | `af892789` | `af892789` |

**11/11 byte-identical**, including element counts. Three agents' worker edits
(+489 lines, two owners inside one file) compose to an exact no-op with their
flags off — the strongest available statement that the merge introduced no
cross-feature coupling. This also re-derives the four one-line reverts as REAL
reverts on the integrated tree, not just on each agent's own branch.

`WORKER_PROTOCOL 15→16` is invisible to this test by design (the fingerprint
excludes `v` and `tessMs`), which is correct: the protocol pin is a cache-bust,
not an output change.


### The two REDS, in full

Two harnesses went red in the sweep. One was a flake and is green on retry. One
survived its retry, and per the retry policy the sweep STOPPED on it, recorded
it, and continued — **it is the one item on this ledger that needs a Fable
ruling.**

#### verify-veg — RED then GREEN (flake, one retry, both runs recorded)

| run | result | canopy A/B at Central Park | verdict |
|---|---|---|---|
| 1 | **24/25** | greener **0.92 %** vs live noise **0.49 %** = **1.88×**, bar 2.5× | FAIL |
| 2 (retry) | **25/25** | greener **1.13 %** vs live noise **0.41 %** = **2.76×** | PASS |

Diagnosis before the retry: run 1's *control* pair moved MORE luma than its
*signal* pair (mean \|dLuma\| 2.54 vs 2.42) — the signature of a transient
inside the 1.6 s control interval, not of a weakened canopy. Placement was
identical and healthy in both runs (**1 177 canopies at Central Park**, gate
"≥ 200" passing by 6×), and every other veg number was unmoved. Retried once,
green, and the canopy count was never in question. Recorded as a flake on a
live-noise-control gate, which is the class R16 §7 created deliberately.

#### verify-groundlife — RED, retried, STILL RED: gate (C) first half

**This is a gate that stopped working, not a feature that regressed, and the
evidence for that is now conclusive.**

| run | signal dL | live control | ratio | bar |
|---|---|---|---|---|
| A's pre-merge control, `SAT_POLY_COVER` **off** | **−0.229** | −0.075 | 3.1× | PASS |
| A's pre-merge control, `SAT_POLY_COVER` **on** | **−0.016** | 0.074 | 0.2× | FAIL |
| D run 1 — §1a park applied | **−0.202** | −0.114 | 1.77× | FAIL |
| D run 2 — park made leak-proof + 3 s settle | **−0.213** | −0.256 | 0.83× | FAIL |

The §1a re-point **did exactly what it was supposed to do**: the tint's measured
effect went from −0.016 (evicted by roofs) back to **−0.202 / −0.213**, i.e.
within 7–12 % of its own pre-R20 value of −0.229. The ground is back in the
crop and the feature is measurably unchanged by R20.

What the retry exposed is that the *control* is not stable. So this agent ran a
**distribution diagnostic** (not a third retry — a measurement): the harness's
exact pose, sun pin, crop, spacing, metric and parking, repeated 6× in one
session, with a FOURTH shot added per iteration to measure a pure A/A of the
**tint-off** state — a pair in which nothing whatsoever is toggled.

```
pair 1: signal -0.226  control -0.176  A/A(off,off) -0.284   mean 95.89
pair 2: signal  0.267  control  0.278  A/A(off,off)  0.263   mean 95.92
pair 3: signal  0.198  control  0.206  A/A(off,off)  0.196   mean 95.01
pair 4: signal  0.153  control  0.172  A/A(off,off)  0.137   mean 94.31
pair 5: signal  0.181  control  0.194  A/A(off,off)  0.016   mean 93.72
pair 6: signal  0.336  control  0.203  A/A(off,off)  0.324   mean 93.38

SIGNAL   mean  0.152  sd 0.179   min -0.226  max 0.336
CONTROL  mean  0.146  sd 0.148   min -0.176  max 0.278
A/A off  mean  0.109  sd 0.201   min -0.284  max 0.324
POOLED |signal|/|control| = 1.04x
```

Two facts fall out, and together they settle it:

1. **The A/A floor is the same size as the signal.** A pair where NOTHING is
   toggled scores 0.109 ± 0.201 — statistically indistinguishable from the
   "signal" (0.152 ± 0.179) and the "control" (0.146 ± 0.148). Pooled over six
   pairs the ratio is **1.04×**. The instrument cannot resolve this feature at
   this pose in either direction.
2. **The pose carries a monotonic drift.** The crop mean walks 95.89 → 93.38
   over the ~35 s of the run — about **0.13 luma per 1.6 s interval**, which is
   precisely the magnitude of every "noise" number above. Both the control pair
   and the signal pair sit on that ramp, and a single pair cannot separate a
   ramp from a step.

**Therefore the earlier PASSES were coin flips too.** A's flag-off 3.1× and this
agent's 0.83× are draws from the same distribution; nothing in the tint changed
between them. This is R19 lesson 3 in a new costume — *a gate that differences
breathing scene totals is a coin* — and R17 §7.1's deeper point: the actor this
gate failed to control was never only the buildings, it was the pose's own
settling.

**What IS certified about the landcover tint, on real gates that passed:**

* it streams and is present — **738 tris across 8 chunks at Powell**, 103 across
  5 at Owens;
* **gate (D) passes**: `visible === (tris >= minPolys)` — the shed contract the
  entire Owens draw ledger is built on;
* **the ceiling half of gate (C) passes with ~30× margin**: \|dL\| ≈ 0.2 against
  `TINT_MAX_DELTA` 6.0, so "an albedo grade, never paint" is proven;
* Owens noon **179** and night **180**, both ≤ 261, with the tint armed;
* every other gate in the harness (21 of 22) is green in both runs.

**Recommendation to Fable — a ruling this agent did not take on itself,**
because the brief sanctioned re-POINTING this A/B, not moving any gate's
assertion. In rough order of honesty:

1. **Demote the floor half of (C) to informational**, exactly as R17 §7.1 did to
   verify-sat-night's residual road-pixel gates, keeping the ceiling half and
   gate (D) as the real contracts. The measurement above is the control
   experiment that justifies it.
2. **Re-point (C) at a pose where the tint owns the crop** — Owens or open
   farmland, where landcover is most of the frame instead of a fraction of a
   built suburb. This preserves a real floor gate but is a new measurement, not
   a re-baseline.
3. Rebuild it as an N-pair pooled A/B with an in-run A/A floor. The data above
   suggests N = 6 is still not enough separation, so this is the weakest option.


---

## §3 — SKIPPED ON BYTE IDENTITY (short, and each row argued from the diff)

Every harness below covers product code that is **byte-identical** to the tree
where it was last recorded green. The proof is the `git diff dda4009..HEAD`
stat at the top of this file: no file these gates touch appears in it. R20
changed satellite ground/buildings, the toy mid ring, and a monument overlay —
it did not touch traffic ingest, the HUD, contracts, the logbook, photo mode,
the mobile layout, weather, or the player flight model.

| Harness | Subsystem it gates | Last recorded green |
|---|---|---|
| verify-weather | `/api/weather`, weather-model | R19 close (`dda4009`) — no weather file in the diff |
| verify-contracts · verify-living-contracts · verify-logbook · verify-daily (browser legs) | progression, passport UI | R19 close — no store or panel in the diff |
| verify-photo | photo mode capture path | R19 close |
| verify-juice · verify-spicy | near-miss / combo / music / SPICY pings | R19 close — no traffic file in the diff |
| verify-mobile · verify-mobile-layout | phone zones + 44 px targets | R19 close. **verify-sat-mobile WAS run** (row 32) because `SatVegLayer.jsx` now mounts a new layer and the low/medium tiers must not pay for it. |
| verify-chase-cam · verify-freelook · verify-warp-arrival · verify-player-nose | camera + warp | R19 close — `FlyScene.jsx`'s delta is two mount lines |
| verify-inspect-actions | inspect card wiring | R19 close (verify-fly-game exercised the same modal, row 30) |
| verify-fly-models · verify-fly-style · verify-fly-formation · verify-style-retire | traffic archetype meshes | R19 close (verify-fleet audits the same meshes and was run, row 24) |
| verify-atlas · verify-airport-buzz | fast travel, airport gameplay | R19 close |
| verify-globe · verify-globe2 | curvature basics | R19 close — `world-bend.js`'s consumers were covered by rim / airbend / edge-fx / neon-alt, all run |
| verify-sun | sun-model | R19 close — verify-boot's sun-at-spawn gate re-asserted it anyway (0.968 vs model 0.968) |

**What this ledger does NOT claim.** It does not claim every harness in
`scripts/` ran today. It claims that (a) 32 browser harnesses + 3 node gates ran
on the integrated tree today, (b) every subsystem the product diff touches was
covered by at least one of them, and (c) the rows above rest on byte identity
plus their cited green.

It also does **not** claim the landcover tint's floor gate is passing — see the
verify-groundlife section. It claims that gate is a coin, with the measurement
to prove it.


---

## §4 — SOAK

`node scripts/soak-fly.js` against `:3123`. The soak boots the **toy (Neon)**
world (`_boot.js` seeds `'toy'` with no style argument), so the applicable
budgets are the toy ones: draws ≤ 480, triangles < 2.2 M.

**SHIPPING CONFIGURATION** (`TOY_MID_SUBURB: enabled true, minH 12,
maxPerChunkMid 180`), two full 15-minute armed runs. `scripts/soak-results.json`
holds run B.

| | run A | run B | target | |
|---|---|---|---|---|
| samples | 78 | 78 | | |
| worst p95 | 11.1 ms | 12.5 ms | R18 band 8.4–12.6 | ok |
| fps floor ≈ | **90.1** | **80.0** | ≥ 55 | **PASS** |
| max draw calls | **440** | **444** | ≤ 480 | **PASS** |
| **max triangles** | **2 345 383** | **2 549 294** | **< 2 200 000** | ⛔ **over** |
| heap | 457 → 194 MB | 525 → 403 MB | no monotonic climb | **PASS** |
| max rebase | 0.30 ms | 0.70 ms | | **PASS** |
| pageErrors | **0** | **0** | 0 | **PASS** |
| live traffic peak | 799 | **1 616** | | |

Run B carried **1 616 live aircraft** — the heaviest load this fleet has ever
soaked (R19's record was 1 145) — with zero page errors, a stable heap and
444 draws. Six of the seven targets pass on both runs.

### THE FULL SOAK DATASET, and what it actually shows

| config | minutes | max tris | traffic peak |
|---|---|---|---|
| `minH 12, cap 240` (as A merged) | 15 | **2 633 649** | 960 |
| `minH 12, cap 240` (as A merged) | 15 | **2 349 013** | 593 |
| **`minH 12, cap 180` — SHIPPED, run A** | 15 | **2 345 383** | 799 |
| **`minH 12, cap 180` — SHIPPED, run B** | 15 | **2 549 294** | 1 616 |
| `minH 14, cap 180` (ruling step 2) | 6 | 2 581 118 | — |
| **flag OFF** (`minH 30, cap 180`) — R19 behaviour | 5 | **2 078 469** | 1 070 |

**Same-configuration spread:** `cap 240` gave {2 633 649, 2 349 013} = **0.284 M
apart**. `cap 180` gave {2 345 383, 2 549 294} = **0.204 M apart**.
**The whole feature delta — armed vs flag-off — is 0.267 M.**

> **The metric's run-to-run noise is the same size as the thing it is
> rejecting.** No single-run `maxTriangles` reading can accept or reject any of
> these configurations, and every apparent "improvement" or "regression" in the
> table above is within that noise. This is R19 lesson 3 wearing a performance
> budget instead of a pixel gate.

It is not traffic, either — the flag-off control saw the second-heaviest load
(1 070) and produced the lowest triangle count, and the very worst reading in
the whole set (2 633 649) landed at **377 aircraft**.

### What IS solid, measured deterministically

Because `maxTriangles` could not answer the question, the lever was measured
where there is no renderer, no route and no traffic: the worker's own
`buildTile('mid')` output over five fixed z13 tiles (§1c). That measurement is
repeatable to the triangle and it is what the shipped tune rests on:

* `cap 240 → 180` removes **16 %** of the feature's triangle cost for **zero
  feature loss** — SHIPPED.
* `minH 12 → 14` removes **5.8 %** and deletes real two-storey suburb —
  REFUSED.
* Fitting under 2.2 M by floor alone implies `minH ≈ 20 m`, which would gut the
  feature the round exists to deliver.

### The ask

**This needs a Fable/product decision, and it is the one open item on this
ledger.** Three coherent options, in the order this agent would rank them:

1. **Re-negotiate the soak triangle metric, not the feature.** `maxTriangles`
   is the max of a noisy series; a **p95 across samples**, or a fixed-pose
   deterministic budget, would actually gate what it claims to. R13 has the
   precedent — it re-negotiated the R7-era soak numbers with a measured
   rationale. On the shipping runs the *typical* frame is far under budget; only
   the transient peak is not.
2. **Accept 2.55 M as the R20 toy budget** with the deterministic table as the
   rationale, and hold `< 2.2 M` for satellite.
3. **Hold 2.2 M as hard** and accept that the toy mid-ring feature must shrink
   to roughly `minH 20`, i.e. mostly back out of the "suburbs past 8 km" ask.

Every flag flip used for these experiments was reverted with
`git checkout -- lib/fly/fly-constants.js`; the shipped state is verified as
`enabled: true`, `minH: 12`, `maxPerChunkMid: 180`, with the other four R20
flags all `enabled: true`.

---

## §6 — EVIDENCE

Regenerated **once, on this integrated tree, in this sweep** (the `3b6704d`
convention: evidence regenerates only at round close, on the merged tree, in one
pass). `git status` after the sweep shows **≈160 tracked PNGs modified**,
covering every harness that shoots:

`r16-satnight-01..08` · `icons-01-esb-{toy,satellite}-gl` ·
`monuments-01/02`, `monuments-sat-01` · `r19-a-*` (suburbia) · `r13-bldg-*`
(sat-buildings) · `r18a1-*` (roof-variety) · `r18a2-*` (skyline) · `r18a3-*`
(veg) · `r18a5-*` (crash) · `r19-b-aerial-01..09` + the four control pairs ·
`r19-c-*` (groundlife) · `r19d-01..07` (dusk) · `r19-e-01..06` (feel) ·
`neon-*`, `neon-alt-*`, `roofs-*`, `grids-*`, `edge-*`, `rim-*`, `round11-*`,
`satdepth-*`, `tracer-*`, `fleet-*`, `hangar-*`, `game-*`, `boot-*`,
`airbend-01`, `sat-mobile-01` · `soak-results.json`.

**Left alone, as instructed:** every `scripts/r20-a-*`, `r20-b-*` and `r20-c-*`
PNG — the agents' own before/after evidence, already committed. `git status`
confirms none of them moved.

---

## §7 — ANYTHING NOT CERTIFIED

1. **The 2.2 M soak triangle budget does not fit, and the metric cannot judge
   the fix.** Shipping config measures 2 345 383 / 2 549 294 across two 15-min
   runs; the same-config spread (0.204–0.284 M) is as large as the whole feature
   delta (0.267 M). Fable's ruling was executed — `maxPerChunkMid` 240 → 180
   ships (−16 % of the deterministic cost, zero feature loss) — and the ruling's
   step 2 (`minH 14`) was measured and refused (−5.8 %, costs feature, and its
   own probe read *worse* at 2 581 118). **§1c and §4 carry the deterministic
   table; §4 carries three ranked options. This is the ONE open item.**
2. **verify-groundlife gate (C), floor half — CLOSED.** Demoted to
   informational by Fable ruling on this agent's measurement (A/A-with-nothing-
   toggled 0.109 ± 0.201 against a "signal" of 0.152 ± 0.179; pooled 1.04×; crop
   drift 0.13 luma per 1.6 s). A's earlier 3.1× PASS was the same coin. The
   stream / shed / ceiling / Owens halves stay load-bearing and pass; the
   harness is **22/22**. §1d.
3. **verify-veg's canopy A/B is a live-noise-control gate and flaked once**
   (1.88× then 2.76× against a 2.5× bar). Green on retry, both runs recorded. A
   future red there should be control-experimented before it is believed.
4. **The §3 skipped rows were not re-executed today** — they rest on byte
   identity plus their cited green.
5. **verify-neon-cover's OFF branch is exercised by hand, not by the harness.**
   The constants are baked at module scope (`const classifyToy = NEON_COVER…`),
   so no browser-side pin can flip them. §1b's verification was a real source
   flip, run, and revert — but it is a manual procedure, and the next round has
   to repeat it deliberately.
6. **Monument LICENSING was verified by verify-icons gate A** (allowlist +
   named authors + CREDITS reachability) — that is a source-and-manifest check,
   not a legal review. The withdrawal of the four Meta MPT models during W1 is
   recorded in C's commit, not re-litigated here.
7. The **worst p95 is 12.5 ms** against R19's 8.4 ms. It sits inside R18's
   recorded 8.4–12.6 ms band and the fps floor is 80.0 against a 55 target, so
   it is reported, not flagged — and run B carried 1 616 live aircraft, 41 %
   above R19's record load, while holding it.
8. **`minH 14` was built, measured and thrown away.** It is not in the tree.
   Anyone re-opening the budget question should start from §1c's deterministic
   table rather than re-running soaks.

## Fable close ruling (appended at round close)

The soak's scene-total max-tris assertion is DEMOTED to informational with
the live-traffic count recorded at the max sample. Justification: D's
measurement above — same-config run spread (0.204–0.284 M) equals the entire
TOY_MID_SUBURB feature delta (0.267 M), and the flag-off control saw the
highest traffic of all runs with the lowest triangles. A budget whose noise
equals the thing it rejects is not a gate (R16: scene totals are not a
signal in live flight). The load-bearing triangle ceilings are the
deterministic fixed-pose gates (verify-neon-cover worst toy 1.691 M <= 2.0 M,
green). Future soaks assert p95-of-samples <= 2.2 M in place of max. The
2.2 M figure itself is NOT raised.
