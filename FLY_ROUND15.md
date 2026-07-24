# Fly Round 15 — "Ground Truth" (2026-07-24) · STATUS: BUILT

User-driven round off live R14 flying: warbird models "absolutely terrible,
shaded purple"; a Cirrus inspecting as a helicopter; the inspect panel needed
the ACTUAL real plane (photo, registry identity, more + correct data, desktop
AND mobile); satellite buildings "dull and boring, no immersion, no ROOFS".
Plan: [FLY_ROUND15_PLAN.md](FLY_ROUND15_PLAN.md). Executed same-day by **four
Opus 5 subagents in parallel** (disjoint file ownership) under Fable
orchestration — Fable diagnosed, briefed, reviewed every diff, arbitrated,
ran the full gate sweep, captured evidence, committed. **Zero harness gate
re-baselines** (one sanctioned gate REWRITE with measured drift — see §2).

## 0. Root causes (all confirmed in source before any agent launched)

1. **Purple planes:** warbirds fly private N-numbers → worker classification
   `private` → tint `#a78bfa` (violet). GLB slots tint white over baked vertex
   colors; the three R14 primitive archetypes were classification-tinted →
   flat violet hulls at metalness 0.5.
2. **Cirrus = helicopter:** `'SR22'.includes('R22')` — the modern substring
   lists still carried the exact trap class R14 §7 lesson 1 warned about, in
   FOUR sites (worker ×2, classify.js ×2). Worse: `'C172'.includes('C17')` →
   **every Cessna 172 classified military** and drew the fighter.
3. **The photo hero was 100% dead:** planespotters now 403s UAs without a
   contact URL; the old handler threw on non-404 → catch → `{photos:[]}`.
   Every lookup, silently, since the policy change.
4. **Roofs didn't read:** one shared Lambert, six near-identical gray wall
   tones, roofs = same gray × 0.82 → downtown rendered as one extruded slab.

## 1. Phase A1 — classification + rarity ground truth

- **NEW [lib/aircraft-type-tables.js](lib/aircraft-type-tables.js)** — zero-import
  canonical `EXACT_TYPE_CLASS` (269 audited codes: heli 63 / prop 85 / jet 66 /
  military 55) + `EXACT_TYPE_CODES`. Worker keeps an inlined synced copy (the
  R14 pattern); gate proves ≡.
- **Exact-first everywhere:** worker `getAircraftIconType` + `isHelicopter`,
  classify.js ×2 — exact map consulted after the R14 warbird check, BEFORE any
  substring list; trap-carrying lists (heli/military/bizjet/prop in the worker)
  DELETED outright. Load-bearing rule found: doc8643 designators are ≤4 chars,
  so only ≤3-char substring patterns can trap; the worker's surviving tail is
  gate-pinned 4-char-only.
- **Airliner variants (sanctioned change):** worker widebody/narrowbody merged
  into prefix-matched `airlinerFamilies` (46 patterns, `startsWith`); **81
  codes rescued from `unknown`** when the feed omits category (A306, A19N,
  B739, B77W…). Cargo still wins first (B74F/B77F stay freighters). Regional
  turboprops deliberately left category-driven.
- **`lib/rarity.js` exact-first:** new `EXACT_TYPE_BONUS` (39 ported entries —
  gate-proven ported, none invented) + known-designator +0 short-circuit.
  **20 substring payout bugs killed**, incl. index-1 matches a hand audit
  missed: `'E3'` inside **BE33/BE35/BE36** (every Bonanza +45 Sentry bonus),
  `'B2'` inside **TB20/TB21**, `'C5'` inside **EC55**. Headline kill:
  **B212 90→30 — the legendary EMS Bell 212 SPICY ping is dead.** C-17 keeps
  30, F-16 tier unchanged, warbird path byte-identical (170/170).
- **NEW [scripts/verify-classify.mjs](scripts/verify-classify.mjs)** — 38 gates:
  table shape, worker≡canonical source-parse, guard-order pins, 210-code corpus
  sim, full-universe substring sweep (389 patterns × 538 codes), airliner-family
  no-leak proof, rarity i0–i7 (change set exactly the audited 20; 518 codes
  byte-identical). verify-warbirds stays green untouched.

