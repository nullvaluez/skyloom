# R19 CLOSE — certification sweep ledger

**Tree:** `claude/round19-honest-world` @ `77203e0` (= main `414a392` + the four
close commits: `5baeb63` sat-night (E) park v2, `dfb6443` neon-cover gate 4,
`d5076d0` ADS-B proxy 200-OK-EMPTY failover, `77203e0` sat-night rulings 1+2).
**Date:** 2026-08-01. **Runner:** R19-CLOSE agent V, under Fable orchestration.
**Server:** the dev server already serving THIS worktree on `:3019`
(`next dev` PID 32448, worktree `r19-fable`), driven through
`FLY_URL=http://localhost:3019`. **Deviation, recorded:** the fleet convention
is one's own dev server on a free port; a second `next dev` would have had to
share this worktree's single `.next`, which the plan (§2) forbids, and Next 16
has no `distDir` CLI flag. Every run below therefore used the existing server
for this same tree.

---

## Why this sweep is TARGETED (Fable scope ruling, mid-session)

Product code on this tree differs from already-certified main `414a392` by
**three files**:

```
git diff 414a392..HEAD --stat -- . ':(exclude)scripts'
 app/api/aircraft/route.js         | 52 +++++++++++++++++++++++++++++++++++++++
 components/fly/TrafficLayer.jsx   | 16 +++++++++++-
 components/fly/TrafficTracers.jsx | 13 ++++++++++
 3 files changed, 80 insertions(+), 1 deletion(-)
```

Everything else since `414a392` is harness scripts and evidence PNGs.

**Honest amendment to the scope ruling.** Fable's trim was issued on the premise
that the delta was *exactly one* file (`app/api/aircraft/route.js`). It is now
three: phase 1 of this session added the two dev-only park handles
`window.__flyTraffic` (TrafficLayer's root group) and `window.__flyTracers` (the
tracer mesh). Both are `process.env.NODE_ENV === 'development'` assignments — a
ref callback that stores an object and an effect that stores/deletes one — so
production behaviour is unchanged and no geometry, material, draw or uniform is
touched in any build. They are nevertheless PRODUCT files, and the harnesses run
the dev bundle, so the traffic-rendering gates that cover them
(verify-tracers / verify-fly-game / verify-spicy / verify-feel) were already in
the must-run set, and **verify-fleet was added to it by this agent** because it
is the gate that audits TrafficLayer's archetype meshes directly.

Supporting-only evidence (NOT a substitute for a run): the interrupted morning
session ran a broad sweep on this same product tree and surfaced no failures —
its PNG mtimes are the only record it left, which is exactly why this ledger
exists.

---

## RUN TODAY — re-executed on the integrated tree

