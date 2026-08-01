/**
 * Round 19 — E "SLIPSTREAM" gate: speed & feel + the three ride-along fixes.
 *
 *   1  cruise strength is LITERALLY zero (the probe-safety construction)
 *   2  cruise frame ARMED === the same frame with the effect UNMOUNTED, on a
 *      frozen scene: net |Δ| inside the A/A noise band AND zero luma move.
 *      This is why no fleet pin was needed for the whole speed-feel feature.
 *   3  cruise draw floor is unchanged by the mount (the effect MERGES)
 *   4  boost ENGAGE fires the FOV punch, sampled at 60 ms
 *   5  boost arms the streaks (strength + heat haze at 750 m/s)
 *   6  the punch has decayed at steady boost: FOV is exactly the R18 curve
 *   7  boost frame carries the streaks — luma over the armed A/A jitter
 *   8  FL180 label count is inside the declutter budget (and non-empty)
 *   9  post-warp altitude trim, the OUTCOME gate: warp 2,300 m, hands off
 *      30 s, altitude within WARP_TRIM.toleranceM
 *  10  the same warp with a PARKED CURSOR (the measured P12 trigger) holds
 *      instead of putting 1.9 km into the ground in 16 s
 *  11  cinema refuses a 21 nm pair: chase kept + the notice
 *  12  cinema still engages a close pair, standoff bounded, both framed
 *  13  zero pageerrors (a GLSL compile failure lands here)
 *
 * Everything runs on REAL engines. The cinema legs use a LIVE ADS-B track and
 * set the geometry by warping the PLAYER a measured distance from it: an
 * earlier draft hand-built a track object into traffic.tracks and threw inside
 * the engine's own update, which is the plan's "drive real engines, never
 * stubs" arriving with a receipt.
 *
 * Run: dev server on your own port, then
 *   $env:FLY_URL='http://localhost:3025'; node scripts/verify-feel.js
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');
const sharp = require('sharp');

const SHOT = (n) => path.join(__dirname, `r19-e-${n}.png`);

/**
 * The A/B crop: WORLD ONLY. A Playwright element screenshot is a page capture
 * clipped to the element box, so everything overlaying the GL canvas — the
 * telemetry strip, the contracts panel, the minimap's live traffic dots, the
 * per-contact labels — lands in the "canvas" shot and animates on its own.
 * Measured: it put a 9.5/255 floor under an A/A control and swamped the effect
 * being tested. A ground crop was no better — Neon's road-traffic pulses and
 * rooftop beacons animate on GPU time and floored it at 13. This is upper sky:
 * quiet (stars, 0.05 A/A), and at a screen radius where the streak ramp is
 * well past its onset.
 */
const CROP = { left: 700, top: 90, width: 420, height: 210 };

/** Mean per-channel |Δ| over the crop, 0..255 units (verify-aerial's helper). */
async function meanAbsDiff(fileA, fileB) {
  const opts = { resolveWithObject: true };
  const a = await sharp(fileA).extract(CROP).raw().toBuffer(opts);
  const b = await sharp(fileB).extract(CROP).raw().toBuffer(opts);
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / n;
}

/**
 * Mean luminance of the crop (0..255). The streaks SCROLL, so an A/A control
 * of two armed frames measures the effect's own animation — the R16 lesson
 * that an animated layer pollutes its own A/B noise floor, and the reason a
 * mean-|Δ| cannot separate "the streaks are painting" from "the streaks
 * moved". Mean luma can: it barely moves as a streak slides along its wedge,
 * and it rises when streaks exist at all.
 */
