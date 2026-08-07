# FLY ROUND 22 — "CINEMATIC NIGHT" (HANDOFF)

> Authored at the R21 "Steady State" close, by user request (2026-08-06): *"create
> the next handoff with clear instructions for doing another graphics
> enhancement pass"* toward a supplied photoreal night-city reference. The two
> frames compared were: (1) the CURRENT satellite night at the Brooklyn Bridge
> chase pose (user screenshot, R20 tree), (2) a cinematic reference frame —
> moonlit cumulus deck, rich blacks, streetlight/traffic-lit roads, reflective
> water, a floodlit ESB focal point. **The reference is a MOOD target, not a
> pixel target** — the game is stylized; every delta below is "close the gap
> while keeping the game's read." This is a planning seed in the round idiom:
> a future orchestrator turns it into FLY_ROUND22_PLAN.md with agent charters.

## §0 What the current frame already does well (do not regress)

- Window-grid night emissives read as a real city (R15/R16); density is
  plausible and now uniform across the whole frame (R20 sprawl + R21 seams).
- ESB/marquee silhouettes and POI letters are legible; bridge silhouettes land.
- R21's stability layer: no flashing, no patchy coverage, prewarmed pipeline.
  **verify-stability / verify-flicker / verify-tier-step / verify-seam are the
  regression armor for THIS round** — every R22 feature must leave them green.

## §1 Ranked visual deltas (target − current), each with candidate mechanism

1. **SKY / CLOUDSCAPE** (biggest single read): reference has a dramatic
   moonlit cumulus deck — rim-lit edges, deep blue gradient behind. Current:
   flat grey-blue wash, faint haze band. Mechanism candidates: a night cloud
   deck layer (billboard clusters with per-sprite moon-rim shading — the R19
   cirrus +1-draw precedent; CloudField exists but is sparse and
   daylight-tuned), SkyDome night gradient steepening (CPU keyframes exist),
   moon disc glow halo. MUST key off `runtime.weather.wx` (R16) — the deck
   coexists with the overcast lid, never fights it. Budget target: ≤ +2 draws.
2. **EXPOSURE HIERARCHY / NIGHT GRADE**: reference has rich blacks, high local
   contrast, restrained bloom on the brightest clusters, teal-orange bias,
   deeper vignette. Current: mid-grey everywhere; window emissives nearly
   uniform; no dark floors between bright clusters. Mechanisms: (a) a
   night-keyed grade term in the existing satellite EffectPass (WhiteBalance/
   BrightnessContrast already merge — a `nightGrade` uniform driven by
   `trueElevationDeg`, 0 by day = every existing daylight gate untouched);
   (b) facade night atlas variance — widen the lit-floor/lit-cell/brightness
   distributions, add per-BUILDING dark-floor probability bands (the atlas is
   seeded-deterministic; a second night atlas variant selected per building by
   hash keeps it cache-safe — note the R21 PREWARM contract: new atlas
   variants must join the warm set); (c) bloom night threshold/intensity tune
   (the R16 night-bloom-breathing machinery already exists — and note the R21
   flicker residual attribution: 23–80 swinging px at Manhattan survived five
   negative controls; any bloom change re-runs verify-flicker's five-control
   protocol before AND after).
3. **ROAD LIFE AT NIGHT**: reference streets glow — streetlight pools,
   headlight/taillight streams, lit intersections. Current: sat roads are a
   dim additive web (R16), nearly invisible at this pose. Mechanisms: raise
   the cls-hierarchy night envelope (R19 SUBURB_NIGHT machinery, additive,
   swept once in R16 — a re-sweep is a knob move needing an A/B); animated
   headlight/taillight dash trains ALREADY EXIST as fragment terms in
   `applyBendRoadSat` (R16 "dash trains") — presence/gain/density tune plus a
   possible second color term (warm headlights one direction, red tail the
   other) inside the ONE road material = zero extra draws; streetlight pool
   sprites at junction points (worker emits junctions? — needs a scout; if
   not, a cls-5/6 vertex-density heuristic. +1 draw budget).
4. **WATER**: reference water is a reflective blue field carrying city light.
   Current: near-black void. This is the R19 §5b "satellite water material"
   follow-up's round. Mechanisms: Fresnel city-glow gradient (cheap, no
   reflection render — sample a horizon-band luma proxy driven by
   SatCityGlow's dome positions), moon streak (toy moonglade `-r13` precedent
   ported to the sat glint material `world-bend-water-satglint-r13` — NEW
   CACHE KEY REQUIRED per the world-bend registry contract), subtle normal
   ripple. True SSR/planar reflection is out of budget — reject unless
   measured otherwise.
