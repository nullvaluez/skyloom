# Round 14 "AirVenture" — PLAN

> STATUS: PLAN (2026-07-23). Execution: 10 Opus 4.8 subagents at high effort
> under Fable orchestration (Fable plans/assigns/reviews only). Record doc on
> completion: FLY_ROUND14.md. Branch `round14-airventure`, tag
> `round14-baseline` at branch point (main @ 401febc).

## 0. Why

The spotting game knows nothing about the aircraft that make EAA AirVenture
Oshkosh special. MiG-17, DC-3, DC-6, B-17, P-51, Corsair, Constellation, Ford
Tri-Motor and their kin resolve to `unknown` (base rarity 5 → Common), render
raw type codes in the inspect card, and draw generic/primitive 3D models. This
round adds a ~200-entry audited warbird/classic rarity database, display names,
4 new traffic archetypes with license-clean GLB models, silhouettes, a
spot-warbird contract, and a deterministic audit harness.

User decisions (2026-07-23): tier policy = **"Marquee = Legendary+"** (every
famous warbird/classic ≥85 so it SPICY-pings; broader list tiers by realism);
list size = **~200 audited entries**.

## 1. Verified ground truth (line refs @ 401febc)

- `lib/rarity.js`: `TYPE_RARITY_BONUS` (30–81) applied via **stacking substring
  loop** (118–122) — a naive `B29` entry would also match key `B2` (+60). Fly
  feeds `_classification = meta.iconType` (archetype string);
  prop/airliner/jet/glider/drone contribute base 0. Tiers: legendary 85–94,
  mythic 95–100.
- Worker `lib/workers/aircraft-processor.worker.js` has its OWN inlined
  classifier (`getAircraftIconType` 139–187); `lib/classify.js` does NOT run in
  Fly. `FLY_ARCHETYPES` (227–237) append-only; index packed in wire row slot 7.
- SPICY (`lib/fly/fly-constants.js:1576–88`): military iconType always pings
  (minus `gaTypes`); everything else needs tier ≥ legendary. Per-hex session
  dedupe.
- Fleet: `TRAFFIC_MODELS` positional array (`lib/fly/assets.js:234–44`,
  `{url,targetLenM,yawFixRad}`, null = primitive). Append-only index contract
  across FOUR files: worker `FLY_ARCHETYPES` / `TRAFFIC_MODELS` /
  `buildArchetypeGeometries()` (`lib/fly/traffic-geometries.js:107–19`) /
  TrafficLayer draw loop. Loader is bare GLTFLoader — NO Draco/KTX2/meshopt
  (compressed GLB silently falls back to primitive). Traffic bakes vertex
  colors (flat-colored low-poly models only). Per-archetype uniform size via
  `targetLenM`.
- Licensing (HARD): CC0/CC-BY poly.pizza direct download
  (`static.poly.pizza/<uuid>.glb`) or NASA PD; NO Sketchfab/API keys; every
  model registered in `FLY_ASSETS` + `node scripts/gen-credits.mjs`. Budgets:
  ≤1MB and ~1.5k tris per traffic GLB.
- Draw gate: `scripts/verify-sat-depth.js:151` fails if draws > 375.
- Contracts: `spot-type` matches `contract.types.has(spot.type)`
  (`lib/fly/contracts.js:101`); `WIDEBODY_TYPES`+`spot-widebody` is the
  pattern.
- Turntable fallback: `lib/aircraft-silhouettes.js` `getBestSilhouette`
  fallbackMap (442–51) has no warbird keys.
- Oshkosh hotspot POI already exists (`lib/fly/poi/hotspots.js:40`).
- Process: R10 paired generate→verify + deterministic scratchpad merge; R13
  lessons — never edit while the user flies (HMR), implementers verify against
  checked-in reality.

## 2. Design

### D1 — Four new archetypes (APPENDED, indices 9–12)

| idx | archetype | targetLenM | members | primitive fallback |
|---|---|---|---|---|
| 9 | `warbird-prop` | 10 | P-51, Corsair, Spitfire, P-40, Bearcat, T-6, T-28, Stearman… | propGeometry variant (low wing, big cowl) |
| 10 | `warbird-jet` | 12 | MiG-15/17/21, F-86, L-39, T-33, Vampire, A-4… | jetGeometry variant (swept, stubby) |
| 11 | `warbird-heavy` | 28 | B-17, B-24, B-29, Lancaster, DC-4/6/7, Constellation | airlinerGeometry(fuseLen≈28, span≈32) |
| 12 | `classic-transport` | 19 | DC-3/C-47, Ford Tri-Motor, Ju-52, B-25, A-26, C-46 | airlinerGeometry(fuseLen≈19, span≈20) |

Classic airliners split across 11/12 by size/engine count. Small twins (Beech
18) → existing `prop`; warbird helos → existing `helicopter`. Null model slot =
primitive is acceptable. Measure and bump the sat-depth draw gate (~390) with
an R14 comment.

### D2 — Rarity: exact-match table, checked FIRST, short-circuiting

New canonical module `lib/warbirds.js` (plain ESM, zero imports,
node-loadable): `WARBIRD_TYPE_RARITY` (exact CODE → bonus, ~200 entries),
`WARBIRD_ARCHETYPE` (exact CODE → archetype for the 4 new archetypes + explicit
overrides like `BE18 → 'prop'`), `WARBIRD_TYPES` (Set for contracts).

