# R23 A "NIGHT-TRUTH" — ROOT CAUSE MEMO (EARLY)

> Committed per plan §4A the moment the verdicts landed, before fix polish, so
> Fable can relay it to B and B's final tuning can pend on it. Evidence lives in
> `scripts/r23-a-*`. **Read §0 first — it bounds how much of this memo is
> measurement and how much is source proof.**

---

## §0 THE ENVIRONMENTAL BLOCKER — read before trusting any number here

**Both tile hosts are 403-denied by this session's egress policy.** The world
cannot stream in this worktree, at all:

```
$ curl -sS http://127.0.0.1:38989/__agentproxy/status
"recentRelayFailures": [
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
    "host": "server.arcgisonline.com:443" },      # Esri imagery + Terrain3D DEM
  { "kind": "connect_rejected", ...
    "host": "tiles.openfreemap.org:443" },        # OpenFreeMap vector tiles
]
```

`registry.npmjs.org` and `api.github.com` return 200 through the same proxy, so
this is a per-host policy denial, not a broken proxy. Per `/root/.ccr/README.md`
a 403 is reported, never routed around.

**Consequence, stated loudly:** the R22 world is the terrain stack, so with the
terrain blocked there is no imagery, no DEM, no buildings, no roads, no
skyline, no parcel homes and no house lights. A 45 s dwell at P-MAN measured
`bldg.ready 0 / roads.ready 0 / draws 94` with `terra {camTileZ 12, targetZ 17,
downloading 8, sharp false}` — the world never arrived
(`scripts/r23-a-smoke2.json`, `scripts/r23-a-man-L1.png` is a near-black empty
frame). **Every pixel-level night claim — lit-pixel fraction, warm share,
white-glow area, luma percentiles — is unmeasurable in this environment.**

So I did not measure pixels, and **I did not manufacture a defect to fix.** What
follows is built from three instruments that survive the blockade:

1. **State probes** — which night contributors are armed, what their materials
   and uniforms hold, at each tier, at a pinned clock. Tile-independent, so
   these are real live measurements (`scripts/r23-a-tiernight.js`).
2. **Paired user-vs-fleet legs** — the same probe with the fleet pin released
   and held, which is what turns "this looks wrong" into "no gate can see it".
3. **Source proof with citations** — for the chains a state probe cannot reach.

Anything that needed pixels is marked **UNRESOLVED (needs a machine with
egress)** and carries the instrument I built so it can be settled on the user's
machine in one read.

---

## §1 THE VERDICT TABLE

| # | Hypothesis | Verdict | Instrument | Number |
|---|---|---|---|---|
| **H1** | Tier/governor chain kills windows | **CONFIRMED as mechanism / UNRESOLVED as trigger** | `r23-a-tiernight.js` state probe | At medium: `nightEnabled=false`, `emissiveIntensity 0`, `emissiveMap null`. At low: the whole building/road/skyline stack **does not mount**. Which tier the user's machine sits at is **not measurable from here.** |
| **H2** | Drape burial under demMaxZoom 16 | **UNRESOLVED** (needs DEM) | — | No DEM can load; `getGroundAt` returns nothing to compare. Source review found no *changed* drape arithmetic in R22 (§3.4). |
| **H3** | Emissive-without-map = white glow | **REFUTED for the building path** / UNRESOLVED elsewhere | material census | High: `emissive #ffd9a3`, `emissiveMap 512²` present, `ei 1.3`. Medium: engine clears emissive to **black** and `ei 0` — it cannot emit an unmapped glow. Scene emissive census at the pose: **4 meshes, all traffic/player strobes** (2×2 maps). Skyline/monument/parcel meshes could not be instantiated (no tiles). |
| **H4** | Settle/birth hold-down | **REFUTED as a persistent state** | source + `birthK` reading | `birthK` re-arms only on an `arrivalEpoch` bump and completes in `bayerSec`; `groundElevVisStep` **snaps** on a new epoch (`settle.js:310`). Neither can hold a layer down past an arrival. |
| **H5** | Grade/exposure crush | **CONFIRMED — and it is the R22 regression** | paired user/fleet probe | Content haze reads **0.55 at medium tier, at night AND at noon identically** on the user's world, and **0.00 in every leg the fleet can run.** See §2. |
| **H6** | Layer mount/key regression | **REFUTED for the tile-independent layers** | mount census | SatCityGlow places **27** domes with `nightK 1` at night / `0` at noon, at all three tiers. Beacons place 2, `on` only at high (its declared `minTier`). Roads/skyline/clutter mount at medium+, unmount at low — all as declared. No silent mount failure found. |

