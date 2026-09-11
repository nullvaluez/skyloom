# R25 — C LIGHT — `LIGHT_BUBBLE_R25` — the ledger

> **VENUE TRUTH, stated once.** This work was built and measured in the cloud
> container: Esri imagery/elevation, OpenFreeMap and adsb.lol are 403-blocked,
> the only tile source is E's offline fixture (`FLY_TILE_FIXTURE=1`,
> `scripts/_fixture.js`), Google Chrome is absent (Playwright chromium through
> `node -r ./scripts/_pw-shim.js`), and WebGL is ANGLE/SwiftShader at 1–3 fps.
> **Every number in this ledger is a COUNT, a METRE, a COLOUR or a PROGRAM
> COUNT. There is not one fps, frame-ms, sparkle or bloom-feel number in it,
> because this venue cannot produce one honestly.** Whether a 350 m shadow
> frustum shows an edge at 500 ft, whether 0.34 m/texel sparkles under motion,
> whether a full moon reads as moonlight rather than as a dimmer switch, and
> whether the night haze floor rescues depth or greys the city — all four are
> USER-MACHINE checkpoints (§6). A SwiftShader number never re-baselines a live
> number.

Owner: **C LIGHT** (Fable). Branch `r25/c`, base = W0 tip `6bf628e`. Port 3132.
Charter: FLY_ROUND25_PLAN.md §3 C. Recon ids: L1–L8 (`scripts/r25-recon.md`).

---

## §0 THE RED — what the tree does today, measured or quoted with file:line

Every claim below is either read from the source on the day or produced by a
gate run in this container. Nothing here is an impression.

| id | what | the number today | where |
|---|---|---|---|
| L1 | lights in the scene | **1 directional + 1 hemisphere**, zero point/spot/ambient | `FlyScene.jsx:3289`, `:3292` |
| L2 | deep-night key / fill / env | **0.09 / 0.10 / 0.14**, constant at every phase of the moon, forever | `lib/fly/immersive.js` `immersiveLighting` |
| L4 | the moon | steers the key **DIRECTION** only; intensity and colour explicitly untouched | `ONE_SUN` `fly-constants.js:5269-5281` |
| L5 | the shadow cascade | ONE ortho, radius **1500 m**, map 2048² at high ⇒ **1.465 m/texel**, at every altitude | `SAT_SHADOWS.orthoRadiusM` `:3562`, `IMMERSIVE.profiles.high.shadowSize` |
| L5 | the same at medium / low | 1024² ⇒ 2.93 m/texel · 512² ⇒ **5.86 m/texel** | `immersive.js:8-10` |
| L6 | AO | `aoRadius` **24 m** (city blocks), intensity 5.0, measured 0–6 % occlusion | `DEPTH_PASS.n8ao` `:6273-6290` |
| L3 | hemisphere GROUND colour | **`#5a6b53`** (daytime olive) from mount to unmount — the keyMix effect writes `hemi.color` ONLY | `MOODS.satellite.hemi` `FlyScene.jsx:390`, effect `:1843-1856` |
| L7 | night bloom threshold | **0.91** (satellite-atmosphere OVERRIDES `SKY_LIVE.bloomNight.threshold` 0.62 at `Effects.jsx:657-658`) | `satellite-atmosphere.js:53` |
| L8 | night haze | **exactly 0** — `AERIAL_LAW.nightRamp` drives `atmoNightMul` to 0, and `NIGHT_TRUTH_R23.hazeNight.retire` is 1.0 | `FlyScene.jsx:2484-2489`, `:6484` |

**The RED as a gate, not as prose.** `scripts/verify-moon-light.mjs` run
against the flag-off base tree `6bf628e` (`git archive` into a scratch dir, the
gate file copied in): **5 passed, 12 failed** —
`scripts/r25-out/r25-c-moon-light-RED-6bf628e.txt`. The load-bearing row:

```
FAIL  (4) THE RED — the night key MOVES with the phase of the moon
      — new 0.0900 → full 0.0900 (Δ 0.0000); R24 is 0.0900 at BOTH — that 0.0000 is the defect
```

and the five PASSES are exactly the identity clauses (1), (2), (3), (4b) —
they pass on both trees **by design**: they are the claim that daylight does
not move, and a claim like that is only worth anything if it is green before
the change as well as after.

---

## §1 MECHANISM — five writes, zero shader text

Every mechanism is a property or uniform write on an object that already
exists. **No new material, no `onBeforeCompile`, no GLSL, no cache key, no
prewarm entry, no draw, no program.** (§2 has the measured program count.)

1. **`shadow`** — the ONE cascade's ortho radius becomes
   `mix(radiusHighM, radiusLowM, k)` on the ground bubble, QUANTISED to
   `steps` rungs and written imperatively on `sun.shadow.camera.{left,right,
   top,bottom}` + `updateProjectionMatrix()` by
   `components/fly/LightBubbleRig.jsx`. 1500 m → 350 m is
   **1.465 → 0.342 m/texel** at 2048². The JSX boot props (`FlyScene.jsx:3303-
   3306`) are untouched, so the flag-off tree is the R24 rig exactly.
2. **`ao`** — `pass.configuration.aoRadius` 24 → `radiusLowM`, `intensity` 5.0
   → `intensityLow`, on the RETAINED N8AO pass. High tier only (the pass exists
   nowhere else). Quantised writes (0.05 m / 0.02) because n8ao's
   `configuration` is a Proxy that fires `firstFrame()` on every change.
3. **`moon`** — `immersiveLighting()` gains a moon: synodic phase
   `illum = (1 − cos(2π·phase))/2` from `epochNewMoonMs` / `synodicDays`, an
   anti-solar `up` weight, and the night key `0.09 → mix(keyNew, keyFull,
   illum) + 0.02`, env `0.14 → mix(envNew, envFull, illum·up) + 0.04`, fill
   `+ fillGain·illum·up`.
4. **`hemi`** — `hemi.groundColor` follows the SAME time-of-day cross-blend the
   key colour follows (`resolveSky` / `legacyBucket`, `lib/fly/sky-dusk.js`);
   the night sky half becomes `skyNight`.
5. **`grade`** — night bloom threshold `mix(1.08, nightBloomThreshold, night)`,
   exposure `+ nightExposureStops·night`, and a **haze floor**
   `atmoNightMul = max(hazeNightFloor, atmoNightMul)`.
6. **`terrainEnv`** — deliberately NO mechanism; see §4.

### 1.1 The three seams, and why each is shaped the way it is

**(a) `immersive.js` and `satellite-atmosphere.js` may not grow an import.**
`scripts/immersive-unit.mjs` loads `lib/fly/immersive.js` as a **`data:` URL**,
where a relative specifier cannot resolve at all, and
`scripts/graphics-unit.mjs` loads `satellite-atmosphere.js` the same way while
rewriting **exactly one** specifier (`./immersive`). Adding
`import { r25On } from './r25-pins'` to either file breaks a frozen node gate
that C does not own and may not edit. So the FLAG is read in the rig, and the
resolved numbers ride into those pure functions **on the object they are
already handed** — `sun.moon`, `sun.grade`, `sun.hazeNightFloor`. Absent ⇒ the
R24 expression runs. That is why flag-off identity here is a property of the
code rather than of a comparison, and it is also why `immersiveLighting` kept
its two-argument signature and needed no new call site.

**(b) The identity is arithmetic, not inspection.** Each moon term is a DELTA
from the R24 value scaled by `w = (1 − day) · up`, and

* `up = smooth(−8, 0, −elevation)` is **exactly 0** at and above 8° of sun,
* `1 − day` is **exactly 0** at and above 16°,

so above 8° no moon term can move a single bit even with the payload attached
(`a + 0.0 === a`). `verify-moon-light` (1) samples that 1,800 ways.

