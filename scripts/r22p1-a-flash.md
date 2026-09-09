# R22.1 — Agent A "FLASH" ledger

Branch `r22p1/flash` off main `5d6c09d`. Worktree
`.claude/worktrees/r22-fable`, dev server `:3021`.

---

## ⚠ HEADLINE — THE DIAGNOSIS WAS WRONG, AND I HAVE THE RIGHT ONE

**The user's flash is a CLOUD BILLBOARD passing across the camera for one
frame. It is not the DPR step, and it is not a compositor artifact.**

Reproduced, on this machine, in BOTH the dev and the production build, and
A/B-proven:

| leg | composed frames | pale frames |
| --- | --- | --- |
| clouds ON (satellite, default NYC spawn, ALT 2625 ft) | 2,236 / 3,189 / 3,749 / 3,791 / 23,987 across five runs | ~1 per 1,600 |
| **`window.__flyClouds.visible = false`, everything else identical** | **30,499** | **0** |

`scripts/r22p1-a-cloudflash-partial.png` is a captured frame with the middle
scanline 86.4% pale: a uniform pale field with a **dead-straight vertical
boundary** and the live world — sky, horizon, city — fully rendered beyond it.
`scripts/r22p1-a-cloudflash-next.png` is the very next composed frame: a
perfectly normal scene. That pair is the user's f691/f692.

What this corrects, point by point:

* **The right-hand strip was never "stale".** It is the world beyond the edge
  of the cloud quad. I had already measured this without believing it: in the
  user's clip the right band changes between f690 and f691 by 0.72 mean abs
  diff against 1.07 for a two-frame step — a normal one-frame advance, not a
  frozen region.
* **The straight vertical boundary is the billboard's edge**, which is exactly
  why it is straight to ±1 px over 41 sixteen-row bands.
* **1067/1280 = 0.8333 = 1.25/1.5 is a COINCIDENCE.** My own captured frame
  puts the same boundary at 0.864, and other captures at 0.731 and 0.837. The
  coverage fraction is a continuous variable set by how the puff happens to
  sit in front of the lens, not a fixed ladder ratio.
* **The pale colour is a lit white cloud saturating the post chain.** That is
  why §1.2's uniform-white calibration matched the recorded frame to ±4/255 —
  the input really was saturated white.
* **The HUD stays intact, the draw count is normal, and the draw list is
  byte-identical to the previous frame** (measured via
  `renderBufferDirect`) — because nothing about the scene changed except where
  one puff was.