---

## §2 FINDING F1 — the content haze is armed at medium/low, has no night term,
## and is structurally invisible to the entire harness fleet

### The measurement (`scripts/r23-a-tiernight.json`)

Same build, same pose, same clock. The only difference between the two blocks
is whether `window.__flyAerialOverride` is left at the fleet's 0 or released to
the `undefined` a real user machine has:

```
condition  clock  tier     nightWindows  windowEI   contentHaze   postAerial
user       night  high     true          1.3        0             0.55
user       night  medium   false         0          0.55          0
user       night  low      (unmounted)   —          0             0
user       noon   medium   false         0          0.55          0        <- identical to night
fleet      night  medium   false         0          0.00          0        <- what every gate sees
fleet      noon   medium   false         0          0.00          0
```

Two facts fall straight out:

1. **`contentHaze = 0.55` at night and `0.55` at noon.** The term carries no sun
   or elevation input of any kind. At noon it mixes toward a bright rim, which
   is correct aerial perspective. At night `_atmoRim` is the deep-night keyframe
   `#101a30` (16, 26, 48), so the same 0.55 mixes the city — **including its lit
   windows** — toward dark navy.
2. **`contentHaze = 0.00` in every fleet leg.** No harness in the repo has ever
   observed this term at a non-zero value.

### The mechanism

`AERIAL_PERSPECTIVE.content` (`lib/fly/fly-constants.js:3542`) shipped
`enabled:false` from R19 through R21 and was flipped **`enabled:true`,
`minTier:'medium'`, `max:0.55` in R22 W3** (sanction §5.4). `FlyScene.jsx:2037`
arms it at `tier >= medium && !highTier`. The uniform reaches the fragment
shader at `world-bend.js:1384`:

```glsl
gl_FragColor.rgb = mix( gl_FragColor.rgb, uSatHazeColor,
                        uSatHazeMax * smoothstep( uSatHaze.x, uSatHaze.y, vSatDist ) );
```

It is injected **after** lighting, so it operates on the final color and pulls
emissive window light down with everything else. It is shared by the
sat-building and sat-skyline variants — i.e. by exactly the two meshes that
carry the city's night read.

Strength by distance at the shipped band (800 → 14000 m): 1.3 % at 2 km,
13.2 % at 5 km, 31.2 % at 8 km, 55 % at 14 km.

### Why no gate caught it — the R19 §7 lesson, third occurrence

`scripts/_boot.js:64` pins `window.__flyAerialOverride = 0` fleet-wide, and
`FlyScene.jsx:2045` multiplies the content gate by it, so every harness forces
the term to its identity path. **`verify-aerial` is the one harness that
un-pins it — and `verify-aerial.js:131` calls `setQualityTier('high')`, where
`!highTier` excludes the term by construction.** The single un-pinner runs at
the one tier where the feature cannot exist. R22's own certification note on
this constant says *"verify-sat-mobile re-run MANDATORY in cert"*; that harness
pins the phone tier but never un-pins the aerial override, so it too reads 0.

**This is a regression against the R21-certified night read** (the term was
`enabled:false` in R21, which the user's own Brooklyn Bridge screenshot
certified as good — FLY_ROUND22_HANDOFF §0). **FIX IS MINE.**

---

## §3 FINDING F2 — the night city is a high-tier-only feature, and nothing
## reports which tier the user is on

### The measurement

Every contributor that makes a city read as *alive* at night is gated at `high`,
and the one term that *removes* light arms at `medium`:

| Night contributor | Gate | low | medium | high |
|---|---|:--:|:--:|:--:|
| **Window night emissives** | `SAT_BUILDINGS.night.minTier: 'high'` (`:1088`) | ✗ | **✗** | ✓ |
| Airport beacons | `SAT_AIRPORT_BEACONS.minTier: 'high'` (`:2394`) | ✗ | ✗ | ✓ |
| Water glint | `SAT_WATER.minTier: 'high'` (`:1113`) | ✗ | ✗ | ✓ |
| Buildings at all | `qualityTier !== 'low'` (`FlyScene:2354`) | ✗ | ✓ | ✓ |
| Road glow web | `qualityTier !== 'low'` (`FlyScene:2364`) | ✗ | ✓ | ✓ |
| Skyline block mass | `qualityTier !== 'low'` (`FlyScene:2370`) | ✗ | ✓ | ✓ |
| City glow domes | none — all tiers | ✓ | ✓ | ✓ |
| **CONTENT HAZE (removes light)** | `minTier: 'medium'` **and** `!highTier` | ✗ | **ON 0.55** | ✗ |