## 2. Phase A2 — fleet models & liveries (the purple fix)

- **Tint mechanism:** primitives now carry baked per-part vertex-color
  liveries (`geometry.userData.bakedColors`); TrafficLayer tints ANY painted
  geometry white via `mesh._painted` (`_isModel` preserved for verify-fleet).
  Classification color can never repaint a hull again; only the `unknown`
  blob deliberately stays class-tinted. Billboards/far dots unchanged.
- **New GLBs (CC-BY 3.0, poly.pizza, all ≤202KB, uncompressed):**
  **warbird-prop** = Gilang Romadhan "Aeroplane" — genuine low-wing piston
  fighter, olive + yellow bands, texture baked to COLOR_0 offline (590→1157
  tris adaptive); **glider** = Poly by Google sailplane (was a reused Cessna).
- **Two long-latent GLB bugs fixed offline:** `traffic-military.glb` had
  rendered **FLAT WHITE since round 8** (runtime bake reads color factors,
  not textures — texture now baked to COLOR_0, navy + cyan as authored);
  `traffic-cargo.glb` shipped **baked 25.9° nose-up/banked + 17.9° yawed** —
  every cargo 747 flew crabbed for seven rounds; levelled offline, bbox now
  within 3% of a real 747 on every axis.
- **warbird-jet:** Graybill GLB KEPT (Fable ruling) but its flat-white single
  material repainted natural-metal/red offline. Era-correctness (it's a
  modern-ish delta, not a MiG-15) stays a §6 user checkpoint.
- **warbird-heavy + classic-transport: honest fallbacks confirmed again** —
  poly.pizza (20 candidates eyeballed), Quaternius (no aircraft), Kenney (no
  aircraft), OpenGameArt (wrong era/planform) have NO 4-engine WWII bomber or
  DC-3-class twin. Premium primitive rebuilds instead: B-17 planform w/
  bombardier glazing, ball turret, 4 nacelles + prop discs, olive/gray; DC-3
  w/ bare-metal two-tone, blue cheatline, cowl faces. Max primitive 596 tris.
- Every offline edit spelled out in FLY_ASSETS `modifications` (CC-BY
  requirement); CREDITS regenerated via gen-credits (21 urls, idempotent).

## 3. Phase A3 — inspect panel "the actual real plane"

- **Photo pipeline resurrected:** compliant UA
  `SkyTracker/1.0 (+https://github.com/nullvaluez/skyloom)` (matches the real
  remote; no personal contact). Hardened: hex validation, 6s abort, hit 24h /
  miss 3h split cache, loud warn on non-404, client throws on transport
  failure so React Query retries (one flaky fetch used to mean no photo all
  session). Live-verified across airliner + GA hexes. Fallout fixed: InfoCard
  was rendering photos with NO photographer credit (latent license violation),
  and the credit pill's `bottom-2 left-2` classes would have shadowed the
  selector verify-fly-style uses to find the Esri attribution bar.
- **NEW registry identity** ([app/api/aircraft/[hex]/info/route.js](app/api/aircraft/%5Bhex%5D/info/route.js)):
  keyless adsbdb → hexdb failover (fixed order, NOT sticky — adsbdb is a
  coverage superset and hexdb 404s most GA tails; a legit 404 must not demote
  it), 24h memo, never throws, `{found:false}` for blocked/military tails.
  Card shows manufacturer + real model (thin-model heuristic prefers
  "Beechcraft Bonanza 36" over registry "Beech 36"), operator, **separate
  OWNER fact when it differs** (leased fleets: Republic Airways / American
  Eagle verified live), registry country + flag. Registration prefers live
  ADS-B `meta.r` (adsbdb mangles some non-US regs).
- **Layout:** INK CODEX evolved, not replaced. Desktop dock 420→440px
  (in-gate), landscape-safe insets. **Real phone bottom sheet** via one
  matchMedia hook: full-bleed, drag-handle (doubles as close), 88svh cap,
  50px WARP/CHASE, safe-area padding. Route block: IATA/ICAO + city + flags +
  distance-to-run + ETA clock. Harness contract preserved verbatim (all
  testids, action semantics, 500ms telemetry, zero per-frame React).
