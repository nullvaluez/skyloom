# FLY ROUND 23 — "NIGHT ALIVE" (RECORD)

> Executed 2026-08-11, one day after the R22 ship, against the user's direct
> defect report. Plan: [FLY_ROUND23_PLAN.md](FLY_ROUND23_PLAN.md). THREE Opus 5
> agents (A NIGHT-TRUTH / B CITY-LIGHT / C NIGHT-CERT) under Fable
> orchestration; Fable planned, relayed, arbitrated, merged, certified.
> Branch `claude/satellite-night-lighting-issue-p0rivp`; base `5d6c09d`
> (R22 close) + inert scaffold `f009263`. Per-harness ledger:
> [`scripts/r23-close-sweep.md`](scripts/r23-close-sweep.md).

## §0 The user report, and what this round did about it

> "Severe lack of lighting overall when it is nighttime in satellite mode.
> Some buildings might have a white glow, some (very few) might show lights
> in windows, but for the most part it is almost silent black and totally
> ruins flying around at night time."

Decomposed as S1 (silent black) / S2 (white glow) / S3 (few lit windows).
Outcome in one paragraph: **the round found and fixed one measured R22 night
regression at the root (F1, on by default), built the light-side enhancement
pass behind a flag (off pending pixel certification), built the un-pinned
night gate that makes this defect class impossible to ship silently again,
and shipped the one-read instrument that settles the remaining open question
(the user's live quality tier) on the user's own machine.** A hard
environment constraint bounds the round's certification honesty — see §3.

## §1 THE ROOT CAUSE (A, F1) — and why every gate was green while it shipped

**The regression:** `AERIAL_PERSPECTIVE.content` (content haze) shipped
`enabled:false` from R19 through R21 and was flipped ON in R22 W3 (sanction
§5.4: `minTier:'medium'`, `max:0.55`). Its strength is a pure function of
DISTANCE — no sun, no elevation, no `nightFrac`. Measured (paired legs, same
build/pose/clock, `scripts/r23-a-tiernight.json`): **contentHaze 0.55 at deep
night and 0.55 at noon, identically.** By day that is correct aerial
perspective (the mix target is a bright rim). At night the rim is the
deep-night keyframe `#101a30`, so the same 0.55 mixes the city toward dark
navy — injected **after the lighting chunks on `gl_FragColor`**, on exactly
the two shader variants that carry the night city (sat-building +
sat-skyline), so it drags emissive window light down with everything else.

**The triple blindness (why 33 green sat-night gates coexisted with the
defect):**
1. `scripts/_boot.js` pins `__flyAerialOverride = 0` fleet-wide — every
   legacy harness forces the term's identity path.
2. The ONE un-pinning harness (`verify-aerial`) pins tier HIGH — where
   `!highTier` excludes the term **by construction**. The single un-pinner
   runs at the one tier where the feature cannot exist.
3. `verify-sat-night` additionally pins tier high while window emissives are
   high-tier-only — so no gate has ever seen night at the tier a live
   session resolves.
This is the R19 §7 lesson's third occurrence, this time proven by a paired
leg rather than argued.

**The fix (merged `0e0080f`, ON by default):** `NIGHT_TRUTH_R23.hazeNight` —
the haze retires on the SAME `dayFrac 0.3 / gamma 1.5` ramp the windows and
road network arrive on, so the two hand off instead of fighting. CPU-side
multiply on the existing uniform: **no shader text change ⇒ no cache-key
move.** At `retire 1.0` deep night reads exactly 0 (R21's certified state —
the term did not exist then); noon keeps R22's 0.55 bit-for-bit; dusk is a
measured monotone ease (14 samples, `scripts/r23-a-hazeramp.json`); all six
fleet-pinned cells unchanged; Owens +0 by construction (the fix can only
remove a mix term). Flag-off = shipped R22 behaviour exactly.

**Independent reproduction (C):** `scripts/r23-c-haze-probe.js`, built from
C's own reading of the mechanism, reproduced F1 on the base tree — medium +
deep night + pin released = **0.55**; the identical cell fleet-pinned =
**0** (the defect and the blindness in one five-row table). On the merged
tree the same probe reads **0.00** at medium+night with noon still 0.55 —
the integration loop closed with the exact predicted numbers
(`scripts/r23-c-haze-probe.json`, zero pageerrors).

**H-table (A, instruments named per verdict):** H5 CONFIRMED (= F1). H1
confirmed-as-mechanism / UNRESOLVED-as-trigger (at medium the night gate is
off and `emissiveIntensity` 0 — but R22's ladder inserts sub-native DPR rungs
BEFORE the first tier step, so tier drops are *harder* than R21; which tier
the user resolves is not measurable from this environment). H3 REFUTED for
the building path (medium clears emissive to black; high carries a proper
warm `#ffd9a3` 512² map — an unmapped white glow cannot come from there).
H4 REFUTED (birth/settle cannot hold a layer down past an arrival). H6
REFUTED for every tile-independent layer (27 city-glow domes, `nightK`
correct at all tiers). H2 (drape burial) genuinely UNTESTED — needs DEM
egress.

## §2 The enhancement pass (B) — behind `NIGHT_CITY_R23`, ships OFF

Merged `9073d6a`. Everything is fragment terms on existing materials plus
one derived vertex attribute: **+0 draws, +0 geometry, no worker change,
WORKER_PROTOCOL stays 18.** New cache keys `world-bend-road-satnight-r23` /
`world-bend-anchor-satbldg-r23`; prewarm warm-set membership included;
flag-off GLSL **byte-identical to base**, proven by the new node gate
`scripts/verify-night-city-identity.mjs` (12/12; re-run green on the merged
tree) plus a two-boot runtime proof (`-r19` keys and 61 programs in ship
state, armed and disarmed alike).

- **Road life (handoff delta 3):** re-sweep SHADOWS the R16/R19-swept
  uniforms (the swept blocks are never edited — the A/B control is a uniform
  write); lamp-pool literals promoted to uniforms; **two-colour traffic**
  (warm headlights with the arc, red tails against it) via `aRoadSide`
  derived client-side from the worker's existing quad vertex parity —
  fail-blended if absent. Junction sprite pools **scouted and SKIPPED**: R22
  CLUTTER already phase-locks physical poles to the shader's 42 m lamp
  pools; a sprite pool would be a third actor at the same address (the R20
  lesson). All road knob values **PROVISIONAL** pending a pixel A/B.
- **Window variance (delta 2b):** per-building phase/gain/dark-share/tint
  jitter hashed off the EXISTING `aBendAnchor` centroid attribute — no new
  attribute, texture, or worker change. Daylight unreachable by construction
  (all terms inside the emissive chunk, `emissiveIntensity` 0 while the sun
  is up). The bench caught and B fixed a real roof-invariant violation
  (~1.9 luma from filtering at a constant-uv primitive — now excluded
  structurally by the `uNCNeutral` sentinel, not arithmetically).
- **The tier proposal:** `NIGHT_CITY_R23.tier.nightMinTier:'medium'`
  (armed-only; `SAT_BUILDINGS.night.minTier` untouched). Cost shape: one
  extra texture fetch on a material already sampling `map` at medium; no new
  draws/programs. **GPU cost UNMEASURED — the default does not flip until
  someone runs the R22-D-idiom paired legs at P-MAN night on real
  hardware.**
- **Bloom: untouched, deliberately** (the R21 flicker residual is not worth
  waking for a term the features don't need).

## §3 Certification — the honest state

**The environment fact that bounds this round:** this cloud session's egress
policy answers **403 to CONNECT** for `server.arcgisonline.com` (Esri
imagery + DEM) and `tiles.openfreemap.org` (all vector content). The world
cannot stream; **no pixel-level night claim is measurable here** — including
the round's own fix. All three agents discovered this independently,
reported it, and did not route around it or manufacture evidence.

**What ran GREEN on the merged tree in this environment:** the F1 uniform
probe (§1 numbers), verify-night-city-identity 12/12, verify-classify /
verify-warbirds / verify-daily PASS, verify-sun 7/7 (A, pre-merge), zero
pageerrors on every boot.

**What is built but UNEXERCISED (ledger §2 is the ordered re-run list):**
`verify-night-alive`'s main gate block (18 of 21 assertions sit past its
`VERIFY: BLOCKED` exit — a third outcome added this round so a blocked run
can never read as green OR as a product red), verify-aerial's new
medium/night legs 12/13 (their *claim* is probe-measured; the legs
themselves sit behind imagery-gated predecessors), the un-pinned
verify-settle leg, and B's entire pixel A/B suite
(`scripts/r23-b-night-ab.js`, six uniform-driven legs per pose, ready to
run). **Absolute thresholds in verify-night-alive are archive-derived
(R16/R19/R20 certified frames, SHA-pinned derivation that reproduces R19's
own published litFrac to 0.04 pp) and explicitly PROVISIONAL; the ratio
gates need no absolute calibration.** `scripts/r23-c-preflight.js` answers
"is a sweep worth starting" in ten seconds.

**Also recorded (C):** `verify-sat-night` keeps 8 of its assertions green
under a TOTAL tile blackout, and two of its reds under blackout are the
wrong reds (a `draws=0` sampling gap read as a budget breach; the R19 census
invariant vacuously true at 0/0) — the old gate partially passes on a blank
world, which is part of how the blindness survived. Fleet hazards found and
guarded: the fleet overwrites its own archived certified frames (bit twice
in one session; derivation now SHA-pins its sources; per-round output dirs
are the R24 general fix), and the element-screenshot stability wait hangs on
page 2+ (viewport fallback with a printed WARN; fleet-wide retirement is an
R24 candidate — `verify-sat-night` still carries the hang).

## §4 Fable rulings

1. **`postAerial` stays untouched.** C's probe shows the high-tier post pass
   at 0.55 at deep night with no sun term — the same defect *shape* as F1.
   Ruling: it shipped in R19 and was live through the R21 night the user
   certified as good (it is pinned off only for harnesses, never for users),
   so it is NOT a regression and does not move in a round whose fix standard
   is "restore the certified read". It is recorded as an open taste question
   for the user checkpoint, with the caveat that "no sun term" is now a
   proven defect shape in this codebase.
2. **`NIGHT_CITY_R23` ships OFF** — B's own report says do not flip without
   the medium-tier GPU number and a pixel A/B, and neither is obtainable
   here. Consequence: B's conditional re-baseline request (verify-groundlife
   frozen `ROAD_CACHE_KEY`) is **NOT consumed** — the gate stays green
   as-is. The flip, when it comes, moves that one string with identity gates
   (2)/(5) as the measured control.
