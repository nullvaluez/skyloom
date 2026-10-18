# Lounge second level — audit, plan and record

The second-level pass on the observation lounge's two-floor **pier** room
(`LOUNGE_PIER`) and its instruments (`LOUNGE_INSTRUMENTS`). Both flags stay
`enabled:false`; owner visual sign-off is a separate gate. Review with
`?flags=LOUNGE_PIER,LOUNGE_INSTRUMENTS`. Everything in this pass is scoped to
the pier variant (or the instruments flag): the classic room and flags-off
behaviour stay unchanged.

Five agents: a scout (audit, render harness, W0 contracts, this plan), three
implementation lanes (FURNISH, LIGHT, LIFE) and an integrator. Background:
[FLY_LIVING_OBSERVATORY.md](FLY_LIVING_OBSERVATORY.md) (the pier, the upper
room, the instruments, owner feedback) and
[FLY_OBSERVATION_LOUNGE.md](FLY_OBSERVATION_LOUNGE.md) ("Rules every
workstream follows").

**Environment truth.** The cloud container has no real GPU (WebGL is
ANGLE/SwiftShader) and cannot reach Esri, OpenFreeMap or ADS-B, so no airport
loads here and no fps or frame-time claim is made anywhere in this record.
Every look verdict below comes from the **room-only render harness**, which
approximates the app's post chain (see "Harness"); every performance verdict
belongs to the owner's RTX 5080.

## Status

- **Scout (W0): landed.** Harness, gate suite, contracts, audit, plan. The W0
  commit is behaviour-neutral: every existing gate prints what it printed
  before except the sanctioned pier triangle ceiling (140,000 → 160,000), and
  harness renders of the pier and classic rooms before and after it compare
  pixel-identical on the pier (6 renders, 0 differing pixels). On the classic
  room 4 renders differ by 0, 0, 11 and 3 pixels of 921,600, which is the
  harness's own run-to-run variation on that classic pose (two runs of the
  same tree differ by 6 and 2 pixels there).
- FURNISH, LIGHT, LIFE: briefs below. Record section at the end.

## Audit

Evidence: the "before" captures in
`.graphics-review/lounge-second-level/` (local, gitignored), all from the
room-only harness at 1280×720 on SwiftShader:

- `before/` — the pier room, 14 poses × day / golden / night, exactly the
  app's shader (`sheet-pier.png`, `sheet-pier-<tod>.png`). Magenta pixels are
  the harness's non-finite marker (weakness 5).
- `before-safebump/` — the same with the harness's `SAFE_BUMP` diagnostic (a
  guarded normalize in the room shader's bump; NOT the app's shader), so the
  rest of the look can be judged.
- `before-classic/` — the classic room, window seat and wide view, day.

Poses are room-local (`scripts/lounge-room-render/poses.mjs`); a capture is
cited as `before/pier-<pose>-<tod>.png`.

### Strengths

1. The continuous left-wall stair is a strong architectural move: 28 equal 164 mm rises with crisp oak nosings over travertine risers, a 1.9 m clear width, and a bright window at its head that draws you up (`stair-foot`, `stair-mid`).
2. The upper room's three-sided glazing under a 3.25 m ceiling has the best light in the lounge: low sun throws long mullion-striped patches across the timber floor and up the reeded stairwell wall (`upper-west-golden`, `upper-wide-from-landing-golden`).
3. The analytic interior light model genuinely understands two levels: the slab blocks the key and the fixtures between floors except through the stair opening, so each floor keeps its own believable light (`top-landing`, `stair-mid`, day and night).
4. The lower lounge is warm and well dressed — sun patches across travertine, oak baffles, the communal table under pendants, the sofa group, the boards — and it keeps its full rear view under the new floor (`lower-mid-wide`, `lower-back-seat`).
5. One movement controller owns walking, the stair ramp and seat glides across both floors, gate-verified (walk 56/56, layered elevation 7/7) and honouring reduced motion.
6. The budgets are disciplined: pier + instruments is 14 draws, 138,922 triangles and 23.96 MiB with no added light, and the room shader adds 20 uniform vectors.
7. Earlier owner feedback is visibly respected: proximity-only instrument controls, Night Watch that keeps circulation lit, and the 36 / 26 mm concealed-top offsets that cured the coplanar floor and tread flicker.

### Weaknesses