Bisection trail, in order, each one eliminating a suspect: post-chain uniforms
(every effect's uniforms identical on the pale frame vs the one before it) →
`scene.background` / `backgroundIntensity` / `environmentIntensity` /
`toneMapping` / exposure (all identical) → the draw list (identical) →
tracers parked (2 pale in 3,249 — not them) → **clouds parked (0 in 30,499)**.

Mechanism, as far as the code shows: `CloudField` places every puff at a
toroidal offset from the player, `wrap(p.cx*f + p.dx + driftX - px, half,
cell)`, with **no near-camera exclusion in XZ**. A puff whose wrap or drift
brings it directly over the camera subtends the whole frustum; its material is
`#ffffff`, `lit: true`, so under the daylight key + env it clears 1.0 linear
and saturates. Line-level attribution inside CloudField (why it is exactly ONE
frame rather than a visible pass-through) is NOT done — that belongs to
whoever owns that file, with the cloud gates in hand.

**Recommended fix (not implemented here — out of my brief and it moves cloud
placement, which several frozen pixel gates read):** a near-camera exclusion
or opacity ramp in `CloudField` — refuse to place, or fade out, any puff whose
distance to the camera is below its own billboard radius. Gates that would
need re-running: verify-round11, verify-weather, verify-sat-night,
verify-dusk, verify-flicker.

**What I did ship** is below: `STEP_SAFE`, which fixes a real, measured,
100%-reproducible LATENT hazard in the same area (the drawing buffer is
reallocated between animation frames, and one composed frame per DPR step runs
against post-chain buffers of the wrong size). It is proven, flag-reversible
and green on every frozen gate — but it does **not** fix the user's flash, and
this ledger must not be read as claiming it does.

---

## 0. The brief, and what actually turned out to be true

The defect: on the shipped R22 production build (shadowads.netlify.app), the
user's screen recording (`2026-08-11 10-39-33.mp4`, 1280x720@60, 872 frames)
contains ONE presented frame — 691, t=11.517 s — in which the whole 3D world
is replaced by a uniform pale field while every HUD DOM overlay stays intact.
Frames 690 and 692 are normal.

The orchestrator's forensics were handed to me as a hypothesis to VERIFY. Two
of its three load-bearing claims survived measurement, one did not:

| claim | verdict |
| --- | --- |
| the boundary is at 1067/1280 = 0.8333 = 1.25/1.5 | **CONFIRMED, and it is a real rendering boundary, not a codec artifact** |
| the pale is a cleared / partially-stale drawing buffer | **REFUTED — the pale is a fully COMPOSED frame** |
| the step path is applyDpr → setState → `<Canvas dpr>` → setPixelRatio/setSize outside the drawing tick | **CONFIRMED, with a verbatim ordering trace** |

---

## 1. Forensics on the recording (before touching any code)

Frames f689–f693 were extracted to RGB24 raw with ffmpeg and measured
numerically rather than eyeballed.

**1.1 The boundary is real, straight, and not h264.**
Per 16-row band, the rightmost column at which f691 differs from f690 by >25
luma:

```
64:1067  80:1067  96:1067 112:1067 128:1067 ... 288:1066 ... 688:1066 704:1077
```

41 bands, all at x = 1066 or 1067. A macroblock-skip artifact would jitter on
16-px boundaries (1056 / 1072) and vary band to band; this is a dead-straight
vertical line one pixel wide, and 1066.67 = 1280 x (1.25/1.5) exactly. The
h264 theory was also weakened by the packet sizes: frame 691's packet is
6068 B against neighbours of 7210 / 10495 / 27702 — a flat frame is CHEAP, so
the encoder was not bit-starved into skipping.

**1.2 The pale field is a rendered frame, and I can say exactly which one.**
The pale is not flat: it carries a smooth radial falloff (228 at the middle,
~213 at the extremes, ~186 in the corners) with elliptical iso-contours whose
horizontal symmetry axis sits at x ≈ 632 — i.e. the **full canvas centre**,
not the centre of the truncated 0..1067 region (which would be 533).

I then produced the app's own response to a uniform input: hide the scene
graph (`scene.visible=false`) and set `scene.background` to a flat Color, so
the composer emits nothing but grade → Vignette → SMAA → ACES over a constant.
At input 1.0 (and anything above — the response saturates there):

| device px in my calib | calib | mapped video px | user f691 | delta |
| --- | --- | --- | --- | --- |
| 960,495 (centre) | 228 | 640,390 | 228 | 0 |
| 1200,300 | 228 | 800,259 | 228 | 0 |
| 30,495 | 219 | 20,390 | 217 | -2 |
| 30,40 | 190 | 20,86 | 186 | -4 |
| 1560,150 | 221 | 1040,159 | 217 | -4 |
| 1450,700 | 227 | 967,526 | 228 | +1 |

30 sampled points spanning the frame, all within ±4/255 once points covered by
a HUD panel in either image are excluded. **The pale field is this app's post
chain over a saturated-white scene input, vignetted across the FULL canvas
width.** So the frame was rendered full-width and only its left 5/6 reached
the display.

**1.3 A cleared drawing buffer is BLACK, not pale.** Measured directly in
Chromium (`/tmp/cw.js`): with `alpha:false`, assigning a *different* value to
`canvas.width` clears the buffer to `[0,0,0,255]`; assigning the *same* value
leaves the contents intact. That kills "the compositor showed the cleared
buffer" as an explanation of the COLOUR (it stays a real hazard for a
different-looking flash), and it is also the measurement the fix's no-op
argument rests on (§3).