3. **Worktree fork-point correction:** the three agent worktrees forked from
   `5d6c09d` (pre-scaffold), not `f009263` — discovered at the A merge when
   the plan file and B's seed block appeared "deleted". No agent misbehaved;
   both files were restored in the merge commits, and the ledger carries the
   merge-base line. (Lesson 3 below.)
4. **A's "0 unmapped emissives" census is vacuous under the blockade** (an
   empty scene has no building meshes to audit) — recorded here so it is
   never quoted as clearing S2. The building path's innocence rests on the
   SOURCE proof (medium clears emissive; high binds the map), which stands.

## §5 Follow-ups / R24 seeds (none built this round, all evidenced)

1. **Skyline night lighting** — `sat-skyline-engine` ships NO night
   lighting; the R18 crossfade hands the climbing player's city to unlit
   dark masses. A's judgment: at altitude this is a BIGGER silent-black
   contributor than the haze. Not a regression (equally unlit in R21) —
   the top R24 enhancement seed, now with B's `aBendAnchor` variance
   precedent to build on.
2. **S2 white glow** — leading suspect is night bloom breathing (threshold
   0.85→0.62, intensity →1.0) clipping warm cores toward white; C's
   white-glow blob detector is built and waiting for pixels. Second
   candidate: POI letters (handoff delta 7, a known white-glow-as-UI item).
