# FLY ROUND 20 — "Icons & Sprawl" (PLAN)

Date: 2026-08-01. Orchestrator: Fable. Executors: FOUR Opus 5 agents (A, B, C, D)
in three waves. Branch: `claude/round20-icons-sprawl` (scaffolded off main
`dda4009`). Integration worktree: `.claude/worktrees/r20-fable`.

## §0 Why (the user's two asks, verbatim intent)

1. **"Severe gap in the ability for buildings to dynamically generate in ALL
   areas."** Root causes are measured and ranked (R20 scout, 2026-08-01):
   - The satellite building path still carries BOTH halves of the multipolygon
     defect R19 fixed for toy only: `maxFootprintM2` tests the feature SUM
     (`vector-tile.worker.js:1198-1201` detail, `:2311` skyline) and every
     polygon of a feature shares ONE drape anchor (`:1482-1491`). Powell OH's
     single 171-house feature (~240k m² summed) is discarded whole.
   - OpenFreeMap ships no house footprints in suburbs (Powell center tile: 1
     building) — but `landuse=residential` polygons DO exist (Powell 1.75 km²,
     Dublin 11.96 km²) and the satVeg cls-4 parcel-anchor + SatHouseLights
     hash-cluster idiom already proved 2,128 stable points at Powell. The
     worker files procedural parcel buildings as "a future round" at
     `vector-tile.worker.js:2371-2374`. That round is this one.
   - The toy z13 mid ring drops every building under 30 m (`worker:3142/:3233`)
     — suburbs vanish past 8 km even in Neon.
2. **"Major monuments such as Empire State Building not having the right 3d
   models and colors."** All 124 landmark POIs share NINE procedural archetype
   builders; ESB, the Eiffel Tower, and Burj Khalifa are literally the same
   stepped-box `spire` (`lib/fly/landmarks-3d.js:156-179`). There is no
   per-POI geometry hook. R20 ships a marquee GLB overlay with real downloaded
   models. **User has explicitly relaxed the model-source guideline for this
   round: any FREE source is in scope; best aesthetic match wins; licensing
   still gets RECORDED in FLY_ASSETS (CC-BY attribution remains a hard rule
   where the license demands it).**

## §1 Scaffolding (Fable, already landed on this branch)

- `WORKER_PROTOCOL 15→16` at all six pin sites lockstep (worker:120,
  toy-world-engine:53, sat-building-engine:42, sat-skyline-engine:20,
  sat-veg-engine:13, sat-road-engine:31). Stale bundles drop.
- Four constants blocks at the tail of `lib/fly/fly-constants.js`, ALL
  `enabled:false`: `SAT_POLY_COVER` + `TOY_MID_SUBURB` (owner A),
  `PARCEL_HOMES` (owner B), `MONUMENT_MODELS` (owner C). Flag-off must stay
  byte-identical to R19 behavior per block. Owners may freely tune values
  INSIDE their own block; nobody edits a block they don't own.

## §2 Ownership matrix (files, exclusive unless noted)

| Agent | Owns |
|---|---|
| **A SPRAWL** | `vector-tile.worker.js` — `buildSatBuildings`, `buildSatSkyline`, the toy `buildTile` mid-ring building block ONLY; `sat-building-engine.js`, `sat-skyline-engine.js` (consumption of per-poly bundles); `SAT_POLY_COVER` + `TOY_MID_SUBURB` blocks; NEW gates appended to `scripts/verify-suburbia.js` + `verify-sat-buildings.js` |
| **B HOMES** | NEW `components/fly/SatParcelHomes.jsx` (+ its FlyScene mount line); `SatHouseLights.jsx` (read-only reference — do NOT change its output); `PARCEL_HOMES` block; worker satVeg emission ONLY if cls-4 anchor density must rise (coordinate via Fable); NEW `scripts/verify-parcel-homes.js` |
| **C ICONS** | `public/models/monument-*.glb` (new files); `lib/fly/assets.js` (FLY_ASSETS entries ONLY — see §4 traps); `CREDITS.md` via `gen-credits.mjs`; NEW `lib/fly/monument-models.js` manifest; NEW `lib/fly/monument-loader.js`; NEW `components/fly/MonumentModels.jsx` (+ FlyScene mount); `LandmarkMonuments.jsx` (ONLY the park-procedural-at-scale-0 hook); `MONUMENT_MODELS` block; `world-bend.js` cache-key registry comment + new key; NEW `scripts/verify-icons.js`; SANCTIONED edits to `scripts/verify-monuments.js` per §5 |
| **D CERT** | `scripts/r20-close-sweep.md`; runs the fleet; may author determinism fixes ANYWHERE with Fable sign-off per fix; FLY_ROUND20.md skeleton |

