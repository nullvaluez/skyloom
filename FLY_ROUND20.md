# FLY ROUND 20 — "Icons & Sprawl" (RECORD)

Built 2026-08-01 → 2026-08-02. Plan: [FLY_ROUND20_PLAN.md](FLY_ROUND20_PLAN.md).
Orchestrator: Fable. Executors: FOUR Opus 5 agents (A SPRAWL, B HOMES,
C ICONS, D CERT) plus two salvage/continuation instances (B2, C2) after a
session-limit interruption — see §5. Branch `claude/round20-icons-sprawl`;
merges: scaffolding `f20f96f` → A `0300e63` → C `5d8920a` → B `df7315f` →
D close (§4).

## §0 Why

Two user asks, verbatim intent: (1) "severe gap in the ability for buildings
to dynamically generate in ALL areas"; (2) "major monuments such as Empire
State Building not having the right 3d models and colors still", with the
model-source guideline explicitly relaxed for this round (any FREE source,
best aesthetic match, licensing still recorded).

## §1 The headline

**Buildings now generate in all three regimes, and ten marquee monuments are
real models.**

1. **Where OpenFreeMap HAS data, satellite finally reads all of it** (A):
   the satellite building + skyline builders carried BOTH halves of the
   multipolygon defect R19 fixed for toy only — `maxFootprintM2` tested the
   feature SUM (one feature = a whole 171-house subdivision, discarded whole)
   and all polygons shared one drape anchor. Ported per-polygon behind
   `SAT_POLY_COVER`: **Powell OH 15 → 1,863 streamed footprints (1,233
   recognized houses)**, Dublin 62 → 2,914, Naperville 31 → 4,466, and
   **Manhattan triangles went DOWN** (511k → 401k worker-side; the per-polygon
   cap finally binds). The toy z13 mid ring stops culling everything under
   30 m (`TOY_MID_SUBURB`, floor 12 m) — Neon suburbs no longer vanish past
   8 km.
2. **Where OpenFreeMap ships NOTHING, procedural homes fill the parcels** (B):
   `SatParcelHomes` — a dedicated flag-gated `satParcel` worker sample over
   `landuse=residential` (the cls-4 canopy scatter was proven unusable as an
   anchor source: it is `SAT_VEG.maxPerChunk` leftovers, and 22.72 km² of
   Craigieburn AU suburbia yields ZERO scatter anchors), ONE InstancedMesh of
   32-tri hash-varied houses, day + night, +1 draw. **Melton AU: 2,068 homes
   where there were none. Powell: exactly 0 — bit-identical triangle totals
   across the flag flip** — a two-term anti-duplication scalar (regional
   deficit vs residential km² × 300 m local box, both off the R18 collision
   column index) makes the layer yield wherever real data lives. **The Owens
   invariant holds by measurement, not hope**: Lone Pine HAS 2.23 km² of
   residential landuse and 69 in-range anchors — all 69 suppress on regK=0.
3. **Ten marquee monuments are real, licensed, correctly colored models** (C):
   Empire State (the mandate), Statue of Liberty, Eiffel Tower (bespoke
   first-party — see §2), Big Ben, Taj Mahal, Sydney Opera House, Colosseum,
   Willis Tower, Space Needle, Gateway Arch. ONE merged `monument-marquee`
   mesh (+1 draw both styles), per-vertex `aAnchor` bend under new key
   `world-bend-anchor-monument-r20`, procedural archetypes byte-identical as
   the instant fallback (parked at scale 0 per placed model), the letter
   contract held to the centimetre. **C2's exclusion discs retire the
   second-actor defect**: the streamed OFM extrusion of the same real
   structure no longer renders through the model (the Taj was wearing a blue
   window-atlas office block; the Eiffel had a blocky base cluster).

## §2 Wave 1 — A SPRAWL + C ICONS (parallel worktrees)