3. **The handoff's remaining deltas** — water (4), sky/cloud deck (1),
   rooftop night key (6), letters (7), landmark floodlighting (5, frozen-
   gate entanglement documented).
4. **`postAerial` sun term** (ruling 1) — taste question, user checkpoint.
5. **Harness fleet:** per-round output dirs (the archive-overwrite hazard);
   element-screenshot retirement fleet-wide; verify-sat-night's
   blank-world-tolerant assertions deserve a hardening pass (it should
   BLOCK, like night-alive, when the world never streamed).
6. **H2 (drape burial)** — untested; the elevation-census instrument spec
   is in the plan §2, buildable the moment DEM egress exists.

## §6 USER CHECKPOINTS (all PENDING — this round's §6 is the round's point)

1. **Fly satellite night on your machine with this branch.** The F1 fix is
   ON by default. First question: is "silent black" materially better?
2. **One console read settles the tier question:** open dev tools during a
   night flight and run `copy(__flyStats.night)` — paste the result back.
   `tier` / `govRung` / `lit.windowsArmed` / `lit.windowEI` answer whether
   your machine has window lights armed at all; `contentHaze` / `postAerial`
   show both dimming terms live. (Published at 2 Hz, wall-clocked, dev
   builds.)
3. **Run the new night gate where the world can stream:**
   `node scripts/r23-c-preflight.js` first (10 s), then
   `FLY_URL=http://localhost:3000 node scripts/verify-night-alive.js`.
   Its first egress-enabled run re-freezes the provisional thresholds via
   the printed `SUGGEST` block — and may crash rather than measure (§3;
   budget five minutes).
