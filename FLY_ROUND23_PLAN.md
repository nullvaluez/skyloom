# FLY ROUND 23 — "NIGHT ALIVE" (PLAN)

> Authored 2026-08-11 by Fable (orchestrator), one day after the R22 ship, in
> response to a direct user defect report. THREE Opus 5 agents (A NIGHT-TRUTH /
> B CITY-LIGHT / C NIGHT-CERT) execute; Fable plans, relays, arbitrates
> sanctions, merges, and certifies. Round branch:
> `claude/satellite-night-lighting-issue-p0rivp`. Base: `5d6c09d` (R22 close).

## §0 The user report (2026-08-11, verbatim substance)

> "We have a severe lack of lighting overall when it is nighttime in satellite
> mode. Some buildings might have a white glow, some (very few) might show
> lights in windows, but for the most part it is almost silent black and
> totally ruins flying around at night time."

Three distinct symptoms. Treat them separately — they may have separate causes:

- **S1 "almost silent black"** — the aggregate night light field (windows,
  road glow, city glow domes, suburb clusters, runway lights) is missing or
  far below its R21 read.
- **S2 "some buildings have a white glow"** — a glow with the WRONG character:
  white, not the warm window-atlas read. Smells like emissive-without-map,
  a bloom artifact against black, or the R20 monument night residual class.
- **S3 "very few show lights in windows"** — window emissives exist somewhere
  but coverage collapsed. Density/coverage failure, not absence.

**Definition of done:** flying over a city at night in satellite reads ALIVE —
warm varied window grids, glowing road web, sodium city domes, runway/beacon
points — while Owens-class rural night stays honestly dark; no white-glow
artifacts; and a new un-pinned gate makes this class of defect impossible to
ship silently again.

## §1 Why this is a REGRESSION, and why every gate was green anyway

1. **The R21 baseline was good and is documented.** FLY_ROUND22_HANDOFF §0,
   written at the R21 close off the user's own Brooklyn Bridge screenshot:
   *"Window-grid night emissives read as a real city (R15/R16); density is
   plausible and now uniform across the whole frame."* Today the user reports
   almost none. Something between the R21 close and the R22 ship took it.
2. **The blindness mechanism is known and on the record.** Commit `56c6a10`
   (R22 W3 flag flips): *"Fleet pins keep every legacy harness measuring the
   R21 world; the five R22 gates un-pin per-gate."* `scripts/_boot.js` pins
   `__flyTerraPin` / `__flySettlePin` / `__flyClutterPin` / `__flyDepthPin`
   = 1 fleet-wide. So **verify-sat-night's 33 green gates certified night on
   the R21 world.** The five R22 gates that DO un-pin (terra / arrival /
   settle / clutter / depth2) measure the R22 world **by day**. The R22 world
   at night was never measured by any instrument. This is the R19 §7 lesson
   repeating a second time: *the harness fleet's own pins can hide an entire
   defect class from every gate.*
3. **A third blindness layer: tier.** verify-sat-night pins quality tier HIGH.
   Window emissives are a high-tier-only material swap (SatBuildingLayer:
   `SAT_BUILDINGS.night.enabled && atLeastTier(qualityTier,
   SAT_BUILDINGS.night.minTier)`). The user's live session runs whatever the
   R21 governor + R22 SETTLE_CALM ladder settle on under the heavier R22
   terrain — which no night gate has ever seen.
4. **The new terrain has no night path at all.** `lib/fly/terrain-engine.js`
   contains ZERO occurrences of "night" or "sun". Whatever darkens/lights the
   R22 ground at night happens (or fails to happen) elsewhere.
5. **Honesty clause:** part of "silent black" predates R22 — the handoff
   itself ranks sat roads "nearly invisible", water "near-black void", grade
   "mid-grey" as KNOWN gaps. This round must both (a) restore the R21-
   certified night read and (b) move the handoff's road-life + window-variance
   deltas far enough that night flying is a feature, not a mourning. Do not
   let (b) mask (a): the regression gets root-caused FIRST, with evidence.

## §2 Ranked hypotheses (A owns the verdict table; falsify with instruments, not vibes)

Every R22 family ships `enabled:` + has a fleet pin, so **bisection is cheap**:
fixed night pose, leg 0 = all pins (R21 world), leg 1 = un-pinned (user's
world), then flip families one at a time. Record tier + dpr + draw census +
night pixel metrics per leg so a tier flap can't masquerade as a shader bug.

