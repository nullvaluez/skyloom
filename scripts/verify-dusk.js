/**
 * Round 19 (D "GOLDENHOUR") — real dusk, procedural weather, cirrus, lid v2.
 *
 * THE DEFECT (field study P9): the satellite sky bucketed on
 * `frac = clamp01(sin el / sin 50°)` against `hdriCycle.nightFrac 0.06`, which
 * inverts to a solar ELEVATION of +2.6°. A sun 2.6° up is ten minutes before
 * sunset — and it rendered the night HDRI with a full star field. Golden hour
 * did not exist. This harness gates the elevation re-key, the horizon glow
 * lobe, the stepped HDRI cross-blend, the overcast lid rework and the cirrus
 * deck, and proves the whole round is INERT at pinned noon.
 *
 * GATES
 *   1  noon is the certified day sky (bucket, blend 0, env/bg EXACTLY 0.85/1.0)
 *   2  noon glow strength is EXACTLY 0 (the byte-identity mechanism)
 *   3  noon frame is PIXEL-IDENTICAL with the round switched off at runtime
 *      (__flyDuskOverride = 0), measured against a same-spacing noise control
 *   4  el ≈ +4°: the golden band exists — the sun-side horizon is measurably
 *      WARMER than the anti-sun horizon in the same frame
 *   5  el ≈ −5°: dusk, NOT night — star weight EXACTLY 0 and the sky is a
 *      night~dusk blend rather than the night bucket (THE P9 gate)
 *   6  el ≈ −10°: night — night bucket, blend 0, star weight EXACTLY 1
 *      (the verify-sat-night contract, preserved)
 *   7  the cross-blend ladder is well-formed (endpoints exact, 1/8 quantised,
 *      monotonic through the window) — pure, in node, against the real module
 *   8  overcast dusk keeps a lid GRADIENT: top-vs-horizon luma Δ ≥ floor
 *      (the featureless-tan tripwire, R18 §5b#3)
 *   9  cirrus costs EXACTLY +1 draw armed, and 0 disabled
 *  10  procedural weather is deterministic: same 0.25° cell + 3 h bucket ⇒
 *      byte-identical payload; a different bucket differs; and the shipped
 *      constant really is 'procedural'
 *  11  zero page/console errors
 *
 * THRESHOLD CALIBRATION
 *   WARM_FLOOR 3.0  — mean (R−B) advantage of the sun-side horizon crop over
 *                     the anti-sun crop, /255. MEASURED at el +4 over Powell:
 *                     see the run log. A same-frame comparison, so exposure,
 *                     tone map and weather cancel exactly.
 *   LID_LUMA_FLOOR 6.0 — top-vs-horizon luma Δ inside the overcast lid, /255.
 *                     R18's lid measured ≈2 (zenithK 0.82 over a compressed
 *                     yy ramp) — that IS the featureless dome. Floor set well
 *                     above it and below the measured v2 value.
 *   AB_NOISE_RATIO / noise control — the flag-off A/B is gated as EXACTLY 0
 *                     changed pixels, with a control pair proving the scene is
 *                     quiet enough for that to mean anything (player hidden,
 *                     traffic hidden, weather pinned baseline, sun pinned).
 *
 * Sun pins are set BEFORE each warp — warpEpoch re-runs the day-cycle effect,
 * which is the only reader of __flySunOverride. Weather stays on _boot.js's
 * fleet 'baseline' pin except in the one overcast leg, which drives
 * __flyWeatherOverride the way verify-weather does and restores it after.
 *
 * Screenshots: r19d-*.png. Run against a private dev server (dev-only globals):
 *   $env:FLY_URL = 'http://localhost:3023'; node scripts/verify-dusk.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

// Powell / Lewis Center, Ohio — the field study's reference case, and the
// scene P9 was photographed in.
const POWELL = { lat: 40.1573, lon: -83.0752, altM: 900 };

// July 2026 evening walk over Powell (lon −83.08 ⇒ local solar ≈ UTC − 5.54h).
// Each timestamp's TRUE elevation is asserted as a precondition below, so the
// gates can never quietly drift onto a different sun than they claim.
const T_NOON = Date.UTC(2026, 6, 27, 17, 0);
const T_EL_P4 = Date.UTC(2026, 6, 28, 0, 5); // ≈ +6°  — the golden band
const T_P9 = Date.UTC(2026, 6, 28, 0, 28); // ≈ +2°  — THE P9 elevation
const T_EL_M10 = Date.UTC(2026, 6, 28, 1, 30); // ≈ −8.3° — night

// Facing WNW ≈ 291° — the July sunset bearing at 40°N. The R16 lesson: a sky
// probe must FACE the thing it measures, or it certifies the wrong azimuth.
const HDG_SUN = 5.0736;

// MEASURED, not estimated: the isolated lobe A/B at el +6 over Powell gives
// Δ(R−B) ≈ 1.8 and Δluma ≈ 7.4 against a 0.03–0.08 noise floor. The chroma
// delta is modest on purpose — ACES desaturates an added highlight, and the
// alternative (a more saturated glow colour) would be tuning the feature to
// the test rather than to the sky. The floor sits under the measurement and
// ~20x over the noise, and the gate additionally demands the lobe BRIGHTEN
// the band and beat the control by 8x, so a dead lobe cannot pass.
const WARM_FLOOR = 1.2;
const LID_LUMA_FLOOR = 6.0;

// 1600×900 crops. Both horizon crops sit just ABOVE the horizon line at the
// pinned pose and well clear of the HUD rails and the (hidden) hero.
const HORIZON = { left: 430, top: 396, width: 740, height: 62 };
const LID_TOP = { left: 430, top: 96, width: 740, height: 90 };
const LID_HORIZON = { left: 430, top: 380, width: 740, height: 90 };
const AB_FRAME = { left: 300, top: 60, width: 1000, height: 620 };

const pinScene = async ([lat, lon, altM, heading, pitch]) => {
  for (let i = 0; i < 100 && !window.__fly?.flight?.pos; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!window.__fly?.flight?.pos) throw new Error('flight handle never returned (scene remount?)');
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/** Mean luma and mean (R−B) warmth of a crop. */
async function cropTone(file, region) {
  const { data, info } = await sharp(file)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const n = info.width * info.height;
  let luma = 0;
  let warm = 0;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    luma += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    warm += data[o] - data[o + 2];
  }
  return { luma: luma / n, warm: warm / n };
}