**A SPRAWL** (`0300e63`): per-polygon explosion + per-poly drape in
`buildSatBuildings`/`buildSatSkyline`; the far-suburb density lock reads a
per-POLYGON threshold (40) under the flag only — measured 2.7× Owens' busiest
tile (Lone Pine's 15 candidates, invisible to the per-feature reader R19
measured 5 against) and 2.8× under Powell's 113; `SAT_FAR_SUBURB` untouched,
flag-off = R19 rules. Flag-gated `skyMeta` telemetry preserves the bundle KEY
SET (enabled:false leaves bundles identical down to their key list). Toy
mid-ring floor with the smallBoost-inverse pre-load skip (a naive reuse of the
new floor at the pre-load site would silently drop buildings pass 2 keeps).
Side effect: **a latent R18 collision defect retired** — the per-anchor-run
collision cylinder spanned a merged feature (max radius 3,391 world units,
wider than a city block); per-building it measures 306, gated by new
verify-sat-buildings (F2). All 11 fingerprint scenes flag-off byte-identical.
Zero sanctioned moves consumed.

**C ICONS** (`5d8920a`, incl. the C2 continuation): the sourcing story is the
round's licensing lesson. C's first pass shipped four models from the Meta
Spatial SDK Samples repo as "MIT" — **Fable review caught that the repo's MIT
covers CODE only; its sample 3D models sit under the Meta Platform
Technologies SDK license (the README carve-out), which is not
free-redistribution. All four were withdrawn** and replaced via a
three-route re-scout (poly.pizza index-verified, Wikimedia Commons API,
Icosa/Google-Poly archive): Colosseum → CreativeTrio CC0; Taj Mahal → Enter
Inventive Studio CC-BY 3.0 (542,709 → 5,890 tris through the offline bake —
untextured single-material topology decimates losslessly); Sydney Opera House
→ **credited to Nick Reinhardt CC-BY 4.0, the original author named by the
GLB's own `asset.extras`** and corroborated on his Sketchfab page with an
exact 62,420-tri match (the clean inverse of the One WTC/CN Tower rejections,
where authorship could only be inferred). The Eiffel ships BESPOKE
(`lib/fly/monument-builders.js`) after three candidates failed honestly: two
undecimatable (the subject is thousands of disjoint lattice members —
meshoptimizer preserves every component boundary; 87,624 tris moved −4% at
ratio 0.03), one 776-tri model rejected on read (solid spire, wrong aspect).
verify-icons (45 gates) now enforces a license ALLOWLIST (CC0 | CC-BY x.y |
Public Domain | MIT) + a named author per entry. Registration is `file:`-only
in FLY_ASSETS + a separate runtime manifest (`lib/fly/monument-models.js`) —
the R17 player-aircraft precedent — so verify-fleet/verify-hangar count
arithmetic never moved. 9 GLBs, 1.86 MB total, largest 417 KB, all ≤ 1 MB.
Offline processor `scripts/r20-monument-bake.mjs` (uncompressed, textureless,
albedo → COLOR_0, +Y up, base y=0, footprint-centred; textures resolved
per-vertex — the R15 flat-white trap engineered away).

**C2 exclusion discs**: per-model radii 25–190 m (Big Ben 25 m so the Palace
of Westminster keeps streaming; Colosseum 190 m across the archaeological
zone), polygon-centroid test after A's explosion on all three admission paths,
punched BEFORE district stats / typology / the Owens lock, compiled at worker
import from two static data files — per-frame placement state would poison
the per-`z/x/y/detail` bundle cache. Byte-proof: flag-off = byte-identical on
all 11 scenes; flag-on moves exactly the 3 ESB-bearing Manhattan bundles.
Plus the satellite **stone key**: re-keys the achromatic part of a marquee
albedo onto the warm `#d7d0c2` stone hue (Taj night blue-minus-red +33.5 →
+25.0 against the certified procedural baseline of +18.4); chromatic
identities (Liberty verdigris, Eiffel iron) untouched.