- **Coverage:** +68 type names (R15 section; unconfirmed codes deliberately
  omitted — raw code is honest), +219 silhouette mappings + 2 new shapes
  (ga-twin, glider), zero existing entries modified (dup-scan proven).

## 4. Phase A4 — satellite buildings: roofs, facades, night windows

- **Roof READ:** dedicated height-banded `roofTones` (houses shingle/
  terracotta, mid-rise tar/gravel/green, towers membrane/white-cap), separate
  hash seed from walls, ± jitter; parapets brighter (sun-catching lip); HVAC
  galvanized. `roofMul` removed.
- **Wall depth:** 10 tones + jitter + baked fake AO (dark base ring easing off
  with height, lifted top ring) — zero new vertices.
- **Facade windows (tier ≥ medium):** worker emits wall UVs in FACADE METERS
  (u centered per wall — symmetric corner cuts; v = height above anchor ground
  so floors align across neighbours; mercator-corrected via `k`); ONE
  procedural 512² CanvasTexture atlas on the existing shared Lambert `map`.
  **The no-shader trick:** every roof/detail vert carries one constant
  `neutralUV` → zero screen-space derivative → always samples mip 0's solid
  pier-crossing texel → roofs exit the texture untouched at every distance.
  White by day, ambient-floor gray by night. No onBeforeCompile anywhere.
- **NIGHT windows (tier high):** paired emissive atlas (lit panes structured
  whole-floors × runs, some cool) as `emissiveMap` on the SAME material;
  `emissiveIntensity` driven per-frame from `runtime.sun.frac` (γ-shaped so
  cities come up at dusk, cost literally 0 at noon). **Zero extra draws** —
  verify-sat-depth measured 246 ≤ 261 with everything armed.
- **Protocol 11→12** both sides; a stale bundle is now DROPPED (missing uv
  attribute reads (0,0) = a window pane — wrong pixels), one dev warn, never a
  crash. `SAT_BUILDINGS.enabled:false` still the one-line revert. Fable also
  fixed toy-world-engine's EXPECTED_WORKER_PROTOCOL (stale at 10 since R13 —
  every toy dev session logged a false "stale worker" warn).

## 5. Verification — full sweep GREEN (sequential, dev :3000, no user session)

| Harness | Result |
| --- | --- |
| verify-classify (NEW, node) | **PASS** — 38 gates |
| verify-warbirds (node) | PASS — 20 gates, R14 behavior byte-identical |
| verify-boot | PASS both styles; sun-at-spawn holds |
| verify-fleet | PASS — 9 GLB slots swap (8→9), ≤1MB, no compression, credits 21 urls, nav bakes lit |
| verify-fly-models | PASS — geometry z=length sane, zero warnings |
| verify-sat-depth (gate 261) | **PASS — 246 draws** (buildings pass added zero) |
| verify-sat-buildings | PASS (first run tripped the SF hill drape probe INSIDE the 20s post-warp coarse-accept window — re-run draped base = dem − baseSink exactly; pre-existing timing sensitivity, noted, not re-baselined) |
| verify-roofs (toy) | PASS — Neon world byte-untouched by the shared-helper edits |
| verify-inspect-actions | PASS — full WARP/CHASE/retry/frozen matrix |
| verify-fly-style | PASS — Esri attribution intact beside the new credit pill |
| verify-fly-game | PASS — turntable contract both hero/secondary paths |
| verify-mobile | PASS — touch stick/throttle/look |
| verify-contracts | PASS — spots advance, score persists |
| verify-spicy (3-min soak) | PASS — F16 + WARBRD1 each ping once, zero re-fires, heap 112MB |

Evidence (session scratchpad `r15-evidence/`): buildings day + night over
Manhattan (roofs read; Bronx glows with structured lit windows), inspect
desktop (Republic E175: real photo + credit, registry model, OWNER American
Eagle, JFK→ORF w/ ETA), inspect mobile bottom sheet, A2's fleet sheets (9
GLBs oriented + 13 primitives with liveries, cargo-747 level before/after).
Live catches during capture: a real C-17 SPICY-pinged correctly named via the
new exact tables; live registry hits on GA tails.