| # | Harness | Result | Wall | Notable numbers | Retry / notes |
|---|---|---|---|---|---|
| 1 | **verify-sat-night** | **33/33 ×2** | 219 s, 225 s | road census night 14/14 meshes (ready 14), noon 14/14, ONE material uuid both legs, uRoadNight 1→0 · (E) A/A noise **0.204 / 0.190**, A/B gone **0.360 / 0.602** vs ceiling 3.00 / 3.03 (8.3× and 5.0× clear) · draws night 220, JFK 220, cruise 158, all ≤ 375 · JFK cls-7 verts 1352 | **YES — one FAIL first.** The pre-fix tree failed gate (E) (`gone=3.41` vs ceiling 2.80, A/A noise 3.19) and the road gate was sign-flipping. Both fixed under Fable rulings 1+2 in `77203e0`; four consecutive greens across the fix's last two revisions, two on the final code. Full diagnosis in that commit message. |
| 2 | **verify-neon-cover** | **9/9** | 144 s | toy triangles worst **1.448 M** ≤ 2 M, flag ON | none |
| 3 | **verify-tracers** | **6/6** | 37 s | 90 live tracers still drawing after style flips; re-backfilled ribbon flat (vUp = 0) | none |
| 4 | **verify-fly-game** | **PASS** | 28 s | warp jump 2219 world-u, arrival 653 m, lock held across warp, canvases 3→4→3 | `WARN: pixel-hover never engaged this run (aim flake, not a card failure)` — the harness's **own** self-report, the documented verify-inspect-actions/fly-game headless-aim flake. Everything else in the run asserted. |
| 5 | **verify-spicy** | **PASS** | 232 s | VIPER11 + WARBRD1 (B-17) pings fire, retire, **0 re-fires over 12 s**, minimap pulse tracks both; 3-min zero-error soak, heap 172 MB | none |
| 6 | **verify-feel** | **13/13** | 110 s | cruise strength **exactly 0** (speedFrac 0.240) · boost FOV **+3.02°** vs flag-off control +0.79° · post-warp altitude Δ **0.0 m** hands-off, and 2300→2300 m with the parked cursor at cmd.pitch −0.471 · cinema refuses 21 nm, close pair standoff 1060 m both framed · FL180 = 6 letters | **No flake this run**, but the known-marginal streak gates were again TIGHT and are recorded as such: gate 2 A/B **1.4074** vs A/A noise **1.3028** (luma step 0.0145 vs world drift 0.0027), gate 7 frame A/B **4.85** vs floor **4.39**. Untouched — this is the documented pixel-noise assertion, not a regression signal. |
| 7 | **verify-aerial** | **16/16** | 168 s | satellite boot **7.6 s** vs the 28.8 s cap · mid-band Δ **7.28**/255 (floor 2.0, noise 0.19) · near field Δ **0.000** (sat-depth contract) · aniso 8, tile textures ≈**66 MB** across 197 (cap 300) · shadow crop darkened 4.91 luma · **Owens draws 194 ≤ 261 with everything armed** | none. Recorded 14/14 at `751625c`; the harness has since grown to 16 gates. |
| 8 | **verify-dusk** | **15/15** | 144 s | golden band Δwarm **1.84** / Δluma **7.47** · pinned-noon frame 0.0531 vs round-off control 0.0559 (indistinguishable) · P9: el +2.064° reads dusk with stars EXACTLY 0 · **cirrus costs exactly +1 draw (214 vs 213)** | none |
| 9 | **verify-fleet** | **28/28** | 35 s | all 9 swapped geometries carry baked `aEmissive`, nav program `world-bend-air-anchor-nav` armed, uNavT advancing | **Added by this agent**, outside the trimmed must-run set, because phase 1 touched `TrafficLayer.jsx`. |
| 10 | verify-classify (node) | **PASS** | <1 s | bonus change set is exactly the audited 20 over 538 codes; 170 warbird bonuses byte-unchanged | none |
| 11 | verify-warbirds (node) | **PASS** | <1 s | 58 modern codes OLD===NEW; B29 exact 47 vs substring 60 (short-circuit load-bearing) | none |
| 12 | verify-daily (node) | **PASS** | <1 s | 28 gates | none |
| 13 | **soak-fly 15 min** | **GREEN** | 15 min | worst **p95 8.4 ms** (p50 4.2 ms throughout), fps floor ≈119 · max draws **445 ≤ 480** · max tris **1.931 M ≤ 2.2 M** · heap 322 → 356 MB (no monotonic climb) · max rebase **0.40 ms** · **0 pageerrors** · live traffic peaked at **1145 aircraft** (R18's soak peaked at 525) | none. The traffic peak is the `d5076d0` proxy failover working — adsb.lol's geographic endpoint is serving 200-OK-EMPTY and the proxy now rotates past it to adsb.fi. The scene held its budgets at more than double R18's load. |

Diagnostic instruments run during phase 1 (not gates, evidence only):
`r19-satnight-movers.js` (rewritten), `r19-satnight-e3100.js` (new, cumulative
park experiment), `r19-satnight-burst.js` (new, 60-pair floor + tail).

---

## SKIPPED ON BYTE IDENTITY — NOT re-executed today

Every row below covers product code that is **byte-identical** to the commit
where it was last recorded green (proof: the `git diff` above — no file these
gates touch appears in it). Each cites that commit.

| Harness | Last recorded green | Recorded numbers |
|---|---|---|
| verify-suburbia | `1116848` (A HOMESTEAD merge) | 16/16 NEW; Powell invented heights 42.0 → 12.0 m |
| verify-sat-buildings | `1116848` | green; flag-off byte identity 25/25 |
| verify-roof-variety | `1116848` | green |
| verify-skyline | `1116848`, re-green at `a0358a6` | green; Owens ready===0 re-asserted |
| verify-sat-depth | `751625c` (B DEEPFIELD) | draws **212**; re-green at `a0358a6` |
| verify-rim | `751625c` | green |
| verify-sun | `751625c`, re-green at `61fbf07` | green |
| verify-round11 | `751625c`, re-green at `7262071` | green |
| verify-boot | `7262071` (D GOLDENHOUR) | green |
| verify-veg | `7262071`, re-green at `a0358a6` | green; Owens 239 ≤ 261 with cirrus armed |
| verify-weather | `e00ba12` | green with the two Fable-sanctioned moves (LID_SAT_MAX 0.12→0.20, dusk walk band 1..16) |
| verify-living-contracts | `61fbf07` | rewritten gates 2/2 |
| verify-groundlife | `a0358a6` (C GROUNDTRUTH) | 18/18 NEW; Owens 178 noon / 179 night ≤ 261 |
| verify-neon-city | `ae7f046` (F REWIND) | draws **379** (toy 363 pre-flag at `751625c`) |
| verify-neon-alt | `ae7f046` | draws 325, void 0.19 % |
| verify-roofs | `ae7f046` | 394 draws / 2985 buildings |
| verify-window-grids | `ae7f046` | 403 |
| verify-edge-fx | `ae7f046` | 400 / 372 / 322 |
| verify-poi | `ae7f046` (toy leg), `414a392` (E) | no shift |
| verify-chase-cam | `414a392` (E SLIPSTREAM) | green; framing gate unmoved |
| verify-freelook | `414a392` | green |
| verify-warp-arrival | `414a392` | green |
| verify-contracts | R18 close (`7169aff`) | green — untouched all round |
| verify-crash · verify-juice · verify-logbook · verify-hangar · verify-photo · verify-daily(browser legs) · verify-atlas · verify-airbend · verify-airport-buzz · verify-monuments · verify-monuments-sat · verify-mobile · verify-mobile-layout · verify-sat-mobile · verify-globe · verify-globe2 · verify-fly-models · verify-fly-style · verify-fly-formation · verify-player-nose · verify-style-retire · verify-inspect-actions | R18 close (`7169aff`) / earlier rounds | untouched by R19 and by this tree's three-file delta |

**What this ledger does NOT claim:** it does not claim the full 22-harness R18
sweep was re-run today. It claims that the only product code that changed since
the last full green sweep is the three files named above, and that every gate
covering those files was re-executed today on the integrated tree.

---

## Evidence PNGs (phase 3)

Regenerated by the runs above and committed as the round-close pass (the
`3b6704d` convention: evidence regenerates ONLY at round close, on the merged
tree, in one pass):

- `r16-satnight-01..08` (verify-sat-night, committed with `77203e0`)
- `r19-b-aerial-01..09` + the four `*-ctrlA/ctrlB` control pairs (verify-aerial)
- `r19d-01..07` (verify-dusk)
- `r19-e-01..06` (verify-feel)
- `tracer-01..04`, `spicy-01/02b`, `game-01..05`, `fleet-01/02/03`
- `soak-results.json`

**Skipped deliberately:** the plan §7 cross-agent showcase captures (the
four-agent frame; C+D night Powell). Fable's trim removed them from scope.

---

## Anything NOT certified

1. **verify-feel's streak gates remain marginal**, by construction — they compare
   a pixel signal against a same-frame noise floor that is 90 % of it (1.4074 vs
   1.3028 today). Green today, green at `414a392`; a future red there should be
   control-experimented before it is believed.
2. **verify-fly-game's pixel-hover leg did not engage** (its own WARN). The card
   itself was asserted; the hover path was not exercised this run.
3. The **skipped rows above were not re-executed today** — they rest on byte
   identity plus their cited wave-merge greens.
4. The `(E)` quiescence loop's own back-to-back pairs still read 0.4–8.1/255 in
   runs whose probe A/A came out at 0.09–0.20; that residue is the screenshot
   cadence, not scene churn, and is documented inline in the harness.