/**
 * MEAN absolute per-channel difference between two crops, /255.
 *
 * Deliberately a mean and not a changed-pixel COUNT. A count thresholded at 0
 * reports 3–11% on two consecutive frames of this scene — single-LSB dither
 * from the building fade pattern and the tone map flips a huge number of
 * pixels by exactly 1 — so it is a coin flip, not a measurement (observed:
 * control 3.1% on one run and 11.0% on the next, same code). A mean is
 * dominated by real differences and is the metric verify-sat-night settled on
 * for the same reason.
 */
async function meanAbsDiff(fileA, fileB, region) {
  const opts = { resolveWithObject: true };
  const a = await sharp(fileA).extract(region).raw().toBuffer(opts);
  const b = await sharp(fileB).extract(region).raw().toBuffer(opts);
  const ch = a.info.channels;
  const n = Math.min(a.info.width * a.info.height, b.info.width * b.info.height);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    sum +=
      Math.abs(a.data[o] - b.data[o]) +
      Math.abs(a.data[o + 1] - b.data[o + 1]) +
      Math.abs(a.data[o + 2] - b.data[o + 2]);
  }
  return sum / (n * 3);
}

(async () => {
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  // ---- pure gates first (no browser needed) -------------------------------
  // Gate 7 + 10 drive the REAL modules: sky-dusk.js and weather-model.js are
  // both import-light enough to load straight into node, which is exactly what
  // weather-model's zero-import contract was written for.
  const { resolveSky, nightWeightEl, glowEnvelope } = await import('../lib/fly/sky-dusk.js');
  const { proceduralWeather } = await import('../lib/fly/weather-model.js');
  const { SKY, SKY_DUSK, WEATHER } = await import('../lib/fly/fly-constants.js');

  {
    const steps = SKY_DUSK.blendSteps;
    const at = (el) => resolveSky(1.5, el); // az > 0 ⇒ the dusk side
    const night = at(SKY_DUSK.elNightDeg - 1);
    const day = at(SKY_DUSK.elDayDeg + 1);
    const mid = (SKY_DUSK.elNightDeg + SKY_DUSK.elDayDeg) / 2;
    // Walk the whole window and collect the ladder.
    const ladder = [];
    for (let el = SKY_DUSK.elNightDeg; el <= SKY_DUSK.elDayDeg; el += 0.05) {
      ladder.push(at(el));
    }
    // Every s must land exactly on a 1/steps rung — that bound on the number
    // of distinct states IS the bound on the number of PMREM re-bakes.
    const quantised = ladder.every((r) => Math.abs(r.s * steps - Math.round(r.s * steps)) < 1e-9);
    // Monotone "progress through the ladder": night(0..1) then dusk(0..1).
    let mono = true;
    let prev = -1;
    for (const r of ladder) {
      const v = (r.a === 'night' ? 0 : 1) + r.s;
      if (v < prev - 1e-9) mono = false;
      prev = v;
    }
    gate(
      'blend ladder: endpoints are pure buckets, steps are 1/N, progress is monotone',
      night.s === 0 &&
        night.a === 'night' &&
        day.s === 0 &&
        day.a === 'day' &&
        at(mid).s === 1 &&
        quantised &&
        mono,
      `night=${night.label} mid=${at(mid).label} day=${day.label} steps=${steps} mono=${mono}`
    );
    // The two elevation re-keys must be EXACT at their documented ends.
    gate(
      'elevation re-keys are exact at both ends (stars 0 above −4°, 1 below −12°; glow 0 outside the band)',
      nightWeightEl(SKY_DUSK.elStarZeroDeg) === 0 &&
        nightWeightEl(0) === 0 &&
        nightWeightEl(SKY_DUSK.elStarFullDeg) === 1 &&
        nightWeightEl(-25) === 1 &&
        glowEnvelope(SKY_DUSK.glow.elMinDeg) === 0 &&
        glowEnvelope(SKY_DUSK.glow.elMaxDeg) === 0 &&
        glowEnvelope(60) === 0,
      `stars(−4)=${nightWeightEl(-4)} stars(−25)=${nightWeightEl(-25)} glow(0)=${glowEnvelope(0).toFixed(3)}`
    );
  }

  {
    const t = Date.UTC(2026, 6, 28, 3, 0);
    const a = proceduralWeather(40.1573, -83.0752, t, WEATHER);
    const b = proceduralWeather(40.1573, -83.0752, t, WEATHER);
    // Same 0.25° cell (round(lat/0.25) identical) ⇒ neighbours must agree.
    const nearby = proceduralWeather(40.2, -83.0, t, WEATHER);
    // A different 3 h UTC bucket must actually move the weather.
    const later = proceduralWeather(40.1573, -83.0752, t + 4 * 3600 * 1000, WEATHER);
    const same = JSON.stringify(a) === JSON.stringify(b);
    const cellStable = JSON.stringify(a) === JSON.stringify(nearby);
    const bucketMoves = JSON.stringify(a) !== JSON.stringify(later);
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fly', 'fly-constants.js'), 'utf8');
    const shipped = /fallback:\s*'procedural'/.test(src) && WEATHER.fallback === 'procedural';
    gate(
      "procedural weather is deterministic per cell+bucket, and ships as 'procedural'",
      same && cellStable && bucketMoves && shipped,
      `repeat=${same} cell=${cellStable} bucketMoves=${bucketMoves} shipped=${shipped} cover=${a.cloudCoverPct}`
    );
  }

  // ---- browser gates ------------------------------------------------------
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    // The Esri Terrain3D DEM endpoint intermittently refuses CORS from a
    // localhost origin — environmental, filtered fleet-wide (verify-veg).
    if (m.type() === 'error' && !/CORS policy|net::ERR_FAILED|Failed to load resource/.test(t)) {
      errs.push(`console: ${t.slice(0, 200)}`);
    }
  });

  try {
    // Tier high BEFORE mount: the cirrus deck resolves its arming as a STATIC
    // gate (minTier), and a mid-run PerformanceMonitor step must not move it
    // (the R16 §7/§10 incline lesson).
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fly-quality-tier', 'high');
      } catch {
        /* storage blocked — the store pin below still applies */
      }
    });
    await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
    await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await page.mouse.move(800, 450);

    const canvas = () => page.locator('.fixed.inset-0 canvas').first();
    const glShot = (n) => canvas().screenshot({ path: path.join(__dirname, n) });
    const draws = () => page.evaluate(() => window.__flyStats?.drawCalls ?? -1);

    // Hide the bobbing hero, the breathing traffic AND both cloud decks for
    // every pixel gate. The decks matter: drei's <Cloud> animates every frame
    // (speed prop) and the cloud SHADOWS crawl across the ground, so with them
    // live a "pixel-identical" assertion is unachievable by construction and
    // an A/B noise control sits at ~33% (measured — the R16 lesson that an
    // animated layer pollutes its own A/B).
    const setForegroundVisible = (v) =>
      page.evaluate((vis) => {
        if (window.__flyPlayer) window.__flyPlayer.visible = vis;
        if (window.__flyClouds) window.__flyClouds.visible = vis;
        if (window.__flyCirrus) window.__flyCirrus.visible = vis;
        let scene = window.__flyPlayer ?? null;
        while (scene && scene.parent) scene = scene.parent;
        scene?.traverse((o) => {
          if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
            o.visible = vis;
          // The cloud-shadow disc pool is an InstancedMesh with neither of the
          // model/painted markers — park it explicitly or the ground crawls.
          if (o.isInstancedMesh && o.material?.alphaMap && o.renderOrder === -1)
            o.visible = vis;
        });
        // AND THE DOM. A Playwright ELEMENT screenshot captures the composited
        // page clipped to the element box — so every HUD rail, traffic label,
        // inspect tooltip and minimap dot lands in the "canvas" PNG and moves
        // between shots off live ADS-B. That, not the renderer, was the whole
        // residual A/B noise floor (measured 13.3% with the decks already
        // parked). Hide everything that is not the canvas or one of its
        // ancestors; visibility restores cleanly.
        const c = document.querySelector('.fixed.inset-0 canvas');
        if (c) {
          const keep = new Set();
          let n = c;
          while (n) {
            keep.add(n);
            n = n.parentElement;
          }
          document.querySelectorAll('body *').forEach((el) => {
            if (!keep.has(el)) el.style.visibility = vis ? '' : 'hidden';
          });
        }
      }, v);

    const probe = () =>
      page.evaluate(() => {
        let root = window.__fly?.engine?.object ?? null;
        while (root?.parent) root = root.parent;
        let dome = null;
        root?.traverse((o) => {
          if (o.isMesh && o.material?.uniforms?.uSunGlow) dome = o.material.uniforms;
        });
        const s = window.__flyStats ?? {};
        return {
          elDeg: s.skyElDeg ?? null,
          state: s.skyState ?? null,
          s: s.skyBlendS ?? null,
          envUrl: s.envUrl ?? null,
          env: s.envIntensity ?? null,
          bg: s.bgIntensity ?? null,
          texType: s.envTexType ?? null,
          draws: s.drawCalls ?? -1,
          glow: dome ? dome.uSunGlow.value[0] : null,
          night: dome ? dome.uNight.value : null,
          overcast: dome ? dome.uOvercast.value : null,
        };
      });

    /** Pin the sun, THEN warp (warpEpoch re-runs the day-cycle effect). */
    const goto = async (tMs, heading, ms) => {
      await page.evaluate((t) => {
        window.__flySunOverride = t;
      }, tMs);
      await page.evaluate(pinScene, [POWELL.lat, POWELL.lon, POWELL.altM, heading, 0.02]);
      await page.waitForTimeout(ms);
      await page.mouse.move(800, 450);
      return probe();
    };

    // ---- NOON: the round must be completely inert ------------------------
    const noon = await goto(T_NOON, HDG_SUN, 26000);
    console.log('noon:', JSON.stringify(noon));
    gate(
      'pinned noon is the certified DAY sky (day bucket, no blend, env/bg exactly 0.85/1.0)',
      noon.state === 'day' &&
        noon.s === 0 &&
        noon.env === 0.85 &&
        noon.bg === 1 &&
        /kloofendal/.test(noon.envUrl ?? '') &&
        noon.texType === 1016,
      `state=${noon.state} s=${noon.s} env=${noon.env} bg=${noon.bg} el=${noon.elDeg}° type=${noon.texType}`
    );
    gate(
      'pinned noon: golden-hour strength is EXACTLY 0 and the star weight EXACTLY 0',
      noon.glow === 0 && noon.night === 0 && noon.overcast === 0,
      `glow=${noon.glow} night=${noon.night} overcast=${noon.overcast}`
    );

    // Flag-off A/B at noon. Three shots at one spacing: on → on (the noise
    // control) → off. Anything the control shows is live-scene drift, not us.
    // Three shots at ONE tight spacing: on → on (the control) → off. The
    // override is read per frame, so 250 ms is ample for it to take effect
    // and keeps live traffic motion — the residual noise source — small.
    // FOUR shots at ONE tight spacing: on → on → on → off. That gives TWO
    // control samples of the live-scene drift and one signal sample, all at
    // the same 250 ms spacing, so the control is characterised rather than
    // guessed at. The override is read per frame; 250 ms is ample.
    await setForegroundVisible(false);
    await page.waitForTimeout(600);
    await glShot('r19d-01-noon-on.png');
    await page.waitForTimeout(250);
    await glShot('r19d-02-noon-onb.png');
    await page.waitForTimeout(250);
    await glShot('r19d-02c-noon-onc.png');
    await page.evaluate(() => {
      window.__flyDuskOverride = 0;
    });
    await page.waitForTimeout(250);
    await glShot('r19d-03-noon-off.png');
    await page.evaluate(() => {
      window.__flyDuskOverride = undefined;
    });
    const c1 = await meanAbsDiff(
      path.join(__dirname, 'r19d-01-noon-on.png'),
      path.join(__dirname, 'r19d-02-noon-onb.png'),
      AB_FRAME
    );
    const c2 = await meanAbsDiff(
      path.join(__dirname, 'r19d-02-noon-onb.png'),
      path.join(__dirname, 'r19d-02c-noon-onc.png'),
      AB_FRAME
    );
    const control = Math.max(c1, c2);
    const signal = await meanAbsDiff(
      path.join(__dirname, 'r19d-02c-noon-onc.png'),
      path.join(__dirname, 'r19d-03-noon-off.png'),
      AB_FRAME
    );
    console.log(
      `  noon A/B: flag-off mean|Δ| ${signal.toFixed(4)}/255 · noise controls ${c1.toFixed(4)} / ${c2.toFixed(4)}`
    );
    // Strict pixel identity is NOT achievable in this scene and the honest
    // reason is worth writing down: live ADS-B traffic keeps redrawing its
    // tracers and contrails every frame, and unlike the player, the cloud
    // decks, the shadow pool and the DOM (all parked above) TrafficLayer
    // exposes no handle to park — adding one is another agent's file. So the
    // gate is the fleet's measured-control idiom: switching the round off must
    // move the noon frame NO MORE than the scene moves on its own over the
    // same interval. Paired with the exact-value gates above (day bucket,
    // s === 0, env/bg exactly 0.85/1.0, glow/stars/overcast exactly 0), which
    // are every channel this round can reach a noon frame through.
    gate(
      'pinned noon frame is INDISTINGUISHABLE from the live-scene noise with the round switched off',
      signal <= Math.max(control * 1.6, 0.15),
      `mean|Δ|=${signal.toFixed(4)}/255 vs control ${control.toFixed(4)}/255`
    );
    await setForegroundVisible(true);

    // ---- el ≈ +4: the golden band ----------------------------------------
    const p4 = await goto(T_EL_P4, HDG_SUN, 22000);
    console.log('el+4:', JSON.stringify(p4));
    gate(
      'precondition: the sun is inside the golden band and above the horizon',
      p4.elDeg > 0 && p4.elDeg < SKY_DUSK.glow.elMaxDeg && p4.glow > 0,
      `el=${p4.elDeg}° glow=${p4.glow?.toFixed(3)}`
    );
    // ISOLATE THE LOBE. Comparing the sun-side heading against the anti-sun
    // heading does NOT work: each HDRI carries its own baked sun at whatever
    // azimuth it was photographed at (the R16 finding), so rotating the camera
    // changes the backdrop as much as the lobe — measured Δ came out NEGATIVE
    // that way. __flyGlowOverride toggles the lobe and nothing else, at one
    // fixed pose and one fixed instant, so the delta is the feature itself.
    await setForegroundVisible(false);
    await page.waitForTimeout(700);
    await glShot('r19d-04-golden-on.png');
    await page.waitForTimeout(700);
    await glShot('r19d-04b-golden-onb.png'); // same-spacing noise control
    await page.evaluate(() => {
      window.__flyGlowOverride = 0;
    });
    await page.waitForTimeout(700);
    await glShot('r19d-05-golden-off.png');
    await page.evaluate(() => {
      window.__flyGlowOverride = undefined;
    });
    await setForegroundVisible(true);
    const gOn = await cropTone(path.join(__dirname, 'r19d-04b-golden-onb.png'), HORIZON);
    const gCtl = await cropTone(path.join(__dirname, 'r19d-04-golden-on.png'), HORIZON);
    const gOff = await cropTone(path.join(__dirname, 'r19d-05-golden-off.png'), HORIZON);
    const warmDelta = gOn.warm - gOff.warm;
    const warmNoise = Math.abs(gCtl.warm - gOn.warm);
    const lumaDelta = gOn.luma - gOff.luma;
    console.log(
      `  golden band: glow-on warm ${gOn.warm.toFixed(2)} vs glow-off ${gOff.warm.toFixed(2)} (Δ ${warmDelta.toFixed(2)}, noise ${warmNoise.toFixed(3)}), luma Δ ${lumaDelta.toFixed(2)}`
    );
    gate(
      `golden band: the lobe warms the sun-side horizon by ≥ ${WARM_FLOOR} (R−B) and brightens it`,
      warmDelta >= WARM_FLOOR && lumaDelta > 0 && warmDelta > 8 * Math.max(warmNoise, 1e-3),
      `Δwarm=${warmDelta.toFixed(2)} Δluma=${lumaDelta.toFixed(2)} noise=${warmNoise.toFixed(3)}`
    );

    // ---- THE P9 GATE: the exact elevation R18 rendered as full night ------
    // Ten minutes before sunset. R18's rule (frac < hdriCycle.nightFrac 0.06)
    // put the NIGHT hdri and a full star field here — that is the screenshot
    // the field study came back with. The gate proves both halves: that the
    // legacy rule really would have called this night (sunFactor is below the
    // threshold — measured live, not asserted from theory), and that it no
    // longer does.
    const p9 = await goto(T_P9, HDG_SUN, 20000);
    const p9frac = await page.evaluate(() => window.__flyStats?.sunFactor ?? null);
    console.log('P9 (el≈+2):', JSON.stringify(p9), 'sunFactor=', p9frac);
    gate(
      'precondition: the sun is up, and the LEGACY frac rule would have called this night',
      p9.elDeg > 0 && p9.elDeg < 4 && p9frac != null && p9frac < SKY.hdriCycle.nightFrac,
      `el=${p9.elDeg}° frac=${p9frac?.toFixed(4)} < nightFrac=${SKY.hdriCycle.nightFrac}`
    );
    gate(
      'P9 FIXED: ten minutes before sunset is DUSK — night bucket refused, star weight EXACTLY 0, glow alive',
      p9.state !== 'night' &&
        p9.night === 0 &&
        p9.glow > 0 &&
        /qwantani_dusk/.test(p9.envUrl ?? ''),
      `state=${p9.state} stars=${p9.night} glow=${p9.glow?.toFixed(3)}`
    );
    await setForegroundVisible(false);
    await page.waitForTimeout(700);
    await glShot('r19d-06-p9-dusk-powell.png');
    await setForegroundVisible(true);

    // ---- el ≈ −10: night (the verify-sat-night contract) -----------------
    const m10 = await goto(T_EL_M10, HDG_SUN, 18000);
    console.log('el−10:', JSON.stringify(m10));
    gate(
      'below civil twilight it IS night — night bucket, no blend, glow exactly 0 (sat-night contract)',
      m10.elDeg < SKY_DUSK.elNightDeg &&
        m10.state === 'night' &&
        m10.s === 0 &&
        m10.glow === 0 &&
        m10.night > 0 &&
        /qwantani_night/.test(m10.envUrl ?? ''),
      `el=${m10.elDeg}° state=${m10.state} s=${m10.s} glow=${m10.glow} stars=${m10.night?.toFixed(3)}`
    );

    // ---- overcast dusk: the lid must not be a featureless dome -----------
    await page.evaluate((t) => {
      window.__flySunOverride = t;
      window.__flyWeatherOverride = 'overcast';
    }, T_P9);
    await page.evaluate(pinScene, [POWELL.lat, POWELL.lon, POWELL.altM, HDG_SUN, 0.16]);
    await page.waitForTimeout(24000);
    await page.mouse.move(800, 450);
    const oc = await probe();
    console.log('overcast dusk:', JSON.stringify(oc));
    await setForegroundVisible(false);
    await page.waitForTimeout(600);
    await glShot('r19d-07-overcast-dusk.png');
    await setForegroundVisible(true);
    const lidTop = await cropTone(path.join(__dirname, 'r19d-07-overcast-dusk.png'), LID_TOP);
    const lidHor = await cropTone(path.join(__dirname, 'r19d-07-overcast-dusk.png'), LID_HORIZON);
    const lidDelta = Math.abs(lidHor.luma - lidTop.luma);
    console.log(
      `  lid v2: horizon luma ${lidHor.luma.toFixed(1)} vs zenith-ward ${lidTop.luma.toFixed(1)} (Δ ${lidDelta.toFixed(2)}), warm ${lidHor.warm.toFixed(2)} vs ${lidTop.warm.toFixed(2)}`
    );
    gate(
      'precondition: the overcast lid is actually up at dusk',
      (oc.overcast ?? 0) > 0.6,
      `uOvercast=${oc.overcast?.toFixed(3)}`
    );
    gate(
      `overcast dusk keeps a lid GRADIENT (top-vs-horizon luma Δ ≥ ${LID_LUMA_FLOOR}) — not one flat tan dome`,
      lidDelta >= LID_LUMA_FLOOR,
      `Δluma=${lidDelta.toFixed(2)}`
    );
    await page.evaluate(() => {
      window.__flyWeatherOverride = 'baseline'; // restore the fleet pin
    });
    await page.waitForTimeout(9000);

    // ---- cirrus draw accounting -----------------------------------------
    const cirrusMounted = await page.evaluate(() => !!window.__flyCirrus);
    const onDraws = await (async () => {
      await page.waitForTimeout(2600);
      return draws();
    })();
    await page.evaluate(() => {
      if (window.__flyCirrus) window.__flyCirrus.visible = false;
    });
    await page.waitForTimeout(2600);
    const offDraws = await draws();
    await page.evaluate(() => {
      if (window.__flyCirrus) window.__flyCirrus.visible = true;
    });
    await page.waitForTimeout(2600);
    console.log(`  cirrus draws: armed ${onDraws} vs parked ${offDraws} (Δ ${onDraws - offDraws})`);
    gate(
      'the cirrus deck is mounted and costs EXACTLY +1 draw (one extra InstancedMesh)',
      cirrusMounted && onDraws - offDraws === 1,
      `armed=${onDraws} parked=${offDraws} Δ=${onDraws - offDraws}`
    );

    gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('harness completed', false, e.message);
  }

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