**(c) The charter's `·up` is applied to the DELTA, deliberately.** Written
literally — night key `= mix(keyNew, keyFull, illum)·up + 0.02` — the term
lands on **0.02** as `up → 0` rather than on R24's 0.09, so the moon flag would
DIM the key across 8°–16° of **daylight**, where `(1 − day) > 0` and `up = 0`.
At `up = 1` (the night the feature is for) the two readings are the same
number; at `up = 0` mine is R24 exactly, which is what clause (4b) asserts.

---

## §2 COST — measured, at this venue

| budget | frozen | measured here | how |
|---|---|---|---|
| draws | 0 added | **0 added** — the feature adds no object to the scene | `verify-shadow-bubble` (7) |
| programs | 0 added | **flat across the whole AGL traverse** | `verify-shadow-bubble` (3b) |
| shader text | 0 | **0** — no `onBeforeCompile`, no ShaderChunk, no `customProgramCacheKey` | source; `git diff` touches no GLSL file |
| cache keys | 0 moved | **0** — `world-bend.js` is not in C's diff at all | `git diff --stat` |
| RT bytes | 0 | **0** — no render target is created | source |
| texture samples | 0 added | **0** | source |
| Owens ceiling 261 | frozen | see `verify-shadow-bubble` (7) | fixture column only |

**The shadow MAP does not change size**, only its frustum: `mapSize` stays
`IMMERSIVE.profiles[tier].shadowSize`, so no depth target is reallocated and
the R19 "castShadow is a discrete transition" rule is untouched.

### 2.1 The run table (this venue only)

| run | what | verdict |
|---|---|---|
| `verify-moon-light.mjs` (node) | on r25/c | **16 passed, 0 failed** |
| `verify-moon-light.mjs` (node) | RED calibration on the flag-off base `6bf628e` | **5 passed, 12 failed** (`scripts/r25-out/r25-c-moon-light-RED-6bf628e.txt`) |
| `verify-shadow-bubble.js` pass 1 | armed | 11 passed, 2 failed — **both failures the INSTRUMENT** (see §7.1) |
| `verify-shadow-bubble.js` pass 2 | armed, after the AGL poll | cruise 1500 m / deck **350 m, 0.342 m/texel (4.3× finer)**, AO **24 → 5 m**, intensity **5.0 → 3.5**, hysteresis **0 rung changes**; (3b) failed on a **+1 program drift** and the night leg was lost when the DEV SERVER died mid-run (§7.3) |
| `verify-shadow-bubble.js` pass 3 | armed, with the program CONTROL | see below |
| `verify-shadow-bubble.js` RED leg | `R25_LIGHT=off` — same file, no rig | see below |
| `verify-shadow-calm.mjs` (node) | on r25/c and on the base | **32 ok / 1 FAIL on BOTH** — the catcher row, inherited, not C's |
| `immersive-unit.mjs` / `graphics-unit.mjs` (node) | on r25/c | **PASS** |
| `verify-import-integrity.mjs` (node) | on r25/c and on the base | **3/1 on BOTH** — two `no-undef` in `scripts/r24-c-agl.js`, an R24 artifact |

---

## §3 THE DECISIONS