- **H1 TIER/GOVERNOR CHAIN (prime suspect for S3, contributes S1).** R22's
  heavier terrain (z18 imagery + demMaxZoom 16 + live LOD curve) holds or
  steps the live session below `SAT_BUILDINGS.night.minTier`, killing window
  emissives; on medium, the §5.4-armed content haze now ALSO runs, hazing
  what light remains. The R22 soak measured governor steps 0 on the harness
  machine at pinned poses — that is not the user's machine or flight profile.
  Instrument: `__flyStats` tier/governor/dpr history at night poses, TERRA
  armed vs pinned, plus the SatBuildingLayer night-gate boolean sampled live.
- **H2 DRAPE BURIAL (prime suspect for S1's road/point-light component).**
  SatRoadLayer ribbons, SatHouseLights points, SAT_AIRPORT_BEACONS, and
  CLUTTER lamp pools drape against DEM queries tuned pre-R22. demMaxZoom
  16 makes the rendered terrain locally HIGHER/finer than a coarse drape —
  additive ribbons/points sink under the surface. Instruments: one-frame
  depthTest-off A/B probe (if the road web pops, it was buried); elevation
  census (layer vertex Y minus terrain raycast Y at N sample points,
  histogram, per pose).
- **H3 EMISSIVE-WITHOUT-MAP (prime suspect for S2).** The facade night atlas
  (`emissiveMap`, R15) or monument night keys fail to bind under the R22
  pipeline/prewarm — emissive color × intensity with a null/incomplete map
  renders as plain white-ish glow. Instrument: scene traverse census at a
  night pose — every mesh with emissiveIntensity > 0, does it hold a
  complete emissiveMap? Plus screenshot crops of the white-glow buildings.
- **H4 SETTLE/BIRTH HOLD-DOWN.** SETTLE_CALM birth fades or the damped
  `groundElevVis` hold night layers at ~0 opacity/mis-height under real
  un-pinned boots (B's W3 fixed one birthK wall-clock hole for re-streamed
  chunks — check for a sibling hole at first-stream under live tile latency).
  Instrument: birthK/opacity census 60 s after an un-pinned night boot.
- **H5 GRADE/EXPOSURE CRUSH.** SAT_QUILT (desatMax 0.22, §5.7 consumed) or
  aerial/content haze applying at night and crushing emissive luma.
  Instrument: per-flag A/B at a fixed night pose, luma-histogram deltas.
- **H6 LAYER MOUNT/KEY REGRESSION.** SAT_CITY_GLOW domes, SUBURB_NIGHT
  clusters, or the SAT_ROADS night envelope silently not mounting or
  mis-keying under the R22 world (elevation source, chunk keys, style gate).
  Instrument: draw-list + mesh census at night pose, R22 vs R21-pinned.

Interactions are expected (H1 chains into H5). The verdict table must state,
per hypothesis: CONFIRMED / REFUTED / PARTIAL, the instrument, the number.

**Fix-ownership rule:** A fixes BROKEN MECHANISMS (regressions vs the R21
certified read). B changes INTENDED-BUT-INSUFFICIENT DESIGN (the handoff
deltas). A's root-cause memo assigns each confirmed finding to one side.
When a finding straddles (e.g., windows tier-gated by design but the design
is now wrong for the R22 world), A ships the mechanism seam, B ships the
product decision behind its flag.

## §3 Measurement protocol (shared; C builds the instrument, A/B consume it)

- **Poses:** P-MAN Manhattan overview (~800 m AGL), P-BB Brooklyn Bridge
  chase pose (recover framing from the R22 handoff's reference description —
  best-effort; if unrecoverable, a low-AGL bridge-adjacent stand-in, frozen),
  P-POW Powell OH suburban night, P-MEL Melton AU parcel-homes night,
  P-OWE Owens Valley night (**DARK CONTROL — must stay dark and cheap; any
  feature lighting Owens is wrong by construction**). Deep night pinned via
  the existing sun/harness idiom (true elevation ≤ −12°); ONE dusk leg
  (el ≈ −6°) at P-MAN to protect the R19 dusk ladder.
- **Night metrics module `scripts/_night-metrics.js` (C, W1, FIRST):** from a
  screenshot buffer compute (a) lit-pixel fraction (luma > threshold,
  sky band excluded), (b) luma p5/p50/p95, (c) warm-lit fraction (lit pixels
  with warm hue — the sodium/window share), (d) white-glow area (contiguous
  high-luma LOW-SATURATION blob area), (e) per-layer draw/tris census via
  `__flyStats`. One instrument, all agents — no per-agent metric dialects.
- **Determinism rules:** traffic hidden at pixel poses and player hidden
  (R17 §7.1 — a pixel gate must not contain actors it doesn't control);
  weather pinned 'baseline'; clutter pinned ONLY where pose stability needs
  it. **The R22 family pins are NEVER set in night-alive legs — measuring
  the un-pinned world is the entire point of this round.**
- **A/B discipline:** every claim ships as paired PNGs + metric rows at a
  frozen pose (`scripts/r23-*` naming). Sequential same-leg re-runs are
  suspect (the world settles under a frozen pose — R22 D's lesson): use
  interleaved paired legs for timing-adjacent claims.

## §4 Ownership split

### Agent A — NIGHT-TRUTH (diagnose the regression, fix it at the root)

Charter: produce the H1–H6 verdict table with instruments and numbers; fix
every CONFIRMED regression at the root; restore ≥ R21 night read on the R22
world at P-MAN/P-POW with evidence.

- Owns: `lib/fly/terrain-engine.js` (night hooks if the fix lands there),
  `components/fly/FlyScene.jsx`, `Effects.jsx` / `AerialPerspective.jsx`
  night interactions, governor/settle night-visibility seams
  (`perf-governor.js` / `settle.js`), `SatEnvironment.jsx`, and the
  drape/elevation seam of EXISTING night layers (SatRoadLayer /
  SatHouseLights / SatCityGlow / SatBuildingLayer emissive path) — **fixes
  only, no new visual features** (features are B's).
- **R23_A_ROOTCAUSE.md committed EARLY** — the moment verdicts land, before
  fix polish. Fable relays it to B; B's final tuning waits on it.
- Flagging: a fix restoring R21-certified behavior may ship un-flagged when
  flag-off byte-identity is meaningless (a broken mechanism has no defensible
  "off" state); anything with taste or perf surface ships behind
  `NIGHT_TRUTH_R23` (pre-seeded). Document the choice per fix.
- Bounds: no gate edits (C owns gates; you may add read-only instruments /
  testids / `__flyStats` fields). No worker-payload changes unless
  unavoidable — if unavoidable, WORKER_PROTOCOL 18→19 at ALL pin sites
  lockstep (grep, count, list them in the report). Owens ≤ 261 draws and
  dark; no new draws at Owens from any fix.

### Agent B — CITY-LIGHT (the enhancement pass: night flying reads alive)

Charter: handoff deltas 2b/2c + 3, scoped to the user pain (lights), behind
`NIGHT_CITY_R23` (pre-seeded, ships `enabled:false` until Fable flips after
review).

- **Delta 3 ROAD LIFE:** cls-hierarchy night envelope re-sweep — the R16
  swept values are load-bearing history, so the re-sweep ships WITH a
  measured A/B against the swept baseline at P-MAN/P-POW (knob-move
  discipline); dash-train presence/gain tune + optional second color term
  (warm/red directions) INSIDE the one road material = zero extra draws;
  junction/streetlight pools ≤ +1 draw IF a sane anchor source exists
  (scout first; the R20 lesson — a scatter spending a shared cap is not an
  anchor source; if none, log the honest fallback and skip).
- **Delta 2b WINDOW VARIANCE:** widen lit-floor/lit-cell/brightness
  distributions, per-building dark-floor probability; a second night atlas
  variant selected per building hash is allowed — cache-safe seeding, and
  **new atlas variants join the prewarm warm set in the same change** (R21
  PREWARM contract).
- **Delta 2c BLOOM NIGHT TUNE:** only with the five-control verify-flicker
  protocol run before AND after (R21 residual: 23–80 swinging px survived
  five negative controls — do not wake it).
- **The tier question (pends A's H1 verdict):** if confirmed, B owns the
  product proposal for a night-visible medium-tier path (e.g., a cheaper
  emissive mode or night-only material swap at medium) — measured cost,
  proposed to Fable, never silently flipped. Windows at night are the game's
  read; "high-tier-only" was a 2026-07 perf call made for a lighter world.
- Bounds: satellite night total across ALL B features ≤ +2 draws at any
  pose, Owens +0 and dark, Melton/Powell anti-duplication + regK trust gates
  untouched unless measured broken; weather coupling — everything keys off
  `runtime.weather.wx` + true elevation, never fights the overcast lid or
  the R19 dusk ladder; new/changed world-bend-family shader chunks require
  NEW cache keys (registry header contract) + warm-set membership; flag-off
  byte-identity is the revert contract. verify-sat-night assertion moves are
  PRE-SANCTIONED RE-BASELINE requests with measured controls, escalated in
  the report — never silently edited (C arbitrates, Fable rules).
- Out of scope this round (R24 seeds, note them, don't build them): water
  (delta 4), sky/cloud deck (delta 1), rooftop night key (delta 6), POI
  letters (delta 7 — user checkpoint item), landmark floodlighting (delta 5,
  frozen-gate entanglement).

### Agent C — NIGHT-CERT (the never-again gate + certification)

Charter: make tonight's defect class impossible to ship silently again, and
certify the round.

- **W1 step 1 — RED CALIBRATION BEFORE ANY FIX LANDS:** build
  `scripts/_night-metrics.js` + `scripts/verify-night-alive.js` and run it on
  base `5d6c09d`. The gate boots the USER'S world — R22 families as shipped,
  **no `__flyTerraPin`/`__flySettlePin`/`__flyClutterPin`/`__flyDepthPin`**,
  tier NOT pinned high in at least one leg (one leg at the resolved live
  tier, one pinned-high control leg) — poses P-MAN/P-POW/P-OWE (+P-BB
  best-effort). Freeze today's red numbers in the harness header (the repo's
  RED-calibration idiom). Gates: lit-pixel-fraction floors at city poses;
  warm-lit share band; white-glow area ceiling; luma p5/p50/p95 bands;
  P-OWE dark ceiling + draw ceiling (≤ 261); zero pageerrors. The harness
  must FAIL on the base tree (prove it, keep the run log) and must pass on
  the fixed tree with UNCHANGED thresholds.
- Also owns: the R22-inherited harness debts — B-W3's requested
  `__flyTerraPin` additions to verify-arrival/verify-settle un-pin arrays;
  the four named harnesses that print no VERIFY line yet exit 0
  (verify-fly-models / formation / globe2 / player-nose) — fix or document,
  don't inherit silently.
- Close sweep on the integrated tree → `scripts/r23-close-sweep.md`
  per-harness ledger (R22 idiom): verify-night-alive (new, green vs frozen
  reds), verify-sat-night 33 (pinned legacy contract — must STAY green;
  it guards the R16 deep-night contract), verify-dusk 15, verify-flicker 7
  (five-control protocol if bloom moved), stability/tier-step/seam,
  verify-terra/settle/clutter/arrival (R22 gates stay green),
  sat-depth/aerial/skyline/monuments-sat/neon-cover byte-hash set, Owens
  draw locks. Any red: adjudicate harness-vs-product honestly (R22 carried
  seven harness-side reds — the ledger records which side failed).
- C NEVER edits product code. Instrument asks route through A (read-only
  `__flyStats` fields) via Fable.

## §5 Shared law (all agents)

1. **The Owens lock, extended to night:** ≤ 261 draws AND near-zero lit
   pixels. Rural desert night is dark; that darkness is a certified feature.
2. Frozen assertion numbers move only by pre-sanctioned re-baseline with a
   measured control, escalated in the report, ruled by Fable, inline-commented
   at the assertion (repo idiom).
3. No API keys; no new runtime deps; no r3f-perf; asset licensing per-source.
4. Vendored three-tile: prefer riding its seams over editing vendored files
   (the R22 syncShadow precedent); any vendored change goes in the VENDOR.md
   patch ledger.
5. Commits: small, per-concern, prefix `R23 A:` / `R23 B:` / `R23 C:`, in
   your own worktree branch. NEVER push. Fable merges.
6. Reports: end with a structured report — H-verdicts / features built /
   gates red-green tables, evidence file paths (`scripts/r23-*`), sanction
   requests, escalations, honest unknowns. The report is the record's raw
   material; write it like FLY_ROUND22.md §agent sections.
7. Dev servers: each worktree runs its own — A `:3021`, B `:3022`, C `:3023`
   (`FLY_URL=http://localhost:<port> node scripts/verify-*.js`; `npm run
   dev -- -p <port>`). Symlink `node_modules` from `/home/user/skyloom`
   (`ln -s /home/user/skyloom/node_modules node_modules`) — do not npm ci
   per worktree unless the symlink breaks Next.
8. Headless environment: Playwright chromium is pre-installed
   (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never `playwright install`.
   SwiftShader rendering — pixel thresholds must be calibrated in THIS
   environment (they are, if C freezes reds here).

## §6 Waves, merge, close

- **W1 (parallel):** A diagnosis → early memo → fixes. B recon + variance/
  envelope builds (final sweep values pend A's memo — Fable relays). C
  metrics module + verify-night-alive RED run on base FIRST, then inherited
  harness debts, then baseline fleet-subset table.
- **W2 (Fable):** review diffs + evidence; arbitrate sanctions and the tier
  proposal; merge A → B → C; decide the NIGHT_CITY_R23 flip.
- **W3:** integrated close sweep (C's ledger), FLY_ROUND23.md record,
  CLAUDE.md top notice, push.

## §7 User checkpoints (schedule in FLY_ROUND23.md §6, PENDING)

1. P-MAN / P-POW before/after money shots — the round's proof.
2. Night read on the USER'S machine + tier telemetry (perf feel FIRST — the
   R20 §6.15 lesson).
3. White-glow gone at the reported poses.
4. Window density/variance taste; road-glow strength taste.
5. If B proposes the medium-tier night path: approve the default.
6. Carried: DEPTH_PASS on/off decision (R22 §6, unrelated but pending).