`fly-constants.js` is shared but conflict-free by construction (pre-seeded
blocks). `FlyScene.jsx` gets ONE mount line each from B and C — keep them
single-line and位置-independent so Fable's merge is trivial.

## §3 Waves

- **W1 (parallel): A + C.** Disjoint by the matrix above.
- **W2: B**, on the tree with A merged (B's layer must respect A's newly-real
  streamed footprints for house-avoidance).
- **W3: D**, on the fully integrated tree.

Worktree protocol (R19 idiom, unchanged): each agent creates its OWN worktree
off `claude/round20-icons-sprawl` (`git worktree add .claude/worktrees/r20-<x>
-b r20/<x> claude/round20-icons-sprawl` from the repo root), junctions
node_modules (`cmd /c mklink /J node_modules C:\Users\bfecho\skyloom-3\node_modules`),
runs its OWN `next dev` on its OWN free port (suggested: A 3120, B 3121,
C 3122, D 3123; NEVER :3000/:3002/:3019 — user-adjacent), points every harness
at it via `FLY_URL`. **Agents never commit** — Fable reviews and lands one
merge commit per agent.

## §4 Frozen constraints (NOT sanctioned to move)

- **Owens Valley ≤ 261 draws** — every harness that asserts it (verify-sat-depth
  :153, verify-aerial :463, verify-skyline :178, verify-suburbia (E)). Owens
  ships 7 parsed buildings / no residential landuse — A and B must hold this
  BY CONSTRUCTION (per-poly explosion adds ~0 there; parcel homes need cls-4
  anchors that don't exist there).
- Satellite ≤ 375, toy ≤ 480 draw ceilings; soak tris ≤ 2.2 M; heap no-climb.
- verify-neon-cover: gate 4a (NO satellite builder references `NEON_COVER` —
  that's why `SAT_POLY_COVER` exists as a separate block), gate 4b (sat
  bundles byte-identical under the NEON_COVER flag flip), the five frozen
  toy FNV hashes for `NEON_COVER.enabled:false`.
- verify-suburbia (G): NO rendered block height in (25, 35) m — `PARCEL_HOMES.hM`
  and A's skyline work must respect the construction rule.
- verify-fleet / verify-hangar count arithmetic: `TRAFFIC_MODELS === 13`,
  assets.js `{ url: '/models/` literals `=== 10`. Monument GLBs register as
  `file:`-only FLY_ASSETS entries + the NEW `lib/fly/monument-models.js`
  manifest (the R17 player-aircraft precedent). ≤ 1 MB per GLB (verify-fleet
  :24 gates every `file:` entry).
- `verify-monuments-sat.js` stays FROZEN — Christ the Redeemer is EXCLUDED
  from the R20 marquee set precisely so the satellite monument harness never
  needs an edit this round.
- No `_isModel`/`_painted` flags on monument or parcel-home meshes (harness
  foreground-hide enrollment).
- Boot envelope; `runtime.modelsReady` semantics (monument GLBs must NOT gate
  boot — procedural fallback renders instantly, models swap in async).

## §5 PRE-SANCTIONED moves (each consumed move needs an inline
`R20 SANCTIONED RE-BASELINE: old → new` comment + a round-record row + Fable
sign-off on the measured control)