async function lumaMean(file) {
  const { data, info } = await sharp(file)
    .extract(CROP)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  return sum / n;
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  await bootFly(page, { style: 'toy' });
  // Mouse to dead centre: mouse-steer is ABSOLUTE, so an unmoved virtual
  // cursor is the difference between a hands-off probe and a nose-down dive.
  // (That is not a harness quirk — it is the P12 mechanism, gated at 10.)
  await page.mouse.move(640, 360);
  await page.waitForTimeout(1500);

  const tier = await page.evaluate(() => window.__flyStore.getState().qualityTier);
  console.log(`tier=${tier}`);

  // ---- 1/2/3: cruise is untouched ----------------------------------------
  // Freeze what the frame contains before comparing two of them: live traffic,
  // streaming tiles and the day cycle all move on their own, and an A/B that
  // does not stop them measures the world, not the effect. The player is
  // parked hands-off at cruise, and the two captures are back to back.
  const cruise = await page.evaluate(() => window.__flySpeedLines.get());
  gate(
    'cruise strength is exactly 0',
    cruise.strength === 0 && cruise.speedFrac < 0.55,
    `strength=${cruise.strength} speedFrac=${cruise.speedFrac.toFixed(3)}`
  );

  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: SHOT(n) });
  // FREEZE (B DEEPFIELD's idiom, verify-aerial): suspend the integrator so the
  // pose stops moving while the REAL scene keeps rendering. At 180 m/s two
  // shots 900 ms apart are 160 m of pure parallax, which is not the effect.
  // Park the hero + traffic too — R17 §7.1: a pixel probe must not contain an
  // actor it does not control (verify-sat-night spent a round passing on the
  // aeroplane's idle bob).
  const freeze = (on) =>
    page.evaluate((frozen) => {
      const f = window.__fly.flight;
      if (frozen) {
        f.__frozen = true;
        f.step = () => {}; // suspend the integrator; the scene keeps rendering
      } else {
        delete f.step; // restores the prototype method
        delete f.__frozen;
      }
      if (window.__flyPlayer) window.__flyPlayer.visible = !frozen;
      let scene = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
      while (scene && scene.parent) scene = scene.parent;
      scene?.traverse((o) => {
        if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
          o.visible = !frozen;
      });
    }, on);
  await freeze(true);
  await page.waitForTimeout(1500);

  // Draw calls are a LIVE scene metric (traffic instances, streaming chunks) —
  // the R16 lesson that scene-total draws are not a signal in flight. Take the
  // structural FLOOR of several reads in each state instead of one sample.
  const drawFloor = async () => {
    let min = Infinity;
    for (let i = 0; i < 6; i++) {
      const d = await page.evaluate(() => window.__flyStats?.drawCalls ?? -1);
      if (d >= 0) min = Math.min(min, d);
      await page.waitForTimeout(140);
    }
    return min;
  };

  // A/A control FIRST, at the same cadence as the A/B below: toy road pulses,
  // rooftop beacons and the cloud deck all animate on their own clocks, so
  // this is the floor any claim has to clear (R16 lesson: gate the NET signal).
  await glShot('01-cruise-ctrlA');
  await page.waitForTimeout(900);
  await glShot('01-cruise-ctrlB');
  const noise = await meanAbsDiff(SHOT('01-cruise-ctrlA'), SHOT('01-cruise-ctrlB'));
  const drawsOn = await drawFloor();
  // Now UNMOUNT: the composer rebuilds its merged program without the effect.
  await page.evaluate(() => window.__flySpeedLines.setMount(false));
  await page.waitForTimeout(900);
  await glShot('01-cruise-unmounted');
  const signal = await meanAbsDiff(SHOT('01-cruise-ctrlB'), SHOT('01-cruise-unmounted'));
  const drawsOff = await drawFloor();
  await page.evaluate(() => window.__flySpeedLines.setMount(true));
  await page.waitForTimeout(900);
  await glShot('01-cruise-remounted');

  // A/B/A, because a frozen scene still DRIFTS. Even parked, the cloud deck
  // slides and the tile field keeps refining, and one run measured the crop
  // getting 0.40/255 darker across the toggle — a change in the direction the
  // effect cannot produce (streaks only ever ADD light). A/B/A tells a STEP
  // from a RAMP: if the unmounted frame is dark because the effect was
  // removed, re-mounting restores the brightness; if the world simply dimmed,
  // the third frame stays dark with the second. So the claim is measured
  // against the drift over the SAME interval, not against zero.
  const lumaA1 = await lumaMean(SHOT('01-cruise-ctrlB'));
  const lumaB = await lumaMean(SHOT('01-cruise-unmounted'));
  const lumaA2 = await lumaMean(SHOT('01-cruise-remounted'));
  const drift = Math.abs(lumaA2 - lumaA1); // world-only: both frames ARMED
  const step = Math.abs(lumaB - (lumaA1 + lumaA2) / 2); // effect-only, drift-centred
  gate(
    'cruise frame armed === unmounted (net signal ≈ 0)',
    signal <= noise * 1.5 + 0.5 && step <= drift + 0.1,
    `A/B ${signal.toFixed(4)} vs A/A noise ${noise.toFixed(4)}; luma step ${step.toFixed(
      4
    )} vs world drift ${drift.toFixed(4)} (armed ${lumaA1.toFixed(3)} → off ${lumaB.toFixed(
      3
    )} → armed ${lumaA2.toFixed(3)})`
  );
  gate(
    'cruise draws unchanged by the mount',
    Math.abs(drawsOn - drawsOff) <= 1,
    `${drawsOn} armed vs ${drawsOff} unmounted (structural floor of 6 reads)`
  );

  // Hand the world back: everything from here needs a flying aeroplane.
  await freeze(false);
  await page.waitForTimeout(800);

  // ---- 4/5: boost --------------------------------------------------------
  const fovBefore = await page.evaluate(() => window.__fly.camera.fov);
  await page.keyboard.press('3'); // boost preset (the fleet pin keeps the meter full)
  // Sample the FOV every 60ms across the engage so the punch cannot hide
  // between two coarse reads.
  const fovTrace = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 25; i++) {
      out.push(+window.__fly.camera.fov.toFixed(3));
      await new Promise((r) => setTimeout(r, 60));
    }
    return out;
  });
  const fovPeak = Math.max(...fovTrace);
  const fovSettleWindow = fovTrace.slice(0, 4); // first ~240ms
  // 60% of the nominal punch, not 100%: the transient decays on a ~0.17 s time
  // constant and the first sample lands one press-round-trip late, so a full-
  // amplitude threshold gates the harness's latency rather than the feature
  // (measured 2.99° of a 4° punch — a gate at 3.0 failed by 0.01°). The
  // separation is not close: the SAME trace with SPEED_FEEL.enabled false
  // measured 0.79° (the damped kick starting), so 2.4° cannot be reached
  // without a punch.
  const punchFloor = 0.6 * 4;
  gate(
    'boost ENGAGE punches the FOV',
    fovPeak >= fovBefore + punchFloor,
    `${fovBefore.toFixed(2)}° → peak ${fovPeak.toFixed(2)}° (+${(fovPeak - fovBefore).toFixed(
      2
    )}°, flag-off control +0.79°) (trace head ${fovSettleWindow.join('/')})`
  );

  // Let the speed actually build (accel 40 m/s² from cruise 180 to boost 750).
  await page.waitForTimeout(16000);
  const boost = await page.evaluate(() => ({
    feel: window.__flySpeedLines.get(),
    speed: window.__fly.flight.speed,
    boosting: window.__fly.flight.boosting,
    fov: window.__fly.camera.fov,
    draws: window.__flyStats?.drawCalls ?? -1,
  }));
  gate(
    'boost arms the streaks',
    boost.feel.strength >= 0.5 && boost.feel.haze > 0,
    `strength=${boost.feel.strength.toFixed(3)} haze=${boost.feel.haze} speed=${boost.speed.toFixed(0)}m/s`
  );
  // At full boost the punch is long gone, so the FOV must be exactly the R18
  // speed curve: CANVAS.fov 62 + CAMERA.fovBoost 16 × 1^1.5 = 78°.
  gate(
    'punch decayed (steady FOV is the plain speed kick)',
    Math.abs(boost.fov - 78) <= 0.6,
    `${boost.fov.toFixed(2)}° vs 78.00° expected`
  );

  // The money shot + a measured screen response. FROZEN again, and for the
  // same reason: at 750 m/s two shots 700 ms apart are 525 m of parallax, next
  // to which any effect looks enormous. Freezing leaves flight.speed at 750, so
  // the effect stays fully armed while the world stops. Its own A/A control
  // runs at the same cadence — this is the mirror of gate 2, and it has to
  // clear ITS floor to mean anything.
  await freeze(true);
  // A long settle, not a polite one: 16 s at 750 m/s has a very large tile
  // wavefront still landing, and streaming imagery is indistinguishable from
  // "the effect did something" in a mean-|Δ|. Wait for the field to converge
  // against the now-static camera before either capture.
  await page.waitForTimeout(6000);
  await glShot('02-boost-ctrlA');
  await page.waitForTimeout(700);
  await glShot('02-boost-streaks');
  const boostNoise = await meanAbsDiff(SHOT('02-boost-ctrlA'), SHOT('02-boost-streaks'));
  await page.evaluate(() => window.__flySpeedLines.setMount(false));
  await page.waitForTimeout(700);
  await glShot('03-boost-nostreaks');
  const boostSignal = await meanAbsDiff(SHOT('02-boost-streaks'), SHOT('03-boost-nostreaks'));
  await page.evaluate(() => window.__flySpeedLines.setMount(true));
  await page.waitForTimeout(400);
  await freeze(false);
  // LUMA, not mean-|Δ|: the two armed control frames differ by the streaks
  // SLIDING (measured A/A floor ≈ 4/255, the same order as the effect itself),
  // so a frame-difference cannot tell motion from existence. Brightness can —
  // streaks add light, and sliding one along its wedge does not.
  const lumaOn = await lumaMean(SHOT('02-boost-streaks'));
  const lumaCtrl = await lumaMean(SHOT('02-boost-ctrlA'));
  const lumaOff = await lumaMean(SHOT('03-boost-nostreaks'));
  gate(
    'boost frame carries the streaks (luma over the armed A/A jitter)',
    lumaOn - lumaOff >= 0.5 && lumaOn - lumaOff > Math.abs(lumaOn - lumaCtrl) * 2,
    `luma armed ${lumaOn.toFixed(3)} vs unmounted ${lumaOff.toFixed(3)} (Δ ${(
      lumaOn - lumaOff
    ).toFixed(3)}); armed A/A jitter ${Math.abs(lumaOn - lumaCtrl).toFixed(
      3
    )}; frame A/B ${boostSignal.toFixed(2)} vs floor ${boostNoise.toFixed(2)}`
  );
  await page.keyboard.press('2'); // back to cruise
  await page.waitForTimeout(4000);

  // ---- 8: label budget at altitude ---------------------------------------
  await page.evaluate(() => {
    window.__fly.warpToGeo(40.72, -74.01, { altM: 5486, name: null }); // FL180 over NYC
  });
  await page.waitForTimeout(9000); // two selection ticks + settle
  const labels = await page.evaluate(() => ({
    n: (window.__fly.poiSlots ?? []).length,
    names: (window.__fly.poiSlots ?? []).map((p) => p.name),
    kinds: [...new Set((window.__fly.poiSlots ?? []).map((p) => p.kind))],
    eyeAgl: window.__fly.flight.pos.y - window.__fly.flight.groundElev,
  }));
  gate(
    'FL180 label count inside the budget',
    labels.n > 0 && labels.n <= 6,
    `${labels.n} letters, kinds [${labels.kinds.join(',')}], eyeAGL ${labels.eyeAgl.toFixed(0)}m`
  );
  await page.screenshot({ path: SHOT('04-fl180-labels') });

  // ---- 9: the warp OUTCOME gate ------------------------------------------
  const warp = await page.evaluate(async () => {
    window.__fly.warpToGeo(37.6, -97.4, { altM: 2300, name: null });
    const y0 = window.__fly.flight.pos.y;
    await new Promise((r) => setTimeout(r, 30000));
    return { y0, y1: window.__fly.flight.pos.y, agl: window.__fly.flight.agl };
  });
  gate(
    'post-warp altitude held (hands off, 30s)',
    Math.abs(warp.y1 - 2300) <= 60,
    `${warp.y0.toFixed(0)}m → ${warp.y1.toFixed(0)}m (Δ ${(warp.y1 - 2300).toFixed(1)}m)`
  );

  // ---- 10: the same warp with the cursor PARKED (the P12 trigger) --------
  // Mouse-steer is absolute: after an Atlas warp the cursor is still sitting
  // where the destination was clicked, and the first pointer move re-arms a
  // large SUSTAINED nose-down command. Pre-fix this put 2,300 m into the
  // ground in 16 s (measured). The trim window is what the player feels.
  await page.evaluate(() => window.__fly.warpToGeo(37.6, -97.4, { altM: 2300, name: null }));
  await page.mouse.move(640, 600); // 0.67 screen-height ⇒ cmd.pitch ≈ −0.47
  const parked = await page.evaluate(async () => {
    const cmd = window.__fly.input.read().pitch;
    const y0 = window.__fly.flight.pos.y;
    await new Promise((r) => setTimeout(r, 8000));
    return { cmd, y0, y8: window.__fly.flight.pos.y };
  });
  gate(
    'parked cursor does not dump the arrival',
    parked.cmd < -0.2 && Math.abs(parked.y8 - 2300) <= 60,
    `cmd.pitch ${parked.cmd.toFixed(3)} · ${parked.y0.toFixed(0)}m → ${parked.y8.toFixed(0)}m after 8s`
  );
  await page.mouse.move(640, 360);
  await page.waitForTimeout(1200);

  // ---- 6/7: cinema on a real target --------------------------------------
  // The target is a LIVE ADS-B track flown by the real TrafficEngine, and the
  // separation is set by warping the PLAYER a measured distance from it. An
  // earlier draft injected a synthetic track object straight into
  // traffic.tracks; it threw inside the engine's own update (a hand-written
  // track is missing fields only the ingest path fills) — the plan's "drive
  // REAL engines, never stubs" with a receipt. Warping the player instead
  // leaves every engine on its shipping path and still fixes the geometry.
  await page.waitForTimeout(6000); // let a poll land contacts
  const placeAt = async (nm) =>
    page.evaluate((nmArg) => {
      const fly = window.__fly;
      const cand = fly.traffic
        .getNearest(12, fly.flight.pos)
        .filter((t) => t.fix1 && t.stale !== 2);
      const t = cand[0];
      if (!t) return null;
      // The track's own geo, then a point nmArg nautical miles due south of it
      // at the same altitude — so the pair separation IS the number asked for.
      const g = fly.engine.worldToGeo(fly.flight.pos.clone().set(t.rx, t.ry, t.rz));
      const dLat = (nmArg * 1852) / 111320;
      fly.warpToGeo(g.y - dLat, g.x, { altM: t.ry, name: null });
      const ok = fly.interceptHex(t.hex);
      return { hex: t.hex, ok };
    }, nm);

  const far = await placeAt(21);
  await page.waitForTimeout(1200);
  await page.waitForTimeout(600);
  await page.keyboard.press('c');
  await page.waitForTimeout(900);
  const farState = await page.evaluate(() => ({
    mode: window.__flyStore.getState().cameraMode,
    // innerText, not textContent: the banner carries its keyframes in an
    // inline <style>, which textContent happily hands back as "@keyframes…".
    banner: document.querySelector('[data-testid="arrival-banner"]')?.innerText ?? '',
    sep: (() => {
      const fly = window.__fly;
      const t = fly.targeting.target;
      if (!t) return -1;
      const k = 1 / Math.cos((fly.flight.latDeg * Math.PI) / 180);
      return Math.round(
        Math.hypot(
          (fly.flight.pos.x - t.rx) / k,
          fly.flight.pos.y - t.ry,
          (fly.flight.pos.z - t.rz) / k
        )
      );
    })(),
  }));
  gate(
    'cinema refuses a 21 nm target (clean chase fallback + notice)',
    !!far?.ok &&
      farState.mode === 'chase' &&
      farState.sep > 8000 &&
      /cinema/i.test(farState.banner),
    `sep ${farState.sep}m mode=${farState.mode} banner="${farState.banner.trim().slice(0, 40)}"`
  );
  await page.screenshot({ path: SHOT('05-cinema-refused') });

  await page.evaluate(() => window.__fly.autopilot.disengage());
  await page.waitForTimeout(400);
  // The precondition has to HOLD AT the assertion (R18's verify-chase-cam
  // lesson): live contacts keep flying, and one run placed the player 1.1 nm
  // out only to measure 10.4 km by the time C was pressed — past engageMaxM,
  // so the rig correctly refused and the gate blamed the clamp. Re-place until
  // the pair is genuinely close, then press C immediately.
  let near = null;
  let nearSep = Infinity;
  for (let attempt = 0; attempt < 3 && nearSep > 3000; attempt++) {
    near = await placeAt(1.1); // ~2,040 m — inside verify-chase-cam's band
    await page.waitForTimeout(500);
    nearSep = await page.evaluate(() => {
      const fly = window.__fly;
      const t = fly.targeting.target;
      if (!t) return Infinity;
      const k = 1 / Math.cos((fly.flight.latDeg * Math.PI) / 180);
      return Math.hypot(
        (fly.flight.pos.x - t.rx) / k,
        fly.flight.pos.y - t.ryd,
        (fly.flight.pos.z - t.rz) / k
      );
    });
  }
  console.log(`close-pair precondition: sep ${Math.round(nearSep)}m`);
  await page.keyboard.press('c');
  await page.waitForTimeout(1500);
  const nearState = await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.targeting.target;
    const cam = fly.camera;
    const ax = fly.origin.anchor.x;
    const az = fly.origin.anchor.z;
    const k = 1 / Math.cos((fly.flight.latDeg * Math.PI) / 180);
    const camAbs = { x: cam.position.x + ax, y: cam.position.y, z: cam.position.z + az };
    const mid = {
      x: (fly.flight.pos.x + t.rx) / 2,
      y: (fly.flight.pos.y + t.ryd) / 2,
      z: (fly.flight.pos.z + t.rz) / 2,
    };
    const proj = (x, y, z) => {
      const v = fly.flight.pos.clone().set(x - ax, y, z - az).project(cam);
      return v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    };
    return {
      mode: window.__flyStore.getState().cameraMode,
      sep: Math.round(
        Math.hypot(
          (fly.flight.pos.x - t.rx) / k,
          fly.flight.pos.y - t.ryd,
          (fly.flight.pos.z - t.rz) / k
        )
      ),
      range: Math.round(
        Math.hypot((camAbs.x - mid.x) / k, camAbs.y - mid.y, (camAbs.z - mid.z) / k)
      ),
      playerOn: proj(fly.flight.pos.x, fly.flight.pos.y, fly.flight.pos.z),
      targetOn: proj(t.rx, t.ryd, t.rz),
    };
  });
  gate(
    'cinema engages a close pair, standoff bounded + both framed',
    !!near?.ok &&
      nearSep <= 3000 && // the precondition, asserted so a runaway target fails loudly
      nearState.mode === 'cinema' &&
      nearState.range >= 120 &&
      nearState.range <= nearState.sep * 1.6 &&
      nearState.playerOn &&
      nearState.targetOn,
    `sep ${nearState.sep}m standoff ${nearState.range}m (pre-R19 would be ${Math.round(
      nearState.sep * 1.6
    )}m) framed=${nearState.playerOn && nearState.targetOn}`
  );
  await page.screenshot({ path: SHOT('06-cinema-close') });

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