So a medium-tier night session loses windows, beacons and glint, and gains a
0.55 haze over what survives. A low-tier night session has **no city at all** —
only the 27 city-glow domes. Measured, both clocks, `r23-a-tiernight.json`.

### What is NOT established

**I cannot tell which tier the user's machine resolves to, and nothing in the
build reports it.** The governor is fleet-pinned `'hold'` so no gate has ever
observed a live step, and R22's soak measured "governor steps 0" on the harness
machine at pinned poses — not on the user's machine under the heavier R22
terrain. Two further notes, honestly:

- R22's ladder fix (`perf-governor.js:79`, sanction §5.8) inserts two
  sub-native DPR rungs **before** the first tier step at dpr 1, which makes a
  tier drop *harder* to reach than in R21, not easier. H1's naive "R22 made it
  heavier so tier fell" story is therefore **not supported** as written.
- The session latch (`perf-governor.js:249`) only latches on a *re-descent onto
  a rung climbed out of within `latchWindowSec`*. A first descent never
  latches and up-steps are allowed. So a permanent trap requires an
  oscillation, which is plausible under heavy streaming but is not proven.

The user's own words argue against a pure medium-tier story: *"some (very few)
might show lights in windows"* — at medium the count is exactly **zero**, not
few. That is more consistent with high tier plus a coverage problem, or with a
tier that moves during the session. **Settling this needs the user's machine.**

**OWNERSHIP:** the *mechanism seam* + telemetry is MINE (§4). The *product
decision* — whether windows at night should remain a high-tier-only flourish
now that they are the game's entire night read — is **B's**, per plan §4B's
"the tier question (pends A's H1 verdict)". My verdict to B: **the design is
now wrong for the R22 world; a night-visible medium-tier path is worth
building, and the cost must be measured, not assumed.**

---

## §4 WHAT I SHIPPED

| Fix | Root cause | Flagged? | Rationale |
|---|---|---|---|
| **Night term on the content haze** | F1 — a distance haze with no sun input, newly armed at medium/low | behind `NIGHT_TRUTH_R23.hazeNight` (default **on**) | It has taste surface (how fast the haze should retire at dusk), so per plan §4A it is flagged. Flag off = today's shipped behavior, so the revert contract is exact. By day the term is identity, so every daylight gate is untouched. |
| **`__flyStats.night` telemetry** | F2 — nothing reports the night chain's live state | unflagged, dev-only, read-only | Adds no draws, no product behavior. This is the artifact that makes the user's machine diagnosable in one read, which is the only way F2's trigger gets settled. |

### F1 A/B — exactly one of twelve cells moved

`scripts/r23-a-tiernight.json` (before = commit `a529b51`):

| condition / clock / tier | BEFORE | AFTER |
|---|---:|---:|
| **user / night / medium** | **0.55** | **0.00** |
| user / noon / medium | 0.55 | 0.55 |
| user / night / high · low | 0 | 0 |
| user / noon / high · low | 0 | 0 |
| all six **fleet** cells | 0.00 | 0.00 |

The fleet cells cannot move: `contentGate` is already 0 there, and the new
multiply sits behind `if (hn && contentGate > 0)`.

### F1 dusk ramp — an ease, not a step

`scripts/r23-a-hazeramp.json`, 14 clock samples, medium tier. Before the fix
this column is a constant **0.55 at every sample**:

| UTC | 16h | 20h | 22h | 22.5h | 23h | 23.5h | 24h | 24.5h → 29h |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| sunFrac | 1.00 | 0.93 | 0.50 | 0.38 | 0.26 | 0.14 | 0.016 | 0 |
| contentHaze | 0.55 | 0.55 | 0.55 | 0.55 | 0.524 | 0.334 | 0.043 | **0** |

Smooth and monotone across the dusk crossing, so the R19 dusk ladder sees an
ease rather than a flash.

### Regression checking — what this environment could and could not do

- **`verify-sun`: PASS** (7/7, zero pageerrors) — a real check that the FlyScene
  edit did not disturb the day cycle or the boot.