5. **LANDMARK FOCAL LIGHTING**: reference ESB is a floodlit warm crown focal
   point. Current: dim red silhouette. Mechanism: satellite night accent
   treatment for marquee monuments (crown/floodlight emissive bands — the R20
   toy accent machinery exists; satellite marquee albedo is graded by the
   stone key). ⚠️ CONSTRAINT: `verify-monuments-sat` is FROZEN and the R20
   §5b.4 Taj night residual is deliberately unspent — this feature REQUIRES a
   pre-sanctioned evolution of that gate in the R22 plan (do it once, close
   the Taj residual in the same move, per the R20 note).
6. **ROOFTOP READ**: reference roofs are dark with clutter shadows breaking up
   slabs. Current: flat brown planes at night. Mechanism: night roof albedo
   key (darken + desaturate roofs as sun elevation falls — a uniform on the
   shared building material, no geometry), R18 roof furniture already exists.
7. **POI LETTERS AT NIGHT**: current white glow letters read as UI over the
   world; the reference has nothing comparable. TASTE ITEM — options: dimmer/
   warmer night letter grade, smaller at night, or leave. USER CHECKPOINT
   before any change; letters are load-bearing for navigation.
8. **PARK/CANOPY NIGHT CONTRAST**: reference parks are dark voids with faint
   edge spill. Current canopy is flat-tinted. Mechanism: night canopy
   darkening in the veg instancer color path (cheap), park-edge streetlight
   spill is covered by delta 3.

## §2 Constraints inherited (verbatim from R21 §4 unless noted)

- Owens ≤ 261 / satellite ≤ 375 / toy ≤ 480; satellite soak p95 tris ≤ 2.2 M
  BLOCKING (the R21 gate); governor steps ≤ 4 per soak; heap no-climb.
- The R21 stability fleet (stability 17 / flicker 7 / tier-step 10 / seam 13)
  green throughout — these are the anti-regression net for every R22 visual.
- verify-sat-night (33) asserts the R16 deep-night contract — the grade and
  window-variance work WILL need pre-sanctioned re-baselines with A/B controls
  (measured before/after at the same pose, the R20 five-tile discipline).
  Budget them in the plan; do not discover them mid-round.
- verify-monuments-sat FROZEN unless the §1.5 evolution is pre-sanctioned.
- World-bend cache-key registry: every new shader variant carries its own key
  (the registry header's contract); new variants join the R21 PREWARM warm set
  in the same change (A's `buildPassList`/warm-set is the single source).
- Weather integration: everything keys off `runtime.weather.wx` and
  `trueElevationDeg` — no feature may fight the overcast lid or the dusk
  ladder (R19 SKY_DUSK; R21 duskCalm).
- No API keys; keyless/free assets; licensing verified per-source (R20 §7.1:
  a repo's LICENSE does not license its assets).
- Round idiom: pre-seeded `enabled:false` constants blocks per owner; flag-off
  byte-identity; worktrees; agents never commit; frozen-move ledger.

## §3 Suggested ownership split (five agents, R21-shaped)

| Agent | Owns |
|---|---|
| A SKY | night cloud deck + SkyDome night gradient + moon halo; weather coupling |
| B GRADE | night grade uniform in the EffectPass + facade night-atlas variance + bloom night tune (five-control flicker protocol) + rooftop night key |
| C GROUND | road night envelope re-sweep + dash-train color/gain + junction pools + canopy/park night + water Fresnel/moonstreak (new cache key) |
| D ICONS | marquee night floodlighting + the sanctioned monuments-sat evolution + Taj residual closure + POI letter night option (built OFF, user checkpoint) |
| E CERT | pre-sanctioned re-baseline controls for sat-night; fixed-pose A/B PNG protocol at the user's Brooklyn Bridge pose + Powell + Owens night + Melton night; luma-histogram instrument for the grade (p5/p50/p95 luma bands — "rich blacks" is measurable); fleet + soaks |

## §4 Measurement protocol (decide pass/fail BEFORE building)

- Canonical poses: the user's Brooklyn Bridge chase pose (recover from the
  screenshot framing), Manhattan overview, Powell night, Melton night, Owens
  night (must stay EMPTY and DARK — the desert is the control), one dusk
  crossing time-lapse.
- Instruments: A/B PNGs per feature flag at fixed poses; luma histograms
  (the grade's "rich blacks" = p5 luma falls, p95 stable, bloom-clipped area
  bounded); draw/tris deltas per feature (deterministic worker/scene counts,
  never soak-differenced); verify-flicker before/after for anything touching
  emissives or bloom.
- Every knob move on R16-swept values (road night intensity, bloom) gets a
  measured A/B against the swept baseline — the sweep values are load-bearing
  history, not suggestions.

## §5 User checkpoints to schedule (§6 of the eventual round record)

1. The Brooklyn Bridge pose vs the reference, side by side — the round's
   money shot. 2. Letters at night (taste). 3. Grade strength (too dark?
   HUD legibility). 4. Cloud deck density/variance over a 15-min flight.
   5. Water read at low AGL vs cruise. 6. ESB/marquee floodlight taste.
   7. Performance feel on the user's machine (the R20 §6.15 lesson — FIRST,
   not last).