1. `verify-monuments.js` gates 3–7 (statue placement/height/letter/pixel) —
   re-pointed at the union of procedural + marquee placements once Liberty
   ships a GLB. Gate 8 (`landmark-*` ≤ 10) does NOT move (marquee mesh is
   named `monument-marquee`). Gate 9 Δ-draw window [1,15] absorbs +1–2.
2. `verify-suburbia` (B)/(D)/(F) measured numbers, if A's per-poly explosion
   or B's homes move Powell/Columbus/Dublin counts — the DIRECTION must be
   up (more coverage), the ceilings of §4 must hold, and (G) never moves.
3. `verify-roof-variety` Manhattan tris ≤ 1.6 M — A must first contain via
   `SAT_POLY_COVER` caps; a re-baseline is last resort with an A/B control.
4. `verify-sat-buildings` extensions for per-poly bundles.
5. R18's satellite value-only monument hue lock is EVOLVED for marquee GLBs
   ONLY: muted real albedo (saturation-capped via `MONUMENT_MODELS.satAlbedo`)
   is sanctioned BY USER ASK ("the right colors"). Procedural non-marquee
   monuments keep the R18 value-only grade untouched.

## §6 Agent charters (summary — full briefs delivered at launch)

- **A SPRAWL**: port the toy per-polygon explosion + per-polygon drape to
  `buildSatBuildings`/`buildSatSkyline` behind `SAT_POLY_COVER`; relax the toy
  mid-ring floor behind `TOY_MID_SUBURB`; measure Powell/Manhattan/Owens
  before+after; extend suburbia/sat-buildings gates; hold every §4 number.
- **B HOMES**: `SatParcelHomes` — ONE InstancedMesh of procedural houses off
  cls-4 parcel anchors (hash-stable, building-avoided, DEM-draped, engine-side
  distance gate, day+night material with `SUBURB_NIGHT` parity), medium+high
  satellite tiers; Powell should read as a real neighborhood from 600 m; new
  verify-parcel-homes harness; Owens stays empty by construction.
- **C ICONS**: scout + download FREE marquee monument models (mandatory: Empire
  State Building; targets: Statue of Liberty, Eiffel Tower, Big Ben, Space
  Needle, Gateway Arch, Sydney Opera House, Taj Mahal, Colosseum, One WTC,
  Willis Tower, CN Tower, Burj Khalifa — honest fallbacks per the R14 lesson,
  bridges EXCLUDED v1, Christ the Redeemer EXCLUDED per §4); offline-process
  to ≤1 MB uncompressed GLBs with colors baked to COLOR_0, base at y=0,
  footprint-centered, +Y up; register per §4; mount as ONE `monument-marquee`
  batched mesh behind `MONUMENT_MODELS` with `applyBendAnchor` under NEW key
  `world-bend-anchor-monument-r20`; procedural instance parks at scale 0 when
  its model places; toy grade = palette-quantized real accents + baked flood
  ramp + emissive accents (night read); satellite grade = §5.5 muted albedo;
  letter contract: model top lands at `groundY + hM×1.35`; A/B screenshots
  for Fable review; sanctioned verify-monuments edits per §5.1; new
  verify-icons harness.
- **D CERT**: r19-close-sweep.md-format ledger; targeted sweep from the real
  product diff; the four monument/building harnesses + neon-cover + suburbia +
  skyline + roof-variety + sat-depth + aerial + fleet + node gates + 15-min
  soak; evidence PNGs in one pass; FLY_ROUND20.md skeleton with §6 user
  checkpoints.

## §7 Definition of done

Every §4 number green on the integrated tree; every consumed §5 move
documented; Powell OH satellite shows a real neighborhood (streamed per-poly
footprints + parcel homes) day and night; NYC/Chicago unchanged or better;
Owens 178–194 band holds; ESB + ≥6 marquee monuments render their real
silhouettes in both styles with correct colors; FLY_ROUND20.md records it all;
user checkpoint table pending.