1. The upper room is nearly empty: about 130 m² of floor holds two chairs, two side tables, one rug and a credenza, so it reads as a long glass corridor rather than a lounge (`top-landing`, `upper-wide-from-landing`, `upper-east`).
2. From the upper runway seat the bottom ~40 % of the view is a black slab: the lower roof is the lower ceiling deck's bare top, shaded as an interior surface that receives neither sun nor sky (`upper-front-seat`, all three times of day).
3. The pier bar's signature backlit onyx is invisible: `pierBar` maps the classic back wall (z 14.2) to x = 11.3, 10 cm inside the right wall's plaster (inner face 11.2), so the onyx panel (x 11.27–11.29) is buried and the bottles stand in front of grey plaster (`bar` vs `before-classic/classic-lower-mid-wide-day.png`; `lib/fly/lounge/room-build.js:940`).
4. Night upstairs is a uniform dim brown with one bright diffuser line: no warm pools, no focal light and little of the room in the glass (`upper-wide-from-landing-night`, `upper-east-night`, `upper-west-night` in `before-safebump/`).
5. Non-finite pixels: on SwiftShader the room shader's derivative bump normalizes a zero (or non-finite) vector on some wood and stone quads (`room-shading.js:432`), and the interior probe captures those NaNs, so night glass reflections are corrupted in both variants (27,416 non-finite pixels from the window seat). A guarded normalize removes all but 1–2 pixels on one pose (`stair-side`: the metal bucket, not from the interior lighting terms — a second, rarer source, perhaps a smoothed normal interpolating through zero). Whether the owner's GPU hits the same quads is unknown; the code has no guard either way.
6. The interior probe is captured with the live camera's view-to-room matrix (`room-shading.js:909`, `lounge-probe.js:61`), so its contents are lit with rotated normals and depend on where the observer happened to be when it refreshed (the harness had to recapture per pose to be deterministic).
7. Stair details alias: a line of single-pixel sparkles runs along the y = 4.6 seam where the lower wall strip meets the upper stairwell wall (both rounded boxes on the x = −11.2 plane), the 18 × 4 mm under-handrail light strip renders as a dotted line (`room-build.js:1082`), and reeded oak around the stairwell sparkles under the night practicals (`upper-landing-down` day/night, `stair-foot-night`).
8. The stair's long side is a pale stack of 28 separate stone blocks with a joint every tread: a 7.5 m blank mass facing the lower lounge rather than a crafted stringer (`stair-side`; `room-build.js:976`).
9. Upstairs offers almost nothing to do: two seats and two binocular rails — no listening window, nothing to look at closely, no story (no books, models, charts or coffee).
10. Sound and motion ignore the second level: one travertine scuff plays on oak, rug and treads alike (`airport-audio.js:493`); stair footfalls follow the 0.72 m flat stride, about 2.3 treads per step (`lounge-walk-runtime.js:332`); the room tone is identical on both floors.
11. The new surfaces have no surface detail: the upper floor's `SURF.UPPER_FLOOR` and the planked upper ceiling's `SURF.PLANKS` have no shader branch, so both render as flat stained wood without boards or joints.
12. There is no planting upstairs (the pier even removed the left olive downstairs), and the only solid wall upstairs, the reeded stairwell wall, carries nothing.
13. The bounce term ramps down toward the back of the room (`room-shading.js:653`), so the upper room — glazed on three sides — gets 0.7–0.9× the bounce of the lower front by day.

### Other findings and risks

- The stairwell enclosure's outer east return (beyond the upper front glazing, x −8.8, z 3.2–8) is interior-shaded and reads as a black monolith in upper views (`upper-west-golden`).
- The emissive frosted-door shader computes `pow(negative, 2.0)` (`room-shading.js:865`), undefined in GLSL; SwiftShader happens to return the square.
- Bronze stool rims at the bar show bright single-pixel glints from the pendant spots (`bar`), the same family as weakness 7.
- Headroom: pier + instruments 138,922 of the sanctioned 160,000 triangles; 30 / 32 practicals; 40 / 48 shadow boxes; 23.96 / 24 MiB textures (no new allocations possible); 14 / 14 draws; 20 room uniform vectors (gate limit 32).

## Plan

### Lanes

| Lane | Owns | Goal |
|---|---|---|
| FURNISH | `lib/fly/lounge/room-build.js` (except the SURF/GLOW objects at its top), `geometry-kit.js`, `room-plan.js`, `room-ao.js`, the `LOUNGE_PIER_ROOM` and `VANTAGE.pier` blocks of `lib/fly/observation-config.js`, `public/models/lounge-ao-pier-v1.bin` (regenerated), `room-walk.mjs` only if new seats strictly need it, extensions of `verify-lounge-upper.mjs` / `verify-lounge-pier.mjs` / `verify-airport-lounge.mjs` | A full, characterful upper room and stair; the geometric defects fixed (W 1, 2, 3, 7, 8, 12) |
| LIGHT | `room-shading.js`, `room-textures.js`, `lounge-glass.js`, `lounge-probe.js`, `lounge-steam.js`, `lounge-board.js`, `room-prewarm.js`, `components/fly/AirportLounge.jsx`, `lib/fly/airport-lounge.js` (the steam wiring), the per-frame feed in `scripts/lounge-room-render/harness.js`; may APPEND codes to SURF/GLOW at the top of `room-build.js` | Correct, NaN-free shading; a convincing mood per floor and time of day (W 2, 4, 5, 6, 7, 11, 13) |
| LIFE | `lib/fly/lounge-walk-runtime.js`, `room-elevation.mjs` (only if needed), the lounge cue section of `lib/fly/airport-audio.js`, `observatory-audio.mjs` / `observatory-stations.mjs` / `observatory-instruments.js` / `observatory-model.mjs`, `components/fly/ObservatoryInstruments.jsx`, `lib/fly/lounge-observatory-runtime.js`, `components/fly/hud/lounge/**`, the `LOUNGE_FEEL` block at the end of `observation-config.js`, their tests | Real capabilities and feel on both floors (W 9, 10) |

Order: FURNISH and LIGHT start together; LIFE starts when one of them
finishes (four cores). Each lane pushes to `main` itself when its gates pass,
rebasing on whatever already landed. Shared files: `scripts/lounge-pass-gates.mjs`
(append one line per new gate), `scripts/lounge-room-render/poses.mjs`
(append-only; prefer `--at` for ad-hoc poses).

### Budgets

| Resource | Today (pier + instruments) | Ceiling | FURNISH | LIGHT | LIFE |
|---|---|---|---|---|---|
| Draws | 14 | 14 | 0 | 0 | 0 |
| Triangles | 138,922 | 160,000 (sanctioned); plan 158,500 | ≤ +17,500 | ≤ +500 | ≤ +1,500 |
| Practicals | 30 | 32 (table size fixed) | the 2 free | 0 net (consolidate to add) | 0 |
| Shadow boxes | 40 | 48 (table size fixed) | the 8 free | 0 | 0 |
| Textures | 23.96 MiB | 24 MiB | none new | none new (repaint content only) | none new (repaint the instrument atlas only) |
| Room uniform vectors | 20 | 32 (gate) | — | ≤ 24 | — |
| Lights | 0 added | 0 | 0 | 0 | 0 |

The plan total (138,922 + 17,500 + 500 + 1,500 = 158,422) sits under the
plan cap of 158,500 (`PLAN_TRIANGLES` in `upper-dressing.mjs`), which
`verify-lounge-second-level.mjs` enforces; the sanctioned ceiling of 160,000
is enforced by `verify-observatory-presentation.mjs` (pier) and
`verify-airport-lounge.mjs --pier`. A lane that frees fixtures or triangles by
consolidation records it here.