## §3 Wave 2 — B HOMES (on the A-merged tree)

See §1.2 for the design. Measured behaviour table (from the B2-verified
ledger): Melton 449 anchors → 2,068 homes (+1 draw exactly, median-of-3
quiesced; +66,176 tris = 2,068 × 32 exactly), Craigieburn 1,910, Plain City
OH 173; Powell 75 anchors → 75 suppressed → 0 placed; Blagnac FR 181 → 0;
Lone Pine 69 → 0 — all three suppressed scenes bit-identical in triangles
across the flip. Heights 5.00–12.11 m (the (25,35) band untouched — suburbia
gate G). Night emissive 0.780 / day exactly 0. Mounted inside SatVegLayer
(the FlyScene mount line was reserved for C — a deliberate merge-hygiene
choice). verify-parcel-homes: 18 gates.

## §4 Certification (Agent D, per-harness ledger `scripts/r20-close-sweep.md`)

**32 browser harnesses + 3 node gates on the INTEGRATED tree — ALL GREEN
after two Fable rulings. Every frozen ceiling held; zero frozen assertion
NUMBERS moved.**

- **Owens 179–195 ≤ 261 across five independent harnesses** (suburbia 180,
  skyline 181, parcel-homes 179, groundlife 179/180, **aerial 195 fully
  armed**). Satellite worst 263 ≤ 375. Toy worst 444 ≤ 480. Manhattan
  roof-variety tris **0.80 M ≤ 1.6 M**. All five R18 neon-cover hashes
  byte-exact. verify-monuments-sat FROZEN and green.
- Key state: Powell kept **1,863 / houses 1,233**; Manhattan sat-buildings
  kept 6,966 with the widest collision column **305.9 m** (pre-R20 control
  3,391 — the retired latent defect); Melton **2,068 homes at exactly +1
  draw**; marquee **+1 draw both styles**, ESB top **626.78 m = 443×1.35
  exactly**; exclusion discs **0 centroids inside** (control 8, nearest
  4.4 m); neon-cover worst toy tris **1.691 M ≤ 2.0 M**.
- **The integration-seam prize**: with all four R20 flags off, the worker is
  **byte-identical to main `dda4009` across all 11 fingerprint scenes** —
  three agents' +489 worker lines compose to an exact no-op.
- **Soak** (15 min, armed, live traffic): fps floor **80.0**, p95 12.5 ms,
  draws 444 ≤ 480, heap 525→403 **no climb**, rebase 0.70 ms, **zero
  pageerrors — through 1,616 live aircraft, 41% above R19's 1,145 record.**
