# FLY ROUND 22 — "TERRAIN & IMMERSION" (RECORD)

> **STATUS: SKELETON (authored W1 by E CERT — the R21 W1 idiom).**
> Every section below is a spine with its evidence slots empty. E fills §4/§5
> at W2/W3; each implementation agent's headline lands in §1 as Fable merges
> it. Placeholders read `— (W2)` / `— (W3)`. The plan is
> [FLY_ROUND22_PLAN.md](FLY_ROUND22_PLAN.md); the certification ledger is
> [scripts/r22-close-sweep.md](scripts/r22-close-sweep.md);
> [FLY_ROUND22_HANDOFF.md](FLY_ROUND22_HANDOFF.md) ("Cinematic Night") is
> DEFERRED INTACT to R23 and must be byte-untouched at close.

---

## §0 Mandate — three symptoms, reported live

The user flew the R21 build in satellite and reported three things (two
screenshots). Each is traced below to named code, and each has a measured
instrument that could not have been built from the R21 fleet.

| # | Symptom, in the user's words | Traced to | Instrument (NEW this round) |
|---|---|---|---|
| 1 | "the world still feels flat / not immersive at low altitude" (Lewis Center OH, ~550 ft AGL) | z17 imagery only below ~930 m AGL; DEM stops at z15; the satellite shadow rig casts onto a terrain set that never receives; zero AO; 42-triangle sphere "trees"; no ground clutter at all; nothing atmospheric in the first 800 m | `verify-terra` (camTileZ by AGL band), `verify-depth2` (receive-set census, frame-time ledger), `verify-clutter` |
| 2 | "post-warp terrain stays blurry" (Atlas warp to Dublin OH at FL300) | `WarpFlash.jsx:43-50` reveals on `engine.downloading < 3` — an instantaneous count with no content check; `warpToGeo` never notifies the quadtree; three-tile refines one zoom per serial round-trip; **Esri imagery/DEM have zero persistent cache** | `verify-arrival` (camTileZ AT the reveal moment, against the departure pose) |
| 3 | "things glitch a little a few seconds after boot/warp" — clarified interactively to **late pop-in + brief stutter**, not tone shifts | the prewarm cannot start until the HDRI resolves and the reveal proceeds at `PREWARM.maxMs` regardless; no streaming layer has a birth fade; parcel homes pop ~2 000 instances at once; the governor ladder has zero DPR rungs at devicePixelRatio 1; raw `groundElev` sweeps every AGL fade band | `verify-settle` (per-layer t90 vs reveal; post-reveal program count; ladder shape; slew rate) |

**The R21 fleet was structurally blind to all three** — it measures whether the
frame HOLDS STILL, and every one of these is a question about whether the right
thing is IN the frame. See `scripts/r22-close-sweep.md` §0.

---

## §1 What shipped

### 1.1 A TERRA — sharpness, streaming speed, raster cache
— (W2)

### 1.2 B SETTLE — arrival gates, prewarm, birth fades, settle calm
— (W2)

### 1.3 C CLUTTER — ground life
— (W2)

### 1.4 D DEPTH — shadows, AO, near-field atmosphere
— (W2) · **ships `DEPTH_PASS.enabled:false` pending user checkpoint #3;
certified in BOTH states.**

### 1.5 E CERT — instruments and gates
Five new harnesses, each RED-calibrated on the pre-R22 tree BEFORE any fix
merged: `verify-terra` (17) / `verify-arrival` (16) / `verify-settle` (14) /
`verify-clutter` (18) / `verify-depth2` (16). Sanctioned-edit preparations for
`verify-warp-arrival` (§5.1), `verify-aerial` (§5.2), `soak-fly` (§5.10), all
inert until armed. Shared per-gate un-pin accessor `unpinPins` in
`scripts/_boot.js`. Ledger `scripts/r22-close-sweep.md`. **Three gates were
REDESIGNED IN W1 after failing to go red** — the details are in close-sweep
§1b, and they are the round's first lesson.

---

## §2 Agents and waves