- FURNISH consolidation: the two existing upper chairs (`upper-front`,
  `upper-back`) now cast two sun-shadow boxes each instead of three (the seat
  and arm boxes merged into one with the same footprint, `shadowChairPair` in
  `room-build.js`), freeing 2 rows. FURNISH then used 9 of the 10 free rows
  (pier 47 / 48 shadow boxes), both free practicals (32 / 32) and +17,044
  room triangles (pier room buckets 131,232 → 148,276).
- LIFE: +1,010 instrument triangles for the upstairs listening window (one
  more instrument of the lower windows' build; pier instruments 7,656 →
  8,666, room + instruments 157,018 / plan 158,500). Its face is painted into
  the existing 1024 × 512 atlas's free band (x 0–256, y 160–256). No draws,
  textures, lights, practicals or shadow boxes; nothing else in the lane adds
  geometry.

## W0 contracts (landed)

1. **Pier triangle ceiling 160,000** — `scripts/verify-airport-lounge.mjs`
   (`--pier` now uses `LOUNGE_BUDGETS.room` like classic) and
   `scripts/verify-observatory-presentation.mjs` (pier 160,000, classic keeps
   140,000), inline-commented.
2. **Surface codes and glow aliases** — appended at the top of
   `lib/fly/lounge/room-build.js`: `SURF.CHART = 18` (stair-wall chart
   prints), `SURF.SPINES = 19` (book spines), `SURF.EXTERIOR = 20` (surfaces
   outside the glazing); `GLOW.READING = 6` and `GLOW.DISPLAY = 6`, aliases of
   `GLOW.LAMP` until LIGHT gives them channels of their own (geometry and
   practicals always use the names). `room-shading.js` exports
   `SURF_FALLBACK` (each unimplemented code renders exactly as PLAIN) and
   emits `SURF_UPPER_FLOOR / SURF_CHART / SURF_SPINES / SURF_EXTERIOR`
   defines into the **pier program only**; the classic program source is
   unchanged.
3. **Room build outputs** — `buildLoungeRoom()` returns `dressing` (the
   contracted DRESSING ids actually built; empty today) and `steamSources`
   (every steaming cup, hero first; `practicals.steam` unchanged);
   `roomDressing(variant)` reads them like `roomBlockers()`. Behaviour gates
   on `roomDressing('pier')`, so no lane ever points at empty floor.
4. **The frozen dressing contract** — `lib/fly/lounge/upper-dressing.mjs`:
   `DRESSING` ids; `CUPS` (two on the credenza, one at the reading nook) with
   `steamPoint()` and `STEAM_R`; `CREDENZA`; `CHART_PANELS` (four level print
   faces on the stair wall at x = −11.16, clear of the handrail by ≥ 0.25 m);
   `FOOTSTEP_SURFACES` + `surfaceAt(floorId, x, z, built)` (stone / oak / rug /
   tread; existing rugs mirrored, the nook rug gated on its id);
   `INSPECTABLES` (model aircraft, stair charts, library, coffee station: id,
   label, prompt, first-party text, focus, bounds, reach, floor);
   `RESERVED_STATIONS` (`upper-front-listen` at (4.48, 5.72, 8.3));
   `KEEP_CLEAR` (stair run-in, top landing and its exit, the upper spine,
   existing seat approaches, rails, the reserved station, and height-limited
   corridors under the six upper standing sightlines); `PLAN_TRIANGLES`.
5. **Contract gate** — `scripts/verify-lounge-second-level.mjs` (9 checks,
   in the gate suite): contract shape, plan budgets, classic invariance,
   codes/fallbacks/pier-only defines, keep-clear vs every built blocker, rugs
   where declared (BVH casts), steam ↔ built cups, built inspectables have
   geometry inside their bounds, built chart faces carry `SURF.CHART`, the
   reserved station's position.
6. **LIFE constants block** — `LOUNGE_FEEL = Object.freeze({})` pre-seeded at
   the end of `lib/fly/observation-config.js`.

### The upper room plan (room-local metres, upper floor y = 4.6)

- West (x −8.6 … −4.4): a reading nook facing the front glass — new vantage
  seat `upper-nook` at (−6.5, 9.05), side table (−5.72, 8.93) with the nook
  cup, a floor reading lamp (one practical, `GLOW.READING`), the nook rug
  x −8.3…−4.8, z 8.35…10.35.
- Behind the top landing: the library on the west wall (x −11.2…−10.84,
  z 12.85…14.05, to y 6.8) — the first thing you see at the head of the
  stair — and a fig in the back-west corner (≈ −6.9, 13.55).
- Centre: unchanged (the two seats, the rug, the rails); the east-west spine
  z 10.55…11.4 stays clear.
- East: the credenza becomes a coffee station (two steaming cups); a slim
  console of three desk model aircraft against the east glazing
  (x 10.35…10.85, z 9.9…11.9); an olive (or smaller plant) in the back-east
  corner (≈ 10.25, 13.25); optionally a rear-facing seat `upper-east` at
  (6.72, 12.92).
- Stair: four framed chart prints stepping up the west wall; a continuous
  stringer on the plinth's long side; a trim over the y = 4.6 wall seam; a
  visible diffuser for the handrail light.
- Lower roof (seen from upstairs): a ballast/membrane finish with low planters,
  lit as an exterior surface.

## Harness

`scripts/render-lounge-room.cjs` (driver) + `scripts/lounge-room-render/`
(`index.html`, `harness.js`, `poses.mjs`). It serves the repository over a
local http server (importmap: `three` → `node_modules`; extensionless
specifiers resolve to `.js`/`.mjs`; `/models/…` falls back to `public/`),
builds the real room through `createAirportLounge({variant})` with the real
surface-map bake and AO bake, the real probe, glass, steam, boards and (pier
default) instruments, and feeds it what `AirportLounge.jsx` feeds it from a
cinema environment computed by the app's own `evaluateCinemaEnvironment` for
a fixed sun (day el 40°, golden el 5°, night el −24°). It fails non-zero on
any page error, shader compile error, console error or failed request.

