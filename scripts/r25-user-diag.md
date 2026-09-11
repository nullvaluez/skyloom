# R25 — THE DIAGNOSIS PACK (do this first, before we build anything)

**Written for a person who has never opened a browser console.** Every step
says exactly what to type and exactly what to send back. Nothing here changes
your game — it only measures it.

**Why you, and why now.** R25 exists because of three things you said: on the
ground the immersive feel still lacks, at night the ground is dark with copper
striping for roads, and the lighting feels flat. We are about to spend a whole
round on those. But the machine we build on cannot see any of them:

| | Your machine | Ours |
|---|---|---|
| GPU | RTX 5080 | a **software** rasteriser at **1–3 frames per second** |
| Satellite imagery (Esri) | works | **blocked** |
| Map data (OpenFreeMap) | works | **blocked** |
| Live aircraft (adsb) | works | **blocked** |
| Google Chrome | installed | **not installed** |

So **every frame-rate, smoothness, stutter and "does it look better" number in
this round is one you take, not one we take.** This pack is the BEFORE. Without
it the round has nothing to prove it improved anything — we would be shipping
on opinion. It takes about 25 minutes.

> **Send back:** one text file (or just paste into chat) with the four JSON
> blobs from Parts C and D, the five screenshots from Parts D and E, and the
> last ten lines of Part F. If something doesn't work, send what you got and
> say where it stopped — a step that fails is itself a result.

---

## Part A — get the tree running (about 5 minutes)

Open a terminal in your clone of the repo and run these four lines, one at a
time:

```
git fetch --all
git checkout claude/happy-planck-dw8yyf
npm install
npm run dev -- -p 3019
```

The last one keeps running and prints something like `Local:
http://localhost:3019`. **Leave that terminal open for the whole pack.** Every
later step needs it.

- Port **3019** is deliberate: six agents are each using their own port, and
  3019 is yours. Nothing collides.
- `claude/happy-planck-dw8yyf` is this round's branch. All six R25 features on
  it are **switched off**, so what you are about to measure is exactly today's
  game — the one you have been complaining about. That is the point.

Now open **Google Chrome** and go to `http://localhost:3019`. Let it boot all
the way (the loading screen reaches 100% and the world appears).

---

## Part B — open the console (about 1 minute, once)

The console is where you paste one-line commands and read answers back.

1. In Chrome, press **F12** (or `Ctrl`+`Shift`+`J` on Windows/Linux,
   `Cmd`+`Option`+`J` on a Mac).
2. A panel opens. Click the tab called **Console**.
3. Click into the empty line at the bottom — the one with a `>` in front of it.
4. Chrome may print a red warning about pasting. If it does, type the words
   `allow pasting` and press Enter once. You only ever do this once.

From here on, "**paste this**" means: click that `>` line, paste the text,
press Enter.

**A 10-second sanity check.** Paste this:

```js
!!window.__fly && !!window.__flyStats && !!window.__flyStats.frame
```

You should see `true`. If you see `false`, the world had not finished booting —
wait ten seconds and paste it again. If it is still `false` after a minute,
stop and tell us; nothing below will work and that is itself the first finding.

---

## Part C — THE DAY RUN (Powell, Ohio, 80–150 m up, 2 minutes)

This is the pose your complaint is about: low and slow over a normal American
suburb, in daylight.

### C1. Go there

Paste this **one line**:

```js
window.__fly.warpToGeo(40.1578, -83.0752, { altM: 360, name: null })
```

The screen flashes and you arrive over Powell. `altM` is height above **sea
level**, and Powell's ground is about 280 m, so 360 puts you roughly 80 m up.

### C2. Check how high you actually are

Paste this:

```js
Math.round(window.__fly.flight.pos.y - window.__fly.flight.groundElev) + ' m AGL'
```

It prints something like `"78 m AGL"`. **We want a number between 80 and 150.**
If it is much lower or higher, fly up or down with the stick for a moment and
paste the line again. Don't fuss — anywhere in the band is fine.

### C3. Start the stopwatch

Paste this to zero the measurement:

```js
window.__flyStats.frame.reset(); 'measuring — now fly for 2 minutes'
```

### C4. Fly for two minutes

**Now actually play.** Stay low — between about 80 and 150 m AGL — and fly
around Powell for two full minutes. Turn. Look around. Use boost. Fly over the
houses, over the trees, over a road. Do the thing that feels bad. If you see a
stutter, a freeze, a tear, a pop — good, keep flying, we are recording it.

Do **not** open the map, the pause menu or the logbook during these two
minutes: those stop the world and would flatter the numbers.

### C5. Copy the result

Paste this:

