# R24 "MOTION HOLD" — CLOSE LEDGER (D)

Per-commit record for the round. Branch
`claude/satellite-render-glitches-kwjp4l`, scaffolded on `44ec502`
(the R22.1 × R23 merge). **17 commits.** Round record:
[FLY_ROUND24.md](../FLY_ROUND24.md). Plan of record:
[FLY_ROUND24_PLAN.md](../FLY_ROUND24_PLAN.md).

Conventions follow `scripts/r22p1-close.md`: every row carries what it
changed and what proves it, every unrun thing is named rather than assumed,
and nothing is called green that was not measured.

---

## §1 THE COMMIT LEDGER

| # | commit | agent | what landed | proof |
|---|---|---|---|---|
| 1 | `6fafa5a` | **D** | Scaffold: six constants blocks (`TILE_HOLD` / `RING_HOLD` / `LEAD_SAFE` / `POOL_FAIR` / `COMMIT_BUDGET` / `MOTION_R24`) with per-block derivations + `FLY_ROUND24_PLAN.md` | ONE pure-append hunk `@@ -5619,0 +5620,205 @@`, +205/−0; module import-verified, 114 exports, no collisions |
| 2 | `0f381d9` | **E** | `scripts/_world-precondition.js` — shared world/machine precondition + `VERIFY: BLOCKED` (exit 2); `verify-flicker` world-content gate | pre-fix, `verify-flicker` passed (1)–(5) on an **empty world** (all counts 0, urban p99 **0.287** vs bound 12) |
| 3 | `dfddcba` | **C** | `settle.js` motion helpers (`motionOn` / `motionSubOn` / `__flyMotion` arm) + `SAT_QUILT` and `HILLSHADE.micro` re-pointed at the damped ground | flag-off reduces to the pre-R24 expression byte-for-byte (D verified against `6fafa5a:lib/fly/settle.js:315`) |
| 4 | `b36d88d` | **E** | `scripts/verify-motion-hold.js` — the sustained-translation content gate (5 gates: churn, below-horizon void, content-presence series, false-cull under translation, frame pacing) | thresholds **PROVISIONAL**, re-frozen by the printed `SUGGEST` block; two `exitBlocked` sites (world content, machine capability) |
| 5 | `341e28c` | **A** | `TILE_HOLD` — vendored patches **#6a** `mergeDwellMs`, **#6b** `frustumPenalty`, **#6c** `lodHysteresis`, **#7** `unlockOnReject`, **#8** `rasterMark`, **#9** `flyTileHoldStats`; raster timeout/retry/backoff in `raster-cache.js`; VENDOR.md ledger rows + the annotation on the old "correct library behavior" note | `r24-a-unit.js` **29/29** against the real `Tile` class; flag-off identity verified per patch by D |
| 6 | `da60841` | **C** | The P2 AGL-divergence probe (`r24-c-agl.js`) + its analysis half, unit-tested | `r24-c-motion-unit.mjs` **32/32**. ⚠ also carried A's three probes into the tree — see §3 |
| 7 | `06fc54b` | **A** | Mark `r24-a-churn` / `-f11` / `-turnback` **UNEXERCISED** in their own headers, incl. the two API assumptions already found wrong | honesty commit; no executable change |
| 8 | `2fdb3ee` | **B** | `RING_HOLD` + `LEAD_SAFE` + `COMMIT_BUDGET` in all five streaming engines | `readyAt` asymmetry implemented per engine (first-ready-only in veg/clutter, per-ready in buildings/roads/skyline) |
| 9 | `c025b1a` | **B** | `POOL_FAIR` in the three unfair pools + wiring C's `aglTruth`/`paceBySpeed` call sites | `fairShare(pool) × maxChunks ≤ pool` by construction |
| 10 | `66236f8` | **B** | `verify-ringhold` (14/14, red-calibrated) + four live probes; `LEAD_SAFE` caps re-derived by exact bisection | **14/14**; caps validated against the un-led world (veg 2417 ≥ 2400 by 17 u) |
| 11 | `aae855b` | **E** | Review fix **X1** — back-reference `r24-a-churn.js` from `verify-motion-hold`'s header | comment-only, 13 insertions, zero executable lines |
| 12 | `164a4dd` | **C** | Review fix **C1** — guard the two grade-site trace writes; make the claim true rather than soften it | **AST walk**: 12/12 `_motionTrace` writes enclosed by a `NODE_ENV` test. `r24-c-motion-unit.mjs` 32/32 |
| 13 | `908187a` | **B** | Review fixes **B1** (behavioural: shed-and-backfill for held water) + **B2**/**B3** (docs) | `verify-ringhold` stays **14/14**; eslint clean; no assertion moved |
| 14 | `de2bf04` | **D** | Scaffold comment fix — the #6a / `unlockOnReject` attribution drift | comment only; verified against `vendor/three-tile/index.js` before writing the correction |
| 15 | `7d18bb6` | **D** | `FLY_ROUND24.md` — the round record | — |
| 16 | *(this)* | **D** | `scripts/r24-close.md` — this ledger | — |
| 17 | *(next)* | **D** | `CLAUDE.md` top notice | — |

**E's delta-recertification on `908187a`:** `npm run build` clean **8.4 s** ·
`verify-ringhold` **14/14** · `r24-c-motion-unit.mjs` **32/32** ·
`r24-a-unit.js` **29/29** · **no assertion number moved by the review fixes.**

---

## §2 THE ADVERSARIAL DIFF REVIEW (D, `6fafa5a..HEAD`)

**Result: no blockers. Six MINOR findings, all resolved before the push.**

### 2.1 Global checks — all PASS

| check | result |
|---|---|
| FLASH_GUARD / R23 night paths untouched | ✅ `world-bend.js`, `night-city.js`, `prewarm.js`, `SatBuildingLayer.jsx`, `SatRoadLayer.jsx` — **zero diff** |
| No cache-key or shader-text moves | ✅ no GLSL string in the diff |
| No frozen assertion numbers edited | ✅ `git diff -- scripts/` carries **no `-` line containing a number** |
| File ownership | ✅ **nothing crossed an owner's boundary** |
| Flag-off byte-noop | ✅ verified **against the pre-R24 source**, not against the comments |
| Parse | ✅ 10 changed lib modules + 2 `.mjs` gates |

### 2.2 The six findings and their resolutions

| # | sev | finding | resolved by |
|---|---|---|---|
| **B1** | MINOR → *behavioural* | A residency-held chunk kept its **water mesh** past `SAT_WATER.maxWaterChunks`: the new `continue` sat above the water-cap test, and `held` is disjoint from `keep` while `_waterKeys ⊆ kept`, so a held key **always** skipped the shed | `908187a` — shed **then** continue, with backfill (§3) |
| **B2** | MINOR | `POOL_FAIR`'s under-use at low resident counts was not disclosed in source | `908187a` — disclosed with the trade and with why a live divisor is refused |
| **B3** | MINOR | The `LEAD_SAFE` derivation claimed the model reproduces both shipped invariants "to the unit"; true for veg (2417 vs 2400), false for clutter (model 2885 vs a shipped 2446) | `908187a` — amended; root cause is a z14 span quoted for a z13 ring |
| **C1** | MINOR | The `_motionTrace` header claimed production-compiled-out; true for 11 writes, false for the 2 at the `SAT_QUILT` grade | `164a4dd` — **claim made true**, both writes guarded |
| **X1** | MINOR | The A↔E instrument split was documented in A's header only | `aae855b` |
| **D-own** | MINOR | `TILE_HOLD`'s comment credited the dwell release to `unlockOnReject`; it is #6a's `if (s !== 2)` clear | `de2bf04` |

### 2.3 Items verified and found correct (no action)

* **A's five flag-off identities**, each read at the code rather than the
  ledger: #6a `if (_dwell > 0)` and `LOD()` returns `s` on the held path too ·
  #6b `t * (penalty || 5)` (0/null/NaN → 5) · #6c `_h > 1 ? r*_h : r`, which
  also makes merge **un-eagerable** by a malformed value · #7 all three
  catches lead with `if (!unlockOnReject) throw err` · #8 off ⇒ no `userData`
  at all and the reuse clause reads `!undefined`.
* **The #8 inversion is genuinely avoided.** Stamping `userData.source` alone
  would make the reuse test match the *error* material and pin it forever;
  the added `&& !flyError` excludes exactly that set, and `flyError` is set at
  no other site.
* **The +2 resident overshoot is bounded three ways** (count, wall clock,
  `ringR × 1.25`) — and, stronger than B's own comment: at any **settled
  frozen pose** the hold is **structurally empty**, because nothing has
  `readyAt` inside `minResidencySec` and nothing leaves `keep` while the ring
  centre is static. Frozen gates therefore see byte-identical behaviour.
* **`ringHoldKeep` preserves the hard draw bound by construction** —
  one-in-one-out, `w` monotonically decreasing, swap source disjoint from
  `kept` — and re-sorts by `distSq`, so the water sub-slice and the positional
  queue order are untouched.
* **The `readyAt` asymmetry is correct and commented**: first-ready-only in
  the two engines that heal **in place** (veg, clutter), per-ready in the
  three that **evict and refetch** (buildings, roads, skyline).
* **`verify-motion-hold` does have a BLOCKED path** — via the shared
  `exitBlocked` helper at two sites; an earlier grep for the literal string
  was a false alarm, checked before it was reported.
* **C's trace channel**: module-scope flat object of primitives, zero
  per-frame allocation, no retention, and the one consumer copies out
  explicitly (`r24-c-agl.js:328`).

---

## §3 THREE THINGS FROM THE CLOSE WORTH CARRYING

**(a) B1 was a real defect that B's own simulator could not catch, and the
instrument that would have caught it is in the un-run fleet.** That instrument
is `verify-roof-variety`'s `waterReady` — the same gate that caught a breach
at 14 in R19, now sitting inside the ~35-harness set R22.1 named as **F16**
and which still has not been run, on this tree or on `44ec502`. **F16 is now
implicated in a real defect rather than a hypothetical one.**

**(b) B1's fix needed the shed-and-backfill shape — the half-fix hazard.**
The R19 evict path sheds water freely *because the chunk is destroyed* and
picks it up again from the rebuild's finalize. **A held chunk is never
rebuilt** (`_pumpQueue` skips a `'ready'` record on re-admission), so a bare
`_evictWater` would have removed the glint for the life of the record —
trading a bounded draw breach for a **permanent visual hole**. The fix uses
the three lines `setWaterEnabled` uses: `_evictWater` + `waterAsked = false` +
arm the R21 S4 backfill, guarded on `chunk.water`.

> **Lesson.** When a new hold keeps an object alive past a cleanup path, check
> what that path relied on happening *next*. A fix that satisfies the bound
> and skips the restore has traded a measurable breach for an invisible one.

**(c) C's guard verification — instrument honesty in the cheap direction.**
Verifying C1, C found the **line-proximity grep** used to check guard coverage
had **mislabelled eight of eleven** writes, and replaced it with an **AST
walk** confirming 12/12 — *before any claim shipped*. This round's expensive
findings came from re-reading measurements; this one came from not trusting a
grep for a question about scope.

### 3.1 Also recorded

* **Probe-attribution collision.** A's `r24-a-churn.js`, `r24-a-f11.js` and
  `r24-a-turnback.js` were added by **C's `da60841`** through the shared
  index. Tree content correct; files are A's by ownership. A shared-index
  artifact, not a violation.
* **E's water-path runtime caveat.** B1's shed-and-backfill path is reasoned
  and unit-checked but has **never been exercised against a streaming world**
  — on the egress list.
* **The `CLUTTER` block's `2446` is wrong and is R25's.** `CLUTTER.ring.z` is
  **13** (span 4892); `fly-constants.js:5037` states the guarantee as `2446`,
  the **z14** span quoted at `:3025`. The prose understates its own ring's
  guarantee by half a tile; conservative-direction, so nothing sized against
  it was ever unsafe. Another owner's block.

---

## §4 WHAT THIS ROUND DID NOT RUN — BY NAME

1. **Every browser gate.** No GPU (SwiftShader ~1 fps), both tile hosts 403,
   and a `dt` clamp that caps effective ground speed near **1 km/min** against
   the ~250 m/s the defect needs. A "fast flight" harness run here **is a slow
   flight harness**. All REDs are **predicted-pending-egress**; all absolute
   thresholds in `verify-motion-hold` are **PROVISIONAL**.
2. **The wide fleet (F16)** — ~35 harnesses, unrun for R22.1, unrun on
   `44ec502`, unrun here. Now implicated (§3a).
3. **The R22.1 trio** — flash-guard / frame-pace / step-clean — never run on
   the merged tree.
4. **Both soaks.** And note they would not have helped: `soak-fly.js:62`
   un-pins only `__flyGovPin`, so the fleet's one long motion run measures the
   **R21** terrain, not the shipped one.
5. **A's three probes** — `r24-a-churn`, `-f11`, `-turnback` — marked
   UNEXERCISED in their own headers.
6. **The user's machine.** Nobody has flown the fixed build on the hardware
   that produced the report. **That is the only test that closes the round.**

---

## §5 VERDICT

> ## BUILT AND NODE-CERTIFIED · BROWSER-UNCERTIFIED BY PROVEN ENVIRONMENTAL IMPOSSIBILITY
>
> Every root cause in §2 of the round record is confirmed **in source**, each
> fix is one-flag revertible, each flag-off path is the verbatim prior
> expression, and the logic is unit-green (ringhold 14/14 · motion-unit 32/32
> · a-unit 29/29 · build clean 8.4 s) with **no assertion number moved by
> anyone, anywhere, all round**.
>
> What has **not** happened is a single frame of this being rendered at speed
> over real tiles. That is stated as the verdict rather than buried under it,
> and the ordered re-run list is [FLY_ROUND24.md](../FLY_ROUND24.md) §6.4.
>
> **The user's machine is the closing test, and the thirty-second
> `copy(__flyStats.night)` probe comes before everything else** — because if
> the governor is unmounting the content stack, no amount of streaming work
> was ever going to be the answer.