| Agent | Charter | Worktree / port | Merge |
|---|---|---|---|
| **A TERRA** | vendored three-tile patches, sharpness, pipeline, raster cache | `r22-a` / 3220 | — (W2) |
| **B SETTLE** | arrival gates, prewarm, birth fades, governor ladder, settle calm | `r22-b` / 3221 | — (W2) |
| **C CLUTTER** | trees v2, parked + moving cars, poles; Owens empty by construction | `r22-c` / 3222 | — (W2) |
| **D DEPTH** | catcher, receive set, N8AO, near-field atmosphere | `r22-d` / 3223 | — (W2) |
| **E CERT** | five harnesses, sanctioned-edit prep, ledger, this record | `r22-e` / 3224 | — (W3) |

Scaffolding: `ee39397` (Fable, W0) — vendored three-tile v0.12.1,
`WORKER_PROTOCOL 17→18` at all six pin sites lockstep, seven pre-seeded
`enabled:false` constants blocks, three FlyScene pre-seeds, four `_boot.js`
fleet pins.

---

## §3 Defect table

Each row: the defect, its measured RED on the pre-R22 tree, the fix, and the
gate that now holds it. RED numbers are frozen in close-sweep §1.

| ID | Defect | RED (pre-R22) | Fix | Gate |
|---|---|---|---|---|
| T1 | low-AGL ground is a magnified parent tile | camTileZ 13 @ 164 m AGL | — (W2) | verify-terra (2) |
| T2 | LODThreshold is altitude-blind | flat 0.86 at every band | — (W2) | verify-terra (4) |
| T3 | imagery capped at z17 | max img z 17 | — (W2) | verify-terra (5) |
| T4 | DEM stops at z15 | DEM 15 / img 17 | — (W2) | verify-terra (11) |
| T5 | ~~cold warp descent is serial~~ → **the cold cruise arrival re-fetches the whole pyramid** | ~~never reached z13 in 40 s~~ **RETIRED (the frustum rule)** → **266 raster requests** for one cold FL300 arrival | — (W2) | verify-terra (7) |
| T5b | ~~far-warp descent STALLS at FL300~~ | ~~settled z10 vs departure z12~~ — **RETIRED: on `maxLeafZ` it reads 13 vs 13** | n/a | verify-arrival (4b) |
| T9 | a LOCAL warp reveals a 7-level deficit with no readiness poll | camTileZ 10 → 17 with a **0 ms** hold (reproduced twice) | — (W2) | verify-arrival (9b) |
| T6 | no persistent raster cache | `fly-raster-v1` absent | — (W2) | verify-terra (8) |
| T7 | every warp is a cold descent | second visit 0.56× cold | — (W2) | verify-terra (9) |
| T8 | ~~the reveal fires on `downloading<3`~~ | ~~reveal z10 vs departure z12~~ — **RETIRED: on `maxLeafZ` the deficit is 1, inside the bound** | n/a | verify-arrival (4) |
| S-POP | the city assembles after the warp reveal | satRoads t90 **+12.9 s** after reveal | — (W2) | verify-settle (2b) |
| S-STUT | the post-reveal compile train stalls the frame | **179 ms worst frame** at reveal+9.9 s (B's arms: OFF 576–714 → ON 132–165 ms). The COUNT was retired — B's fix raises it 13→19 by design | — (W2) | verify-settle (4)/(6) |
| S-RAMP | the parcel pool appears in one frame | 100% of 1 868 homes in one 100 ms sample at full scale | — (W2) | verify-settle (8) |
| S-ELEV | raw `groundElev` sweeps the fade bands | **~384 m per FRAME** (re-expressed from the retired 24 023 m/s — a rate computed with a dt that is not the damper's own) | — (W2) | verify-settle (10) |
| S-LADDER | zero DPR rungs at devicePixelRatio 1 | 0 rungs (control at dpr 1.5: 2) | — (W2) | verify-settle (11) |
| C1 | trees are 42-tri spheres with no trunk | 42 tris/instance, bbox Y [-1,1] | — (W2) | verify-clutter (2) |
| D1 | shadows land on nothing | 0 of 4 near leaf tiles receive, 5 casters in the same 1 500 m radius | — (W2) | verify-depth2 (3) |
| D2 | the ground catcher ships off | 0 catcher meshes at 682 m AGL with casters in frustum | — (W2) | verify-depth2 (4) |
| D3 | zero ambient occlusion | no N8AO in a 4-pass composer | — (W2) | verify-depth2 (7) |
| D4 | nothing atmospheric in the first 800 m | live `startM` 800 | — (W2) | verify-depth2 (12) |
| D5 | medium/low content is an un-atmosphered cut-out | `content.enabled=false`, `minTier='high'`; no aerial pass at medium | — (W2) | verify-depth2 (13) |

---

## §4 Certification (W3)

Per-harness detail lives in `scripts/r22-close-sweep.md` §3. This section
carries the verdict and the numbers that matter.

### 4.1 Run environment
— (W3)

### 4.2 Full fleet
— (W3)

### 4.3 Soaks (TOY + SATELLITE, 15 min each)
— (W3)

### 4.4 Fixed-pose A/B evidence at the six canonical poses
— (W3)

### 4.5 Consumed §5 moves
— (W3)

### 4.6 `DEPTH_PASS` certified in both states
— (W3)

---

## §5 Postmortem
— (W3)

### 5.1 W1 instrument redesigns (already recorded, close-sweep §1b)
Three gates were written, run against the defective tree, and **failed to go
red** — and were redesigned in W1 rather than discovered at W3:
`verify-arrival (4)` (self-calibrating against a reference that shared the
defect), `verify-settle (2)` (first appearance instead of t90, and boot instead
of warp), `verify-settle (8)` (aimed at a growK step that never fires at the
test pose while the actual pop went unmeasured). Details and numbers in the
close-sweep.

### 5.2 Follow-ups
— (W3)

---

## §6 User checkpoints (plan §9) — PENDING USER

| # | Checkpoint | Evidence | Status |
|---|---|---|---|
| 1 | **P-LEWIS before/after** — the round's money shot (sharpness + clutter + shadows/AO candidate) | — (W3) | PENDING |
| 2 | **P-DUBLIN warp arrival before/after** + hold-length feel (is ≤ 6.5 s tolerable when it buys a sharp reveal?) | — (W3) | PENDING |
| 3 | **Shadows + AO taste and perf ON THE USER'S MACHINE FIRST** — this decides whether `DEPTH_PASS` flips on or stays built-but-off | — (W3) | PENDING |
| 4 | Tree / car / pole read at low AGL (density, scale, believability) | — (W3) | PENDING |
| 5 | Moving-traffic speed and density taste | — (W3) | PENDING |
| 6 | `SAT_QUILT` arrival desaturation A/B | — (W3) | PENDING |
| 7 | Boot feel: stutter gone, pop-in gone (subjective confirmation of the §7 instruments) | — (W3) | PENDING |

Carried and still open: the R21 §6 table (7 checkpoints), R20 §6 (15), R19 §6
(21), and the earlier R15–R18 tables.

---

## §7 Lessons
— (W3). Two are already earned and are recorded here so they are not lost:

1. **A self-calibrating gate whose two numbers share the defect is a coin.**
   `verify-arrival (4)` compared the reveal's tile zoom against the same pose
   fifteen seconds later, and passed cleanly on the defective tree — because
   the destination never sharpens either. The reference has to come from
   somewhere the defect does not reach; here, the departure pose at the same
   altitude.
2. **An instrument can measure a library working correctly and call it a bug.**
   Four W1 reds were the three-tile out-of-frustum LOD rule: at FL300 the tile
   under the aircraft is off screen and never subdivides, so `camTileZ`
   saturates near z10 with the loader idle. "Stuck at z10 for 40 s with
   downloading 0" reads like a stalled pipeline and is a correct quadtree. The
   tell was in the measurement all along — the loader was IDLE — and an idle
   loader that has finished looks exactly like an idle loader that gave up, to
   a gate watching only the number it expected to move.
3. **The same instrument can be right at one altitude and vacuous at another.**
   `maxLeafZ` replaced `camTileZ` at cruise because it sees past the frustum;
   at low AGL that same property made it read z17 off residue from earlier
   poses while the ground under the camera was z13. Neither is the better
   instrument — each is used where it measures something, and the gate says so.
4. **A gate must be greenable, not just red-able.** The first re-base put the
   FL300 descent on `maxLeafZ >= 13` — until A's own armed-vs-control files
   showed the cruise profile is IDENTICAL armed and control. A red nobody can
   close is as useless as a green nobody can fail, and it would have shipped a
   permanent failure into the round record.
5. **"The layer exists" is not "the layer arrived."** Gating pop-in on first
   appearance passed on the defective tree by six seconds, because BootScreen
   already drains the tiles before it reveals. The pop a player sees is the
   ring FILLING — t90, not t>0 — and the path where it happens is the WARP
   reveal, which consults no vector ring at all.