```
node scripts/render-lounge-room.cjs --list
node scripts/render-lounge-room.cjs --variant pier --sheet --out /home/user/skyloom/.graphics-review/lounge-second-level/<dir>
node scripts/render-lounge-room.cjs --variant pier --poses upper-east,upper-west --tod night
node scripts/render-lounge-room.cjs --variant classic --poses lower-front-seat,lower-mid-wide --tod day --sheet --out …
node scripts/render-lounge-room.cjs --at "nook:-6.0,6.25,10.4:-6.5,5.4,8.4" --tod golden   # ad-hoc eye:target
node scripts/render-lounge-room.cjs --flags SAFE_BUMP,NIGHT_WATCH                         # diagnostics / switches
```

Poses: lower-front-seat, lower-back-seat, lower-mid-wide, bar, stair-side,
stair-foot, stair-mid, top-landing, upper-landing-down,
upper-wide-from-landing, upper-front-seat, upper-back-seat, upper-east,
upper-west (classic: lower-front-seat, lower-mid-wide, bar). Seated poses use
the exact VANTAGE eye, look centre and default pitch; standing eyes are 1.65 m
above their floor (the stair ramp on the stair). Flags: `LOUNGE_INSTRUMENTS`
(on by default for the pier, `-LOUNGE_INSTRUMENTS` off; off for classic),
`NIGHT_WATCH`, `NO_BLOOM`, `NO_SMAA`, `NO_PROBE`, `SAFE_BUMP` (diagnostic).
Output: `<variant>-<pose>-<tod>.png`, `stats-<variant>.json` (per pose: scene
pass draws/triangles, every-pass draws, non-finite pixel count, exposure,
shading state), and with `--sheet` labelled contact sheets. The full pier set
(42 renders) takes about 2.5 minutes here.

What it approximates (say so when citing it): a procedural sky gradient
(background + PMREM environment) and one procedural ground plane 18 m below
the floor instead of the world; one harness DirectionalLight and
HemisphereLight carrying the app's sun/fill values instead of the CSM cascades
(the room masks its key analytically, so the interior light is the same);
three's UnrealBloomPass + OutputPass (AgX, exposure = env exposure × 2^lounge
stops) + SMAAPass instead of the app's chain — no N8AO, no aerial
perspective, no immersive clouds, no grade or vignette, no TRUE_SCALE
anisotropy, no live exterior, HUD or traffic (the boards show "QUIET SKIES").
The probe is recaptured for every pose (the app's probe content depends on
the camera at capture time — weakness 6). Non-finite pixels are counted and
painted magenta before the bloom. Determinism: repeat renders match exactly
on the pier poses tried; the classic `lower-mid-wide` pose varies by a few
pixels run to run (6 and 2 of 921,600 measured). Draw and triangle counts are exact; times mean nothing.
Steady scene pass: pier 16 draws / 138,936 triangles (room + instruments 14 /
138,922, plus the harness sky and ground); classic 14 / 120,212.

## Gate suite

```
node --no-warnings scripts/lounge-pass-gates.mjs
node --no-warnings scripts/lounge-pass-gates.mjs verify-my-lane.mjs "verify-x.mjs --flag"
node --no-warnings scripts/lounge-pass-gates.mjs --only verify-lounge-upper.mjs,verify-lounge-second-level.mjs
```

Runs the 26 standard gates sequentially (the 25 lounge, airport, flag,
golden, attribution and import gates the pass depends on, plus
`verify-lounge-second-level.mjs`), prints a pass/fail table, asserts the
classic invariant line (12 draws · 120198 triangles · 21.9 MiB · 28
practicals) and exits non-zero on any failure (about 60 s here). Extra
arguments add gates. Production build (integrator only):
`FLY_BUILD_DIR=.next-pass NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build --webpack`, then `rm -rf .next-pass`.

## Lane briefs

The three briefs below are handed verbatim to the lane agents (who also
receive the pass's shared context: hard constraints, environment, records
culture, git rules).

### FURNISH — geometry and dressing

**Goal.** Make the upper observation room and the stair genuinely full, warm
and characterful — a lived-in spotter's room with an aviation story — while
keeping circulation and seated sightlines clear, and fix the geometric
defects the audit found. Pier variant only.

**Files you own.** `lib/fly/lounge/room-build.js` (except the SURF/GLOW
objects at its top: LIGHT may append codes there; use them by name),
`lib/fly/lounge/geometry-kit.js`, `lib/fly/lounge/room-plan.js`,
`lib/fly/lounge/room-ao.js`, the `LOUNGE_PIER_ROOM` and `VANTAGE.pier`
blocks of `lib/fly/observation-config.js`,
`public/models/lounge-ao-pier-v1.bin` (regenerate with
`node scripts/build-lounge-ao.mjs --pier` after every geometry change),
`lib/fly/lounge/room-walk.mjs` only if new seats strictly require it, and
extensions of `scripts/verify-lounge-upper.mjs`, `verify-lounge-pier.mjs`,
`verify-airport-lounge.mjs` (or a new gate file of your own, appended to
`STANDARD_GATES` in `scripts/lounge-pass-gates.mjs`). Do not edit the frozen
contract `lib/fly/lounge/upper-dressing.mjs` or
`scripts/verify-lounge-second-level.mjs`; if a contract value is genuinely
wrong, stop and report it instead.

