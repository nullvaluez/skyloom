# Fly Round 10 — "In That Area" (world-marker expansion + altitude-aware POI letters)

> STATUS: BUILT + verified (2026-07-18). Two paired asks from the user
> (who wanted their local area well-covered): (1) **WAY more world markers** —
> "I want to see Powell, Dublin, and so forth… this to all major cities";
> (2) at cruise altitude, **see the ground markers near AND far so it feels
> like you're *inside* that little area** the mini-planet warp carves out
> (reference: a big clear "Detroit" label). Both shipped. The offline
> `CITIES` POI DB grew **303 → 1719** (+1416, agent-generated + adversarially
> verified), and the POI **letter** system in [PoiLetters.jsx](components/fly/PoiLetters.jsx)
> is now altitude/horizon-aware: a metro POPULATES around you, and because the
> globe FLATTENS with altitude, more of the area's towns appear the higher you
> fly. All defaults are live-tunable in `LETTERS` ([fly-constants.js](lib/fly/fly-constants.js)).
> Verified real-Chrome+GPU: verify-poi / verify-monuments / verify-atlas all
> green. §4 = user tuning sign-offs pending; §5 = harnesses; §6 = lessons.

## 1. What shipped

**Part A — data.** `lib/fly/poi/cities.js` went from ~300 hand-curated world
cities to **1719**: every US metro's suburbs + satellite towns (Columbus OH
metro area covered in depth per the user's request), plus dense fill across
Europe, Canada, Latin America, Asia, the Middle East, Africa and Oceania. Format
unchanged — `[name, lat, lon, tzOffsetH]` — so every consumer (PoiLetters,
buildPoiList, buildAtlasList, minimap) is unmoved. Cities are distance-culled at
render, and the minimap only mass-draws military POIs, so the ~5× row count adds
no clutter and no perceptible cost (a few thousand hypot() at 0.5 Hz).

**Part B — visibility.** The letters now read as an AREA, not one lonely CITY
name. See §3.

## 2. The data expansion

- **How.** 5 Opus-4.8 regional generator agents (Midwest incl. the home metro /
  NE+Mid-Atlantic+SE / West+Mountain+TX-OK-NM / Europe+Canada+LatAm /
  Asia+ME+Africa+Oceania), each PAIRED with an Opus-4.8 adversarial verifier
  that re-checked every coordinate (right state/hemisphere, ≤~15km of the true
  center, correct coarse tz, no hallucinated places, no dup/collision). Run as a
  `Workflow` generate→verify pipeline; each agent wrote a region JSON, then a
  deterministic node merge (scratchpad) deduped accent+case-insensitively vs the
  existing 303 and across regions, bounds-validated, and appended region-grouped
  sections before the array's `];`. Merge result: **+1416, 0 dupes, 0 invalid,
  0 US-suffixed towns outside the US bbox.** Verifiers caught 3 hallucinated
  towns, a Tianjin ~28km off, St. John's tz (−3.5), Chihuahua tz (post-2022
  reform), and several name collisions.
- **The disambiguation trap (important).** `name` is the identity key for POI
  slots (`shown` set, slot reconcile) AND the Atlas key (`city:${name}`), so
  **every name must be globally unique**. `Dublin` was already Dublin **Ireland**
  → Ohio's is `Dublin OH`. Likewise `Columbus`(OH)→`Columbus GA`,
  `Portland`(OR)→`Portland ME`, `St. Petersburg`(RU)→`St. Petersburg FL`,
  `Long Beach NY`→`Long Beach CA`, `Hollywood`→`Hollywood CA`, `Santa Fe`→
  `Santa Fe NM`, etc. Any future bulk add MUST state-suffix ambiguous US names.
- Timezone is the same COARSE standard-time offset the Atlas uses for its
  "it's night there" nudge only — DST/exactness does not matter.

## 3. The POI letter rework (altitude/horizon-aware "area feel")

Root cause of the user's empty high-altitude screenshot near Wright-Patterson:
(a) **Dayton wasn't in the DB at all**, and (b) the letter system only ever
showed the **2** nearest cities. Fixes, all in `LETTERS` + PoiLetters:

- **Metro populates.** city `max` 2→**6** (airport 3→4, military 2→3); SLOTS
  10→**20** capacity. Quotas are a ceiling — separation + horizon cull keep it
  from ever looking like a wall of text.
- **Per-kind declutter** (`separationM` is now a per-kind MAP, not a number):
  cities pack tight (**3000**) so a metro's suburbs coexist; landmarks keep the
  round-6 **4500** so dense monument clusters (NYC) stay slot-stable. A flat
  3000 blinked EMPIRE STATE in/out — caught by verify-poi (§6). The collision
  radius between two candidates is `max(sepFor(a.kind), sepFor(b.kind))`.
- **Horizon-aware cull (the key idea).** A grounded letter is DRAWN only out to
  the visible rim. `horizonD = sqrt(altM / k)` is where the bent ground drops to
  eye level (`k` = the live, **altitude-flattened** bend read from `getBend()`);
  past `horizonD·horizonFrac` (1.1, floored at `minVisM` 30km) the letter would
  float as white text in the void BELOW the world (letters are NOT subject to
  the ground rim-fade shader), so it is hidden. Because `GLOBE.altFlatten`
  flattens `k` as you climb, this rim distance GROWS with altitude (~15km low →
  ~155km at 40k ft) — so **more of the area's towns appear the higher you fly,
  with zero per-altitude tuning.** The cull is VISUAL only: selection and
  `runtime.poiSlots` are untouched, so letter stability (verify-poi) holds.