**1.4 Display geometry.** The recording is a 2x downscale of a ~2560-wide
screen at 150% scaling: the browser chrome measures 59 video px = 118 device
= 78.7 CSS px, which is Edge's chrome height; the HUD readout row measures
485 video px against 640 CSS px in my own run (ratio 0.758 ≈ 0.75). So
devicePixelRatio 1.5, boot dpr = min(CANVAS.dprMax 1.5, 1.5) = 1.5, and the
ladder's first rung is 1.5 → 1.25. The 5/6 boundary is that rung.

---

## 2. Root cause — the measured ordering

`scripts/r22p1-a-probe.js` patches `HTMLCanvasElement.prototype.width/height`
(the only write that reallocates the drawing buffer), `renderer.setPixelRatio`
/`setSize`, `composer.setSize` and `composer.render`, and stamps every row
with whether it happened inside a rAF callback. Pre-fix trace, verbatim, one
forced down-step:

```
t=21459.0  FORCE(-1)                                      (governor step)
t=21465.0  gl.setPixelRatio(1.25)   inRaf=FALSE  dbw 1920
t=21465.0  gl.setSize(1280,660,false) inRaf=FALSE
t=21465.7  canvas.width  1920 -> 1600  inRaf=FALSE   <-- REALLOC + CLEAR
t=21466.1  canvas.height  990 ->  825  inRaf=FALSE   <-- REALLOC + CLEAR
t=21466.1  gl.setSize(1280,660,true)   (r3f's own call, same numbers)
t=21468.3  composer.render()  bw=1920  dbw=1600      <-- MISMATCHED FRAME
t=21481.5  composer.setSize(1280,660)  inRaf=FALSE   <-- 15.4 ms later
```

Why: `PerfGovernor`'s `useFrame` raises `setDpr` (React state) inside the rAF;
React schedules the re-render at default priority, so `<Canvas dpr>` →
`root.configure()` → `state.setDpr()` runs in a LATER task. r3f's store
subscriber (`events-*.esm.js` ~line 1163) then calls `gl.setPixelRatio` +
`gl.setSize` **synchronously inside that store write** — i.e. between frames.
`FlyEffectComposer`'s size effect is a PASSIVE effect keyed on `viewport.dpr`,
so it lands a whole frame later still.

Two hazards fall out, both measured:

* **H1 — a reallocated (cleared) drawing buffer exists between animation
  frames.** 24/24 realloc writes happened outside a rAF.
* **H2 — exactly one composed frame per step runs with post-chain buffers that
  disagree with the drawing buffer.** 10–12 per 12 steps across runs.

Neither hazard is disputable; both are 100% reproducible.

### 2.1 The DPR step never produced a pale frame — and that was the clue

~46 forced steps and 4 natural ladder descents, across headless Chrome, headed
Chrome (real GPU), dev, 6x and 8x CPU throttling, dsf 1.5 and 1.0, both
directions: **zero pale frames**. The mismatch frame (H2) renders correctly
here — postprocessing's final pass resamples a 1920-wide input into a
1600-wide viewport and covers it fully.

I treated that as "not reproduced on this hardware" for too long. It was
actually the correct answer: the DPR step does not do this. The pale frame
turned up the moment I ran the gate against a pose the fleet never flies (the
un-warped default spawn, which the production leg had to use because
`window.__fly` is dev-only) — see the headline. Two hazards were real all the
same, and STEP_SAFE closes them; the flash was somewhere else entirely.

### 2.2 The instrument had to be replaced, and that is itself a finding

CDP `Page.startScreencast` — the obvious "see what the user sees" tool — is
**blind to single-frame events**. Calibrated by injecting 8 known one-frame
blanks (`scene.visible=false` for one rAF): the screencast reported 0/8
anomalies over 566 captured frames, while the in-page census saw every one of
them as a 22-draw frame against a 244-draw median. Every gate here therefore
reads the DEFAULT FRAMEBUFFER back in-page (one `readPixels` scanline per
composed frame, immediately after the final pass writes it) instead.

---

## 3. The fix — `STEP_SAFE`