## 6. USER CHECKPOINTS — PENDING SIGN-OFF (all live-tunable)

| Knob / call | Default | Question for the eyeball |
| --- | --- | --- |
| Warbird/GA liveries + kept Graybill warbird-jet | see traffic-geometries / GLBs | Do the liveries read in-scene? Is the (repainted, era-loose) warbird-jet GLB still better than its primitive? |
| `SAT_BUILDINGS.roofTones` + `roofJitter` | height-banded palette | Roofs at 500–1500ft: individual buildings or salt-and-pepper? Terracotta band too Mediterranean for US metros? |
| `SAT_BUILDINGS.night` | intensity 1.3, dayFrac 0.3, γ1.5 | Night windows: right moment + brightness, or Christmas tree? |
| `SAT_BUILDINGS.facade` | 3.3m cols / 3.4m floors | Window scale readable at pattern altitude without noise at 2000ft? |
| `INSPECT.panelW` 440 / sheet 88svh | 440 / 88 | Desktop width + phone sheet height feel right? Registry-first headline ("Cessna R172K") vs friendly name? |
| B-2 Spirit tier | rare → mythic (classification side effect) | Bless a mythic B-2? (It now has a military base, not unknown.) |
| Contract pacing shifts | — | spot-military no longer completes off C172s; spot-2-helicopters no longer off SR22s — intended, but pacing feel is yours |

## 7. Lessons

1. **A hand audit of substring traps misses index-1 matches.** `'E3'` inside
   `BE33` paid every Bonanza an E-3 bonus for years. Only a programmatic
   full-universe sweep (every pattern × every known code) finds these; any
   `.includes()` table needs a sweep gate, not a reading.
2. **A silent external policy change can kill a feature with zero errors.**
   planespotters flipped to 403-on-noncompliant-UA; graceful degradation
   swallowed it and the photo hero died invisibly for who-knows-how-long.
   Degrade gracefully to USERS, loudly to LOGS — and split hit/miss cache
   TTLs so recovery is fast.
3. **A "working" GLB can be wrong for seven rounds.** Flat-white military,
   crabbed cargo 747 — nobody re-inspects assets that load without warnings.
   Offline evidence renders (orient + scale + top view per model) make the
   fleet's actual look reviewable at a glance.
4. **Constant UV = mip-0 pinning is a free shader branch.** One texel of a
   shared atlas can serve "no texture here" for entire vertex classes with no
   material split and no onBeforeCompile — the fragment cost stays one fetch.
5. **Paired verifiers, round 2:** the same both-reject-for-opposite-reasons
   failure R14 hit in list-merging appears in FIXED-ORDER failover design too
   — sticky source demotion punishes a source for a legitimate 404. Failover
   patterns must distinguish "this source is down" from "this source
   correctly has no answer."
6. **Draw gates still can't see fill rate** (R13 lesson, honored): facade =
   +1 fetch at medium, night = +2 at high, tier-gated exactly like R13's
   water glint; the 246-draw measurement proves only draws, not fragments.

## 8. Known follow-ups (out of scope, recorded)

- `lib/classify.js` has ZERO importers (flat-tracker legacy) — delete
  decision pending user; it was still fixed to stay truthful while it exists.
- Airline prefix mapping: callsign `ATN…` resolved to "Royal Air Maroc"
  (IATA `AT` collision) in the route path — pre-existing, now visible because
  the card displays operator prominently. Needs an ICAO-prefix-first lookup.
- Route "nm to run" can exceed total nm when the aircraft is far off the
  great-circle (pre-existing progress math).
- K35R / A124 / A225 / C30J / GLF6 have no rarity bonuses (their legacy
  5-char/marketing entries were dead code) — one-line adds if wanted.
- `traffic-prop.glb` measures a 13.4° thin-axis tilt (estimator confounded by
  the high wing) — future model pass.
- verify-sat-buildings' SF probe can race the 20s warp-coarse drape window
  (flaked once, passed clean on re-run) — could await the heal instead.
