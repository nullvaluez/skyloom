# R24 — USER DIAGNOSIS PACK (10 minutes, on YOUR machine)

This is the round's real RED. Every fps / ms / stutter / tearing number has to
come from your machine: the cloud container this round is built in has no GPU
(software rasteriser, ~1 frame per second under the game's load) and cannot
reach the tile, elevation or flight-data servers at all. So nothing measured
there can tell us whether the world is smooth on yours.

Run **Part A on the build you have now**, before any R24 fix lands. Then, when
R24 is ready, run the identical Part A again and we compare like with like.

---

## Part 0 — four questions (answer in one line each)

1. **Which build(s) showed the bad tearing / glitching?** The R21 build (what
   `main` is today), the later R22 / R22.1 / R23 deploy, or **both**?
2. **Which symptoms did you actually see** (tick the ones you saw, cross the
   ones you did not — a crossed-out symptom is as useful as a ticked one):
   - a single white / pale frame that flashes and is gone
   - a freeze of a fraction of a second, then the world snaps forward
   - **buildings appearing and disappearing** ← reported, please confirm where
   - **terrain tiles swapping for other tiles** ← reported, please confirm
   - HUD labels swimming or lagging behind the world in turns
   - the picture going soft and then sharp again
   - blurry terrain at the edges of the screen while banking
   - shimmering / crawling detail on the ground
   - a real tear line: the top half of the screen showing a different moment
     than the bottom half
3. **Your machine:** GPU, screen resolution, browser zoom / OS display scaling
   (this sets devicePixelRatio), refresh rate (60 / 120 / 144 Hz), browser and
   version, windowed or fullscreen.
4. **Which style** were you flying — satellite or Neon (toy)?

---

## Part A — the 3-minute flight (the numbers)

### A1. Open the console collector

Open the game, then open DevTools (F12) → Console, and paste this **before**
you start flying. It is self-contained: it works on **any** build, including
one with no instrumentation in it at all.

```js
(() => {
  const S = (window.__diag = {
    dt: [], long33: 0, long100: 0, worst: 0, longtasks: 0, longtaskMs: 0,
    ready: [], tiles: [], sec: [], t0: performance.now(), last: performance.now(),
  });
  const rd = () => ({
    sb: window.__satBuildings?.stats?.ready ?? null,
    sky: window.__satSkyline?.stats?.ready ?? null,
    tiles: window.__flyStats?.terra?.resident ?? null,
    adds: window.__flyStats?.terra?.adds ?? null,
    removes: window.__flyStats?.terra?.removes ?? null,
    draws: window.__flyStats?.drawCalls ?? null,
    tris: window.__flyStats?.triangles ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    dpr: window.devicePixelRatio,
  });
  let prev = rd();
  S.timer = setInterval(() => {
    const now = rd();
    S.sec.push({
      t: +((performance.now() - S.t0) / 1000).toFixed(1),
      // per-second DELTAS: this is what turns "buildings vanish" into a number
      dReady: (now.sb ?? 0) - (prev.sb ?? 0),
      dSky: (now.sky ?? 0) - (prev.sky ?? 0),
      dTiles: (now.tiles ?? 0) - (prev.tiles ?? 0),
      adds: (now.adds ?? 0) - (prev.adds ?? 0),
      removes: (now.removes ?? 0) - (prev.removes ?? 0),
      draws: now.draws, tris: now.tris, tier: now.tier, dpr: now.dpr,
    });
    prev = now;
  }, 1000);
  const tick = (t) => {
    const d = t - S.last; S.last = t;
    S.dt.push(+d.toFixed(2));
    if (d > 33) S.long33++;
    if (d > 100) S.long100++;
    if (d > S.worst) S.worst = d;
    if (S.dt.length > 40000) S.dt.shift();
    S.raf = requestAnimationFrame(tick);
  };
  S.raf = requestAnimationFrame(tick);
  try {
    S.obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { S.longtasks++; S.longtaskMs += e.duration; }
    });
    S.obs.observe({ entryTypes: ['longtask'] });
  } catch {}
  S.stop = () => {
    cancelAnimationFrame(S.raf); clearInterval(S.timer); try { S.obs.disconnect(); } catch {}
    const a = S.dt.slice().sort((x, y) => x - y);
    const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    const mins = (performance.now() - S.t0) / 60000;
    return {
      frames: a.length, minutes: +mins.toFixed(2),
      p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: +S.worst.toFixed(1),
      long33PerMin: +(S.long33 / mins).toFixed(1),
      long100PerMin: +(S.long100 / mins).toFixed(1),
      longtasks: S.longtasks, longtaskMs: Math.round(S.longtaskMs),
      refreshHz: Math.round(1000 / q(0.5)), dpr: window.devicePixelRatio,
      screen: [screen.width, screen.height], inner: [innerWidth, innerHeight],
      gpu: (() => { try { const c = document.createElement('canvas').getContext('webgl2');
        const d = c.getExtension('WEBGL_debug_renderer_info');
        return c.getParameter(d.UNMASKED_RENDERER_WEBGL); } catch { return null; } })(),
      perSecond: S.sec,
    };
  };
  console.log('diag armed — fly for 3 minutes, then run: copy(__diag.stop())');
})();
```

### A2. Fly this, for three minutes

- **Satellite** style, quality on whatever it picks by itself (do not force it).
- Warp to **Powell, Ohio** and descend to **200–400 m above the ground**.
- Fly a lazy **S-curve toward Columbus** — turn left for ~10 s, right for ~10 s,
  and keep repeating. Bank properly; the reported symptoms are turn-related.
- Around the two-minute mark, **climb to ~2 km and dive back to 300 m** once.
- Do not touch the console while flying.

### A3. Copy the numbers back

```js
copy(__diag.stop())
```

and paste the result into the chat. On an **R24** build also run, and paste:

```js
copy(window.__flyStats.frame.sample())   // R24 only — the in-app instrument
copy(window.__flyStats)                  // R24 only — everything else
```

(If `window.__flyStats.frame` is undefined on an R24 build, `FRAME_STATS` is
still flag-off. Say so and paste `copy(window.__flyStats)` alone.)

---

## Part B — the 30-second "buildings vanish / tiles swap" recording

This is the one that pins down what you actually saw. It needs a screen
recording, and it needs the collector above to be running at the same time so
the picture and the numbers line up.

1. Re-arm the collector from A1 (or just leave it running).
2. Start a screen recording — OBS, or Windows `Win+Alt+R`, or macOS
   `Shift+Cmd+5`. **Record the whole window, at your monitor's refresh rate if
   the recorder offers a choice.** A phone camera pointed at the screen is a
   perfectly good fallback for a tear line, and is in fact *better* than a
   software recorder for that one symptom, because a software recorder
   composites and can hide it.
3. In those 30 seconds, at 200–400 m over Powell:
   - hold a **hard left bank for 5 s**, level, then a **hard right bank for 5 s**
     (buildings disappearing at the screen edge shows up here),
   - then fly **straight and level toward Columbus for 10 s** watching the
     ground ahead (a tile swapping for another tile shows up here — with R24's
     test world each tile is stamped with its own z/x/y, but on your live build
     look for a square of ground suddenly changing sharpness or colour),
   - then **climb 500 m** in the last 10 s.
4. Stop the recording. Run `copy(__diag.stop())` and paste that too.
5. When you send the clip, note the **timestamps in it** where you saw
   something wrong ("3 s in, a whole block of buildings blinked out"). The
   per-second `perSecond` rows in the pasted JSON have a `t` in seconds from
   when the collector was armed, so a timestamp lets us line the two up:
   a `removes` spike or a negative `dReady` at the same second is the
   mechanism, and if BOTH are flat at that second the cause is somewhere else
   and we look elsewhere rather than guessing.

---

## Part C — running the harness fleet on your machine (optional, ~30 min)

Only if you want to; the numbers above are the important part.

The fleet needs a dev server and a Chrome. From a fresh checkout of the R24
branch:

```bash
npm install
npm run dev -- -p 3019          # leave this running in its own terminal
```

Then in a second terminal (repo root), the R21 quartet plus the new gates:

```bash
FLY_URL=http://localhost:3019 node scripts/verify-stability.js
FLY_URL=http://localhost:3019 node scripts/verify-flicker.js
FLY_URL=http://localhost:3019 node scripts/verify-tier-step.js
FLY_URL=http://localhost:3019 node scripts/verify-seam.js
FLY_URL=http://localhost:3019 node scripts/verify-frame-pace.js
FLY_URL=http://localhost:3019 node scripts/verify-flash-guard.js
FLY_URL=http://localhost:3019 node scripts/soak-fly.js --satellite --minutes 15
```

Those commands assume the harnesses' own assumption: **Google Chrome stable is
installed** (they launch `channel: 'chrome'`). That is true on your machine and
false in the cloud container, which is why the container runs them through
`node -r ./scripts/_pw-shim.js …` instead. If Chrome is missing, or you want to
force the bundled Chromium, the shim works on your machine too and
`PW_CHANNEL=chrome` restores the harness authors' exact launch:

```bash
PW_CHANNEL=chrome FLY_URL=http://localhost:3019 \
  node -r ./scripts/_pw-shim.js scripts/verify-stability.js
```

Paste the last ~20 lines of each run (the PASS/FAIL block and the RED TABLE).

---

## What each answer buys

| You give us | It decides |
|---|---|
| Part 0 Q1 (which build) | whether R22/R23 introduced the glitching or R21 already had it — that is the difference between "re-implement carefully" and "there is a defect in the base we have not found" |
| Part 0 Q2 (symptom ticks) | which of the five workstreams is on the critical path, and which fixes we can stop building |
| Part 0 Q3 (machine) | whether the DPR ladder has any rungs at all on your display, and what refresh the governor should be targeting |
| `p99`, `worst`, `long100PerMin` | the RED for `verify-frame-pace`; the container can only prove the instrument publishes, not what it should read |
| `perSecond` `removes` / `dReady` spikes | whether "buildings disappearing" is an evict, a cull, or a recompile — three different fixes |
| the 30 s clip | whether the tear line is real tearing (vsync) or a one-frame content glitch; they look identical in a still and are not the same bug |
| Part C runs | real green/red for the R21 quartet on this tree — the in-tree record has none (the round was pushed mid-certification) |