```js
copy(JSON.stringify(window.__flyStats.frame.sample(), null, 2))
```

It prints `undefined` — that is normal and correct. The result is now on your
clipboard. **Paste it into your reply and label it `C — DAY, Powell 80–150 m`.**

Then paste this second line and send its answer too, labelled `C — scene`:

```js
copy(JSON.stringify({ draws: window.__flyStats.drawCalls, tris: window.__flyStats.triangles, sun: window.__flyStats.sunFactor, tier: window.__flyStore.getState().qualityTier, style: window.__flyStore.getState().mapStyle }, null, 2))
```

<details>
<summary>What we will read out of it (you don't need to)</summary>

`p50` / `p95` / `p99` are frame times in milliseconds — at 60 Hz a perfect
frame is 16.7. `long33PerMin` counts dropped frames per minute, `long100PerMin`
counts visible freezes, `stallsPerMin` counts stutters by R22.1's definition.
`lastStall.phases` names what the engine was doing when the worst one happened.
`programsDelta` says whether shaders were still compiling mid-flight, which is
the usual cause of a freeze-and-snap.
</details>

---

## Part D — THE NIGHT RUN (the copper-striping complaint)

### D1. Make it night

Paste these **two lines**, one after the other:

```js
window.__flySunOverride = Date.UTC(2026, 6, 18, 6, 0)
```
```js
window.__fly.warpToGeo(40.1578, -83.0752, { altM: 360, name: null })
```

The first pins the clock to about 2 a.m. Ohio time. The second re-warps — and
that matters: the sky only re-reads the pinned clock on a warp, so **the warp
is what makes it night**, not the first line on its own.

Give it about 20 seconds to settle, then check:

```js
window.__flyStats.sunFactor
```

A number at or very near `0` means it is properly night. If it is not, wait a
few more seconds and paste it again.

### D2. Fly two minutes at night

Same as Part C: `window.__flyStats.frame.reset()`, then fly low around Powell
for two minutes, then

```js
copy(JSON.stringify(window.__flyStats.frame.sample(), null, 2))
```

**Label it `D — NIGHT, Powell 80–150 m`.**

### D3. The night census

Paste this and send the answer, labelled `D — night census`:

```js
copy(JSON.stringify({ sun: window.__flyStats.sunFactor, sky: window.__flyStats.skyState, env: window.__flyStats.envIntensity, bg: window.__flyStats.bgIntensity, draws: window.__flyStats.drawCalls, tris: window.__flyStats.triangles, houseLights: window.__flyStats.houseLights, satNightGate: window.__flyStats.satNightGate, clutter: window.__flyStats.satClutter }, null, 2))
```

> **A note on honesty.** The plan for this round asked you for
> `copy(__flyStats.night)`. **There is no such handle** — we checked the source
> rather than assume. The line above asks for the handles that actually exist
> and together answer the same question: how dark the ground is, what the sky
> thinks time it is, and how many light sources are on.

### D4. Three screenshots — THE "BEFORE" PICTURES

These are the pictures the whole round will be judged against, so take them
carefully. For each one: warp, **wait 30 seconds** for the ground to finish
streaming in, press **P** to enter photo mode (this hides the HUD so the
picture is of the world, not of the interface), take the screenshot with your
OS, then press **P** again to leave.

| # | Where | Paste this | Name the file |
|---|---|---|---|
| 1 | Powell, 80 m | `window.__fly.warpToGeo(40.1578, -83.0752, { altM: 360, name: null })` | `before-night-powell-80.png` |
| 2 | Columbus, 250 m | `window.__fly.warpToGeo(39.9612, -82.9988, { altM: 480, name: null })` | `before-night-columbus-250.png` |
| 3 | Manhattan, 792 m | `window.__fly.warpToGeo(40.7549, -73.984, { altM: 800, name: null })` | `before-night-manhattan-792.png` |

Keep the sun override pinned for all three — do not reload the page between
them, or it goes back to daytime.

### D5. Put the clock back (when you are done)

```js
window.__flySunOverride = null
```

---

## Part E — THE PHONE (two screenshots)

On your phone, on the same Wi-Fi, open the address the dev-server terminal
printed next to **Network** (it looks like `http://192.168.x.x:3019`).

Let it boot, then take **two screenshots of the flying HUD**:

1. **portrait** — hold the phone upright. Name it `before-phone-portrait.png`.
2. **landscape** — turn the phone sideways, wait for the layout to settle, take
   it again. Name it `before-phone-landscape.png`.

Take both while actually flying (not in a menu). These are the "before" for the
one-button fan.

If the phone cannot reach the address, say so — that is worth knowing, and we
can fall back to Chrome's device emulation.

---

## Part F — PROVE THE HARNESS MECHANICS, ONCE

Later in this round we will send you a list of about fifteen one-line commands
to run. **We would like to prove the mechanics work now, on one row, while
there is time to fix it** — rather than discover on close day that the format
was wrong.

Leave the dev server running. Open a **second** terminal in the repo and run:

```
FLY_URL=http://localhost:3019 node scripts/verify-mobile.js
```

It opens a headless phone-sized browser, drives the touch controls and prints
a list of `PASS` / `FAIL` lines ending with `VERIFY: PASS` or `VERIFY: FAIL`.
It takes a couple of minutes.

**Send back the last ten lines.** Whatever it says is useful:

- `VERIFY: PASS` — the mechanics work and the mobile HUD is healthy today.
- `VERIFY: FAIL` with a few named rows — the rows are the finding.
- `Cannot find module 'playwright'` — your machine needs `npm i -D playwright`
  then `npx playwright install chromium`. Tell us and we will put the install
  line at the top of the close-day list for everyone.

That is the whole point of running one row early: **the failure we want to find
today is the format's, not the feature's.**

---

## What this pack cannot tell us, and who has to say it

Only you can. Please also answer these in your own words — they are not
measurable from any of the above:

1. At 80–150 m by day, what specifically reads as *flat*? The ground texture
   being too smooth? No small objects? Shadows that don't sit under anything?
2. At night, is it "too dark to see the ground" or "the ground is fine but the
   roads are wrong"? If both, which bothers you more?
3. The tearing/glitching from the last round — **is it still there on this
   build**, and if so is it better, worse or the same? (Two rounds of fixes for
   it were never confirmed on your machine.)
4. On the phone: portrait, landscape, or both?

---

## The full command list, to copy in one go

```js
// A — sanity
!!window.__fly && !!window.__flyStats && !!window.__flyStats.frame

// C — day
window.__fly.warpToGeo(40.1578, -83.0752, { altM: 360, name: null })
Math.round(window.__fly.flight.pos.y - window.__fly.flight.groundElev) + ' m AGL'
window.__flyStats.frame.reset(); 'measuring — now fly for 2 minutes'
copy(JSON.stringify(window.__flyStats.frame.sample(), null, 2))
copy(JSON.stringify({ draws: window.__flyStats.drawCalls, tris: window.__flyStats.triangles, sun: window.__flyStats.sunFactor, tier: window.__flyStore.getState().qualityTier, style: window.__flyStore.getState().mapStyle }, null, 2))

// D — night
window.__flySunOverride = Date.UTC(2026, 6, 18, 6, 0)
window.__fly.warpToGeo(40.1578, -83.0752, { altM: 360, name: null })
window.__flyStats.sunFactor
window.__flyStats.frame.reset(); 'measuring — now fly for 2 minutes'
copy(JSON.stringify(window.__flyStats.frame.sample(), null, 2))
copy(JSON.stringify({ sun: window.__flyStats.sunFactor, sky: window.__flyStats.skyState, env: window.__flyStats.envIntensity, bg: window.__flyStats.bgIntensity, draws: window.__flyStats.drawCalls, tris: window.__flyStats.triangles, houseLights: window.__flyStats.houseLights, satNightGate: window.__flyStats.satNightGate, clutter: window.__flyStats.satClutter }, null, 2))

// D4 — the three before-shots (P toggles photo mode; wait 30 s after each warp)
window.__fly.warpToGeo(40.1578, -83.0752, { altM: 360, name: null })
window.__fly.warpToGeo(39.9612, -82.9988, { altM: 480, name: null })
window.__fly.warpToGeo(40.7549, -73.984, { altM: 800, name: null })

// D5 — put the clock back
window.__flySunOverride = null
```

---

*Owner: E CERT. Source of every handle used above, so the next person can check
them rather than trust them: `window.__flyStats.frame` —
`lib/fly/frame-stats.js:16-30` (`FRAME_STATS.enabled` is `true` at
`lib/fly/fly-constants.js:5686`, so the ring is live on a dev build).
`__flySunOverride` — read at `components/fly/FlyScene.jsx:1454` and `:1677`; the
warp-re-read is `scripts/verify-sat-night.js:104` (`warpToGeo` bumps
`warpEpoch`, which is what re-runs the day-cycle effect). `warpToGeo(lat, lon,
opts)` — `components/fly/FlyScene.jsx:1314`, `altM` is ABSOLUTE. `drawCalls` /
`triangles` — `FlyScene.jsx:3033-3034`. The night census handles are each
published under a `NODE_ENV === 'development'` guard by their own layer, which
is why Part A says `npm run dev` and not `npm run build`.*