4. **Preview B's pass (taste):** set `NIGHT_CITY_R23.enabled = true` —
   road glow re-sweep + two-colour traffic + window variance + medium-tier
   windows, all at +0 draws. Knob-by-knob taste notes welcome; every value
   is marked PROVISIONAL and expects your eyes.
5. **The cloud-session environment ask:** allowing egress to
   `server.arcgisonline.com` and `tiles.openfreemap.org` in this
   environment's network policy would let future rounds pixel-certify in
   the cloud; without it, W3 pixel certification runs on your machine.
6. Carried from R22: the DEPTH_PASS on/off decision (`__flyDepthArm`), the
   P-LEWIS/P-DUBLIN money shots, quilt/tree/car/warp-hold taste — untouched
   by this round.

## §7 Lessons

1. **A fleet pin hides a defect class — third occurrence, new variant:** the
   un-pinner ran at the one tier where the feature cannot exist. An un-pin
   is only coverage if the un-pinned term is REACHABLE in that leg's
   configuration; assert reachability, not just release.
2. **A night gate that inherits the fleet's pins re-creates the blindness it
   exists to kill.** verify-night-alive releases the aerial pin and PROVES
   the release; it leaves the depth pin held because releasing it would ARM
   a feature users don't have — each pin decision is an analysis, not a
   default.
3. **Verify the merge-base before diffing agent work.** Worktrees fork from
   HEAD-at-creation; a diff against the intended base read as "the agent
   deleted files" when the truth was "the fork predates them".
4. **An instrument over an empty scene is vacuous, and a blocked world can
   look like a passing one** — 8 of verify-sat-night's assertions stayed
   green under a total blackout, and an emissive census over zero meshes
   "found no defects". Gates need existence preconditions (`meshes > 0`,
   tiles-answered) before their invariants mean anything; BLOCKED must be a
   distinct outcome from PASS and FAIL.
5. **Uniform-level state probes survive a tile blockade.** The round's root
   cause was found, fixed, and independently reproduced entirely through
   state probes, paired pin legs, and source proof — and the fix was then
   verified on the merged tree with the same instrument. Pixels are the
   gold standard; they are not the only honest standard.
6. **The egress policy is part of the test environment contract.** Three
   agents each rediscovered the same 403 independently; the preflight now
   makes that a ten-second answer instead of a ninety-minute timeout.