New constants block `STEP_SAFE` (fly-constants.js, appended after
SETTLE_CALM's neighbourhood) + new module `lib/fly/step-safe.js`.

* `perf-governor.js` — `applyDpr` calls `requestDpr(d)`, which PARKS the value
  and returns true. When the flag is off (or `window.__flyStepSafePin==='off'`)
  it returns false and the R22 line `setDpr(d)` runs unchanged.
* `lib/fly/step-safe.js` — `<StepSafeRig>` runs a `useFrame` at priority
  **-99**: after `PerfGovernor` (-100, which decides the step) and long before
  the composer (+1, which draws). It applies `gl.setPixelRatio` +
  `gl.setSize` + `composer.setSize`, then calls `setDpr` — all inside the
  animation frame that then draws.
* `FlyEffectComposer.jsx` — registers the live composer with the rig from an
  EFFECT (not the component body — see §6.3). Its own passive size effect is
  untouched and remains the only resize path for a window resize and for the
  FX_STABILITY-off tree.
* `FlyCanvas.jsx` — mounts the rig on the governor branch only. The legacy
  `<PerformanceMonitor>` branch is byte-identical in both flag states; it steps
  DPR with a FUNCTIONAL `setDpr((d)=>…)` that has no value to park, and R22's
  contract for that path is that it does not move.

Why the React catch-up is safe: after the rig has applied the resize, r3f's
subscriber re-applies `setPixelRatio(1.25)` + `setSize(1280,660)` with
identical numbers. Chromium does not reallocate on an unchanged `canvas.width`
(§1.3), so no clear happens — and the trace proves it: post-fix there are
exactly 2 realloc rows per step (width + height, both in-rAF) and the
catch-up produces none.

Safety valve: `STEP_SAFE.maxDeferMs` (1000 ms). If the rig never consumes a
pending dpr — not mounted, or the tab has been hidden — the value is applied
the legacy way. Losing the ladder's cheapest rung would be worse than the
flash it avoids. Measured `valve: 0` in every run.

**Revert contract:** `STEP_SAFE.enabled:false` ⇒ the rig is not mounted,
`requestDpr` declines, `registerStepSafeComposer` early-returns, and the
governor's `applyDpr` is the R22 line. One flag.

---

## 4. Numbers

### 4.1 RED vs GREEN, same instrument, same machine, same session

Headed Chrome (`channel:'chrome'`, `--enable-gpu`), satellite, Powell OH pose
(40.1748 / -83.1079, 515 m MSL), forced down/up steps from inside a rAF. RED
is reached without a rebuild via `window.__flyStepSafePin='off'`.

| metric | RED (pre-fix) | GREEN (armed) |
| --- | --- | --- |
| realloc writes outside a rAF | **24 / 24** | **0 / 40** |
| `composer.setSize` lag after the realloc | 9.0 – 23.6 ms | **0.3 – 1.1 ms** |
| composed frames with composer buffer ≠ drawing buffer | **10–12 / 12 steps** | **0** |
| same-frame proof (realloc followed by a composed frame with the same `__rafSeq` AND the new width) | **0 / 12** | **20 / 20 per arm** |
| PALE composed frames | 0 (not reproduced) | 0 |
| BLACK composed frames | 0 | 0 |
| draw-count collapses | 0 | 0 |

### 4.2 GREEN coverage

* **dsf 1.5** — 20 forced steps, drawing buffer 1920 ↔ 1600 every time
  (20/20 moved), ladder 7 rungs, 3945 composed frames.
* **dsf 1.0** — 20 forced steps, drawing buffer 1280 ↔ 1120 every time
  (20/20 moved) — this is the SUB-NATIVE rung `1.0 → 0.875` that
  SETTLE_CALM.ladderFix adds; the gate un-pins `__flySettlePin` precisely so
  this arm is not vacuous. 3084 composed frames.
* **live windows** — 180 s un-pinned at the pose per arm: 31,366 + 27,818
  composed frames. Zero pale, zero black, zero collapse, zero mismatch, zero
  out-of-rAF reallocs, zero pageerrors.
* Total composed frames read back: **59,184 + 7,029 forced = 66,213**.

### 4.3 Frozen gates (see §7 for the final quiet-machine table)

---

## 5. New instrument — `scripts/verify-step-clean.js`

Fleet idiom: `bootFly`, `FLY_URL`, per-gate un-pins documented in the header,
a final `VERIFY PASS` / `VERIFY FAIL` line, RED-calibration numbers in the
header measured on the pre-fix tree.

12 gates: precondition · STEP_SAFE armed and consuming · every step really
moved the drawing buffer ("no flash" must not be "no steps") · no realloc
outside a rAF · no buffer mismatch · no PALE frame · no BLACK frame · no draw
collapse · the React catch-up is a no-op · a live window holds · the SAME-FRAME
proof · zero pageerrors.

Pins un-pinned, both deliberate: `__flyGovPin` (this gate drives the ladder)
and `__flySettlePin` (without it a dpr-1 machine has no dpr rung at all and
the dsf-1 arm tests nothing). `scripts/_boot.js` was NOT edited — the gate
uses the existing shared `unpinPins()` helper and the verify-stability
accessor idiom.

It also runs against a PRODUCTION build: `window.__flyGl` is dev-only, so the
gate resolves the renderer off `window.__flyComposer.getRenderer()`.

---

## 6. Decisions, and things that bit

**6.1 `node_modules` was empty.** The worktree's `node_modules` was a junction
into `C:\Users\bfecho\skyloom-3\node_modules`, which contained 0 entries — no
dependency resolved. I ran `npm ci` from my worktree (no dependency added, no
lockfile change); npm replaced the junction with a real `node_modules` inside
the worktree. The main repo tree was not otherwise touched.

**6.2 Forcing from a plain task is not the production path.** The first probe
called `__flyGov.force()` from `page.evaluate`. Production raises the state
change from inside `useFrame`, and React schedules a rAF-raised update
differently. Both the probe and the gate now force from inside a
`requestAnimationFrame` callback.

**6.3 Handles installed from a component body bind to the dead instance.**
Flagged by the orchestrator from Agent B's finding (React 19 StrictMode
constructs two TerrainEngines). Checked here: `registerStepSafeComposer` and
`registerStepSafeSetDpr` are both called from `useEffect`, keyed on the object
they register, with disposers that only clear if they still own the slot — so
a StrictMode double-mount leaves the LIVE composer registered. Two concurrent
`StepSafeRig` subscribers would also be safe: the first consumes the pending
value, the second sees `null` and returns.