**(1) A SECOND SHADOW-CASTING LIGHT IS REJECTED.** A light COUNT is part of
every program's cache key: three's `WebGLPrograms` folds light counts, fog and
scene environment into the key, which is precisely why `lib/fly/prewarm.js`
passes the LIVE scene as `compileAsync`'s `targetScene`
(**`lib/fly/prewarm.js:120-126`**: *"the material/geometry/object parameters
that WebGLPrograms folds into its cache key — material class, vertexColors, the
map set, instancing, instanceColor, flatShading, side, plus the LIGHT COUNTS,
fog and scene environment"*). Adding a second directional therefore recompiles
**every lit material in the scene** — the R21 "everything flashes, reappears,
disappears" mechanism, deliberately re-introduced, and it would invalidate the
whole prewarm warm-set in the same stroke. `verify-shadow-bubble` (3b) measures
the property the rejection protects: programs flat across the traverse.

**(2) NO EPHEMERIS.** The moon is a MEAN SYNODIC LUNATION from a known new
moon, not a lunar position model (plan §8). `verify-moon-light` (0b) puts the
error on the record: 14 h of phase error is **1.98 % of a cycle** — invisible
in a light intensity, and not worth 40 kB and a new dependency. The moon's
DIRECTION is already anti-solar (`moonDirFromSun`, what R24's `ONE_SUN` blends
the key toward), so "is the moon up" is "is the anti-solar point up", which is
`−elevation`. That is the honest reading of the app's own moon, and it is
written down here because a future round WILL be tempted to call it a bug.

**(3) A NEW MODULE, `lib/fly/light-bubble.js`.** The plan's file list for C
named `shadow-kernel.js` as the home for the shadow arithmetic. It is not, for
a measured reason: `scripts/verify-shadow-calm.mjs` loads `shadow-kernel.js` by
STRIPPING its imports and injecting exactly two bindings (`ShaderChunk`,
`SHADOW_CALM`), so any new import or export there is a live risk to a frozen
R24 gate — and an AO-pass publisher in a file about ShaderChunk patching is bad
engineering besides. `light-bubble.js` is new, conflicts with nobody, and is
loaded by `verify-moon-light` through the same strip-imports idiom.

**(4) THE RUNG DEADBAND IS A SCHMITT TRIGGER, measured from the BOUNDARY.**
The first version asked "has the continuous radius left the CURRENT rung's
radius by more than `hysteresisM`", which is **vacuous by construction**: at a
rung boundary the continuous value is half a rung from the rung's own radius —
`(1500 − 350)/8/2 = 71.9 m` — already more than the 40 m band, so the switch
fires on exactly the jitter the band exists to hold. `verify-moon-light` (8c)
caught it: **7 rung changes across 24 samples of ±11.5 m of jitter sitting on
the 7↔8 boundary**. Measuring from the EDGE gives 0. The lesson is in §7.

**(5) THE HEMI BUCKET IS READ FROM `sky-dusk.js`, NOT COPIED FROM FlyScene.**
FlyScene's keyMix effect calls `resolveSky(az, trueElevationDeg(sinEl))` on a
5 s cadence and keeps the result in React state the rig cannot see. The rig
calls **the same two pure functions** on `runtime.sun` every frame instead of
mirroring the rule, so the two can never drift; the only difference is that the
crossing is continuous here rather than a 5 s step, and the endpoints are
identical.

**(6) FOUR FlyScene LINES, NOT THREE — declared for arbitration.** The charter
grants C `:2979` (the texel snap), `:773` (the near-receive reach) and
`publishSunLight`. The HAZE FLOOR in charter item 5 lives at the night-ramp
site (`FlyScene.jsx:2500`) and is a fourth one-line touch. It is a single
statement, `Math.max(runtime.sun?.hazeNightFloor ?? 0, atmoNightMul)`, which is
a **byte-noop** with the rig unmounted (`Math.max(0, x) === x` for the
non-negative multiplier), and it needs no import. Flagged here and in the
hand-off so the orchestrator arbitrates it rather than discovering it.

**(7) THE NEAR-RECEIVE FALLBACK IS `SAT_SHADOWS.orthoRadiusM`, NOT
`shadowRigRef.current.radiusM`.** The charter spells the fallback as the rig
ref, but `:773` reads the CONSTANT today and the rig ref carries
`TOY.shadowRadiusM` in the toy style — so that fallback would change Neon
behaviour with the flag OFF. The satellite texel snap at `:2979` does use the
rig ref, because that branch is satellite-only.

---

## §4 WHAT IS NOT BUILT, AND WHY

**`terrainEnv` — no mechanism, by charter.** The terrain tile material is
three-tile's own `MeshStandardMaterial` (`lib/fly/vendor/three-tile/index.js:
811-815`, constructed `:1727`), which is **A GROUND's vendor territory this
round** and is the one material in the scene C could only reach by editing a
vendored file that `scripts/verify-vendor-three-tile.mjs` gates verbatim. It
does not need reaching: the terrain is lit by the scene's ONE directional and
ONE hemisphere, so C's moon key, hemisphere ground colour and night grade land
on it through the lights — and A GROUND's normal perturbation (`GROUND_DETAIL_
R25.overlay`) is what gives that light something to shade at 50–500 ft.
Changing `envMapIntensity` or adding a map on the vendored class would have
been a second owner in one file for a result the light already produces.

---

## §5 FROZEN GATES TOUCHED

| gate | status | note |
|---|---|---|
| `scripts/immersive-unit.mjs` | **GREEN** | it loads `immersive.js` as a data URL; the file stays import-free, and `moon` is only a KEY on the result when a payload was passed, so its `Object.values(...).every(Number.isFinite)` sweep is untouched |
| `scripts/graphics-unit.mjs` | **GREEN** | `satellite-atmosphere.js` gained no import |
| `scripts/verify-shadow-calm.mjs` | see §6 run table | `shadow-kernel.js` NOT touched (decision 3) |
| `scripts/verify-one-sun.js` | see §6 run table | `ONE_SUN`'s key direction is untouched; C changes the key's INTENSITY at night only |
| `scripts/verify-import-integrity.mjs` | inherited RED | 2 `no-undef` in `scripts/r24-c-agl.js`, an R24 artifact — **identical on the base tree**, not C's |

---

## §6 OPEN RISKS AND USER CHECKPOINTS

1. **The 350 m frustum edge at 500 ft.** A 350 m ortho radius means shadows
   simply stop 350 m from the aeroplane. At 500 ft AGL with a shallow sun that
   edge can fall inside the frame. Nothing at this venue can see it. **User
   checkpoint**: fly Powell at 150 m and 500 ft, `window.__flyLightBubble.set({
   shadow: { radiusLowM: 500 } })` and back, and say which one has a visible
   line. `radiusLowM` is a one-console-line knob.
2. **Sparkle at 0.34 m/texel** is a TEMPORAL property (R24's SHADOW_CALM
   lesson: the PCF kernel rotation is world-hashed and the follow target is
   texel-snapped, both of which this feature keeps). It cannot be observed at
   1–3 fps. **User checkpoint.**
3. **Bloom feel.** The night threshold 0.91 → 0.78 is a taste knob with a
   measurable effect only once B NIGHT's emitters exist; until then it mostly
   lowers the bar for the existing road/window emissives. **User checkpoint**,
   `__flyLightBubble.set({ grade: { nightBloomThreshold: … } })`.
4. **The haze floor greying the city.** 0.12 is a floor on a multiplier whose
   colour is the night rim (`#24272b`). Too high and a night city goes milky.
   **User checkpoint**, same handle.
5. **The moon phase is a real date.** On a new-moon night the world is
   DARKER than R24 (key 0.045 against 0.09) — deliberately, and it is the
   first thing to check if "the night got too dark" comes back: it may simply
   be a new moon. `__flyLightBubble.set({ moon: { illumOverride: 1 } })`
   settles it in one line.
6. **`up` uses the anti-solar point, not a lunar position** (decision 2), so
   the moon rises and sets with the sun's opposite. On the user's machine this
   reads as "the moon is up all night", which is what the app already DRAWS.

---

## §7 LESSONS

### 7.1 The instrument was wrong three times before the feature was wrong once

Every RED this gate produced was its own, and each one had a different shape.

**(a) THE POSE THAT NEVER ARRIVED.** Pass 1 pinned the aeroplane at 80 m AGL,
waited a fixed 5 s and measured **1050.8 m** — then reported "the cascade is
1500 m at 80 m AGL" and "the AO radius is 24 m at k = 1" as two feature
failures. The bubble keys on the EYE's visual AGL and the eye is the DAMPED
chase camera: in 5 s at 1–3 fps it had travelled 16 m of the 987 it was sent.
Waiting for the app's own published AGL instead of for a clock turned both rows
green with no change to the feature at all (deck 80.0 m, k 1.0000, radius 350,
AO 5.00 / 3.50). This is verify-one-sun's "wait for the app to pick it up, do
not wait a duration" lesson, in metres instead of degrees.

**(b) THE +1 THAT WAS THE VENUE.** Pass 2's program count read
**115 → 115 → 116 → 116 → 116** across the traverse and failed a bare
"spread === 0". One content program had arrived with a streaming tile. The fix
is not a looser bound — it is a CONTROL: the same number of samples over the
same settle with **k held constant**, so the traverse is judged against the
venue's own drift. And the claim survives either way, because what the rejected
design (a second shadow light) would have done is re-key EVERY lit material at
once: a jump of tens, not a drift of one.

**(c) THE SERVER THAT DIED.** Pass 2 then lost `window.__fly` entirely
mid-night-leg and threw `Cannot read properties of undefined`. It was not a GPU
crash and not the rig: the dev server process had exited (the next run got
`ERR_CONNECTION_REFUSED` on the same port), taking the page's chunks with it.
A gate that dies on a dead server reports nothing about the feature, so the
gate now checks `window.__fly` at each leg boundary and reads NOT CALIBRATED —
with `__flyStats.sceneRemounts`, the tripwire FlyScene already ships for this —
instead of a stack trace.

### 7.2 The rest

1. **A deadband measured from the wrong reference is not a deadband.** The
   rung hysteresis compared the continuous value against the CURRENT RUNG's
   radius, which at a boundary is half a rung away — always more than the band.
   It read like hysteresis, it was spelled like hysteresis, and it fired on
   every jitter sample. Measure a Schmitt trigger from the EDGE it is guarding,
   and make the gate jitter ON the edge rather than sweep across it: a sweep
   would have passed.
2. **A gate that cannot import its subject must say so as a clause, not as a
   stack trace.** The first RED calibration run died with `ENOENT` on
   `light-bubble.js` and reported nothing at all. Loading the module
   defensively turned the same run into 5 passed / 12 failed, which is a
   calibration artifact rather than a crash log.
3. **The venue decides the seam.** `immersiveLighting` could not take the flag
   as an import because a node gate loads that file as a `data:` URL — so the
   flag went to the caller and the numbers rode in on an argument the function
   already had. The constraint produced a purer function than the design did.
4. **An identity claim wants an interval, not an adjective.** "Daylight is
   unchanged" is unfalsifiable; "at and above 8° of sun elevation the weight is
   exactly 0, and here are 1,800 `Object.is` comparisons" is a contract.
5. **Ask what the pin does to the OTHER arm.** `__flyDepthPin` means the N8AO
   pass is never CONSTRUCTED, so an AO clause on the fleet's defaults would
   have measured an absent pass and called it a constant radius. The gate arms
   `__flyDepthArm` before mount and says which pin it released.

---

## §8 COULD NOT MEASURE HERE

* **Any fps / frame-ms number**, for any of the five mechanisms. SwiftShader.
* **Whether the shadow looks better.** A shadow at 0.342 m/texel instead of
  1.465 is arithmetic; that it reads as contact shadow under the wing is a
  user-machine judgement.
* **Sparkle / temporal stability** at the new texel size (checkpoint 2).
* **The night image as an image** — bloom threshold, exposure stops and the
  haze floor all describe a frame this venue renders at 1–3 fps through
  SwiftShader's own colour path, and the fixture's night sky is not the live
  one.
* **The live Owens ceiling.** (7)'s draw census is the FIXTURE desert. The
  frozen 261 is a live number; this feature adds no object to the scene, so
  the expectation is identity, not headroom — but the row that proves it lives
  on the user's machine.
* **Interaction with B NIGHT's irradiance and A GROUND's overlay.** Both land
  after C in the merge order; the moon key and the hemisphere ground colour are
  inputs to what they draw.
