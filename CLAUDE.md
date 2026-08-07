# SkyTracker ADSB Application - Comprehensive Analysis & Action Plan

> **⚠️ THE APP IS NOW FLY-ONLY (Round 9, 2026-07-17):** the flat 2D tracker,
> AR spotter, and their components/hooks/stores are DELETED —
> [FLY_ROUND9.md](FLY_ROUND9.md) is the record (tag `round9-pre-delete` =
> full pre-deletion tree). `app/page.js` boots straight into FlyMode behind
> a BootScreen overlay (`window.__flyBoot` progress contract). What remains:
> `components/fly/**`, `lib/fly/**`, the fly/atlas/contracts/passport
> stores, use-fly-traffic/use-fly-audio/use-route/use-aircraft-photo, all
> `app/api/aircraft/*` routes, and the aircraft-processor worker. The
> flat-tracker analysis in the body of this file is HISTORICAL — it
> describes deleted code (markers, panels, Leaflet-era plans); do not act
> on it.

> **⚠️ NEWEST — READ FIRST:** **Round 21 "Steady State" is BUILT and pushed
> (2026-08-07): [FLY_ROUND21.md](FLY_ROUND21.md) is the record** (plan
> [FLY_ROUND21_PLAN.md](FLY_ROUND21_PLAN.md); FIVE Opus 5 agents — A GOVERNOR
> / B STREAMKEEPER / C SURFACE / D PIPELINE / E CERT — under Fable
> orchestration; scaffolding `e1077f8` moved WORKER_PROTOCOL 16→17 at all six
> pin sites lockstep + four pre-seeded `enabled:false` blocks, zero constants
> conflicts a fourth straight round). **It fixes the two R20 live regressions
> at the root — 18 confirmed defects (S1–S8 flashing, P1–P10 patchy world),
> each closed by measurement**: the un-latched PerformanceMonitor flap is
> replaced by a session-latching governor (`PERF_GOVERNOR`, 0 steps at the
> exact R20 flap condition); the EffectComposer leak/DPR-resize/rebuild churn
> by a vendored composer (`FX_STABILITY`, programs flat across ladder
> cycles); bend-blind frustum culling by computed sphere margins
> (`STREAM_KEEPER`, orbit-proven +15/+45% submissions — the Neon
> disappearing-chunks bug); sticky-empty tiles by reason-coded TTL/backoff;
> the 39-vs-41 Owens-lock checkerboard by a monotone hatch ramp
> (`TILE_PIPELINE`, Owens 0 BY CONSTRUCTION); the skyline one-corner-per-tile
> cap by a hash shuffle; the parcel-homes boot carpet by a two-ring settle +
> collision-index trust gate + rolling-MIN regK (`SURFACE_CALM` — NOT an EMA,
> the flap converges an EMA to phantom homes, documented inline); the
> monument 1-frame double-draw by same-frame suppression (epoch lag 0.000s);
> the reversed-depth polygonOffset units sign; plus a PREWARM system
> (compileAsync over 29 world-bend variants + all three Effects tier chains,
> boot FASTER flag-on) and a persistent cross-worker Cache API tile cache
> (3× traffic cut). NEW gates: verify-stability (17) / verify-flicker (7) /
> verify-tier-step (10) / verify-seam (13) — each RED-calibrated on the
> defective tree first — + the first SATELLITE soak (p95 tris ≤2.2M
> BLOCKING). Flicker attribution series 380→146(A)→73(D)→49(B) swinging px;
> Owens 179–195 ≤ 261 held everywhere; zero frozen numbers moved except two
> Manhattan R18 hashes re-baselined under a 3-way-controlled UPSTREAM planet
> drift ruling (OFM build 20260802 — frozen hashes over live tilesets have a
> shelf life). **⚠️ W3 fleet + both 15-min soaks were IN FLIGHT at push
> time** — smoke 17/17 + first fleet rows green; the final §4 run table and
> soak percentiles land in a follow-up close commit. §5 = the session-limit
> postmortem (both killed agents salvaged from transcripts; the carpet
> reproduced only UNDER LOAD after a quiet-boot-green probe — "a probe green
> on a quiet boot is not a probe green under load"). §6 = user checkpoints
> (the two reported symptoms re-checked on the user's machine FIRST).
> **[FLY_ROUND22_HANDOFF.md](FLY_ROUND22_HANDOFF.md) = the next round's
> seed: the "Cinematic Night" graphics pass toward the user's reference
> image (8 ranked deltas, ownership split, measurement protocol).**
>
> Earlier: **Round 20 "Icons & Sprawl" is BUILT +
> CERTIFIED (2026-08-02): [FLY_ROUND20.md](FLY_ROUND20.md) is the record**
> (plan [FLY_ROUND20_PLAN.md](FLY_ROUND20_PLAN.md); FOUR Opus 5 agents —
> A SPRAWL / B HOMES / C ICONS / D CERT — plus salvage instances B2/C2 after
> a session-limit interruption, under Fable orchestration; scaffolding
> `f20f96f` moved WORKER_PROTOCOL 15→16 at all six pin sites lockstep and
> pre-seeded four `enabled:false` constants blocks — zero constants conflicts
> for a third straight round). **The two user asks are closed at the root:**
> **(1) BUILDINGS IN ALL AREAS** — the satellite builders carried BOTH halves
> of the R19 multipolygon defect (feature-SUM footprint test + one shared
> drape anchor); per-polygon behind `SAT_POLY_COVER`, **Powell OH 15→1,863
> streamed footprints / 1,233 houses**, Manhattan worker tris DOWN
> (511k→401k, the cap finally binds), the toy z13 mid ring stops culling
> <30 m (`TOY_MID_SUBURB`, floor 12 m, cap tuned back to the R19 180 under a
> close ruling), and where OFM ships NOTHING, `SatParcelHomes`
> (`PARCEL_HOMES`, +1 draw, satellite-only) builds hash-stable homes on
> `landuse=residential` parcels — **Melton AU 2,068 homes from zero
> footprints, while Powell/Blagnac/Lone Pine place ZERO with bit-identical
> triangle totals across the flip** (two-term anti-duplication off the R18
> collision-column index; the cls-4 canopy scatter was PROVEN unusable as an
> anchor source — it is SAT_VEG cap leftovers, 22.72 km² of Craigieburn = 0
> anchors). **The Owens lock held by measurement**: Lone Pine HAS 2.23 km²
> residential landuse; all 69 in-range anchors suppress on regK=0; the
> far-mass lock reads a per-POLYGON threshold (40) under A's flag only.
> **(2) REAL MONUMENTS** — ten marquee landmarks are real models in ONE
> `monument-marquee` mesh (+1 draw both styles, per-vertex `aAnchor` bend,
> NEW key `world-bend-anchor-monument-r20`): ESB, Liberty, Big Ben, Taj,
> Opera House, Colosseum, Willis, Space Needle, Gateway Arch downloaded
> (licenses VERIFIED per-source; **four Meta-samples models were WITHDRAWN
> when review caught the repo's README carve-out — its 3D assets are MPT-
> licensed, NOT MIT**; verify-icons enforces a license allowlist + named
> authors; Opera House credited to the author named in the GLB's own
> asset.extras) + a BESPOKE first-party Eiffel (three candidates failed
> honestly — disjoint lattice defeats decimation). Procedural archetypes stay
> byte-identical as instant fallback; **C2's exclusion discs (25–190 m,
> per-poly centroid, import-static = cache-safe) retire the second-actor
> defect** (the Taj wore its OFM extrusion's night window atlas; the Eiffel
> had a base cluster). Registration is `file:`-only + a separate runtime
> manifest (`lib/fly/monument-models.js`) so verify-fleet/hangar count
> arithmetic never moved. **CERTIFICATION (§4, ledger
> `scripts/r20-close-sweep.md`): 32 browser harnesses + 3 node gates ALL
> GREEN on the integrated tree; Owens 179–195 ≤ 261 everywhere; all five R18
> hashes byte-exact; with all four R20 flags off the worker is BYTE-IDENTICAL
> to main across 11 fingerprint scenes (+489 lines compose to a no-op); soak
> fps floor 80.0 / heap no-climb / zero pageerrors through 1,616 live
> aircraft (41% above R19's record)** — and the soak's scene-total max-tris
> was proven unable to judge the mid-ring feature (same-config spread =
> feature delta) and demoted to informational; fixed-pose gates
> (1.691 M ≤ 2.0 M) are the load-bearing tris ceilings; future soaks assert
> p95 ≤ 2.2 M. NEW gates: verify-icons (45) / verify-parcel-homes (18);
> suburbia 21 / sat-buildings 17 (per-building collision columns — widest
> 3,391→306, a latent R18 defect retired). Five sanctioned moves consumed,
> all inline-commented; zero frozen assertion numbers moved. **§5 =
> the session-limit postmortem (B's code was sound, B's brand-new HARNESS was
> the red — it matched prose as code); §5b = nine follow-ups (latitude
> coupling in parcel density, deep-rural US has no landuse to build on, Taj
> night residual = the certified sat night key, Opera House trademark note);
> §6 = 15 user checkpoints PENDING (ESB/Liberty/Eiffel/Taj reads, exclusion
> radii, suburb night blend, per-model yaw facings); §7 = ten lessons (a
> repo's LICENSE does not license its assets; the asset out-testifies the
> aggregator; parking the archetype isn't enough when a second actor stands
> at the same address; a scatter spending a shared cap is not an anchor
> source; bit-identical triangle totals are the suppression instrument;
> grep-gates read comments too; one-flag revert contracts rot as flags
> accumulate).**
>
> Earlier: **Round 19 "Honest World" is BUILT
> (2026-08-01): [FLY_ROUND19.md](FLY_ROUND19.md) is the record** (plan
> [FLY_ROUND19_PLAN.md](FLY_ROUND19_PLAN.md); SIX Opus 5 agents in two waves
> of three under Fable orchestration; scaffolding commit `faf5e28` pre-seeded
> all 17 R19 constants blocks `enabled:false`, moved WORKER_PROTOCOL 14→15 at
> all six pin sites lockstep, and landed the `_boot.js` fleet pins
> `__flyAerialOverride`/`__flySatShadowOverride` = 0 — zero constants
> conflicts across six agents, the R18 idiom holding a second round). Planned
> off a 15-minute live GPU field study (28 screenshots, both styles, Powell OH
> / rural Union County / Columbus OH, 150 m–FL280, noon/dusk/night) that named
> twelve pains P1–P12; every one has a merge commit against it.
> **THE headline: the toy/Neon winding fix landed** — `classifyToy` dispatch
> behind `NEON_COVER` at the three frozen call sites (`polygonPass`
> land/water, toy buildings, toy scatter), and **Powell OH went from EVERY
> polygon layer classifying to zero to a real town**. Two latent defects fell
> out behind it: `maxFootprintM2` tested the SUM of a feature's polygons (one
> OpenFreeMap feature carries a whole 171-house subdivision — multipolygons
> now explode per-polygon behind the flag), and the scatter was
> winding-starved too (restored stands with `frustumCulled=false` needed the
> one charter-permitted engine-side distance gate; **NYC low 577→408 draws**).
> **ZERO re-baselines: all six pre-sanctioned re-cert gates passed their
> UNCHANGED assertions** (neon-city 379, neon-alt 325/void 0.19%, roofs
> 394/2985 bldgs, window-grids 403, edge-fx 400/372/322, poi no shift;
> ceilings 480 untouched). What else shipped: **(1) HONEST SUBURBIA** —
> `ROOF_TYPOLOGY` bands untagged footprints by area+aspect inside a
> suburban-context guard (**Powell invented heights 42.0→12.0 m**, walls emit
> NEUTRAL_UV so a school goes dark instead of blazing with the office atlas;
> downtown chunks keep the legacy curve VERBATIM), high-tier coverage widen
> 3600→4400 m / 12→16 chunks, and a hard-capped far-suburb hatch where
> **nothing can land in the (25, 35) m band by construction** — armed on
> DENSITY (`minCountPerTile 5`; measured z14 candidates Owens max 1 / Powell 2
> / Dublin 12 / Chicago 46 = THE OWENS LOCK). **(2) DEPTH + ATMOSPHERE** —
> `postprocessing`'s `USE_REVERSED_DEPTH_BUFFER` define is never set so raw
> depth arrives REVERSED (detected via `getReversed()`); AerialPerspective
> merges into the existing EffectPass = **0 extra draws**; SAT_QUILT cruise
> grade; satellite shadow rig (ground-catcher disc built-but-OFF); **z17 +
> aniso 8 high tier with style-gated `LODThreshold 0.86` — naive z16 measured
> 270 which BREAKS 261; shipped 209 and sharper than R18**. Exactly the FOUR
> budgeted key moves: `fade-hill-r19`, `anchor-satbldg-r19`,
> `anchor-satskyline-r19` (B) + `road-satnight-r19` (C). Content haze
> built-but-off — redundant with the depth pass at high tier, and it is the
> RIGHT fix for medium/low which decision 2 freezes. **(3) DUSK EXISTS** —
> `runtime.sun.el` is CLAMPED [8.6°, 51.6°] so everything keys off
> `trueElevationDeg(sinEl)`; buckets re-keyed on ELEVATION (night below −8°)
> so **el +2 = dusk with ZERO stars** (was night + starfield: `nightFrac 0.06`
> = el 2.6°, i.e. R18 called 8:40 pm July Ohio NIGHT), `nightWeight` star-snap
> re-keyed (0 at −4°, full at −12° — verify-sat-night's deep-night contract
> intact), SkyDome golden lobe (CPU strength + hard shader skip), 8-step HDRI
> cross-blend on a HalfFloat scratch RT with **endpoint bypass = settled skies
> bit-identical**, `WEATHER.fallback` → `'procedural'` (+ a cell-quantised
> `tempC` bug that flapped precip kind at the freezing line), overcast lid v2
> (closes R18 #17), cirrus +1 draw (procedural CC0). NEW `lib/fly/sky-dusk.js`.
> **(4) LIVING GROUND** — residential canopy off A's frozen per-class scatter
> (**Powell 227 placed, was 0**), landcover tint +1 draw with **`park` DROPPED
> from the palette** (administrative, NOT landcover — Owens ships 29.87 km² of
> `park:national_scenic_area` over Mojave desert; the desert stays pale),
> suburban night (**2,128 lights at Powell** as hash-stable parcel clusters —
> `housePts` is literally 0 there, OFM generalises houses away outside dense
> cores) and the streetlight double-dimming diagnosed (**road width
> double-duties as brightness** — fixed with an additive cls 5/6 envelope at
> parity with primaries; the R16-swept `night.intensity` untouched), daylight
> road seam (+121 luma peak on road pixels). **(5) SPEED + FEEL** — SpeedLines
> (radial smear + 44 wedge streaks + boost heat-haze, 0 draws, **NO depth read
> by design — immune to the reversed-depth trap**, exactly 0 at probe cruise
> 0.24 = the SHAKE construction), boost FOV punch +3.06° measured outside the
> damped state, framing-aware cinema clamp (**a flat 900 m would BREAK
> verify-chase-cam's frozen framing gate**; 1083 m standoff both-framed vs
> 2765 pre-R19) + far-target refusal at 8 km, altitude-keyed label budget
> (FL180 6 letters vs 11), and **P12 with the plan's mechanism CORRECTED:
> hands-off the model holds 0.0 m over 31 s** — the trigger is the parked
> Atlas cursor re-arming an absolute sustained pitch (measured −0.471; the
> field-study curve 2300→443 m in 16 s reproduced), so the trim servos PITCH
> with `cancelPitch 0.55` + 1.5 s fade-back. **NEW gates: verify-suburbia (16)
> / verify-aerial (14, the ONE un-pinner of both new fleet pins) / verify-dusk
> (15) / verify-groundlife (18) / verify-feel (13) / verify-neon-cover (9).**
> **Owens ≤261 never moved** (239–240 at W1 armed, **178 noon / 179 night** at
> W2 close — exactly the plan §5 ledger). Sanctioned assertion moves: TWO,
> both verify-weather, both charter-caused and escalated (`LID_SAT_MAX`
> 0.12→0.20 against a measured control; the dusk walk rebuilt as a 1..16
> band). **CERTIFICATION (§4, per-harness ledger at
> `scripts/r19-close-sweep.md`): ALL GREEN, one retry all round** (sat-night
> during iteration) — sat-night 33/33 ×2 consecutive, neon-cover 9/9, tracers
> 6/6, fly-game/spicy PASS, feel 13/13, aerial 16/16 (**Owens 194 ≤ 261 fully
> armed**, sat boot 7.6 s vs a 28.8 s cap, near-field Δ exactly 0.000), dusk
> 15/15 (**cirrus exactly +1 draw, 214 vs 213**), fleet 28/28, node gates PASS;
> everything else rests on byte identity + its cited wave green. **15-min soak
> GREEN: worst p95 8.4 ms / p50 4.2 ms, fps floor ≈119, draws max 445 ≤ 480,
> tris 1.931 M ≤ 2.2 M, heap 322→356 MB with no climb, ZERO pageerrors —
> through a live-traffic peak of 1,145 aircraft (R18's soak peaked at 525;
> the peak IS the proxy fix working).** The sweep was Fable-TRIMMED on a
> one-file-delta premise that became THREE files during the close (two
> `NODE_ENV`-guarded dev-only park handles in TrafficLayer/TrafficTracers) —
> recorded in §4.1, and verify-fleet was ADDED to the run set to cover it.
> All runs used the worktree's existing `:3019` dev server (a second `next dev`
> would share the single `.next`; Next 16 has no `distDir` flag) — a documented
> deviation, not a hidden one. **POSTMORTEM (§5):** a session limit interrupted the close, leaving
> work in two worktrees — both salvaged (`dfb6443` a frozen cross-owner bundle
> hash that went red when C legitimately added keys, rewritten as 4a SOURCE +
> 4b RUNTIME; `5baeb63` an `o.visible=false` cloud park that CloudField's own
> `useFrame` overwrote every frame — a no-op on precisely the actor it named,
> and its residual-mover LIST was itself an instrument artifact:
> `Object3D.traverse` does not stop at an invisible parent, so it indicted the
> already-hidden player GLB and the decks it had already parked, while the two
> real movers were the traffic billboard pool and the tracers mesh — which
> rewrites its position ATTRIBUTE every frame and never moves its
> `matrixWorld`, invisible to any visibility or matrix census).
> **The user-visible "live crafts missing" event was NOT R19** — the round's
> source diff contains ZERO lines matching `/traffic/i` — it was adsb.lol's
> geographic endpoint degrading to **200-OK-EMPTY** meeting a pre-existing
> proxy failover blind spot: an empty-but-present array walked the success
> path, pinned `preferredSource`, poisoned `lastGood`, and the client stale
> ladder deleted the whole sky (**281→253→0 tracks**). Fixed in `d5076d0`
> (`app/api/aircraft/route.js`, 52 lines, no knob moves): empty = CANDIDATE,
> rotation continues, first non-empty wins, unanimous-empty returned honestly
> as `x-adsb-empty: all-sources` (before 0 tracks / after 782). **Follow-up
> NOT fixed: attribution hardcodes "Flight data © adsb.lol" while the proxy
> now serves adsb.fi — and R17 photo mode BAKES that string into exported
> captures.** FLY_ROUND19.md **§4 = certification (per-harness detail in
> `scripts/r19-close-sweep.md`)**; **§6 = 21 checkpoints PENDING USER** (incl.
> the Neon before/after money shot `scripts/r19-f-powell-*`, the live-crafts
> confirmation on the user's own machine, the carried R18 Neon nudge `7865ba4`
> sign-off, and the still-open R15/R16/R17/R18 §6 tables); §5b = follow-ups
> (attribution follows `x-adsb-source`; the fleet is structurally blind to
> live-traffic outages; verify-neon-cover's hard-coded builder list; carried
> satellite water / plumes / phone-satellite cert; two built-but-off features);
> §7 = lessons (a frozen cross-owner hash is a coupling gate not a leak gate;
> object visibility cannot park an actor whose owner rewrites it every frame;
> a gate that differences four breathing scene totals for exact equality is a
> coin; an instrument can indict actors it merely failed to EXCLUDE; an
> aggregator can fail INSIDE a 200; the harness fleet's own pins can hide an
> entire defect class from every gate; measure the trigger before you build
> the plan's fix).
>
> Earlier: **Round 18 "Alive & Dangerous" is BUILT
> (2026-07-27): [FLY_ROUND18.md](FLY_ROUND18.md) is the record** (plan
> [FLY_ROUND18_PLAN.md](FLY_ROUND18_PLAN.md); five Opus 5 agents in two waves
> under Fable orchestration; a scaffolding commit pre-seeded all 11 R18
> constants blocks so five agents produced ONE trivial merge conflict).
> **THE finding: `classifyRings` hard-codes the wrong winding sign for every
> OpenFreeMap polygon layer — satellite Manhattan rendered 114 buildings
> instead of 3,860.** Fixed satellite-side (`classifyRingsSat`, winding-
> agnostic, gated behind `ROOFS_SAT.enabled`); **toy/Neon carries the SAME
> defect at three frozen call sites (~99% of toy polygons dropped) — R19's
> headline candidate, needs its own certification round.** What shipped:
> **(1) ROOFS + VARIETY** — new 4-arg-pushV worker helpers (hip/shed/mansard/
> pyramid via `pushInsetPeak`, penthouse/water-tank/chimney/antenna,
> photo-plausible satellite crowns+spires), height-banded dispatch with an
> always-something guarantee (`ROOFS_SAT`), volume-stratified suburb selection
> over a HASH-SHUFFLED order (MVT feature order is spatially clustered),
> house-height inference band, measured wall-tone re-tune (buildings-vs-
> imagery delta −50→−32, band pinned in NEW verify-roof-variety), satWater
> neighbor-gated ocean fill. WORKER_PROTOCOL 13→14 (all four pins lockstep).
> **(2) CITY SCALE** — NEW sat-skyline-engine: z14 block-mass ring in
> `groupN`-grouped chunks (8.7 km reach, ≤10 draws), Bayer near-field hole
> crossfading with SAT_BLDG_FADE (the city BECOMES mass at altitude), empty
> chunks issue NO mesh (**Owens 254–258 ≤ 261 all round, zero re-baselines**);
> monuments got sat-only silhouette variants + value shading (toy geometry
> proven 9/9 byte-identical). A2 killed the plan's area-fallback (its 18–60 m
> invented-height clamp SATURATES — fake 60 m downtowns over every big-box
> strip). **(3) LIVING GROUND** — NEW sat-veg-engine + ONE pooled canopy
> InstancedMesh of tree STANDS (Central Park 999, rural Owens 952 — valley
> trees are CORRECT; the invariant is +1 draw, not count 0), harbor boats
> (leash-arithmetic proves on-water) + industrial steam plumes (normal-blend —
> additive steam is invisible over white roofs); movers high-tier-only.
> **(4) ARCADE JUICE** — near-miss off real ADS-B traffic (closest-approach
> inflection gated on PEAK closing rate — range rate at CPA is ~0 by
> definition), combo ×(1+0.25·(n−1)) cap ×3, session score + RunSummary,
> screen shake wired INSIDE chase-camera post-slerp (zero-amplitude leaves
> the quaternion untouched — probe-safe by construction), 4-layer procedural
> music director on `audio.bus()` (enabled:false ⇒ zero nodes), BoostBar/
> ComboChip self-anchored pointer-events:none (NO LayoutRoot zone changes).
> **(5) STAKES** — crashes ON by default, reckless-only (commanded sink
> >30 m/s at contact, or >200 m/s dive >18°, or buildings ≥45 m/s via REAL
> collision columns built in the sat-building drape pass — `queryColumns`,
> world units throughout, topY post-drape absolute); **arm gate 5 s after
> mount AND every warpEpoch bump = the fleet immunity invariant**; ~1.8 s
> tumble → respawn 2 km back at ground+400 m; "Flight stakes: Forgiving"
> restores R17 byte-for-byte; boost is a real meter (6 s / 12 s / 0.25
> re-arm, autopilot exempt, **the '3' preset is metered too** — the harness
> fleet keeps unlimited boost via the sanctioned `__flyBoostInfinite` pin in
> scripts/_boot.js, the R16 weather-pin idiom; verify-crash alone un-pins).
> **Live fix during the round:** overcast-dusk tracer visibility
> (`TRACERS.sun.overcastNightK` — the night ramp keys off EFFECTIVE light,
> gain 0.38→1.1 at overcast dusk, identity at baseline weather) after a user
> report was control-experimented to pre-existing R16 behavior. SIX
> probe-determinism fixes, zero assertion-number changes. NEW gates:
> verify-roof-variety (18) / verify-crash (23) / verify-juice (25) /
> verify-skyline (17) / verify-veg (23). Full 22-harness sweep + 15-min soak
> GREEN (p95 8.4–12.6 ms through a 525-aircraft surge), **zero gate
> re-baselines**. Fable-authored Neon value/warmth nudge (3 values, isolated
> commit `7865ba4`, A/B PNGs) awaits sign-off. FLY_ROUND18.md **§6 = 17
> checkpoints PENDING USER** (+ carried R15/R16/R17 tables); §5b = follow-ups
> (Neon winding round, satellite water material, overcast-dusk sky); §7 =
> lessons (a coverage defect masquerades as a variety complaint; winding
> conventions are data contracts; an integration seam both sides tested is
> still untested; the fleet-pin idiom generalizes; probe preconditions must
> imply their assertions; pre-seeded disjoint config blocks kill merge hell).
>
> Earlier: **Round 17 "Your Wings" is BUILT (2026-07-25):
> [FLY_ROUND17.md](FLY_ROUND17.md) is the record** (plan
> [FLY_ROUND17_PLAN.md](FLY_ROUND17_PLAN.md); five Opus 5 agents in two waves
> under Fable orchestration). **(1) PLAYER HANGAR** — 9 selectable aircraft
> (NEW `lib/fly/player-aircraft.js` manifest, NOT assets.js — verify-fleet's
> count arithmetic never moved; helicopter excluded, no hover model) with
> DISTINCT flight feel via the new `flight.cfg` seam (`FlightModel(cfg)`;
> chase-cam/autopilot/audio read the aircraft's own envelope); persistence =
> the fly-settings pre-mount pattern (`fly-aircraft`); **default = the
> fighter, value-identical** (bootFly never seeds the key — zero harness
> moves); rollback `HANGAR.enabled:false`; gate verify-hangar (16).
> **(2) PROGRESSION REPAIR + LIVING CONTRACTS** — ONE `lib/fly/spot-attrs.js`
> helper at all three spot sites (persisted ≡ displayed rarity; squawk
> badges + emergencyCount finally reachable); `concorde_heir` got a real
> case; CLASSIFICATION_RARITY speaks Fly vocabulary (airliner 10/jet 15/
> prop 10/glider 45/drone 50 — A320 no longer rarity 0; NEW intended ping:
> 7700 airliner = 90 legendary); contract progress PERSISTS
> (`fly-contracts-active-v1` sibling key — the `fly-contracts` envelope is a
> harness contract); 9 weather/night/POI-tag templates appended after
> touch-go (toy NEVER deals weather/night — toy has no live `runtime.sun`);
> deterministic DAILY set ×2 pay (`lib/fly/daily.js`, `__flyDayOverride`);
> gates verify-daily (28) + verify-living-contracts (16); SANCTIONED
> re-baselines: verify-warbirds e0/BASE_MAP, verify-logbook badges 24→26.
> **(3) PHOTO MODE** — P/touch button, orbit+zoom, flight keeps flying,
> HUD hidden-not-unmounted (AttributionBar ALWAYS visible), capture reads
> the canvas same-rAF POST-EffectComposer (preserveDrawingBuffer stays
> false) and bakes the style's attribution; gate verify-photo (10).
> **(4) MOBILE OVERHAUL** — `hooks/use-device-layout.js` is the ONE device
> truth (`isSheet = isPhone || ≤639` union: landscape phones get sheets);
> named zones in `LayoutRoot.jsx` carry desktop offsets VERBATIM (desktop
> byte-identity MEASURED); overflows dead (two-line toasts, InfoCard→chip,
> clamp() banners); complete touch scheme (LOGBOOK/PHOTO/BOOST + contextual
> INSPECT/INTERCEPT/CINEMA ride `input.press()` into the EXISTING key
> machines); tap-leak fixed (stopPropagation + `[data-zone]` exclusion);
> Atlas pinch; Android back; **phone contracts panel collapses to a chip in
> BOTH orientations**; `.hud-glass`/`.hud-flat-phone` kill phone
> backdrop-filter; gate **verify-mobile-layout (390×844 AND 844×390,
> measures overlap/overflow/44px)** + verify-mobile now 28.
> **Post-round harness archaeology (FLY_ROUND17.md §7.1):** verify-sat-night's
> noon pixel gates had passed R16 on the HERO'S IDLE BOB, not road glow —
> control-experimented against the pre-R17 build; probes now hide
> `window.__flyPlayer` + traffic, residual road-pixel gates demoted to
> informational. A pixel-probe gate must not contain an actor it doesn't
> control. **§6 = the R17 user checkpoint table PENDING** (aircraft feel,
> rarity re-base, daily set, photo output, phone portrait/landscape — plus
> carried R15 §6 + R16 §6).
>
> Earlier: **Round 16 "Living World" is BUILT (2026-07-24):
> [FLY_ROUND16.md](FLY_ROUND16.md) is the record** (plan
> [FLY_ROUND16_PLAN.md](FLY_ROUND16_PLAN.md); five Opus 5 agents in two waves
> under Fable orchestration). Satellite-first: **(1) REAL WEATHER** — NEW
> keyless `/api/weather` (open-meteo → aviationweather METAR failover, 0.25°
> cells, never fabricates) drives cloud coverage / visibility-fog / wind /
> rain-snow through NEW `lib/fly/weather-model.js` damped `runtime.weather.wx`
> scalars; **baseline (no data / `__flyWeatherOverride='baseline'`) is
> bit-identical to R15** — that pin is in `scripts/_boot.js` fleet-wide AND
> hand-added to raw-boot verify-round11 (live 97%-overcast NYC greyed its
> noon tint through the new overcast path working as designed). PrecipLayer =
> +1 draw active / 0 clear / never mounts low. **(2) LIVING SKY** — NEW
> `lib/fly/sun-model.js` (latitude+declination: polar night & midnight sun
> real; `az`=hour angle BIT-IDENTICAL so hillshade flip/dawn-dusk split
> unmoved; verify-boot now mirrors via `window.__flySunModel` — sanctioned),
> NEW SatEnvironment (continuous env/bg intensity, prefetch + same-frame HDRI
> swap — **background must be the RAW equirect; a PMREM CubeUV background
> IGNORES backgroundIntensity**, measured), satellite stars+moon+overcast lid
> (uNight multiply-to-identity at rest), night bloom breathing, and
> `SKY_LIVE.hdriFade.nightTexelCap 0.35` — the qwantani "night" HDRI is
> really TWILIGHT with a bright band on one azimuth (faced it = luma 225;
> R13 never eyeballed that heading); do NOT cap the day files (their sun is
> the IBL key light — tried, measured cool-shift, reverted). **(3) NIGHT
> GROUND** — worker detail `'sat-roads'` (**WORKER_PROTOCOL 12→13**, 3 pins),
> NEW sat-road-engine (z13 ring r12000, ≤16 draws, cache key
> `world-bend-road-satnight-r16`, sun drives UNIFORMS only — draw counts
> identical day/night), real runway edge lights from `aeroway` (cls 7, 0 extra
> draws), SatRoadLayer + white/green airport beacons (+1), SatCityGlow sodium
> domes to 90 km (+2 always-issued), and `SAT_BLDG_FADE` Bayer screen-door
> dissolve (2400→3000 m, evict at 3200 only when invisible — key
> `world-bend-anchor-satbldg-r16`). Owens Valley draw gate: **254 ≤ 261, NO
> re-baseline** (roads exist in that scene — planned for). **(4) PILOT
> LOGBOOK** — the passport's first UI (L key / PauseMenu / Spots cell; LOG /
> BADGES / STATS; phone 100svh sheet via extracted `hooks/use-sheet-layout`),
> badge unlock toasts (queued, spot/spicy/buzz push paths byte-preserved),
> `daily_streak_7` fixed, quality+sound persist (`lib/fly/fly-settings.js` —
> explicit picks only; **PerformanceMonitor onIncline reverts any downward
> tier pin in seconds — low-tier contracts must be STATIC source gates**),
> TOD tracers (vapor day / glow night, never culled), rarity dual-table adds
> (K35R/C30J/GLF6/A124/A225 — zero classify-gate edits). NEW harnesses
> verify-weather (28) / verify-sat-night (33) / verify-logbook (13); full
> 37-run sweep GREEN, zero re-baselines. FLY_ROUND16.md **§6 = the COMBINED
> R15+R16 user checkpoint table PENDING** (weather feel + procedural flip,
> road-night look, glow/beacons/fade, TOD tracers, night sky + moon, bloom,
> latitude sun, logbook — plus everything R15 §6 carried); §7 = lessons
> (animated layers pollute their own A/B noise — gate net sparks; scene-total
> draws are not a signal in live flight; addInitScript re-runs on EVERY
> navigation; gate toast stacks on state, not exit-animating DOM).
> **Post-round live fix (2026-07-25, FLY_ROUND16.md §9):** satellite on
> iPhone washed the whole frame to one pale field (Neon fine) —
> SatEnvironment's `FloatType` HDRIs aren't linear-filterable on Apple GPUs
> (no `OES_texture_float_linear`; three r185 warns instead of falling back,
> so the sky sampled undefined garbage) → decode is now `HalfFloatType`
> (toy/drei's certified path; texelCap clamps raw half bits). NEW gate
> `scripts/verify-sat-mobile.js` (7) boots the iPhone viewport with the
> extension hidden — pre-fix code fails it, current code + verify-mobile
> are green. A texture TYPE is a device contract, not a quality knob.
> **Same-day mobile perf floor (FLY_ROUND16.md §10):** the first phone that
> RENDERED satellite ran it at tier high ("Q High" — the §7 incline lesson
> live) and flapped high↔medium, rebuilding bloom/building materials each
> crossing. NEW `lib/fly/device-class.js` `isPhoneClass()` static gate:
> unpicked phones resolve tier 'medium' pre-mount and `autoTierCeiling()`
> (fly-settings) caps stepQualityTier UP-steps at the player's saved pick
> or 'medium' — explicit picks win both ways, declines never capped,
> desktop byte-identical (probe: phone:false/high/high). verify-sat-mobile
> grew 7 → 10 gates (tierPolicy resolve, live never-high, seeded explicit
> pick honored).
>
> Earlier: **Round 15 "Ground Truth" is BUILT (2026-07-24):
> [FLY_ROUND15.md](FLY_ROUND15.md) is the record** (plan
> [FLY_ROUND15_PLAN.md](FLY_ROUND15_PLAN.md); four Opus 5 agents in parallel
> under Fable orchestration). The R14 live complaints are FIXED at the root:
> **(1) classification is exact-first everywhere** — NEW `lib/aircraft-type-tables.js`
> (269 audited codes, worker keeps a gate-synced inline copy) consulted before
> any substring list; the trap lists are DELETED (SR22 was a helicopter via
> `R22`, **C172 was MILITARY via `C17`**); airliner families are now explicit
> `startsWith` prefixes (81 variant codes rescued from `unknown`); rarity got
> the same escape hatch (`EXACT_TYPE_BONUS` + known-code +0 short-circuit — 20
> substring payouts killed incl. index-1 matches like `'E3'` in `BE33`; the
> legendary EMS **B212 SPICY ping is dead**). NEW gate `scripts/verify-classify.mjs`
> (38 gates incl. a full-universe pattern×code sweep). **(2) The purple planes
> are fixed** — primitives carry baked vertex-color liveries and anything
> painted tints WHITE (`mesh._painted`); new CC-BY GLBs for warbird-prop +
> glider; `traffic-military.glb` had rendered FLAT WHITE since R8 (texture
> never baked) and the cargo 747 flew with a baked 26° nose-up attitude —
> both fixed offline, documented in FLY_ASSETS `modifications`. warbird-heavy
> + classic-transport remain honest premium primitives (no era-correct
> license-clean GLB exists — re-verified across 4 sources). **(3) The inspect
> panel shows the actual real plane** — the planespotters photo pipeline was
> 100% DEAD (they now 403 UAs without a contact URL; the old catch swallowed
> it) — fixed with a compliant UA + hardened proxy; NEW keyless registry route
> `/api/aircraft/[hex]/info` (adsbdb → hexdb, fixed-order failover, never
> throws) feeds manufacturer/real model/OWNER-vs-operator/country; real phone
> bottom sheet (matchMedia, 88svh, safe-area); harness testids preserved;
> +68 names, +219 silhouette mappings. **(4) Satellite buildings got roofs
> that read + night windows** — height-banded roof palette decoupled from
> walls, baked wall AO, facade window atlas via worker-emitted FACADE-METER
> UVs (WORKER_PROTOCOL 11→12, stale bundles DROP), night `emissiveMap` driven
> by `runtime.sun.frac` (tier high, zero extra draws — sat-depth measured 246
> ≤ 261). The constant-neutralUV/mip-0 trick keeps roofs textureless with NO
> shader injection. Full 14-harness sweep GREEN. FLY_ROUND15.md §6 = user
> checkpoints PENDING (liveries, roof palette, night intensity, panel
> defaults, mythic B-2); §8 = follow-ups (classify.js is importer-less dead
> code — delete decision pending; ATN→"Royal Air Maroc" airline-prefix
> collision in the route path).
>
> Earlier: **Round 14 "AirVenture" is BUILT (2026-07-24):
> [FLY_ROUND14.md](FLY_ROUND14.md) is the record** (plan
> [FLY_ROUND14_PLAN.md](FLY_ROUND14_PLAN.md), executed same-day by 10 Opus 4.8
> subagents in six waves). The spotting game now knows the EAA Oshkosh fleet.
> **`lib/warbirds.js` = 170 audited warbird/classic ICAO codes** (three lock-step
> exports: `WARBIRD_TYPE_RARITY` / `WARBIRD_ARCHETYPE` / `WARBIRD_TYPES`), driving
> **exact-first rarity** in `lib/rarity.js` — the exact code is checked BEFORE the
> legacy substring loop and, on a hit, adds the audited bonus and
> SHORT-CIRCUITS (so `B29` can't stack `B2`'s +60; non-warbird scoring incl.
> empty typeCode is byte-unchanged, gate-proven). Marquee list lands Legendary+
> (≥85) so it SPICY-pings via the tier gate (NOT the military accent —
> `militaryTypes` untouched, no spot-military miscount). **Four APPENDED traffic
> archetypes (indices 9–12): warbird-prop / warbird-jet / warbird-heavy /
> classic-transport** — append-only lock-step across worker `FLY_ARCHETYPES` /
> `TRAFFIC_MODELS` / `buildArchetypeGeometries()` / TrafficLayer (wire row slot 7
> packs the index; out-of-range now falls back to `meshes[8]` unknown, NOT
> `.length-1`). Only **warbird-jet gets a real GLB** (Stephen Graybill "Low poly
> Fighter", CC-BY 3.0, `traffic-warbird-jet.glb` 10KB uncompressed — the model
> scout found poly.pizza has NO era-correct warbirds, so the other three ship
> purpose-built flat-shaded primitives). Plus 170 display names, a `spot-warbird`
> contract (kind `spot-type`, `WARBIRD_TYPES`, 300 pts, completable off-airshow),
> three new silhouettes + fallbacks, and **NEW gate `scripts/verify-warbirds.mjs`**
> (deterministic: source-parses all four files to prove the worker inline map ≡
> canonical + append-only order + disjoint from every modern-code set + tier
> bands). **ZERO gate re-baselines except one sanctioned measured move: sat-depth
> 375 → 261** (measured 245; R12/R13 ring-shrink already dropped structural
> draws). Red-team (A10): NO product-code defects; licensing re-verified live;
> 10/10 designators confirmed real; per-archetype visual evidence captured.
> FLY_ROUND14.md §9 = user checkpoints PENDING (marquee tier feel during
> AirVenture week, SPICY frequency near airshows, silhouette reads, spot-warbird
> pacing); §7 = lessons (substring tables need exact-first escape hatches; paired
> verifiers can double-reject the same row for opposite ownership reasons — the
> merge must arbitrate; scouts report honest fallbacks, not forced picks).
>
> Earlier: **Round 13 "Solid Ground" is BUILT (2026-07-19):
> [FLY_ROUND13.md](FLY_ROUND13.md) is the record** (the plan is
> [FLY_ROUND13_PLAN.md](FLY_ROUND13_PLAN.md) — executed same-day, satellite-first).
> What changed: **ACES filmic tone mapping in BOTH styles** + satellite's first
> color grade (sun-frac WhiteBalance effect, merges into the EffectPass);
> satellite ATMOSPHERE — aerial haze ON, `SKY.altAtmo` drives the rim triple
> per frame (time-of-day keyframes × altitude cool-shift — the FL300 "wet
> mirror" is dead), and a discrete-bucket HDRI cycle gives satellite its
> **first real night since R7** (toy keeps the certified noon HDRI); AIRCRAFT
> presence (clearcoat+fresnel hull grade, double-flash strobes, throttle
> afterburner, 1-draw contact-blob shadow — the ortho rig was REJECTED on
> fill-rate grounds, twin altitude-scaled contrails, moonlit night key);
> **CENTERPIECE: 3D extruded buildings in SATELLITE** (worker detail
> 'sat-buildings', WORKER_PROTOCOL 10, lean SatBuildingEngine z14 ring —
> `__toyWorld` still never defined in satellite — per-vertex footprint-centroid
> anchor bend `world-bend-anchor-satbldg`, raw-DEM drape;
> **`SAT_BUILDINGS.enabled:false` = one-line byte-noop revert**); low-AGL
> micro-detail noise + hillshade v2 (the ONE existing key move:
> `world-bend-fade-hill-r8`→`-r13`) + satWater glint (PROTOCOL 11) + monuments
> satStyle v2 + POI letter haze-fade; and the Neon §8 bundle (roof skylight
> content `beacon-grid-r8b`→`-r13`, water moonglade `foam-r8`→`-r13`, toon
> cloud puff, monument floodlights + gradient halo, moon disc + star
> variation, TOWN_CORES) with **ZERO R12 §7 / R10 §4 knob-value moves**. Two
> live-caught fixes: the null-island boot sun (frame loop published
> runtime.geo before spawn placement — `spawnPlacedRef` gates it now; verify-
> boot gained a sun-at-spawn gate) and damped satellite cloud altSpread
> (`satSmoothSec` — post-warp transients whipped the deck). **Zero harness
> gate re-baselines the entire round.** FLY_ROUND13.md §8 = THREE user
> checkpoint tables PENDING (they also close the R11 §4 dayTint/satStyle rows
> and the R12 §7 + R10 §4 tables); §10 = lessons (fallbacks turn visible when
> visual range widens; gate frame-loop publishers on placement; damp any
> input a position-multiplier reads; never let agents edit while the user
> flies HMR; draw gates can't see fill-rate).
>
> Earlier: **Round 12 "Neon Planet" is BUILT + verified
> (2026-07-18): [FLY_ROUND12.md](FLY_ROUND12.md) is the record.** Neon at
> cruise was "toy plane over graph paper": the toy ground fade band
> (`WORLD_EDGE.fade.toy` 14–26km) was STATIC while curvature/letters/traffic
> all already scaled with altitude. Now the band BREATHES
> (`WORLD_EDGE.altHorizon`, sqrt(AGL/k)·frac, floor = the static band so
> low-altitude Neon is byte-identical): FlyScene's −50 block damps it into
> the live `uEdgeFade` uniform and **`getEdgeFade()` (world-bend.js) is the
> single source of truth** for every consumer — sky dip, the NEW z10 'ultra'
> streaming ring (`TOY_WORLD.ultraRing`, hysteresis-armed, full-ring shrink
> pays for it, worker 'ultra'→'far' alias, WORKER_PROTOCOL 9, quadtree
> descent generalized for zoom-gapped rings), VoidFloor (LIVE floorY — the
> static depth would occlude the far field at cruise — + delta-based grid
> fade), TownGlow (nearest-N sort fix, range = band end, farScale, pool 96),
> and the toy cloud deck (altSpread: centers/cell/dissolve scale together).
> verify-neon-alt NEW (spawn invariants EXACT → FL260 band 81.5km, 30 ultra
> chunks, grid 0, draws 278, void-pixel 0.1% → descend re-clamps);
> verify-neon-city/rim pass unchanged. FLY_ROUND12.md §7 = live-tune
> sign-offs PENDING USER; §9 lessons (certify the altitudes users fly; check
> what the fade hides before building; store derived values where the GPU
> reads them; descent encodes zoom-adjacency silently).
>
> Earlier: **Round 11 "Satellite, For Real" is BUILT
> (2026-07-18): [FLY_ROUND11.md](FLY_ROUND11.md) is the record.** The round-10
> satellite default was never perf-certified (harnesses seed 'toy') and the
> user's first real session on it lagged badly + showed the old
> "buried planes" class of bug. Root cause: the flip itself, not the round-10
> code. Round 11: (1) boot resolves the style PRE-mount via new
> `lib/fly/map-style.js` (no more toy-build→satellite hot-swap; store literal
> stays 'toy' for harnesses); (2) perf floor — aniso 8→4 + per-tier, satMaxZoom
> 17→16, tier-aware hillshade strength, cloud shadows high-tier-only; (3) NEW
> `TRAFFIC_HORIZON` + `horizonFade()` in world-bend.js — per-aircraft two-body
> horizon (`sqrt(eye/k)·1 + sqrt(alt/k)·2.5`), stamped once per frame in
> TrafficLayer, folded into the EXISTING fade channels of sprites/tracers/
> labels (no new GPU uniform; multiply OUTSIDE the anti-starvation floors);
> (4) satellite clouds: band 1500–4200, deterministic 6-cluster layout,
> sun-tinted via `runtime.sun` (unlit material, tinted not lit); (5) monuments
> mount in satellite (raw DEM ground, Lambert daylight satStyle, letters lift
> in both styles now); player Contrail finally rides applyBendAir.
> Harnesses: verify-round11 + verify-monuments-sat NEW, verify-sat-depth
> updated (aniso ≥4, z16, draws ≤375, tier pinned). FLY_ROUND11.md §4 =
> live-tune sign-offs pending; §6 lessons (a default flip is a certification
> event; the horizon is a two-body problem; style-conditional costs hide in
> configs).
>
> Earlier: **Round 10 "In That Area" is BUILT + verified
> (2026-07-18): [FLY_ROUND10.md](FLY_ROUND10.md) is the record.** Two paired
> user asks (the user wanted their local area well-covered): (1) WAY more world
> markers — the offline `CITIES` POI DB grew **303 → 1719** (+1416,
> 5-Opus-agent generate→verify workflow; merged with accent/case dedupe +
> bounds validation; every ambiguous US name state-suffixed — `Dublin` was
> already Dublin IRELAND, so Ohio's is `Dublin OH`); (2) at cruise altitude,
> see the ground town markers near AND far so a warped mini-planet reads as
> "its own little area you're inside of". The POI **letter** system
> ([PoiLetters.jsx](components/fly/PoiLetters.jsx) + `LETTERS` in
> fly-constants.js) is now altitude/horizon-aware: city `max` 2→6, SLOTS
> 10→20, **per-kind `separationM`** (cities pack tight at 3000, landmarks keep
> the stable 4500 — a flat 3000 blinked EMPIRE STATE, caught by verify-poi), a
> **horizon cull** (`horizonD = sqrt(altM/k)` reading the live bend uniform —
> letters are troika Text, NOT the rim-fade shader, so far ones would float in
> the void), distance up-scale (`farScale`) for legibility, and a `heldVisible`
> gate so a big Atlas warp doesn't leave the previous area's off-screen names
> squatting the quota for 20s. Because `GLOBE.altFlatten` flattens `k` with
> altitude, MORE of the area's towns appear the higher you fly — for free.
> FLY_ROUND10.md §4 = live-tuning sign-offs pending (all knobs in `LETTERS`);
> §5 = harnesses green (verify-poi / verify-monuments / verify-atlas); §6 =
> lessons (letters aren't ground; ride the curve, don't fight it; per-kind
> declutter; `name` is an identity key; decouple selection from visibility).
> **§7 follow-up (same day): SATELLITE is the default view now** (user) — the
> store literal `mapStyle` stays `'toy'` but `PauseMenu` resolves an unsaved
> player to `'satellite'` and persists it; harnesses seed `'toy'` via
> `scripts/_boot.js` (no more `removeItem`) so the Neon suite is unmoved. Same
> pass also SCOPED the area-feel boost to cities/airports (landmark/military/
> hotspot reverted to round-6/8 tuning), added `LETTERS.stickyK` 0.68 to damp a
> pre-existing STATUE/VERRAZZANO/CONEY gone-and-back, and bumped verify-poi's
> settle 8s→14s (arrival transient, not flicker). §7 lesson 6: a harness sample
> WINDOW can hide a real flicker — re-trace the full timeline when density or
> settle changes.
>
> **⚠️ ACTIVE WORK — READ FIRST:** **Round 7 "Electric Night City" is BUILT
> (2026-07-17): [FLY_ROUND7.md](FLY_ROUND7.md) is the record.** The Neon
> (toy) world now EMITS light (facade windows on `aFacade`, runway edge
> lights on `aGlow`, town glow-domes via `world-bend-anchor` — cache-key
> registry in world-bend.js grew 4 variants), RMB is a full 360° orbit
> (offset-space damping; coalesced pointer events), satellite gained a
> DEM hillshade + anisotropy + z17, the inspect card is a transparent
> isometric holo-panel (wiring/testids unchanged), airports are gameplay
> (lib/fly/airport-buzz.js → contracts + toasts), and the **Night style is
> RETIRED** ('night'→'toy' migration; NIGHT constants kept as documented
> dead values). Mid-round live fixes: traffic altitude LIFT
> (`GLOBE.trafficBend.farLiftBoost` — high traffic reads UP, not
> horizon-pinned; GPU + CPU `airDrop` mirror change together) and rooftop
> brightness (near-black since round 4, exposed by the new camera).
> FLY_ROUND7.md §4 = user sign-offs pending; §5 = which harnesses are
> green vs the paused full sweep + soak; §6 = new lessons (don't run
> harnesses while the user live-tests; stale tabs across dev-server
> restarts). Earlier: **Round 6 "Connected Sky" EXECUTED
> (2026-07-17): [FLY_ROUND6.md](FLY_ROUND6.md) is the record.** It fixed
> the round-5 live-review bugs (silent warp/chase failures → loud;
> contrails now backfill instantly, never render vertical/slab/spear —
> new `world-bend-air-anchor` shader variant + behind-camera cull; sky/
> ground rim unified via `GLOBE.rim` + a bend-following SkyDome dip; far
> warps stream ~3× faster behind a held streak→hold→reveal cinematic;
> POI letters are slot-stable with hysteresis; SPICY no longer pings CAP
> Cessnas and picks the nearest contact) and added the arcade layer the
> user asked for (C cinema wing-cam during chases, Contracts v1 scoring
> panel + persisted `fly-contracts` store, Day-style local-time sun).
> FLY_ROUND6.md §4 lists the user sign-off checkpoints (all defaults
> live-tunable in `fly-constants.js`); §5 has new hard-won lessons
> (ribbon width factors must cover camera geometry; per-vertex bend
> shears rigid objects; no store writes inside React state updaters).
> Harnesses: verify-inspect-actions/tracers/poi/rim/warp-arrival/
> chase-cam/contracts/sun all new and green, plus full round-5 sweep.
> Earlier: **Round 5 "Atlas" (2026-07-17): [FLY_ATLAS_REWORK.md](FLY_ATLAS_REWORK.md) §8.** The Atlas fast-travel screen (M / minimap click / pause menu:
> canvas world map with Natural Earth coastlines, search-to-warp,
> destination cards, recents/favorites/visits in the persisted
> `fly-atlas-store`), `runtime.warpToGeo` (military/hotspot warps spawn
> 4km out, nose on the field), a much bigger offline POI DB
> (`lib/fly/poi/` — ~300 cities +tz, ~120 landmarks, 63 military bases,
> 30 spotting hotspots; military/hotspot letters + tooltip badges +
> minimap triangles), the world-alive pass (worker-baked road-traffic
> pulses on `aArc` + rooftop beacon blink on `aBeacon` — both ZERO extra
> draws, cache keys `world-bend-fade-pulse`/`-beacon`; Day-only instanced
> cloud shadows +1 draw), and SPICY traffic pings (military/epic+ first
> sightings → toast + minimap ring). The §4.4c scout is UNBUILT
> (flag-off; needs explicit user opt-in). Open: live-tuning review of the
> new defaults (ROAD_PULSE/BEACONS/CLOUDS.shadow/SPICY + atlas colors).
> Earlier rounds: the **"Globe" rework (2026-07-16)** made every style a
> curved mini-globe with neon tracers + clean 3D Archivo-Black letters,
> and round 4 added the void-grid floor, terrain-clearing clouds, ribbon
> contrails (clock-skew mass-delete fixed in traffic-engine ingest), the
> INK CODEX inspect card, spot toasts and shoreline foam — see
> **[FLY_GLOBE_REWORK.md](FLY_GLOBE_REWORK.md) §6 + §6.3**.
> [FLY_TOYWORLD_REWORK.md](FLY_TOYWORLD_REWORK.md) §6.5's gotchas still
> apply (vector pipeline/curvature/tracers carry forward). The base Fly
> Mode is COMPLETE (all phases 0–6 + GLB fleet + game-feel pass,
> browser-verified — see
> **[FLY_MODE_HANDOFF.md](FLY_MODE_HANDOFF.md)** §8/§8.5.1 for the record,
> hard constraints (NO API keys; no r3f-perf; asset licensing), and the
> verification harnesses). Before touching anything under `components/fly/`,
> `lib/fly/`, or `stores/fly-store.js`, read those docs. The analysis below
> this notice predates Fly Mode and parts of it are stale (e.g. it
> references Leaflet, which was already replaced by deck.gl/MapLibre).

## Executive Summary

After thorough analysis of the SkyTracker codebase, I've identified several issues, performance bottlenecks, and opportunities for enhancement. This document provides a detailed breakdown and a prioritized action plan to transform the application into a modern, high-performance flight tracker.

---

## Part 1: Current Issues Identified

### 🔴 Critical Issues

#### 1. **Memory Leaks in Aircraft Store**
```javascript
// Problem: Map references in trails never get cleaned up for stale aircraft
trails: new Map(), // Grows unbounded over time
```
- Trail data persists even after aircraft leave the viewport
- No garbage collection for aircraft that haven't been seen in 30+ seconds

#### 2. **renderToString Performance Bottleneck**
```javascript
// In AircraftMarker.jsx - Line 3877
const iconHtml = renderToString(
  <AircraftIcon type={iconType} color={color} size={size} rotation={rotation} />
);
```
- `renderToString` is called on every render for every marker
- Synchronous, blocking operation that doesn't scale with 5,000+ aircraft

#### 3. **Icon Re-creation on Every Update**
- The `useMemo` dependency array includes `rotation`, causing icon re-creation on every position update
- CSS transforms should handle rotation instead of re-rendering the entire icon

#### 4. **No Virtual Rendering for Aircraft List**
- All filtered aircraft are rendered to the DOM even when not visible
- At 10,000+ aircraft, this causes significant memory pressure

### 🟠 Moderate Issues

#### 5. **Inefficient Filter Processing**
```javascript
// In use-filters.js - runs O(n) filters sequentially
filteredAircraft.forEach((ac) => {
  const type = classifyAircraft(ac); // Called multiple times per aircraft
});
```
- `classifyAircraft()` is called multiple times per aircraft (in filtering + stats)
- Should memoize classification results per aircraft

#### 6. **Missing Error Boundaries**
- No error boundaries around map components
- A single bad aircraft data point could crash the entire application

#### 7. **Polling Inefficiency**
- Uses fixed 5-second interval regardless of viewport size
- Small viewport = wasted API calls; large viewport = stale data

#### 8. **Trail Position Diffing**
```javascript
if (!lastPos || lastPos.lat !== ac.lat || lastPos.lon !== ac.lon)
```
- Floating-point comparison is unreliable
- Aircraft hovering may create duplicate points

### 🟡 Minor Issues

#### 9. **Missing Leaflet Static Assets**
- References `/leaflet/marker-icon.png` but files may not exist in public folder

#### 10. **Tooltip Performance**
- Tooltips create additional DOM nodes for every aircraft
- Should use a single shared tooltip that repositions

#### 11. **No Request Deduplication**
- Rapid panning can trigger multiple overlapping API requests

---

## Part 2: Performance Improvement Plan

### Tier 1: Critical Performance Fixes (Immediate Impact)

#### A. Canvas-Based Rendering for Markers
Replace DOM-based Leaflet markers with Canvas rendering for massive performance gains.

```javascript
// New: CanvasIconLayer.jsx
import L from 'leaflet';

// Use Leaflet.Canvas-Markers plugin or custom canvas layer
const CanvasIconLayer = L.Layer.extend({
  initialize: function(options) {
    this._icons = [];
    L.setOptions(this, options);
  },
  
  onAdd: function(map) {
    this._canvas = L.DomUtil.create('canvas', 'aircraft-canvas');
    this._ctx = this._canvas.getContext('2d');
    map.getPanes().overlayPane.appendChild(this._canvas);
    
    map.on('moveend zoomend', this._redraw, this);
    this._redraw();
  },
  
  setAircraft: function(aircraft) {
    this._icons = aircraft;
    this._redraw();
  },
  
  _redraw: function() {
    // Batch render all aircraft to canvas
    requestAnimationFrame(() => this._draw());
  },
  
  _draw: function() {
    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    
    this._icons.forEach(ac => {
      if (ac.lat && ac.lon) {
        const point = this._map.latLngToContainerPoint([ac.lat, ac.lon]);
        this._drawAircraft(ctx, point, ac);
      }
    });
  }
});
```

**Expected Impact:** 10x-50x rendering performance improvement for 5,000+ aircraft

#### B. Pre-compiled SVG Icon Sprites
Create a single sprite sheet with all aircraft types and rotations pre-rendered.

```javascript
// Icon sprite configuration
const ROTATION_STEPS = 36; // 10-degree increments (vs continuous)
const ICON_TYPES = ['airliner', 'helicopter', 'military', 'cargo', 'prop', 'jet', 'glider', 'drone', 'unknown'];

// Pre-generate at build time
function generateIconSprite() {
  const canvas = document.createElement('canvas');
  const iconSize = 40;
  const cols = ROTATION_STEPS;
  const rows = ICON_TYPES.length;
  
  canvas.width = iconSize * cols;
  canvas.height = iconSize * rows;
  // ... pre-render all icons
}
```

**Expected Impact:** Eliminate runtime SVG rendering overhead

#### C. Web Worker for Data Processing
Move filtering and classification to a Web Worker.

```javascript
// workers/aircraft-processor.worker.js
self.onmessage = function(e) {
  const { aircraft, filters } = e.data;
  
  // Heavy processing off main thread
  const processed = aircraft.map(ac => ({
    ...ac,
    classification: classifyAircraft(ac),
    iconType: getAircraftIconType(ac),
    color: getAircraftColor(ac),
  }));
  
  const filtered = applyFilters(processed, filters);
  
  self.postMessage({ processed, filtered });
};
```

**Expected Impact:** Unblock main thread, maintain 60fps during data updates

### Tier 2: Optimization Improvements (High Value)

#### D. Spatial Indexing with R-Tree
```javascript
import RBush from 'rbush';

class AircraftSpatialIndex {
  constructor() {
    this.tree = new RBush();
  }
  
  update(aircraft) {
    this.tree.clear();
    this.tree.load(aircraft.map(ac => ({
      minX: ac.lon, minY: ac.lat,
      maxX: ac.lon, maxY: ac.lat,
      aircraft: ac
    })));
  }
  
  queryBounds(bounds) {
    return this.tree.search({
      minX: bounds.getWest(),
      minY: bounds.getSouth(),
      maxX: bounds.getEast(),
      maxY: bounds.getNorth()
    }).map(item => item.aircraft);
  }
}
```

#### E. Adaptive Polling Rate
```javascript
function getPollingInterval(zoom, aircraftCount) {
  if (zoom > 12 && aircraftCount < 100) return 2000;  // Focused view
  if (zoom < 6) return 10000;  // Wide view, less urgent
  if (aircraftCount > 3000) return 8000;  // Heavy load
  return 5000;  // Default
}
```

#### F. Request Coalescing
```javascript
class RequestCoalescer {
  constructor(fetchFn, delay = 300) {
    this.pending = null;
    this.fetchFn = fetchFn;
    this.delay = delay;
  }
  
  request(params) {
    if (this.pending) {
      clearTimeout(this.pending.timeout);
    }
    
    return new Promise((resolve, reject) => {
      this.pending = {
        params,
        resolve,
        reject,
        timeout: setTimeout(() => this._execute(), this.delay)
      };
    });
  }
  
  _execute() {
    const { params, resolve, reject } = this.pending;
    this.pending = null;
    this.fetchFn(params).then(resolve).catch(reject);
  }
}
```

---

## Part 3: Unique Aircraft Icons Implementation

### Current State
You have 9 different icon shapes defined in `AircraftIcon.jsx`:
- AirlinerIcon, HelicopterIcon, MilitaryIcon, CargoIcon, PropIcon, JetIcon, GliderIcon, DroneIcon, UnknownIcon

**Problem:** Same icon shape is used with different colors, making aircraft types visually similar.

### Solution: Distinctive Icon Design System

#### Phase 1: Enhanced Icon Differentiation

```javascript
// New: lib/aircraft-icons.js
export const AIRCRAFT_ICON_DEFINITIONS = {
  // Commercial Airliners - Wide body silhouette
  airliner: {
    viewBox: '0 0 32 32',
    path: 'M28 18v-2l-10-6V4c0-1.1-.9-2-2-2s-2 .9-2 2v6L4 16v2l10-3v7l-3 2v2l5-1.5 5 1.5v-2l-3-2v-7l10 3z',
    style: 'filled',
    showTrail: true,
  },
  
  // Regional Jets - Smaller, sleeker
  jet: {
    viewBox: '0 0 32 32',
    path: 'M26 17v-2l-9-5V4.5c0-.83-.67-1.5-1.5-1.5S14 3.67 14 4.5V10l-9 5v2l9-2.5v6l-3 2v2l4.5-1 4.5 1v-2l-3-2v-6l9 2.5z',
    style: 'filled',
    showTrail: true,
  },
  
  // Military - Swept wings, aggressive shape
  military: {
    viewBox: '0 0 32 32',
    path: 'M27 16l-9-5.5V4a2 2 0 10-4 0v6.5L5 16v2l9-2v5l-3 2v2l5-1 5 1v-2l-3-2v-5l9 2v-2zM16 6l2-2h-4l2 2z',
    style: 'outlined',
    strokeWidth: 1.5,
    marker: 'star', // Adds small star indicator
  },
  
  // Cargo Freighter - Bulky body
  cargo: {
    viewBox: '0 0 32 32',
    path: 'M28 18v-2l-10-6V4c0-1.1-.9-2-2-2s-2 .9-2 2v6L4 16v2l10-3v7l-3 2v2l5-1.5 5 1.5v-2l-3-2v-7l10 3z',
    bodyPath: 'M11 11h10v6H11z', // Additional cargo bay
    style: 'filled',
    showTrail: true,
  },
  
  // Helicopter - Distinct rotor blade
  helicopter: {
    viewBox: '0 0 32 32',
    path: 'M6 8h20v2H6z M16 10v6m-6 0h12a3 3 0 010 6H10a3 3 0 010-6z M13 22l-2 4h10l-2-4',
    rotorPath: 'M6 8h20', // Animated rotor
    style: 'filled',
    animate: 'rotor',
  },
  
  // Prop/Turboprop - High wing design
  prop: {
    viewBox: '0 0 32 32',
    path: 'M16 3a1 1 0 00-1 1v7L6 15v2l9-2v6l-3 2v2l4-1.5 4 1.5v-2l-3-2v-6l9 2v-2l-9-4V4a1 1 0 00-1-1z',
    propPath: 'M16 3l2-2-4 0 2 2', // Propeller detail
    style: 'filled',
  },
  
  // Glider - Long slender wings
  glider: {
    viewBox: '0 0 32 32',
    path: 'M16 5c-.3 0-.5.2-.5.5v6L2 14v1.5L15.5 13v6l-2.5 1.5v1.5l3-.75 3 .75V20l-2.5-1.5v-6L30 15.5V14l-13.5-2.5V5.5c0-.3-.2-.5-.5-.5z',
    style: 'thin',
    strokeWidth: 1,
  },
  
  // Drone/UAV - Quad configuration
  drone: {
    viewBox: '0 0 32 32',
    path: 'M8 8a4 4 0 100-1 M24 8a4 4 0 100-1 M8 24a4 4 0 100-1 M24 24a4 4 0 100-1',
    bodyPath: 'M13 13h6v6h-6z',
    armPaths: ['M8 8L13 13', 'M24 8L19 13', 'M8 24L13 19', 'M24 24L19 19'],
    style: 'outlined',
    animate: 'props',
  },
  
  // Unknown - Distinctive question mark/radar blip
  unknown: {
    viewBox: '0 0 32 32',
    path: 'M16 4a12 12 0 100 24 12 12 0 000-24z',
    innerPath: 'M16 8l6 12H10l6-12z',
    style: 'pulsing',
    opacity: 0.7,
  },
  
  // NEW: Government/VIP - Distinct executive shape
  government: {
    viewBox: '0 0 32 32',
    path: 'M28 17v-2l-10-6V4c0-1.1-.9-2-2-2s-2 .9-2 2v5L4 15v2l10-2.5v7l-3 2v2l5-1.5 5 1.5v-2l-3-2v-7l10 2.5z',
    crownPath: 'M10 4l2-2h8l2 2', // Crown/official marker
    style: 'filled',
    marker: 'shield',
  },
  
  // NEW: Emergency - Pulsing with alert styling
  emergency: {
    viewBox: '0 0 32 32',
    path: 'M28 18v-2l-10-6V4c0-1.1-.9-2-2-2s-2 .9-2 2v6L4 16v2l10-3v7l-3 2v2l5-1.5 5 1.5v-2l-3-2v-7l10 3z',
    style: 'emergency',
    animate: 'pulse',
    glowColor: '#ff0000',
  }
};
```

#### Phase 2: New AircraftIcon Component

```jsx
// components/aircraft/AircraftIcon.jsx - Complete Rewrite
'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AIRCRAFT_ICON_DEFINITIONS } from '@/lib/aircraft-icons';

export const AircraftIcon = memo(function AircraftIcon({
  type = 'unknown',
  color = '#6b7280',
  size = 32,
  rotation = 0,
  isEmergency = false,
  isSelected = false,
  className,
}) {
  const iconDef = AIRCRAFT_ICON_DEFINITIONS[isEmergency ? 'emergency' : type] 
    || AIRCRAFT_ICON_DEFINITIONS.unknown;
  
  const styles = useMemo(() => ({
    width: size,
    height: size,
    // Use CSS transform for rotation - no re-render needed
    '--rotation': `${rotation}deg`,
    '--icon-color': isSelected ? '#3b82f6' : color,
    '--glow-color': isEmergency ? '#ff0000' : 'transparent',
  }), [size, rotation, color, isSelected, isEmergency]);

  return (
    <svg
      viewBox={iconDef.viewBox}
      style={styles}
      className={cn(
        'aircraft-icon',
        `aircraft-icon--${iconDef.style}`,
        iconDef.animate && `aircraft-icon--${iconDef.animate}`,
        isSelected && 'aircraft-icon--selected',
        className
      )}
    >
      {/* Drop shadow filter */}
      <defs>
        <filter id={`shadow-${type}`} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.5"/>
        </filter>
        {isEmergency && (
          <filter id="emergency-glow">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feFlood floodColor="#ff0000" floodOpacity="0.6"/>
            <feComposite in2="blur" operator="in"/>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        )}
      </defs>
      
      {/* Main aircraft path */}
      <g 
        style={{ transform: 'rotate(var(--rotation))', transformOrigin: 'center' }}
        filter={isEmergency ? 'url(#emergency-glow)' : `url(#shadow-${type})`}
      >
        <path 
          d={iconDef.path} 
          fill={iconDef.style === 'outlined' ? 'none' : 'var(--icon-color)'} 
          stroke={iconDef.style === 'outlined' ? 'var(--icon-color)' : 'none'}
          strokeWidth={iconDef.strokeWidth || 0}
        />
        
        {/* Additional paths for complex icons */}
        {iconDef.bodyPath && (
          <path d={iconDef.bodyPath} fill="var(--icon-color)" opacity="0.8"/>
        )}
        
        {iconDef.propPath && (
          <path d={iconDef.propPath} fill="var(--icon-color)" opacity="0.9"/>
        )}
        
        {/* Markers */}
        {iconDef.marker === 'star' && (
          <polygon points="16,2 17,5 20,5 18,7 19,10 16,8 13,10 14,7 12,5 15,5" 
            fill="var(--icon-color)" opacity="0.7" transform="scale(0.4) translate(24,0)"/>
        )}
        
        {iconDef.marker === 'shield' && (
          <path d="M16 1l4 2v4c0 3-4 5-4 5s-4-2-4-5V3l4-2z" 
            fill="var(--icon-color)" opacity="0.6" transform="scale(0.35) translate(30,0)"/>
        )}
      </g>
    </svg>
  );
});

// CSS to add in globals.css
/*
.aircraft-icon {
  transform-origin: center;
  will-change: transform;
}

.aircraft-icon--pulse {
  animation: pulse 1s ease-in-out infinite;
}

.aircraft-icon--rotor g:first-of-type::after {
  animation: spin 0.1s linear infinite;
}

.aircraft-icon--selected {
  filter: drop-shadow(0 0 6px var(--icon-color));
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}
*/
```

#### Phase 3: Icon Preview Component for Testing

```jsx
// components/aircraft/IconGallery.jsx - Development tool
'use client';

import { AircraftIcon } from './AircraftIcon';
import { AIRCRAFT_COLORS } from '@/lib/constants';

const ICON_TYPES = [
  'airliner', 'jet', 'military', 'cargo', 'helicopter', 
  'prop', 'glider', 'drone', 'government', 'unknown'
];

export function IconGallery() {
  return (
    <div className="grid grid-cols-5 gap-4 p-4 bg-gray-900">
      {ICON_TYPES.map(type => (
        <div key={type} className="flex flex-col items-center gap-2">
          <div className="text-xs text-gray-400">{type}</div>
          <div className="flex gap-2">
            {[0, 45, 90, 180, 270].map(rotation => (
              <AircraftIcon
                key={rotation}
                type={type}
                color={AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown}
                size={32}
                rotation={rotation}
              />
            ))}
          </div>
        </div>
      ))}
      
      {/* Emergency states */}
      <div className="col-span-5 border-t border-gray-700 pt-4 mt-4">
        <div className="text-sm text-gray-400 mb-2">Emergency States</div>
        <div className="flex gap-4">
          {['airliner', 'helicopter', 'military'].map(type => (
            <AircraftIcon
              key={type}
              type={type}
              color="#ff0000"
              size={40}
              rotation={45}
              isEmergency={true}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## Part 4: New Features for Modern Sleek Tracker

### Feature 1: Real-time Flight Path Prediction

```javascript
// lib/prediction.js
export function predictFlightPath(aircraft, minutes = 5) {
  if (!aircraft.lat || !aircraft.lon || !aircraft.track || !aircraft.gs) {
    return null;
  }
  
  const speedKnots = aircraft.gs;
  const headingRad = (aircraft.track * Math.PI) / 180;
  const distanceNm = (speedKnots / 60) * minutes;
  
  // Convert nautical miles to degrees (approximate)
  const distanceDeg = distanceNm / 60;
  
  const predictedLat = aircraft.lat + distanceDeg * Math.cos(headingRad);
  const predictedLon = aircraft.lon + distanceDeg * Math.sin(headingRad) / Math.cos(aircraft.lat * Math.PI / 180);
  
  return {
    lat: predictedLat,
    lon: predictedLon,
    eta: new Date(Date.now() + minutes * 60000),
  };
}
```

### Feature 2: 3D Altitude Visualization

```jsx
// components/map/AltitudeLayer.jsx
'use client';

import { useMemo } from 'react';
import { Polyline } from 'react-leaflet';

export function AltitudeLayer({ aircraft }) {
  const altitudeLines = useMemo(() => {
    return aircraft
      .filter(ac => ac.lat && ac.lon && ac.alt_baro > 1000)
      .map(ac => {
        const height = Math.min(ac.alt_baro / 1000, 50); // Normalize
        const opacity = 0.3 + (height / 50) * 0.4;
        
        return {
          positions: [
            [ac.lat, ac.lon],
            [ac.lat + 0.01, ac.lon + 0.01], // Offset for shadow effect
          ],
          color: `hsl(${200 + height * 2}, 70%, 50%)`,
          weight: 1,
          opacity,
          key: ac.hex,
        };
      });
  }, [aircraft]);
  
  return altitudeLines.map(line => (
    <Polyline key={line.key} {...line} />
  ));
}
```

### Feature 3: Aircraft Proximity Alerts

```javascript
// hooks/use-proximity-alerts.js
'use client';

import { useMemo } from 'react';

export function useProximityAlerts(aircraft, thresholdNm = 5) {
  const alerts = useMemo(() => {
    const proximityAlerts = [];
    const checked = new Set();
    
    aircraft.forEach((ac1, i) => {
      if (!ac1.lat || !ac1.lon) return;
      
      aircraft.slice(i + 1).forEach(ac2 => {
        if (!ac2.lat || !ac2.lon) return;
        
        const key = [ac1.hex, ac2.hex].sort().join('-');
        if (checked.has(key)) return;
        checked.add(key);
        
        const distance = calculateDistanceNm(
          ac1.lat, ac1.lon, ac2.lat, ac2.lon
        );
        
        // Check altitude separation
        const altSeparation = Math.abs(
          (ac1.alt_baro || 0) - (ac2.alt_baro || 0)
        );
        
        if (distance < thresholdNm && altSeparation < 1000) {
          proximityAlerts.push({
            aircraft1: ac1,
            aircraft2: ac2,
            distance,
            altitudeSeparation: altSeparation,
            severity: distance < 2 ? 'critical' : 'warning',
          });
        }
      });
    });
    
    return proximityAlerts.sort((a, b) => a.distance - b.distance);
  }, [aircraft, thresholdNm]);
  
  return alerts;
}

function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + 
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

### Feature 4: Weather Layer Integration

```jsx
// components/map/WeatherLayer.jsx
'use client';

import { TileLayer } from 'react-leaflet';
import { useUIStore } from '@/stores/ui-store';

const WEATHER_LAYERS = {
  radar: 'https://tilecache.rainviewer.com/v2/radar/{ts}/256/{z}/{x}/{y}/2/1_1.png',
  clouds: 'https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid={apiKey}',
  wind: 'https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid={apiKey}',
};

export function WeatherLayer({ type = 'radar', apiKey }) {
  const { weatherLayerEnabled } = useUIStore();
  
  if (!weatherLayerEnabled) return null;
  
  const url = WEATHER_LAYERS[type]
    .replace('{apiKey}', apiKey)
    .replace('{ts}', Math.floor(Date.now() / 600000) * 600); // 10-min cache
  
  return (
    <TileLayer
      url={url}
      opacity={0.5}
      zIndex={100}
    />
  );
}
```

### Feature 5: Flight History Playback

```javascript
// stores/playback-store.js
import { create } from 'zustand';

export const usePlaybackStore = create((set, get) => ({
  isPlaying: false,
  playbackSpeed: 1,
  currentTime: null,
  history: [], // [{timestamp, aircraft: []}]
  
  recordFrame: (aircraft) => {
    set(state => ({
      history: [
        ...state.history.slice(-360), // Keep 30 min at 5s intervals
        { timestamp: Date.now(), aircraft: [...aircraft] }
      ]
    }));
  },
  
  startPlayback: (fromTime) => {
    set({ isPlaying: true, currentTime: fromTime || get().history[0]?.timestamp });
  },
  
  stopPlayback: () => {
    set({ isPlaying: false, currentTime: null });
  },
  
  getFrameAtTime: (time) => {
    const history = get().history;
    return history.find(h => h.timestamp >= time)?.aircraft || [];
  },
  
  setPlaybackSpeed: (speed) => {
    set({ playbackSpeed: speed });
  },
}));
```

### Feature 6: Airport/Runway Overlay

```javascript
// lib/airports.js
export const MAJOR_AIRPORTS = {
  KJFK: { lat: 40.6413, lon: -73.7781, name: 'JFK International', runways: ['04L/22R', '04R/22L', '13L/31R', '13R/31L'] },
  KLAX: { lat: 33.9425, lon: -118.4081, name: 'Los Angeles International', runways: ['06L/24R', '06R/24L', '07L/25R', '07R/25L'] },
  KORD: { lat: 41.9742, lon: -87.9073, name: 'O\'Hare International', runways: ['04L/22R', '09C/27C', '10L/28R', '10C/28C', '10R/28L', '09L/27R', '09R/27L', '04R/22L', '14R/32L', '15/33'] },
  // ... add more
};
```

### Feature 7: Keyboard Shortcuts

```javascript
// hooks/use-keyboard-shortcuts.js
'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useMapStore } from '@/stores/map-store';
import { useAircraftStore } from '@/stores/aircraft-store';

export function useKeyboardShortcuts() {
  const { toggleSidebar, toggleDetailPanel } = useUIStore();
  const { resetView, geolocate } = useMapStore();
  const { selectAircraft, unfollowAircraft } = useAircraftStore();
  
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      switch (e.key) {
        case 'f':
          e.preventDefault();
          toggleSidebar(); // Toggle filters
          break;
        case 'd':
          e.preventDefault();
          toggleDetailPanel(); // Toggle detail panel
          break;
        case 'Escape':
          selectAircraft(null);
          unfollowAircraft();
          break;
        case 'h':
          e.preventDefault();
          resetView(); // Home view
          break;
        case 'l':
          e.preventDefault();
          geolocate(); // My location
          break;
        case '+':
        case '=':
          // Zoom in handled by Leaflet
          break;
        case '-':
          // Zoom out handled by Leaflet
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, toggleDetailPanel, selectAircraft, unfollowAircraft, resetView, geolocate]);
}
```

### Feature 8: Night Mode Map Variant

```javascript
// lib/constants.js - Add map themes
export const MAP_THEMES = {
  dark: {
    name: 'Dark Matter',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CARTO',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  terrain: {
    name: 'Terrain',
    url: 'https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg',
    attribution: '&copy; Stamen',
  },
  light: {
    name: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CARTO',
  },
};
```

### Feature 9: Live Stats Dashboard

```jsx
// components/panels/StatsDashboard.jsx
'use client';

import { memo, useMemo } from 'react';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useFilterStats } from '@/hooks/use-filters';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export const StatsDashboard = memo(function StatsDashboard() {
  const aircraft = useAircraftStore(s => s.getAircraftArray());
  const stats = useFilterStats(aircraft);
  
  const altitudeDistribution = useMemo(() => {
    const ranges = [
      { range: '0-10k', min: 0, max: 10000, count: 0 },
      { range: '10-20k', min: 10000, max: 20000, count: 0 },
      { range: '20-30k', min: 20000, max: 30000, count: 0 },
      { range: '30-40k', min: 30000, max: 40000, count: 0 },
      { range: '40k+', min: 40000, max: Infinity, count: 0 },
    ];
    
    aircraft.forEach(ac => {
      const alt = ac.alt_baro || 0;
      const range = ranges.find(r => alt >= r.min && alt < r.max);
      if (range) range.count++;
    });
    
    return ranges;
  }, [aircraft]);
  
  return (
    <div className="p-4 bg-card rounded-lg space-y-4">
      <h3 className="text-sm font-semibold">Live Statistics</h3>
      
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-primary">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Total Aircraft</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-500">{stats.byType.commercial}</div>
          <div className="text-xs text-muted-foreground">Commercial</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-red-500">{stats.byType.military}</div>
          <div className="text-xs text-muted-foreground">Military</div>
        </div>
      </div>
      
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={altitudeDistribution}>
            <XAxis dataKey="range" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
```

### Feature 10: Shareable Flight Links

```javascript
// hooks/use-share.js
'use client';

import { useCallback } from 'react';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';

export function useShare() {
  const selectedAircraft = useAircraftStore(s => s.getSelectedAircraft());
  const { center, zoom } = useMapStore();
  
  const generateShareUrl = useCallback(() => {
    const params = new URLSearchParams();
    
    if (selectedAircraft) {
      params.set('hex', selectedAircraft.hex);
    }
    
    params.set('lat', center[0].toFixed(4));
    params.set('lon', center[1].toFixed(4));
    params.set('zoom', zoom.toString());
    
    return `${window.location.origin}?${params.toString()}`;
  }, [selectedAircraft, center, zoom]);
  
  const share = useCallback(async () => {
    const url = generateShareUrl();
    
    if (navigator.share) {
      await navigator.share({
        title: selectedAircraft 
          ? `Tracking ${selectedAircraft.flight || selectedAircraft.hex}`
          : 'SkyTracker - Live Flight Tracker',
        url,
      });
    } else {
      await navigator.clipboard.writeText(url);
      // Show toast notification
    }
  }, [generateShareUrl, selectedAircraft]);
  
  return { generateShareUrl, share };
}
```

---

## Part 5: Prioritized Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)
| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P0 | Fix memory leaks in trail storage | High | Low |
| P0 | Remove renderToString, use CSS rotation | High | Medium |
| P0 | Add error boundaries | High | Low |
| P1 | Memoize classification results | Medium | Low |
| P1 | Implement request coalescing | Medium | Medium |

### Phase 2: Performance Optimization (Week 2)
| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P0 | Implement Canvas-based marker rendering | Very High | High |
| P1 | Add Web Worker for data processing | High | Medium |
| P1 | Pre-generate icon sprites | Medium | Medium |
| P2 | Implement spatial indexing | Medium | Medium |
| P2 | Add adaptive polling | Low | Low |

### Phase 3: Icon System (Week 3)
| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P0 | Design 10 unique aircraft icons | High | Medium |
| P0 | Implement new AircraftIcon component | High | Medium |
| P1 | Add emergency/selected states | Medium | Low |
| P1 | Create icon gallery for testing | Low | Low |
| P2 | Add icon animations (helicopter rotor) | Low | Medium |

### Phase 4: New Features (Week 4+)
| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| P1 | Keyboard shortcuts | Medium | Low |
| P1 | Shareable flight links | Medium | Low |
| P2 | Weather layer integration | Medium | Medium |
| P2 | Airport overlay | Medium | Medium |
| P2 | Statistics dashboard | Medium | Medium |
| P3 | Flight path prediction | Low | Medium |
| P3 | Altitude visualization | Low | Medium |
| P3 | History playback | Low | High |

---

## Part 6: Quick Wins (Can Implement Today)

### 1. CSS-Only Rotation Fix (5 minutes)
```css
/* globals.css */
.aircraft-marker svg {
  transform: rotate(var(--rotation, 0deg));
  transition: transform 0.3s ease-out;
}
```

```jsx
// AircraftMarker.jsx - Remove rotation from dependency array
const icon = useMemo(() => {
  // Don't include rotation here
}, [iconType, color, size, emergency]);

// Apply rotation via CSS variable
return (
  <Marker
    style={{ '--rotation': `${rotation}deg` }}
    // ...
  />
);
```

### 2. Classification Memoization (10 minutes)
```javascript
// In aircraft-store.js
setAircraft: (aircraftList) => {
  const newMap = new Map();
  
  aircraftList.forEach((ac) => {
    if (ac.hex) {
      // Pre-calculate and cache classification
      ac._classification = classifyAircraft(ac);
      ac._iconType = getAircraftIconType(ac);
      ac._color = getAircraftColor(ac);
      newMap.set(ac.hex, ac);
    }
  });
  // ...
}
```

### 3. Trail Cleanup (5 minutes)
```javascript
// In aircraft-store.js
setAircraft: (aircraftList) => {
  const { trails } = get();
  const activeHexes = new Set(aircraftList.map(ac => ac.hex));
  
  // Clean up trails for aircraft no longer in view
  const cleanedTrails = new Map();
  trails.forEach((trail, hex) => {
    if (activeHexes.has(hex)) {
      cleanedTrails.set(hex, trail);
    }
  });
  
  set({ trails: cleanedTrails });
  // ...
}
```

### 4. Error Boundary (10 minutes)
```jsx
// components/ErrorBoundary.jsx
'use client';

import { Component } from 'react';

export class MapErrorBoundary extends Component {
  state = { hasError: false };
  
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  
  componentDidCatch(error, errorInfo) {
    console.error('Map error:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center bg-background">
          <div className="text-center">
            <p className="text-lg font-medium">Map failed to load</p>
            <button 
              onClick={() => this.setState({ hasError: false })}
              className="mt-2 text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    
    return this.props.children;
  }
}
```

---

## Summary

Your SkyTracker application has a solid foundation but requires optimization for handling 5,000+ aircraft smoothly. The key improvements are:

1. **Performance**: Switch to Canvas rendering, use Web Workers, and optimize icon creation
2. **Icons**: Implement 10 unique, distinctive aircraft silhouettes instead of color-only differentiation
3. **Features**: Add modern features like keyboard shortcuts, sharing, weather layers, and statistics

The phased approach allows for incremental improvements while maintaining a working application throughout the process.