**6.4 `window.__composed = []` inside `page.evaluate` aliased a dead array.**
The census closure captured the original array; reassigning the global gave me
an empty one to read. Caught by gate (1) reporting `frames 0` — which is
exactly why that precondition gate exists. Fixed with `.length = 0`.

**6.5 Running the R21/R22 gates REWRITES their tracked artifacts.**
verify-stability / verify-tier-step / verify-flicker / verify-settle each
overwrite `scripts/r21-e-*.png|json` and `scripts/r22-e-*.png|json` in place —
E's frozen RED-calibration artifacts. My first commit swept them up (74k lines
of churn in `r21-e-red-stability.json` alone). They were restored to
`5d6c09d` and the commit amended; the branch diff is now only my own files.
Anyone running these gates on a dirty tree should check `git status` before
staging.

**6.6 Contamination, re-run quietly.** Agent B was working the same machine.
Three gate reds proved to be contamination and cleared on a quiet re-run —
recorded here rather than smoothed:

| gate | first read | quiet re-run | cause |
| --- | --- | --- | --- |
| verify-stability (12) parcel carpet | 211 placed | 0 placed | load-dependent (the R21 §5 phenomenon) |
| verify-stability (15) / verify-flicker (6) console errors | Esri CORS failures, then `/api/aircraft` 500s (upstream ECONNRESET) | 0 | live-network flake |
| verify-settle (6) throttled-HDRI stutter | 241.8 ms vs a 200 ms bound | 158.3 ms | CPU contention |

verify-flicker (2)/(4a) went red alongside its console-error gate on the first
run (urban p99 15.6, suburb swings 6) and green on the re-run (10.955 / 0) —
a scene still streaming because its tiles were being CORS-blocked flickers,
so the content reds were downstream of the network red, not independent.