- **`verify-dusk`: NOT A USABLE INSTRUMENT HERE.** Two of its gates fail on the
  **untouched base tree** (`pinned noon is the certified DAY sky` — env/bg
  0.8448/0.9955 vs an exact-0.85/1.0 assertion, an un-settled SatEnvironment
  ramp; and `cirrus +1 draw` — armed 118 vs parked 118), and two separate runs
  died mid-flight (dev server killed once, browser closed once). One further
  gate (`overcast lid is up at dusk`) passed on base and failed once on the
  fixed tree, and my re-run crashed before reaching it — **I am recording that
  as UNATTRIBUTED rather than claiming exoneration.** The mechanism argument
  that it cannot be mine is strong (the diff multiplies a local `contentGate`
  and writes a dev-only stats object; it touches no weather path) but a
  mechanism argument is not a measurement, and this is exactly the R19 §7 trap
  applied to myself. **It needs one re-run on a machine with egress.**
- Everything pixel-based, including this fix, is **uncertified here** (§0).

---

## §5 ESCALATIONS

1. **To C (gates).** `verify-aerial` is the only un-pinner of
   `__flyAerialOverride` and it runs tier `high`, so the content haze is
   unreachable by the entire fleet. It needs a **medium-tier leg** and a
   **night leg**. I did not touch it — C owns gates.
2. **To C.** `verify-night-alive` must include a leg at the resolved live tier
   with `__flyAerialOverride` **released**. A night gate that inherits the fleet
   pin re-creates exactly the blindness that shipped this defect.
3. **To B.** The tier question (§3). Also: the **high-tier post pass** runs at
   `maxMix 0.55` at night with no sun term either (measured: `post=0.55` at
   sunFrac 0 and 1). I deliberately did **not** touch it — it shipped in R19,
   was live on the user's machine through R21, and the R21 night read was
   certified good, so it is *not* a regression. It is a strong candidate for
   B's night grade work.
4. **To B — the skyline has NO night lighting at all.** `sat-skyline-engine.js`
   declares it in its own header: *"no water, no facade atlas, no night
   windows, no collision columns"*. The R18 Bayer crossfade means the city
   **becomes** that ring as you climb (buildings dissolve 2400→3000 m, evict at
   3200 m), so **climbing out of a city at night hands the whole skyline over to
   unlit dark masses.** That is by design and not an R22 regression, so it is
   not mine to change — but if the user flies at altitude it is a far larger
   contributor to "almost silent black" than anything in §2, and it is squarely
   B's delta.
5. **To B — the leading hypothesis for S2 ("white glow"), unproven.** I could
   not find any building-side source (H3 refuted by measurement) and the night
   palette is deliberately warm — `SAT_CITY_GLOW.coreColor '#ffd9a3'` even
   carries the comment *"clears bloom without going white"*. But satellite bloom
   **breathes at night**: `SKY_LIVE.bloomNight` lerps intensity 0.7 → **1.0**
   and the luminance threshold 0.85 → **0.62** as the sun goes down
   (`Effects.jsx:311`). A warm core bloomed at 1.0 through a 0.62 threshold
   clipping toward white is the most plausible mechanism for "some buildings
   have a white glow", and bloom night tune is B's delta 2c — with the
   five-control `verify-flicker` protocol before AND after, per plan §4B.
   **This needs pixels; I could not test it.**
6. **Note for whoever runs low tier.** At `low` the night city does not exist at
   all: buildings, roads, skyline and clutter never mount (`qualityTier !==
   'low'`), and `BLOOM_SCALE.low = 0` drops bloom entirely. What remains is 27
   unbloomed city-glow domes. If any user machine resolves to low, "almost
   silent black" is a literal description of the intended build.
4. **To Fable.** No frozen assertion number moved and none is requested. No
   sanction consumed.
5. **To Fable / the round.** This worktree cannot certify anything pixel-based.
   The fixes here need a re-run with egress before they can be called proven.

---

## §6 HONEST UNKNOWNS

- Which quality tier the user's session actually resolves to, and whether it
  moves. **The whole of F2's severity hangs on this.**
- The white-glow symptom (S2) has **no confirmed source**. The building path is
  measurably not it. Skyline, parcel homes and monuments could not be
  instantiated without tiles.
- H2 (drape burial) is genuinely untested, not dismissed.
- Whether F1 alone accounts for "almost silent black", or is one term among
  several. At 800 m AGL over Manhattan most of the frame sits 2–8 km out, where
  the haze is 1–31 % — real, but on its own probably not the whole complaint.