`lib/rarity.js`: `CLASSIFICATION_RARITY` adds `warbird-prop: 45, warbird-jet:
45, warbird-heavy: 50, classic-transport: 40`; `calculateRarity` does the exact
lookup first — on hit, ADD the bonus and SKIP the substring loop entirely
(prevents B29→B2 stacking; keeps all new keys out of substring space; zero
existing scores change — audited). Tier math: base(archetype) + bonus lands in
the declared band. Marquee entries ≥85; ultra-rares 95–97 (below AF1 stack
headroom); non-marquee by realism (T-6 ~60, Stearman ~55, common homebuilts
30–45).

Worker: append the 4 archetypes to `FLY_ARCHETYPES`; add an inlined
`WARBIRD_ARCHETYPE` exact check at the TOP of `getAircraftIconType`. Do NOT
touch `militaryTypes` (no red tint, no military auto-ping, no spot-military
miscount) — warbirds ping via the legendary tier gate. Worker inline copy kept
in sync by the deterministic gate (D6), not imports.

### D3 — Display names
Append all codes to `AIRCRAFT_TYPE_NAMES` (`lib/aircraft-type-names.js`) in a
Round-14 section. Every rarity key must have a name (audited).

### D4 — Contract
One template in `lib/fly/contracts.js`: `spot-warbird` (kind `spot-type`,
`types: WARBIRD_TYPES` from `@/lib/warbirds`, pts 300). Completable
off-airshow because the Set includes common types. No badge changes.

### D5 — Silhouettes
`lib/aircraft-silhouettes.js`: 3 new shapes (`warbird-prop`, `radial-heavy`,
`classic-twin`); `ICAO_TYPE_TO_SILHOUETTE` entries for ~40 highest-traffic
warbird codes; fallbackMap entries for all 4 archetypes (`warbird-jet` →
existing `fighter`).

### D6 — Harnesses
- NEW `scripts/verify-warbirds.mjs` (node, deterministic): key
  validity/uniqueness; no key collides with modern-code space (names DB,
  WIDEBODY_TYPES, substring patterns); worker inline map ≡ canonical; archetype
  arrays aligned across all four files; every key named; tier bands hold;
  gaTypes disjoint.
- `verify-spicy.js`: second synthetic contact (`WARBRD1`, t:'B17', arch 11,
  iconType:'warbird-heavy') — pings once via tier gate, not military accent;
  F16 case unchanged.
- `verify-sat-depth.js`: measured bump 375 → ~390 with R14 citation comment.
- Regression sweep (sequential, dev :3000, `bootFly`): verify-fleet (+ eyeball
  screenshots), verify-fly-models, verify-contracts, verify-boot, soak-fly.

## 3. The 10 Opus agents

| # | Role | Output | Wave |
|---|---|---|---|
| A1 | List generator — combat | `r14-warbirds-military.json` (scratchpad) | 1 |
| A2 | List generator — civil | `r14-warbirds-civil.json` | 1 |
| A5 | Model scout (poly.pizza CC0/CC-BY, license verified, real downloads) | `r14-models.json` | 1 |
| A3 | Adversarial verifier of A1 | verified JSON + rejection log | 2 |
| A4 | Adversarial verifier of A2 | verified JSON + rejection log | 2 |
| A7 | Deterministic merge author/runner, then rarity/classifier integrator | merged JSON + report; repo: warbirds.js, rarity.js, worker | 3 |
| A6 | Model integrator | repo: models, assets.js, traffic-geometries.js, CREDITS.md | 3 |
| A8 | Names/contracts/silhouettes integrator | repo edits | 4 |
| A9 | Harness engineer + full sequential gate run | repo: scripts/*; gate log | 5 |
| A10 | Red team full-diff review + FLY_ROUND14.md | round record + review report | 6 |

Entry schema: `{code, name, category, archetype, realLenM, bonus,
expectedTier, sizeWaiver, marquee, oshkoshRegular, notes}`. Merge steps: drop
rejected → uppercase + `^[A-Z0-9]{2,4}$` → cross-file dedupe → collision audit
vs names DB/WIDEBODY/substring patterns/worker lists → archetype allowed +
size-ratio ≤0.45 or waiver → tier = base+bonus in band; histogram cap ≤35%
legendary+ EXCEPT marquee override → gaTypes ∩ = ∅ → emit merged JSON +
report. Orchestrator reviews between every wave and authors all commits, the
PR, and the merge.

## 4. Risks

Substring collisions → exact-first short-circuit + audits. License miss/dead
link → scout real-download verify + verify-fleet URL gate + red-team recheck;
null slot keeps the round shippable. Compressed-GLB silent fallback → no
draco; verify-fleet no-primitive gate hard-fails. Draw budget → measured
sat-depth bump. Worker divergence → verify-warbirds source-parse sync gate.
Size tension → archetype split + ratio audit + eyeball screenshots. SPICY
flood → per-hex dedupe + nearest-first + histogram cap; `SPICY.minTier` stays
live-tunable.

## 5. Out of scope (follow-ups)

Player-flyable warbird selection; Oshkosh seasonal/event logic; textured
per-type liveries (traffic bakes vertex colors).