---

## 7. Final run table (quiet machine)

See `.r22p1-a-final.log` for the raw output.

| harness | result | note |
| --- | --- | --- |
| verify-step-clean RED leg (`STEP_PIN_OFF=1`) | FAIL (4)(5)(12) | the calibration — the gate must fail on the pre-fix ordering |
| verify-step-clean (dsf 1.5 + dsf 1.0) | PASS | 12/12 gates, both arms |
| verify-stability | PASS | 17/17, assertion numbers unchanged |
| verify-tier-step | PASS | 11/11, assertion numbers unchanged |
| verify-flicker | PASS | 7/7, assertion numbers unchanged |
| verify-settle | PASS | 14/14, assertion numbers unchanged |
| `npm run build` | PASS | |

Zero frozen assertion numbers moved. No sanctions requested.

---

## 7.1 The production leg — where the real defect surfaced

`npm run build` passes. The gate can be pointed at `next start` (it resolves
the renderer off `composer.getRenderer()` because `window.__flyGl` is
dev-only), and against production it flies the un-warped default spawn because
`window.__fly.warpToGeo` is dev-only too.

Production leg, dsf 1.5, 16 forced steps + a 45 s live window:

| gate | result |
| --- | --- |
| (2) STEP_SAFE armed + consuming | PASS — 16 requested / 16 applied / valve 0 |
| (3) every step moved the drawing buffer | PASS — 16/16, 1920 ↔ 1600 |
| (4) no realloc outside a rAF | PASS — 0/32 |
| (5) no buffer mismatch | PASS — 0 |
| (12) same-frame proof | PASS — 16/16 |
| (6)/(10) no PALE composed frame | **FAIL — 5 pale frames** |

STEP_SAFE therefore works identically under the production React build. The
PALE failures are the cloud defect, at a pose the frozen fleet never flies:
3 of the 5 were nowhere near a realloc, all had normal draw counts and
agreeing buffers, and two were 313 ms apart. That failure is the reason this
round has a real root cause instead of a plausible one — the content gate did
its job on the first pose that was not the pinned harness pose.

**Consequence for the gate:** with no warp available, the pose is
uncontrolled, so the PALE/BLACK content gates cannot distinguish "the world
went white" from "a cloud crossed the lens". They stay BLOCKING at the
controlled Powell pose (dev), where they are 0 over 66,213 frames. Whoever
adds a production leg to the fleet must either demote them to informational
there or park the cloud deck first.

---

## 8. Open risks

1. **THE USER'S DEFECT IS STILL OPEN.** STEP_SAFE does not fix it. The cloud
   fix is unimplemented and unowned. Until it lands the user will keep seeing
   the flash, and a re-report must not be read as "the fix failed".
2. **Window resizes are not covered.** A CSS `size` change goes through the
   same r3f subscriber, outside the frame loop, and STEP_SAFE only intercepts
   the DPR path. Deliberate: minimal, targeted change. A resize is user-driven
   and already visually eventful; a governor step is not.
3. **The FX_STABILITY-off configuration only gets the renderer half.** The
   library composer does not register, so its buffers still catch up in a
   passive effect. Documented in `registerStepSafeComposer`.
4. **The legacy PerformanceMonitor path still has the defect.** Untouched by
   design (byte-identity contract). It is only reachable with
   `PERF_GOVERNOR.enabled:false`.
5. **The cloud reproduction is at the NYC default spawn, not the user's
   Powell pose.** At Powell (AGL 233 m, weather pinned baseline) I saw zero
   pale frames in 66,213 composed frames. The user was at AGL 233 m too — but
   in production, with LIVE weather, which drives cloud coverage and the deck
   the harness fleet never sees (`__flyWeatherOverride='baseline'` is a fleet
   pin). Whoever takes the cloud fix should reproduce with the weather pin
   OFF, not just at a different pose.
6. **A defect this visible survived a full R22 certification** because every
   browser gate flies pinned weather, a pinned pose and a pinned governor. The
   first uncontrolled pose in this round found it in under three minutes.
