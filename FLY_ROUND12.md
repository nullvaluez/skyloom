# Fly Round 12 — "Neon Planet" (2026-07-18)

Round 11 certified satellite at altitude; the user then flew Neon at cruise
(~26,000 ft over Delaware County) and it "looked like absolute shit": the toy
ground dissolved at a **static 14–26km band** while everything else — the
curvature (`GLOBE.altFlatten`), the POI letters (round 10's `sqrt(alt/k)`
cull), the traffic (`horizonFade`) — already scaled with altitude. Past a
small disc the whole view was the round-4 void grid: "toy plane over graph
paper," with city letters legally standing on dissolved ground. User ask:
make Neon-at-altitude read as a rounded mini-planet that keeps rendering to
a curved horizon. Decisions (asked + answered): real geography to the
horizon (not a stylized shell), void grid fades out with altitude (stays the
low-alt signature), TownGlow AND the cloud deck scale up at cruise.

**The key discovery (exploration):** the world past 26km mostly already
existed. Toy chunks stream to ~30km; beyond them the three-tile base
quadtree (solid ink tiles + real Esri DEM) streams to the horizon. The fade
band — set ONCE per style, never per frame — was painting it all into the
rim. The fix is therefore mostly *plumbing an altitude-aware band through
one source of truth*, plus one genuinely new streaming ring.

## 1. Design: ONE horizon function, many consumers