**Contracts you use (W0, on main).** `upper-dressing.mjs`: `DRESSING`,
`CUPS` + `steamPoint()` + `STEAM_R`, `CREDENZA`, `CHART_PANELS`,
`FOOTSTEP_SURFACES` (the nook rug rect), `INSPECTABLES` (your geometry for
each lies inside its `bounds`), `RESERVED_STATIONS` and `KEEP_CLEAR` (never
build there). In `buildLoungeRoom()`: push each contracted piece's DRESSING id
into `dressing` from the function that builds it (pier only), and push
`{ at: steamPoint(cup), r: STEAM_R }` into `steamSources` for each cup you
build. Surface codes `SURF.CHART`, `SURF.SPINES`, `SURF.EXTERIOR` and glow
groups `GLOW.READING`, `GLOW.DISPLAY` — always by name; until LIGHT
implements them they render as PLAIN / LAMP, which is expected.

**Budget.** Room triangles ≤ +17,500 over today's 138,922 (room +
instruments). The 2 free practicals and the 8 free shadow boxes are yours
(you may consolidate existing pier ones to free more if visually equivalent;
record it). No new draws (merge into stone, wood, metal, leather, fabric,
plaster, small, foliage, emissive), no new textures, no new lights. Measure
pieces: a seg 1 `softBox` is 108 triangles, a seg 3 cushion ~970, an olive
tree ~3.6k, a fig ~3.1k; add a 12-triangle `block()` box to
`geometry-kit.js` for books and small parts.

**Classic invariance.** Classic geometry, its vertex order and its AO bake
must not change (the suite asserts 12 draws · 120198 triangles · 21.9 MiB · 28
practicals). Never refactor a helper the classic room uses in a way that
reorders or alters its parts (do not extract `heroProps`' cup for reuse;
write a new pier-only helper). Gate every addition on `plan.upper` /
`plan.backGlass`.

**Items, in priority order.**

1. **Unbury the pier bar's back bar.** WHY: weakness 3 — the onyx panel
   (x 11.27–11.29) and the cabinet back sit inside the right wall's plaster
   (inner face 11.2) because `pierBar` (`room-build.js:940`) maps the classic
   back wall to x = 11.3. HOW: move the back-bar assembly so its wall plane
   lands on 11.2 with the onyx ~20 mm in front of the plaster — either shift
   only the back bar inside `pierBar`, or move the whole bar
   (`LOUNGE_PIER_ROOM.bar.counterX` 8.55 → 8.45); blockers, shadow boxes,
   floor AO and the bar's practicals must move with it (they already ride the
   same transform). BUDGET: 0. ACCEPT: harness `bar` day/night shows the warm
   onyx glow behind the bottles; walk, pier and vantage gates green.