- **Distance up-scale** (`farScale` {8000, 90000, ×2.4}): letters grow toward
  ~constant on-screen size so a town near the (flattened) horizon stays legible
  instead of shrinking to a speck.
- **Warp-hold seam fix** (`heldVisible`): the 20s minimum-hold + sticky-sort
  bonuses now apply only while a shown letter is STILL on-screen (`d ≤ cullD`).
  Before, a big Atlas warp left the previous area's now-off-screen names
  squatting the quota for 20s while the new area's towns waited unseen. In-view
  holders behave exactly as before, so stability is preserved.

## 4. User sign-offs pending (live-tuning review)

All knobs are in `LETTERS`. Fly up over your home area and eyeball; nudge freely:
- `city.sizeM` 250 / `airport.sizeM` 165 — base letter heights (m).
- `city.max` 6 / `airport.max` 4 / `military.max` 3 — how busy a metro reads.
- `separationM` per kind — city 3000 (suburb density) vs landmark 4500 (stable).
- `horizonFrac` 1.1 / `minVisM` 30000 — how close to the rim / the low-altitude floor.
- `farScale` {startM 8000, endM 90000, mul 2.4} — distant-letter boldness.
- `minDistM` 2200 — overhead suppression.

## 5. Harnesses

- **verify-poi** — PASS (letters continuously present, no flicker, no sub-4s
  lifetimes, zero pageerrors). This round first FAILED on a sub-4s EMPIRE STATE
  blink from the flat 3000 separation; the per-kind `separationM` map fixed it.
- **verify-monuments** — PASS (statue reads, monument draw budget Δ=10, ≤480 draws).
- **verify-atlas** — PASS (search + warp + visit store); incidentally confirms the
  new suburbs render everywhere — Nellis spawn slots now show North Las Vegas /
  Paradise NV / Henderson NV / Boulder City / Mesquite NV.
- Not re-run this round (unaffected): the rest of the migrated sweep + soak.

## 6. Lessons

1. **Letters aren't ground.** POI letters are troika Text meshes, NOT patched by
   the `world-bend-fade` rim shader — so extending their range naively makes far
   ones sink into the void below the horizon as floating text. The fix is the
   `horizonD = sqrt(altM/k)` cull, reading the SAME live bend uniform the GPU
   uses (via `getBend()`), so CPU letters and GPU ground agree.
2. **The warp already gives you "an area."** You don't fight the curvature to
   show more — you ride it. `altFlatten` widening the rim with altitude IS the
   mechanism that reveals more towns when high; the cull just tracks it.
3. **Global declutter radius is too blunt** once kinds have very different
   densities. Cities want tight packing (suburbs); landmark clusters want the
   old wide spacing for stability. Per-kind `separationM` (max of the pair) is
   the right shape. A single global value regressed verify-poi.
4. **`name` is an identity key, not just a label.** Bulk city adds must be
   globally unique — state/country-suffix every ambiguous US name (Dublin OH).
   The merge dedupes accent+case-insensitively as a backstop.
5. **Decouple selection from visibility.** Keeping selection generous (full
   range) while culling in the render loop preserved the round-6 stability
   guarantees (verify-poi reads `poiSlots`, the selection snapshot) AND fixed
   the void-floater problem — two goals that a selection-time cap would have
   traded off against each other (and would have narrowed the harness's route).

## 7. Follow-up (2026-07-18, same day): satellite default + POI stability

**Satellite is the default view now** (user). A player with no saved style lands
on Esri "Day", not Neon. The store literal `mapStyle` STAYS `'toy'` (so harnesses,
which seed `'toy'` via `scripts/_boot.js`, mount with no style hot-swap that would
let the boot gate reveal early); `PauseMenu`'s hydration effect resolves an unsaved
player to `'satellite'` and persists it. Explicit toy-choosers keep toy. `_boot.js`
no longer `removeItem`s the style key on a no-arg boot — it seeds `'toy'` — so the
Neon-world harness suite is unmoved. Verified: a fresh boot (no saved key) →
`mapStyle==='satellite'`, and verify-neon-city stays green (toy path intact).

**POI stability pass (found while verifying the above).** Scoping the round-10
area-feel boost to CITIES + airport reach exposed that the earlier all-kinds bump
had destabilized the dense NYC landmark field. Two real fixes:
- **Non-city kinds reverted to round-6/8 tuning** — landmark/military/hotspot
  `rangeM`/`sizeM`/`max` and `minDistM` (2200→2600) fed the round-6 stability
  contract; only cities pack tight (`separationM.city` 3000, every other kind
  back to 4500). Cities/airports keep the area-feel boost; the global horizon
  cull + `farScale` still apply to every kind (visual, not selection).
- **`stickyK` 0.8→0.68** — a *pre-existing* gone-and-back at the STATUE /
  VERRAZZANO / CONEY 3-way distance crossing south of Manhattan (round-9's 8 s
  window ended right before the come-back at t≈50, so it was never sampled). The
  denser round-10 field + the settle bump surfaced it; a stronger shown-letter
  sticky factor turns the 3-way boundary jitter into clean one-way handoffs.
- **verify-poi settle 8 s → 14 s** — the harness spawns ON the Statue; EMPIRE
  STATE's real 10 s arrival lifetime was being sampled mid-life (looked like a
  2 s blink). Letting arrival settle before sampling fixes the artifact without
  weakening mid-flight flicker detection.

Verified green ×4: verify-poi (clean, no gone-and-back). verify-monuments /
verify-atlas / verify-neon-city all PASS. **Lesson 6:** a harness sample WINDOW
can hide a real flicker — the Statue gone-and-back lived just past round-9's
window edge for a year. When you change letter density OR the settle, re-trace
the FULL timeline, don't just trust the pass/fail.