Round-11 lesson ("never let three consumers pin three different
constants") applied from the start: the smoothed band lives in the
`uEdgeFade` uniform the GPU is already fading with, and **`getEdgeFade()`**
(world-bend.js, mirrors `getBend()`) is the single getter every consumer
reads — no consumer can drift from what's on screen.

- `groundHorizonTargetM(cfg, floorM, maxM)` (world-bend.js) — the terrain
  twin of `horizonFade`'s player term: `max(floorM, min(maxM,
  sqrt(eyeAGL/k) · frac))` off the live `uEyeY − uRefGroundY` / `uBendK`.
- FlyScene's −50 block (right after `setBend`/`setBendEye`, toy-only via
  `WORLD_EDGE.altHorizon.byStyle`) damps the target (`expApproach`,
  `smoothSec 1.5`) and calls `setEdgeFade`/`setDepthHaze` per frame — pure
  uniform writes. **END floors at the static 26000 by construction** (below
  ~7,900 ft the values are byte-identical — no epsilon, `expApproach` at an
  equal target is exact), START trails at `startGrow 0.6` of the extension,
  the round-8 haze end rides START × 13/14 so "haze end < fade start" holds
  at every altitude. The style-change useEffect stays the ONLY writer for
  satellite/night (round-11 certification untouched).
- Worked values: FL260 → end **81.7km** / start 47.4km (verified live:
  81,521 / 47,312 at bendK 1.7076e-6); FL400 → capped at `maxM 110000`.

Consumers, all via `getEdgeFade()`:

| Consumer | Round-12 change |
| --- | --- |
| Sky dip (FlyScene) | reads live `startM` (satellite output bit-identical); dome horizon rises to meet the distant ground edge (dip 0.51 → 0.24 at FL260) |
| Ultra ring radius (engine) | `max(ring3.r, endM × slack)` per refresh |
| VoidFloor | live `floorY = −endM²·k − marginM` + grid alpha fade (§3) |
| TownGlow range | `max(30000, endM)` placement radius (§4) |
| Cloud spread | `f = clamp(endM / 26000, 1, maxF)` (§5) |
| Harness | `__flyStats.edgeFadeStartM` / `groundHorizonM` |

## 2. The z10 'ultra' ring (real geography to the horizon)

`TOY_WORLD.ultraRing {enabled, z:10, slack:1.1, onEndM:40000, offEndM:34000,
fullShrinkR:4000}` + `demZByDetail.ultra: 7` + `maxChunks 120→160`.

- **One hysteresis switch arms both halves of the trade** (evaluated on the
  existing 2s/600m refresh cadence, state on the engine): the z14 'full'
  ring shrinks 8000→4000 (building detail is invisible from 4km+ AGL) and a
  z10 ring extends to `bandEnd × slack`. The freed ~130 draws fund the
  ring's ~40–72. Disarmed = the static 3-ring array, literally the round-11
  code path.
- **Worker**: `detail 'ultra'` is an alias for `'far'` at `buildTile` entry
  (no buildings/scatter/foam, motorway/trunk/primary only — the OMT
  `building` layer doesn't exist below ~z13 anyway). `WORKER_PROTOCOL 8→9`:
  a stale HMR worker would silently run z10 tiles through the FULL filters.
- **The descent needed generalizing**: the quadtree assumed CONSECUTIVE ring
  zooms (z14→13→12; `visitChild(z+1, ringIdx−1)` pairs one zoom step with
  one ring step). With z12→z10 a child is z11 — no ring's zoom — and the old
  code would have emitted it as a mislabeled 'far'/'mid' chunk. Now a child
  only ARRIVES in the finer ring when its zoom matches (`childIdx = z+1 ===
  rings[ringIdx−1].z ? ringIdx−1 : ringIdx`); between zooms it stays in the
  coarse ring's territory (emitting there = the same boundary artifact class
  as the existing outer-bubble clamp). A `rings[i−1].z > z` guard makes a
  misordered config terminate. Disarmed behavior is byte-identical.
- **`slack 1.1` is a correctness knob**: toy chunks drape at `elev×1.7 +
  2.5` but the base tiles are TRUE DEM — the relief seam at the ring's outer
  edge must sit inside the 100%-faded zone.
- **The `maxChunks 160` cap trims in fade order**: nearest-win drops the
  FARTHEST tiles first, which are exactly the most-faded ones. Measured 158
  chunks at FL260 (30 ultra) — at FL400 the desired set may exceed 160 and
  trim a few outer ultra tiles sitting in the band's last ~5% of fade.
  Benign by construction; raise `maxChunks` if a live eyeball ever
  disagrees.
- Beyond the ring: the base tiles were **already ink** (`PALETTE.groundBase`
  via the solid data-URI in tile-sources.js — the "palette-tan" comment is
  stale wording, the palette is the source) — so unstreamed far ground reads
  as dark land with DEM relief, no restyle needed.

## 3. VoidFloor: live depth + altitude grid fade

- **The static `floorY` was the round's hidden killer** (plan-agent catch):
  `−(26000²/2·bendR) − 900 ≈ −4.3km`, but at FL260 the extended band's far
  terrain drops to ~−11.5km — an opaque floor at the static depth would
  depth-occlude the ENTIRE far field. `floorY` is now derived per-frame from
  `getEdgeFade().endM² × getBend().k` — exactly the old value at low
  altitude (and in night), always just below the fully-faded distance (the
  round-4 no-seam invariant, now dynamic).
- Grid alpha × new `uGridAltFade`, driven **delta-based**
  (`WORLD_EDGE.floor.gridAltFade {extStartM 4000, extEndM 34000}` on
  `liveEnd − staticEnd`) — night's static 34km band extends by 0 and stays
  untouched; an absolute threshold would have permanently dimmed it. Full
  grid below ~9k ft, gone by ~18k ft.

## 4. TownGlow to the horizon

- Placement radius `max(30000, bandEnd)`; the domes' `applyBendAnchor`
  material already dissolves on the same `uEdgeFade` band, so their
  *rendering* extended for free.
- **Latent bug fixed**: the round-7 loop placed the FIRST `max` cities in
  POI-list order, not the nearest — invisible at 30km (rarely >48
  candidates), arbitrary at 90km. Now collect → sort by distance → nearest
  `maxByTier[tier]` (high/medium 96, low 48; pool 96, still ONE draw).
- `farScale {startM 30000, endM 110000, mul 2.5}` (LETTERS.farScale shape):
  horizon towns read as glow pools, not sub-pixel dots. Inert below 30km.

## 5. Cloud deck visible below at cruise

`CLOUDS.altSpread {enabled, maxF 3.2, sizeExp 0.6}` (toy only): spread
factor `f = clamp(bandEnd/26000, 1, maxF)` scales the **cluster centers,
the toroidal wrap cell AND the distance dissolve together** — fading
farther without scaling the 24km cell is meaningless (wrap keeps every puff
within ±cell/2). Puffs stored as center+offset (`x(f) = cx·f + dx`, same
hash inputs — at f=1 numerically identical to round 11); clusters spread
apart but stay internally tight; puff scale ×`f^sizeExp`. The vertical band
(1400–3800m) is untouched — at cruise the player is far ABOVE it, and
seeing the deck drift below is the depth cue. Verified: f=3.14, 23 puffs
below eye at FL260.

## 6. Files touched

`lib/fly/fly-constants.js` (WORLD_EDGE.altHorizon, floor.gridAltFade,
TOY_WORLD.ultraRing/demZ.ultra/maxChunks, TOWN_GLOW, CLOUDS.altSpread) ·
`lib/fly/toy-world/world-bend.js` (`groundHorizonTargetM`, `getEdgeFade`,
docstrings) · `components/fly/FlyScene.jsx` (per-frame band writer, live sky
dip, stats) · `lib/fly/toy-world/toy-world-engine.js` (`_effectiveRings`,
zoom-gap descent, stats, protocol 9) · `lib/fly/toy-world/vector-tile.worker.js`
('ultra' alias, protocol 9) · `components/fly/VoidFloor.jsx` ·
`components/fly/TownGlow.jsx` · `components/fly/CloudField.jsx` ·
`scripts/verify-neon-alt.js` (new).

Untouched by design: `LANDMARKS_3D.maxRangeM 26000` (at cruise the band
STARTS ≥47km — monuments sit fully inside the un-faded zone; the round-8
black-silhouette mode cannot return), PoiLetters (already altitude-aware —
letters now stand on visible ground, free win), TRAFFIC_HORIZON/tracers
(air-variant rim dissolve rides the extended band automatically),
satellite/night writers, `PALETTE.*`.

## 7. Live-tune sign-offs (all knobs in fly-constants.js) — PENDING USER

| Knob | Default | Question for the eyeball |
| --- | --- | --- |
| `altHorizon.frac` | 1.2 | Horizon distance at cruise feels like "inside your own little area"? |
| `altHorizon.startGrow` | 0.6 | Haze onset: far detail readable but still atmospheric? |
| `altHorizon.maxM` | 110000 | FL400 ceiling OK (110km)? |
| `altHorizon.smoothSec` | 1.5 | Dive/climb: band breathes, never pops? |
| `floor.gridAltFade` | +4k/+34k ext | Grid gone by the time it would read through? Low-alt identity intact? |
| `ultraRing.slack` | 1.1 | No relief seam / tan-free handoff at the rim? |
| `ultraRing.onEndM/offEndM` | 40k/34k | Ring arms ~13k ft — early enough? No flapping in level flight? |
| `ultraRing.fullShrinkR` | 4000 | Near city still detailed enough at mid altitudes? |
| `TOWN_GLOW.farScale.mul` | 2.5 | Horizon towns read as window-seat light pools? |
| `TOWN_GLOW.maxByTier` | 96/96/48 | Enough towns at cruise over a metro? |
| `CLOUDS.altSpread.maxF` | 3.2 | Deck spread reads as weather below, not confetti? |
| `CLOUDS.altSpread.sizeExp` | 0.6 | Spread puffs big enough from altitude? |

## 8. Verification (2026-07-18)

- `npm run build` — clean.
- **verify-neon-alt (new) — ALL GREEN first run**, values matching the
  design math almost exactly:
  (A) spawn invariants EXACT (band 14000/26000, grid 0.42, ultra 0, f=1,
  glows ≤30km); (B) FL260: band 81,521m (predicted 81.7k), bendK 1.7076e-6
  (predicted 1.708e-6), 30/30 ultra chunks ready, grid 0, glows to 74km
  (24 placed), cloud f 3.14 with 23 puffs below eye, **draws 278** (gate
  480); (C) pixel gate: void-color fraction in the horizon band **0.1%**
  (the "graph paper" class is dead); (D) descend: band re-clamps 26,386,
  grid 0.42, ultra evicted, switch disarmed; (E) zero errors.
- **verify-neon-city — PASS unchanged** (the certified low-alt look:
  draws 354, ultra 0/disarmed at spawn, all skyline/beacon/runway gates).
- **Full regression sweep — ALL GREEN (2026-07-18, exit 0 × 9, zero FAIL
  lines)**: verify-neon-city (low-alt cert: draws 354, ultra 0/disarmed,
  skyline/beacons/runways all pass); verify-rim (toy/high y=9100 WITH the
  ultra ring armed: maxStep 6, draws 250; satellite untouched: maxStep 4/6,
  draws 185); verify-edge-fx (void floor, pulse/beacon programs, 45s tracer
  stability cv 0.143, toy draws 350-357, satellite no-floor + draws 218);
  verify-round11 (satellite default boot + traffic horizon — round-11
  certification intact); verify-sat-depth; verify-poi; verify-boot;
  verify-tracers; verify-atlas.
- Do NOT run harnesses while the user live-tests (round-7 lesson).

## 9. Lessons

1. **The certified path must include the certified ALTITUDES.** Round 11
   certified satellite-at-cruise but Neon's harnesses all ran at spawn
   height; the one screenshot at 9,100m (verify-rim) gated smoothness, not
   emptiness. verify-neon-alt now pins FL260 and gates continuity (the
   pixel void-fraction gate) in the style the user actually flies.
2. **Before building new world, check what the fade is hiding.** The
   "missing" far world mostly existed — streamed chunks to 30km, DEM base
   tiles to the horizon — behind a band set once per style. Root-causing
   the LIMITER (fade, not streaming) turned a scary render project into
   plumbing + one ring.
3. **Store the derived value where the GPU reads it.** The smoothed band
   lives in `uEdgeFade` itself; `getEdgeFade()` is the only getter. Seven
   consumers, zero drift, no second channel to reconcile — the round-11
   "fold into existing channels" lesson, applied to a SOURCE this time.
4. **Quadtree descent encodes adjacency assumptions silently.** The 3-ring
   descent hard-assumed consecutive zooms (one zoom step per ring step); a
   gapped ring (z12→z10) would have emitted mislabeled chunks. When adding
   a level to a recursive spatial structure, diff the recursion's implicit
   invariants, not just its config.
5. **A dynamic band re-prices every "beyond the band" assumption.** Three
   satellites of the old 26km constant had to move with it (VoidFloor depth,
   TownGlow range cap, LANDMARKS range doc) and one didn't need to
   (monuments — now INSIDE the band, safer than before). Grep for the
   constant's VALUE, not just its name, when a constant becomes live.
6. **Trim in fade order is free graceful degradation.** The nearest-win
   chunk cap drops the farthest (= most-faded) tiles first, so cap pressure
   at extreme altitude eats invisible geometry before visible ground — a
   budget knob that degrades in the right order by construction.