2. **Dress the upper room** (weaknesses 1, 9, 12) per the plan in "The upper
   room plan" above, all on the upper floor (y 4.6):
   - *West reading nook:* new vantage seat `upper-nook` — chair at
     (−6.5, 9.05), rot ≈ −0.12 (turned slightly toward the room's centre),
     `loungeChair` with a lighter cushion (seg/div 2) in a warm fabric; side
     table (−5.72, 8.93) top 0.57 carrying `CUP_NOOK` exactly at its base and
     a paperback; a brass floor reading lamp at ≈ (−7.4, 9.5) with one
     practical (spot, `GLOW.READING`, warm, power ≤ 0.9, range ≤ 4) and an
     emissive shade on `GLOW.READING`; the nook rug exactly at x −8.3…−4.8,
     z 8.35…10.35 built like the existing rugs (border + field slabs, same
     thicknesses), pushing `DRESSING.NOOK_RUG`. Add the seat to
     `VANTAGE.pier` (`floorId 'upper'`, `floorY 4.6`, eye from `seatEye`,
     a free `approach`, look centre = its rot) and its chair blocker with
     `seatId`.
   - *Library behind the top landing* (`DRESSING.LIBRARY`): an oak bookcase
     on the west wall x −11.2…−10.84, z 12.85…14.05, up to y 6.8, with
     books as 12-triangle boxes in varied heights and cover colours (a few
     lying flat), bookends and a small framed photograph; spines on
     `SURF.SPINES` (vertex colour = cover colour). It faces you as you arrive
     at the head of the stair. The top landing and its exit stay clear.
   - *Plants:* a fiddle-leaf fig in the back-west corner (≈ −6.9, 13.55) and
     an olive (or a smaller potted plant if the budget binds) in the
     back-east corner (≈ 10.25, 13.25), reusing `figTree` / `oliveTree` /
     `planter` with their round blockers (canopy radius 0.8).
   - *Coffee station* (`DRESSING.COFFEE_STATION`) on the existing credenza
     (`CREDENZA`, top 5.37): a compact espresso machine (stainless and black,
     ~0.5 × 0.45 × 0.4 m) at the credenza's south end (z ≈ 11.55–12.05),
     `CUP_STATION_A` and `CUP_STATION_B` on saucers at their exact bases, a
     short stack of cups, a sugar bowl, a small tray; an indicator light on
     the machine may be a tiny emissive part on `GLOW.BAR` (no practical).
   - *Model aircraft display* (`DRESSING.MODEL_DISPLAY`): a slim oak console
     against the east glazing (x 10.35…10.85, z 9.9…11.9, top ≈ 0.78 m) with
     three first-party procedural desk models on angled stands — a high-wing
     piston single, a twin-jet airliner, a four-engine long-hauler (spans
     0.35–0.55 m; fuselage lathe ≤ 12 segments, thin prism wings and tails,
     ≤ ~900 triangles each), white/grey with one restrained cheat-line colour
     in vertex colours — all inside `INSPECTABLES['model-display'].bounds`.
     They are scenery, never contacts. Your second practical may be a shelf
     or picture light here or over the library (line, `GLOW.DISPLAY`).
   - *Optional, if budget remains:* a rear-facing seat `upper-east` at
     (6.72, 12.92) rot π with a side table at (7.5, 13.04) and approach
     (7.58, 12.4) (seat-menu label e.g. "Upper rear corner"); oak ceiling
     beams across the upper room on the mullion pitch (no face within 20 mm
     of the roof underside's plane); a throw cushion on an upper chair.
   BUDGET: the bulk of your 17,500. ACCEPT: harness `upper-wide-from-landing`,
   `top-landing`, `upper-east`, `upper-west`, `upper-back-seat` at day,
   golden and night read as a furnished, warm room with clear walkways (use
   `--flags SAFE_BUMP` until LIGHT's NaN fix is on main);
   `verify-lounge-second-level.mjs` green with `dressing built [...]` listing
   your ids; walk / upper / pier / vantage / observatory gates green (new
   seats reachable, seated sightlines through the glass, head clear of the
   chair).
3. **The lower roof seen from upstairs** (`DRESSING.ROOF_FINISH`; weakness
   2). HOW: over the deck top between the lower roof glass and the upper front
   glazing (z ≈ 2.6…8.0, x −8.8…11.2, around the stairwell enclosure) build a
   single membrane/ballast slab on `SURF.EXTERIOR` (top ≥ 4.68, i.e. ≥ 20 mm
   above the deck's 4.66; in the plaster bucket so it skips per-vertex AO, or
   extend `skipsVertexAO`), a slightly raised gravel border, a coping line at
   the front edge and a few long, low planter troughs with grasses (foliage
   cards) set back from the glazing. Nothing may rise into the upper seats'
   view of the runway (keep tops ≤ ~4.79 within 1 m of z 8 and lower further
   out). If you split the stairwell enclosure's east return into an inner
   and an outer skin (≥ 20 mm apart), put the outer one on `SURF.EXTERIOR`.
   Until LIGHT implements `SURF.EXTERIOR` this renders dark, as today — that
   is expected. ACCEPT: `upper-front-seat` shows a composed roof; lower-room
   poses unchanged.
4. **Chart prints on the stair wall** (`DRESSING.CHART_WALL`; weakness 12).
   Four level frames at `CHART_PANELS` (print faces on x = −11.16, centres and
   sizes exact), oak or bronze frames ≤ 60 mm wide with a mat; each print face
   a thin panel on `SURF.CHART` in a warm paper colour (`#ece4d2`). No face
   within 20 mm of being coplanar with the wall (x −11.2) or the lower wall's
   dado trim (face x −11.185 at y 3.29–3.31). ACCEPT: `stair-foot`,
   `stair-mid`, `stair-side` show the series stepping up with the rake; the
   contract gate finds `SURF.CHART` on each face.
5. **Stair polish** (weaknesses 7, 8). (a) Clad the plinth's exposed east face
   with one continuous stringer along the rake (oak or travertine, ≥ 20 mm
   proud, shadow-gap base), keeping the 26 mm tread / structure separation and
   the 36 mm floor offset. (b) Cover the y = 4.6 seam on the stair wall with a
   continuous trim (≥ 30 mm tall, ≥ 20 mm proud) or make that wall one
   surface for the pier. (c) Give the under-handrail light (`room-build.js:1082`)
   a visible diffuser ≥ 12 mm tall inside a bronze channel, same light
   position and channel. ACCEPT: `upper-landing-down` day/night has no dotted
   line at the seam or the rail; `stair-side` shows one stringer; extend
   `verify-lounge-upper.mjs`'s finish/structure separation to the new stacked
   faces.
6. **AO.** Regenerate the pier bake after every geometry change; the classic
   bake stays untouched.
7. **Gates.** Extend `verify-lounge-upper.mjs` (new seats' sightlines and head
   clearance; library, console and plants never cross the six standing
   sightlines; ≥ 20 mm separation for every new stacked face) and
   `verify-lounge-pier.mjs` (seat count, approach routes).

**Non-goals.** Shader or material code (LIGHT); audio, HUD or behaviour
(LIFE); any change to the classic room; exterior airport changes; new draws,
textures or lights; edits to the frozen contract; instrument geometry (LIFE);
downloaded assets.

**Verify and push.** `node --no-warnings scripts/lounge-pass-gates.mjs`
green with the classic invariant line; render
`--variant pier --sheet --flags SAFE_BUMP --out /home/user/skyloom/.graphics-review/lounge-second-level/furnish-after`
(and without `SAFE_BUMP` once LIGHT's NaN fix is on main) and LOOK at every
pose; render the classic reference and compare with `before-classic/`
(≤ ~11 px noise); `npx eslint` on changed files; `git diff --check`; commit;
`git fetch`, rebase on `main`, rerun the suite, push.

### LIGHT — light, materials, glass, atmosphere

**Goal.** Give each floor and time of day a convincing, calm mood — sun and
sky where they belong, warm pools after dark, believable glass — and make the
room shader robust: no NaNs, no banding, no sparkle. Pier variant only.

**Files you own.** `lib/fly/lounge/room-shading.js`, `room-textures.js`,
`lounge-glass.js`, `lounge-probe.js`, `lounge-steam.js`, `lounge-board.js`,
`room-prewarm.js`, `components/fly/AirportLounge.jsx`,
`lib/fly/airport-lounge.js` (the steam wiring), and the per-frame feed in
`scripts/lounge-room-render/harness.js` (`render()`: mirror every change you
make to `AirportLounge.jsx`'s feed so the harness stays a faithful room-only
replica). You may APPEND new codes to the SURF / GLOW objects at the top of
`room-build.js` (re-pointing the `GLOW.READING` / `GLOW.DISPLAY` aliases to
new channels is yours).

**Contracts you use.** `SURF.CHART`, `SURF.SPINES`, `SURF.EXTERIOR`,
`SURF.UPPER_FLOOR` (defines already emitted into the pier program;
`SURF_FALLBACK` documents today's fallback — update it as you implement),
`GLOW.READING` / `GLOW.DISPLAY`, `room.steamSources`, and
`upper-dressing.mjs` `CHART_PANELS` (rects for the chart shader).

**Budget.** Triangles ≤ +500 (steam cards, motes). Room uniform vectors ≤ 24
(gate prints 20; limit 32). No new textures (repaint the content of an
existing canvas/procedural texture at the same size only), no new draws
(steam and motes inside the steam or glass overlay draw), no new lights, no
new practicals except by consolidating existing ones (net zero; record it).
The room program must not fork at runtime: new features are compile-time
pier defines plus uniforms, never per-frame define changes; keep the
`onBeforeCompile` / `customProgramCacheKey` chains and the
`lights_pars_begin` / `lights_fragment_begin` anchors; bump the pier
program-key tag when the pier shader changes; prewarm and program-lifecycle
gates stay green.

**Classic invariance.** Classic program text and pixels stay as they are
(`verify-lounge-second-level.mjs` checks the classic source carries no pier
defines; the harness classic reference must match `before-classic/` within
noise). Put every change behind the pier path (`opts.backGlazed`, a variant
argument for the emissive material or probe). Classic exposure to weakness 5
is recorded as an owner follow-up, not fixed here.

**Items, in priority order.**

1. **No non-finite pixels** (weakness 5; do this first — honest evaluation
   depends on it). Guard `lgBump`'s normalize (`room-shading.js:432`: fall
   back to `surfNorm` when the vector is zero or non-finite) and rewrite the
   emissive door's `pow(negative, 2.0)` (`:865`) as a square — both on the
   pier path only. Then find the second, rarer source: with `SAFE_BUMP` the
   `stair-side` pose still shows 1–2 non-finite pixels from the metal bucket,
   and disabling the key, practicals, reflections and specular AA does not
   remove them (guard the normalizations of `lgN` / the shading normal).
   ACCEPT: every pier pose × day/golden/night renders with
   `non-finite px 0` WITHOUT `SAFE_BUMP`; the harness's magenta is gone from
   the glass.
2. **Correct probe** (weakness 6). During `InteriorProbe.capture`, set
   `uLoungeViewToRoom` (and `uLoungeEye` = the probe eye) for each face, and
   restore them afterwards (a per-face callback or an `onBeforeRender` on the
   room meshes), pier path only. ACCEPT: night reflections in
   `lower-front-seat`, `lower-back-seat`, `upper-back-seat` place the room's
   warm pools plausibly; they no longer depend on which pose rendered first
   (you can then drop the harness's per-pose recapture, or keep it).
3. **Exterior surfaces** (weakness 2). Implement `SURF.EXTERIOR`: key =
   N·L with a simple occlusion by the upper room box and stairwell enclosure
   (or none), sky = upper-hemisphere irradiance, reflections = the IBL; no
   interior bounce, no practicals. Also treat the existing deck plate's
   up-facing top outside the upper room (y > 4.62, z < 8.0, n.y > 0.7) as
   exterior on the pier path, so the roof is lit even before FURNISH's finish
   lands. ACCEPT: `upper-front-seat` day/golden shows a lit roof instead of a
   black band; night dim and calm.
4. **A mood per floor and time of day** (weaknesses 4, 13). Day: make the
   bounce floor-aware for the pier (the upper room is glazed on three sides;
   today's z-ramp at `:653` gives it 0.7–0.9×). Night: warm islands rather than
   a uniform dim brown — give `GLOW.READING` / `GLOW.DISPLAY` their own channels
   if needed (grow `uLoungeGlow` within the uniform budget, add `CHANNEL`
   curves), retune the upper slots, table lamps and new fixtures so the nook,
   the seats, the display and the coffee station read as pools with legible
   circulation between; Night Watch dims the decorative ones together and
   keeps the circulation floor; glass reflections upstairs carry the room.
   Golden: keep the long sun streaks. ACCEPT: `upper-wide-from-landing`,
   `upper-west`, `upper-east`, `top-landing` night vs `before-safebump/`: warm
   pools, legible circulation, no banding; day: brighter, airier upper room;
   lower-room moods unchanged unless better.
5. **Surface detail** (weakness 11; pier-only branches). `SURF.UPPER_FLOOR`:
   oak boards (~0.18 m wide, random lengths, staggered joints), drawn and
   filtered like the travertine joints (fwidth-based, faded before they go
   sub-pixel — no moiré at grazing angles); `SURF.PLANKS` on the upper roof
   underside (pier path; the classic communal table keeps its look);
   `SURF.CHART` from `CHART_PANELS` (`kind` / `seed`): a muted sectional
   (contour tints, water, airways, a compass rose) or an approach plate (plan
   and profile), every line width filtered; `SURF.SPINES`: per-book bands and
   title blocks from the vertex colour and a position hash, filtered.
6. **Steam on the new cups.** `createLoungeSteam` takes `room.steamSources`
   (7 cards per source, 14 triangles each, same look), wired in
   `lib/fly/airport-lounge.js`; no steam where the room has no cup.
   Optional, with restraint: faint dust motes in the sun shafts upstairs,
   inside the steam or glass draw, only where the key falls through the
   upper glazing, static under reduced motion, never flickering.
7. **Specular sparkle** (weakness 7, other findings). Extend the geometric
   specular anti-aliasing so practical highlights on the reeded oak around
   the stairwell and on the bar's bronze stool rims do not sparkle (fade the
   relief before it aliases; derive roughness from relief variance), pier
   path. ACCEPT: `stair-foot` night and `bar` night free of single-pixel
   glints; compare two `--at` poses 2 cm apart for shimmer.
8. **Harness parity.** Keep `scripts/lounge-room-render/harness.js` in step
   with `AirportLounge.jsx`.

**Non-goals.** Geometry changes in room buckets (FURNISH); audio, HUD,
behaviour (LIFE); raising `MAX_LIGHTS` / `MAX_SHADOWS`; new textures, draws or
lights; classic-room changes; exterior world shading outside the room.

**Verify and push.** The gate suite green (classic invariant line;
`verify-airport-lounge` uniform vectors ≤ 24); render the full pier set
without `SAFE_BUMP` into
`/home/user/skyloom/.graphics-review/lounge-second-level/light-after` with
`--sheet` and LOOK at every pose and time of day (and `NIGHT_WATCH` at
night); `non-finite px 0` everywhere; classic reference matches
`before-classic/` within noise; `npx eslint`; `git diff --check`; commit;
fetch, rebase, rerun, push.

### LIFE — capabilities, feel, motion, sound, HUD

**Goal.** Give the second level real things to do and a physical feel —
surface-true steps, a stair you can feel, a quieter upper room, objects worth
a closer look, a listening window upstairs — with restraint and calm UI. Pier
variant (and the instruments flag for the station) only.

**Files you own.** `lib/fly/lounge-walk-runtime.js`,
`lib/fly/lounge/room-elevation.mjs` (only if needed), the lounge cue section
of `lib/fly/airport-audio.js`, `lib/fly/lounge/observatory-audio.mjs`,
`observatory-stations.mjs`, `observatory-instruments.js`,
`observatory-model.mjs`, `components/fly/ObservatoryInstruments.jsx`,
`lib/fly/lounge-observatory-runtime.js`, `components/fly/hud/lounge/**`, the
`LOUNGE_FEEL` block at the end of `lib/fly/observation-config.js`, and their
tests.

**Contracts you use.** `upper-dressing.mjs`: `surfaceAt()` /
`FOOTSTEP_SURFACES`, `INSPECTABLES`, `RESERVED_STATIONS`, `DRESSING`; and
`roomDressing('pier')` from `room-build.js` — act on a contracted piece only
when its id is built (whichever lane lands first, nothing points at empty
floor).

**Budget.** Triangles ≤ +1,500 (instrument geometry). No new textures
(repaint the existing 1024 × 512 instrument atlas content only), no new draws
(instrument bodies and displays), no new lights. No generated speech,
conversations or announcements; no rewards (Explorer, passport, contracts)
from anything in the lounge; desktop only; reduced motion respected (no bob or
sway; veil cuts); keyboard access works for everything you add.

**Classic invariance.** The classic room's walk, steps, audio and HUD stay
byte-for-byte; gate every new behaviour on the pier variant (the walk runtime's
`variantOf()`), the upper station also on `LOUNGE_INSTRUMENTS`.

**Items, in priority order.**

1. **Surface-aware footsteps** (weakness 10). `cue('step', { surface })` with
   distinct procedural timbres: stone (today's scuff, unchanged), oak (a
   lower, warmer knock with a short wooden resonance ~180–260 Hz), rug
   (muffled, low-passed, quieter), tread (oak with a hollow riser resonance,
   slightly brighter). Surface from `surfaceAt(walk.floorId, x, z,
   roomDressing('pier'))`. Gains stay on the room bus around
   `WALK.footstepGain`. ACCEPT: `verify-airport-audio.mjs` extended (each
   surface builds and disposes its nodes; the classic step is unchanged).
2. **Stair cadence and motion** (weakness 10). On the stairs layer one
   footfall per tread pair (0.54 m horizontal) instead of the 0.72 m flat
   stride, and a small camera-only stepped lift (≤ 15 mm, eased) on each
   footfall over the continuous ramp; zero under reduced motion; speed along
   the incline unchanged; no FOV change. ACCEPT: walk / elevation gates
   extended (cadence on the stair, flat cadence unchanged, zero lift under
   reduced motion).
3. **Per-floor ambience and a quiet floor cue** (weakness 10). Crossfade the
   room bus with eye height, smoothly over the stair: upstairs a quieter
   murmur (about −6 dB), softer HVAC, the outside slightly more present
   through three glazed walls (glass level / cutoff up a little); the PA chime
   unchanged. The floor cue is that shift plus the HUD place label ("Upper
   observation room", "Staircase") — no chime, no toast spam.
4. **Inspectable décor** (weakness 9). From `INSPECTABLES`: offered only when
   its `dressingId` is built, on its `floorId` layer, within `reachM` of its
   `bounds`, while nearly still (speed < 0.3 m/s) and facing within ~25°, with
   a clear line of sight (reuse `rayBox` / `stationLineClear` from
   `observatory-stations.mjs`); Enter or a click opens a calm card (label and
   text; Enter / Escape close; focus returns), no camera move, no rewards, no
   persistence. It is a `LOUNGE_PIER` feature and must work with
   `LOUNGE_INSTRUMENTS` off. ACCEPT: a new node gate (offer, gating on
   dressing, floor, facing, keyboard close); browser behaviour is the
   integrator's run.
5. **An upstairs listening window** (`LOUNGE_INSTRUMENTS`; weakness 9). Add
   `upper-front-listen` to `observatory-stations.mjs` at the exact
   `RESERVED_STATIONS` position, its physical instrument in
   `observatory-instruments.js` (pedestal, hinge and housing like the lower
   listening windows, joined, never floating) and its proximity control. Its
   screen tile goes in the atlas's unused region (x 0…640, y 147…512): the
   640…896 column already holds five 96-px tiles and is full. ACCEPT:
   `verify-lounge-observatory.mjs` and `verify-observatory-presentation.mjs`
   extended (the ray reaches the screen before the housing; the support joins
   the head); `verify-lounge-second-level.mjs` confirms the position.
6. **Seat menu by floor.** If FURNISH adds seats, group the menu as "Lower
   lounge" / "Upper room", calm and keyboard-navigable; cross-floor seat
   changes keep the comfort fade.
7. **Tests** for every item, in the gates you own.

**Non-goals.** Room geometry (FURNISH) or shading (LIGHT); new instrument
kinds beyond the reserved station; any eight-button or always-on panel;
camera moves on inspection; rewards or persistence; speech of any kind;
classic-room changes.

**Verify and push.** The gate suite plus your new gates green (pass them as
extra arguments or append them to `STANDARD_GATES`); harness renders of
`upper-front-seat`, `upper-wide-from-landing` with instruments on to see the
new station (`/home/user/skyloom/.graphics-review/lounge-second-level/life-after`);
`npx eslint`; `git diff --check`; commit; fetch, rebase, rerun, push.

## Record

*(The integrator fills this section: what each lane landed, with commits,
gate results, harness captures and anything left open.)*