- **The soak max-tris story (the round's honest escalation)**: both armed
  runs exceeded the 2.2 M max-tris figure (2.345/2.549 M) — but D proved the
  METRIC cannot judge the feature: same-config run spread (0.204–0.284 M)
  equals the entire feature delta (0.267 M), and uncontrolled live traffic
  rides the same scene total (the control run saw the HIGHEST traffic and the
  LOWEST triangles). Deterministic worker measurement: the cap half of the
  cost (−16%) was free — taken (`maxPerChunkMid` 240→180 under ruling); the
  floor half (−5.8%) costs real suburb — refused. **Fable close ruling: the
  deterministic fixed-pose gates are the load-bearing triangle ceilings
  (1.691 M ≤ 2.0 M green); the soak's scene-total max-tris is demoted to
  informational-with-traffic-recorded, and future soaks assert
  p95-of-samples ≤ 2.2 M instead of max** (the R16 "scene totals are not a
  signal in live flight" lesson, applied to a perf budget).
- Sanctioned moves consumed (each inline-commented + ledger row): (1)
  verify-monuments gates 3–7 union re-point — every assertion VALUE
  unchanged; (2) verify-groundlife tint-floor A/B → INFORMATIONAL (the
  6-pair distribution diagnostic proved even its pre-R20 3.1× pass was a
  coin: A/A-nothing-toggled scores 0.109±0.201 vs signal 0.152±0.179); (3)
  verify-neon-cover gate-3 OFF-branch control state widened to the full
  toy-reachable R20 flag set (new gate 3a recomputes that set from worker
  source; PARCEL_HOMES asserted satellite-only); (4) `TOY_MID_SUBURB
  .maxPerChunkMid` 240→180 under ruling; (5) the soak tris metric re-spec
  above. Retries: verify-sat-buildings and verify-roof-variety once each in
  W1 on a transient upstream 404; verify-veg once in the close sweep (1.88×
  → 2.76×); verify-monuments once in W1 (live-fetch console error) — all
  documented with both runs.

## §5 Postmortem — the session-limit interruption, and what salvage found

A session limit killed BOTH in-flight agents mid-run (B during its harness
suite, C2 during its A/B control) — the same failure mode as R19's close.
Outcomes:
- **C2 resumed from its transcript with full context** and finished clean.
- **B's transcript was lost.** Salvage agent B2 ran the R19 lesson
  deliberately — verify the stranded work, don't trust it — and found the
  inversion worth recording: **B's product code was complete and sound; the
  defect was in B's own new HARNESS**, which was red against correct code
  (gate I matched the component's comment text `NO _isModel/_painted:` as if
  it were code; gate F passed vacuously on a pose with zero anchors). B2
  fixed the instrument, re-ran everything, and reproduced B's Step-0
  measurement table exactly.

## §5b Follow-ups (not defects; recorded decisions)

1. **Latitude coupling in parcel anchor density** — worker anchor area is
   mercator m², so anchors/true-km² scales 1/cos²φ. The deficit scalar masks
   it at every measured latitude; a high-latitude unmapped suburb would
   exceed the documented density band. Fixing it invalidates the measured
   ledger — deliberately flagged, not re-tuned.
2. **Deep-rural US gets nothing from the homes layer** — Union County /
   Ashley OH / Hazard KY measure 0.00 km² residential landuse; there is no
   parcel to build on. The R19 field-study rural pain is out of this layer's
   reach by construction; a future round needs a different signal (roads?).
3. **SatHouseLights + lit parcel-home windows** both render at night in the
   same suburb — reads as porch lights among lit windows at Melton, but it is
   a taste checkpoint (§6).
4. **Taj night residual** — the marquee reads +25.0 blue-minus-red at night
   vs the certified procedural baseline +18.4; the excess is the satellite
   night key itself (MeshToonMaterial takes no envMap). Closing it means
   changing monument night lighting for procedural AND marquee at once, which
   moves frozen verify-monuments-sat. Deliberately not spent this round.
5. **Sydney Opera House depiction** — the model file's CC-BY 4.0 is clean;
   the Sydney Opera House Trust holds trademarks on the building's likeness
   for some commercial uses. Outside a license sweep's scope; recorded for
   the user's awareness.
6. **Archive.org is a single point of failure for re-fetching** the Taj and
   Opera House sources (Google Poly is dead; Icosa mirrors it). The files are
   committed; re-processing needs only the repo.
7. **Suburban-context guard disarms more often** under per-polygon data
   (Columbus suburban chunks 7 → 2) — honest measurement, but
   `ROOF_TYPOLOGY.context` was calibrated on per-feature stats; a future
   round may recalibrate.
8. **One World Trade, CN Tower, Burj Khalifa** stay procedural: the first two
   rejected on unverifiable authorship (CC-BY without a certain name is not
   attribution), the third on quality. The marquee manifest documents all
   three with reasons.
9. **NEON_COVER's one-flag R18-byte revert contract is superseded** — with
   TOY_MID_SUBURB, MONUMENT_MODELS, and PARCEL_HOMES armed, the R18-byte
   control state is the full R20 flag set off (D's sanctioned gate-3 re-spec).
   The five frozen R18 hashes themselves never moved.

## §6 User checkpoints — PENDING USER

| # | Checkpoint | Where to look |
|---|---|---|
| 1 | Powell OH satellite reads as a real town (real footprints, typology heights, no invented downtown) | warp Powell, 600 m |
| 2 | Neon/toy suburbs persist past 8 km (mid-ring) without draw-feel regressions | toy Powell/Columbus at cruise |
| 3 | An unmapped suburb grows homes: Melton/Craigieburn AU | satellite, 600–2,000 m |
| 4 | Powell/US mapped suburbs show NO doubled/procedural clutter (anti-dup) | satellite Powell |
| 5 | Owens Valley still reads as empty desert, day + night | the R14+ certified scene |
| 6 | ESB reads as the real tower, both styles (the round's mandate) | NYC warp |
| 7 | Statue of Liberty: verdigris + gold torch at night (toy) | Liberty warp |
| 8 | Eiffel bespoke lattice: silhouette at 1.5 km and 8 km, both styles | Paris warp |
| 9 | Taj: marble day / acceptable night (see §5b.4), minarets intact after decimation | Agra warp |
| 10 | Big Ben: tracery reads; Westminster still streams beside it (25 m exclusion) | London warp |
| 11 | Opera House on Bennelong Point; Colosseum; Willis; Space Needle; Gateway Arch | respective warps |
| 12 | Marquee yaw facings (authored, not surveyed — ESB π/2, Gateway Arch π/2, rest 0) | any objection = one manifest value |
| 13 | Night: monument accent bands (ESB crown, Liberty torch, Big Ben clock band y 0.60–0.70 — the least certain) | night warps |
| 14 | Suburb night: parcel-home windows + house lights blend (§5b.3) | Melton at night |
| 15 | Performance feel on the user's machine through all of the above | — |

## §7 Lessons

1. **A repo's LICENSE file does not license its assets.** The Meta samples
   repo is MIT with a README carve-out putting every sample 3D model under a
   proprietary SDK license. Proximity is not coverage; read the carve-outs.
2. **The asset itself can out-testify the aggregator.** Icosa said "Jaideep
   Prasad, CC-BY 3.0"; the GLB's own `asset.extras` named Nick Reinhardt,
   CC-BY 4.0, with the original URL — and the triangle count corroborated it.
   Credit the author the file names, at the version the file declares.
3. **Parking the archetype is not enough when a second actor stands at the
   same address.** The streamed OFM extrusion of the same real structure had
   to be excluded at the worker, per polygon, before district stats.
4. **Exclusion state must be import-static, not per-frame.** Tile bundles are
   cached per z/x/y/detail; an exclusion that varies with placement timing
   builds the same tile differently — cache poisoning by design.
5. **A scatter that spends a shared budget is not an anchor source.** The
   cls-4 canopy points are `SAT_VEG.maxPerChunk` leftovers: 22.72 km² of
   Craigieburn suburbia yields zero. B's dedicated sample exists because the
   measurement said it must.
6. **Bit-identical triangle totals are the suppression instrument; pixel
   scalars are coins.** Owens-with-0-homes and Melton-with-2,068 both scored
   3.03% pixels moved; the triangle totals separated them exactly.
7. **An interrupted agent's harness can be the defect while its code is
   sound.** B2's inventory-first salvage found B's 686-line component clean
   and B's brand-new gate red against it — for matching prose as code.
8. **Grep-gates read comments too.** Twice this round (neon-cover 4a tripped
   on prose naming a flag; parcel-homes gate I tripped on a comment saying
   what the code does NOT do). Strip comments before pattern-matching source.
9. **Same-site A/B or no A/B.** C2's first night-hue control compared Agra to
   Rio at the same UTC instant — deep night vs dusk. Discarded, redone
   same-site; only the corrected numbers survive in comments.
10. **One-flag revert contracts rot as flags accumulate.** Widen the CONTROL
    STATE (all-flags-off) and keep the frozen hashes; never couple unrelated
    flags to preserve a stale contract's wording.
