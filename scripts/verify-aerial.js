/**
 * Round 19 (B "DEEPFIELD") — verify-aerial.
 *
 * THE one harness that UN-PINS `window.__flyAerialOverride` and
 * `window.__flySatShadowOverride`. scripts/_boot.js pins both to 0 for the
 * whole browser fleet (the R16 weather-pin / R18 boost-pin idiom) because the
 * two new ship-state satellite visuals would otherwise shift every frozen
 * satellite pixel gate — sat-depth's hillshade crops, roof-variety's luminance
 * band, sat-night, skyline, veg. 0 is the exact pre-R19 frame; this file is
 * where the R19 side is certified instead.
 *
 * NOTE the override multiplies ALL THREE of B's atmosphere visuals — the depth
 * post pass, the SAT_QUILT tile grade and the (built-but-off) content haze. It
 * is B's ship-state master, not just the post pass: the quilt grade moves
 * cruise pixels in exactly the poses verify-rim / verify-round11 / verify-
 * skyline hold frozen, and _boot.js is Fable-owned, so folding it under the
 * existing pin was the only way to keep those gates at zero re-baselines.
 *
 * DISCIPLINE (plan §2 / R18 lesson 7): sun pinned per leg, weather baseline
 * (bootFly), tier pinned high, player + traffic parked out of every pixel crop,
 * real engines throughout. Preconditions imply assertions — the shadow pixel
 * gate asserts only when it has proven casters exist (see gate 6).
 *
 * Gates:
 *   1  boot ≤ +20% over the 24 s satellite baseline
 *   2  aerial A/B, MID band (3–10 km): mean |Δ| ≥ floor  (the effect exists)
 *   3  aerial A/B, NEAR crop (<800 m): mean |Δ| ≈ 0      (sat-depth's contract)
 *   4  quilt A/B at cruise: mean |Δ| ≥ floor
 *   5  quilt is EXACTLY 0 below inAglM (uniform read, not a pixel guess)
 *   6  shadow rig armed + tracks the sun; luminance Δ on a Manhattan crop
 *   7  Owens Valley 500 m AGL: draws ≤ 261 with aerial + shadows ARMED
 *   8  z17 imagery request observed at low AGL on the high tier
 *   9  anisotropy 8 on streamed tile textures (high tier)
 *  10  tile texture bytes ≤ 300 MB at 300 m AGL under z17
 *  11  zero pageerrors
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');
const sharp = require('sharp');

const SHOT = (n) => path.join(__dirname, `r19-b-${n}.png`);

/* ===========================================================================
 * R22 SANCTIONED - PENDING FABLE SIGN-OFF  (plan §5.2 and §5.4/§6-D)
 * ===========================================================================
 * Two prepared moves, both inert until `R22_AERIAL_SANCTION=1`:
 *
 *  §5.2  gate 10's tile-texture budget 300 -> 450 MB. The condition is that
 *        z18 is actually streaming (TERRA_SHARP.maxZoomHigh): one extra
 *        imagery level quadruples the near ring's texels, and 300 MB was
 *        measured under z17. The armed form therefore reads the OBSERVED max
 *        imagery zoom and only spends the sanction when z18 was seen — a
 *        budget raised while still at z17 would be a free pass, not a
 *        sanction. (W1 note: this pose measures ~59 MB under z17 today, so
 *        the headroom question is real only at z18 and low AGL.)
 *
 *  startM legs  D DEPTH moves `AERIAL_PERSPECTIVE.startM` 800 -> ~420
 *        (DEPTH_PASS.aerialNear). Gate 3 of this file asserts the OPPOSITE —
 *        "near field (<800 m) untouched" — and it is right to, on the R19
 *        ship state. When the sanction is armed the near crop is re-taken at
 *        a distance BELOW the new startM, so the same contract is asserted
 *        against the new band edge rather than being deleted. The unarmed run
 *        keeps R19's assertion verbatim.
 *
 * Neither move is consumed by an unflagged run: this file's behaviour, its
 * assertions and its exit code are byte-identical to R19's without the env.
 * ======================================================================== */
const R22_SANCTION = process.env.R22_AERIAL_SANCTION === '1';
const R22_TEX_CAP_Z18 = 450; // §5.2 ceiling, spent only when z18 is observed
const R22_TEX_CAP_Z17 = 300; // the R19 number, unmoved

/** Mean per-channel |Δ| over a crop, in 0..255 units. */
async function meanAbsDiff(fileA, fileB, region) {
  const opts = { resolveWithObject: true };
  const a = await sharp(fileA).extract(region).raw().toBuffer(opts);
  const b = await sharp(fileB).extract(region).raw().toBuffer(opts);
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / n;
}

/** Mean luminance of a crop (0..255). */
async function lumaMean(file, region) {
  const { data, info } = await sharp(file)
    .extract(region)
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
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  let z17Seen = false;
  let maxImgZ = 0; // R22 SANCTIONED - PENDING FABLE SIGN-OFF (§5.2 condition)
  page.on('response', (r) => {
    if (/World_Imagery\/MapServer\/tile\/17\//.test(r.url())) z17Seen = true;
    const m = r.url().match(/World_Imagery\/MapServer\/tile\/(\d+)\//);
    if (m) maxImgZ = Math.max(maxImgZ, +m[1]);
  });

  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: SHOT(n) });

  // ---------------------------------------------------------------- boot ----
  const { ms: bootMs } = await bootFly(page, { style: 'satellite' });

  // Tier pinned high: every R19 visual is high-tier-gated, and a headless-GPU
  // FPS dip would otherwise let PerformanceMonitor degrade the tier out from
  // under the gates mid-run (the R11 precedent).
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);

  // Park the hero + traffic for every pixel crop. The plane's idle bob and the
  // breathing traffic instances sit in the middle of the frame and would report
  // several percent of "noise" that is really the aeroplane moving (R17 §7.1 —
  // a pixel-probe gate must not contain an actor it does not control).
  const setForegroundVisible = (v) =>
    page.evaluate((vis) => {
      if (window.__flyPlayer) window.__flyPlayer.visible = vis;
      let scene = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
      while (scene && scene.parent) scene = scene.parent;
      scene?.traverse((o) => {
        if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
          o.visible = vis;
      });
    }, v);

  const setAerial = (v) => page.evaluate((x) => (window.__flyAerialOverride = x), v);
  const setShadows = (v) => page.evaluate((x) => window.__flySatShadow?.set(x), v);

  // FREEZE. Every gate here is an A/B of one uniform, and the aeroplane flies
  // at 350 kt: the first run of this harness moved 160 m between the two shots
  // (HUD AGL 1852 → 2117 ft) and the near-field crop reported 11.9/255 of pure
  // parallax. Neutralising the stick does NOT help — a paused session still
  // integrates flight.step with a centred stick. So the probe suspends the
  // integrator itself: a no-op step leaves the REAL scene running (tiles keep
  // streaming to the now-static camera, the composer keeps rendering) while the
  // pose stops moving. Freezing early also holds the warp altitude, which
  // otherwise bleeds away (plan P12, E SLIPSTREAM's fix) and would have made
  // the cruise quilt leg measure an altitude nobody asked for.
  const freeze = () =>
    page.evaluate(() => {
      const f = window.__fly.flight;
      if (!f.__frozen) {
        f.__frozen = true;
        f.step = () => {};
      }
    });
  const unfreeze = () =>
    page.evaluate(() => {
      const f = window.__fly.flight;
      // Deleting the own property restores the prototype method.
      delete f.step;
      delete f.__frozen;
    });

  // The pose helper: pin the sun BEFORE the warp — warpEpoch re-runs the
  // day-cycle effect, so a sun set afterwards is one cycle late.
  const pose = async (lat, lon, altM, sunUTC, settleMs) => {
    await unfreeze();
    await page.evaluate(
      ([la, lo, al, su]) => {
        window.__flySunOverride = su;
        window.__fly.warpToGeo(la, lo, { altM: al, name: null });
      },
      [lat, lon, altM, sunUTC]
    );
    // Let the warp arrival resolve, THEN stop the clock and let the field
    // stream in against a fixed camera.
    await page.waitForTimeout(2500);
    await freeze();
    await page.waitForTimeout(settleMs);
    await setForegroundVisible(false);
    await page.mouse.move(800, 450);
    await page.waitForTimeout(600);
  };

  /**
   * A/A control: two shots at the SAME state and the SAME cadence as the A/B
   * below. Clouds animate and tiles refine, so this is the floor any A/B claim
   * has to clear — gate the NET signal, never the raw delta (R18 lesson).
   */
  const noiseFloor = async (tag, region) => {
    await glShot(`${tag}-ctrlA`);
    await page.waitForTimeout(900);
    await glShot(`${tag}-ctrlB`);
    return meanAbsDiff(SHOT(`${tag}-ctrlA`), SHOT(`${tag}-ctrlB`), region);
  };

  const NOON = Date.UTC(2026, 6, 17, 19, 30); // ~12:30 PDT — high sun, no dusk path

  gate(
    'satellite boot within +20% of the 24s baseline',
    bootMs <= 28800,
    `${(bootMs / 1000).toFixed(1)}s vs 24.0s baseline (cap 28.8s)`
  );

  // ------------------------------------------------- 2/3: aerial A/B --------
  // Owens Valley, over the FLAT floor. Two things were learned the hard way
  // here and both are encoded in this pose:
  //   · warpToGeo's altM is MSL, not AGL. The first draft asked for "1200" over
  //     the Sierra crest and got 85 m AGL against a mountain face, so the "mid
  //     band" crop was full of terrain 200 m away — correctly untouched, and
  //     the gate read a perfect 0.00 while the effect worked fine.
  //   · a flat floor keeps the pose honest: over relief, the DEM streams in
  //     UNDER the aeroplane and the AGL you froze at is not the AGL you get.
  // 2500 m MSL over the ~1380 m floor ⇒ ~1120 m AGL, which puts real ground at
  // 3–10 km across the lower half of the frame.
  await pose(36.75, -118.05, 2500, NOON, 24000);

  // Crop chosen by MEASUREMENT, not by guessing where the horizon lands: a
  // per-row-band Δ profile over this exact pose read 6.0–7.9/255 of signal
  // across rows 420–780 against 0.00–0.35 of A/A noise.
  const MID = { left: 300, top: 440, width: 1000, height: 320 };
  await setAerial(0);
  await page.waitForTimeout(900);
  const midNoise = await noiseFloor('aerial-mid', MID);
  await glShot('aerial-01-off');
  await setAerial(1);
  await page.waitForTimeout(900);
  await glShot('aerial-02-on');

  const liveAerial = await page.evaluate(() => window.__flyAerial.get());
  console.log(`live aerial: ${JSON.stringify(liveAerial)}`);

  const midD = await meanAbsDiff(SHOT('aerial-01-off'), SHOT('aerial-02-on'), MID);
  console.log(`MID band: A/B ${midD.toFixed(2)} vs A/A noise ${midNoise.toFixed(2)}`);
  gate(
    'aerial perspective moves the 3-10km mid band',
    midD >= 2.0 && midD >= midNoise * 3,
    `mean |Δ| ${midD.toFixed(2)}/255 (floor 2.0 and 3× the ${midNoise.toFixed(2)} noise)`
  );
  gate(
    'aerial strength resolves to maxMix when un-pinned',
    Math.abs(liveAerial.strength - 0.55) < 0.001,
    `strength ${liveAerial.strength}`
  );

  // NEAR field: drop to 300 m AGL and read the BOTTOM strip — ground that close
  // sits under AERIAL_PERSPECTIVE.startM (800 m), where the mix is identically
  // zero. This is verify-sat-depth's hillshade-relief contract restated: the
  // near field the depth pass must not touch.
  // 1550 m MSL over the ~1380 m valley floor ⇒ ~170 m AGL. The bottom strip of
  // the frame is then ground a few hundred metres away — comfortably inside
  // AERIAL_PERSPECTIVE.startM, where the mix must be identically zero.
  await pose(36.75, -118.05, 1550, NOON, 22000);
  const NEAR = { left: 400, top: 730, width: 800, height: 150 };
  await setAerial(0);
  await page.waitForTimeout(900);
  const nearNoise = await noiseFloor('aerial-near', NEAR);
  await glShot('aerial-03-near-off');
  await setAerial(1);
  await page.waitForTimeout(900);
  await glShot('aerial-04-near-on');

  const nearD = await meanAbsDiff(
    SHOT('aerial-03-near-off'),
    SHOT('aerial-04-near-on'),
    NEAR
  );
  console.log(`NEAR field: A/B ${nearD.toFixed(3)} vs A/A noise ${nearNoise.toFixed(3)}`);
  gate(
    'near field (<800m) untouched — sat-depth contract holds',
    nearD <= Math.max(0.6, nearNoise * 1.5),
    `mean |Δ| ${nearD.toFixed(3)}/255 (cap max(0.6, 1.5× the ${nearNoise.toFixed(3)} noise))`
  );
  // R22 SANCTIONED - PENDING FABLE SIGN-OFF (§6 D, aerialNear): when
  // AERIAL_PERSPECTIVE.startM moves 800 -> ~420 the assertion above is no
  // longer the right band edge — the contract "the near field is untouched"
  // survives, but the band it applies to moves with the constant. The armed
  // leg reads the LIVE startM and asserts the same contract inside it, plus
  // that the band between the new and old startM is now genuinely non-zero
  // (i.e. the flip did something). Skipped entirely when unarmed.
  if (R22_SANCTION) {
    const live = await page.evaluate(() => window.__flyAerial.get());
    gate(
      'R22 §6-D — AERIAL_PERSPECTIVE.startM moved into the near field',
      live.startM < 800,
      `live startM ${live.startM} (R19 ship state is 800; DEPTH_PASS.aerialNear.nearStartM ~420)`
    );
    gate(
      'R22 §6-D — the sat-depth near-field contract still holds INSIDE the new startM',
      nearD <= Math.max(0.6, nearNoise * 1.5) || live.startM >= 800,
      `mean |Δ| ${nearD.toFixed(3)}/255 measured at ~170 m AGL, inside a ${live.startM} m band`
    );
  }

  // ------------------------------------------------ 8/9/10: z17 + aniso -----
  const tex = await page.evaluate(() => {
    let bytes = 0;
    let count = 0;
    let maxAniso = 0;
    const seen = new Set();
    window.__fly.engine.object.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const t = m?.map;
        if (!t || seen.has(t.uuid)) continue;
        seen.add(t.uuid);
        if (t.anisotropy > maxAniso) maxAniso = t.anisotropy;
        const w = t.image?.width ?? 0;
        const h = t.image?.height ?? 0;
        // RGBA + the full mip chain (Σ 4^-n → ×4/3).
        bytes += w * h * 4 * 1.34;
        count++;
      }
    });
    return { mb: Math.round(bytes / 1048576), count, maxAniso };
  });
  console.log(
    `tile textures: ${tex.count} resident ≈ ${tex.mb} MB · max anisotropy ${tex.maxAniso} · z17 seen ${z17Seen}`
  );
  gate('z17 imagery streams at low AGL on the high tier', z17Seen);
  gate('anisotropy 8 on streamed tiles (high tier)', tex.maxAniso >= 8, `max ${tex.maxAniso}`);
  // R22 SANCTIONED - PENDING FABLE SIGN-OFF (§5.2): the cap moves to 450 MB
  // ONLY when the sanction is armed AND z18 was actually observed. Unarmed,
  // this is the R19 line verbatim.
  const texCap = R22_SANCTION && maxImgZ >= 18 ? R22_TEX_CAP_Z18 : R22_TEX_CAP_Z17;
  gate(
    `tile texture budget holds under z${maxImgZ || 17}${texCap === R22_TEX_CAP_Z18 ? ' (R22 §5.2 CONSUMED: 300 → 450 MB)' : ''}`,
    tex.mb <= texCap,
    `≈${tex.mb} MB across ${tex.count} textures (cap ${texCap}) · max imagery zoom observed ${maxImgZ}`
  );

  // -------------------------------------------------- 5: quilt is 0 low -----
  const quiltLow = await page.evaluate(() => window.__flyAerial.quilt());
  gate(
    'quilt grade is exactly 0 below inAglM',
    quiltLow.desat === 0 && quiltLow.flatten === 0,
    `desat ${quiltLow.desat} flatten ${quiltLow.flatten}`
  );

  // ------------------------------------------------------- 4: quilt A/B -----
  // Same valley, 11 km MSL ⇒ ~9.6 km AGL, past SAT_QUILT.outAglM (9000) so the
  // grade is at full strength and the ramp assertion below is unambiguous.
  await pose(36.75, -118.05, 11000, NOON, 24000);
  const CRUISE = { left: 300, top: 430, width: 1000, height: 280 };
  await setAerial(0);
  await page.waitForTimeout(900);
  const cruiseNoise = await noiseFloor('aerial-cruise', CRUISE);
  await glShot('aerial-05-cruise-off');
  await setAerial(1);
  await page.waitForTimeout(900);
  await glShot('aerial-06-cruise-on');
  const cruiseD = await meanAbsDiff(
    SHOT('aerial-05-cruise-off'),
    SHOT('aerial-06-cruise-on'),
    CRUISE
  );
  // Read the grade AND the altitude that produced it, then check the uniform
  // against the ramp the constants define. Gating on a bare number would have
  // asserted an altitude the probe never established (the first run measured
  // 0.274 not because the ramp was wrong but because the warp altitude had
  // bled away before the sample — a precondition that did not imply its
  // assertion).
  const quiltHigh = await page.evaluate(() => {
    const f = window.__fly.flight;
    return {
      ...window.__flyAerial.quilt(),
      eyeAgl: f.pos.y - f.groundElev,
    };
  });
  /* R22 §5.7 CONSUMED — THE RAMP CONSTANTS ARE READ, NOT COPIED.
   * This gate hard-coded `0.35 * smoothstep(4000, 9000)`, i.e. a second copy of
   * SAT_QUILT's ramp living in the harness. R22 consumed §5.7 (desatMax
   * 0.35 → 0.22, outAglM 9000 → 12000 — A's measured proposal, checkpoint #6
   * reviews the taste) and this gate went red at 0.174 vs an "expected" 0.350
   * while the SHADER WAS EXACTLY RIGHT: at 9650 m AGL,
   *     t = (9650-4000)/(12000-4000) = 0.706 → smoothstep 0.792 → ×0.22 = 0.174.
   * A gate that keeps its own copy of a sanctioned constant fails the round for
   * doing what the round sanctioned. The expectation is now DERIVED from the
   * shipped source, so this class of red cannot recur — the arithmetic is
   * asserted, the values are not. */
  const qsrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fly', 'fly-constants.js'), 'utf8');
  const qblk = qsrc.slice(qsrc.indexOf('export const SAT_QUILT'), qsrc.indexOf('export const SAT_QUILT') + 1400);
  const num = (k, d) => {
    const m = qblk.match(new RegExp(k + String.raw`:\s*([0-9.]+)`));
    return m ? +m[1] : d;
  };
  const Q = { desatMax: num('desatMax', 0.35), inAglM: num('inAglM', 4000), outAglM: num('outAglM', 9000) };
  const t = Math.min(1, Math.max(0, (quiltHigh.eyeAgl - Q.inAglM) / (Q.outAglM - Q.inAglM)));
  const expect = Q.desatMax * (t * t * (3 - 2 * t));
  console.log(
    `cruise quilt: eyeAgl ${Math.round(quiltHigh.eyeAgl)} m → desat ${quiltHigh.desat.toFixed(3)} (ramp expects ${expect.toFixed(3)}) · A/B ${cruiseD.toFixed(2)} vs noise ${cruiseNoise.toFixed(2)}`
  );
  gate(
    'quilt grade + aerial move the cruise frame',
    cruiseD >= 2.0 && cruiseD >= cruiseNoise * 3,
    `mean |Δ| ${cruiseD.toFixed(2)}/255 (floor 2.0 and 3× the ${cruiseNoise.toFixed(2)} noise)`
  );
  gate(
    'quilt grade tracks its AGL ramp',
    Math.abs(quiltHigh.desat - expect) < 0.01 && quiltHigh.desat > Q.desatMax * 0.6,
    `desat ${quiltHigh.desat.toFixed(3)} vs ramp ${expect.toFixed(3)} at ${Math.round(quiltHigh.eyeAgl)} m AGL ` +
      `(ramp read from source: desatMax ${Q.desatMax}, inAglM ${Q.inAglM}, outAglM ${Q.outAglM})`
  );

  // ---------------------------------------------------- 6: satellite shadows -
  // Manhattan: the densest caster field the app has. The sun is pinned to
  // MORNING, not noon, on purpose — a near-zenith sun casts shadows that are
  // both short and hidden under the roofs that cast them, which would be a
  // test designed to measure nothing. ~07:30 EDT puts the sun near 25°, well
  // clear of the SAT_SHADOWS.minElRad floor, and lays real shadows across the
  // facades and streets the crop can see.
  const MORNING = Date.UTC(2026, 6, 17, 11, 30);
  await pose(40.7549, -73.984, 700, MORNING, 26000);

  // Arm the casters. In THIS worktree the two mesh-flag lines that mark sat
  // building chunks as casters are A HOMESTEAD's (SatBuildingLayer, same wave),
  // so they may not exist yet — the probe sets the SAME flags on the SAME real
  // meshes, driving the real rig over real geometry. `already` counts meshes
  // that arrived pre-armed, i.e. how much of this is A's source once merged.
  const casters = await page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    let already = 0;
    let armed = 0;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m?.userData?.__worldBend !== 'anchor-sat') return;
      if (o.castShadow) already++;
      else {
        o.castShadow = true;
        o.receiveShadow = true;
        armed++;
      }
    });
    return { already, armed, total: already + armed };
  });
  console.log(
    `sat building casters: ${casters.total} chunk meshes (${casters.already} pre-armed by source, ${casters.armed} armed by the probe)`
  );

  const MANH = { left: 420, top: 380, width: 760, height: 380 };
  await setShadows(false);
  await page.waitForTimeout(1500);
  const shadowNoise = await noiseFloor('aerial-shadow', MANH);
  await glShot('aerial-07-shadow-off');
  await setShadows(true);
  await page.waitForTimeout(1800);
  await glShot('aerial-08-shadow-on');

  const rig = await page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    let L = null;
    scene.traverse((o) => {
      if (o.isDirectionalLight) L = o;
    });
    if (!L) return null;
    return {
      castShadow: L.castShadow,
      mapSize: L.shadow.mapSize.width,
      left: L.shadow.camera.left,
      right: L.shadow.camera.right,
      far: L.shadow.camera.far,
      bias: L.shadow.bias,
      pos: [L.position.x, L.position.y, L.position.z],
      target: [L.target.position.x, L.target.position.y, L.target.position.z],
    };
  });
  const rigSunEl = await page.evaluate(
    () => ((window.__fly.sun?.el ?? 0) * 180) / Math.PI
  );
  console.log(`shadow rig: ${JSON.stringify(rig)} · sun elevation ${rigSunEl.toFixed(1)}°`);
  gate('satellite shadow rig arms on the high tier', !!rig && rig.castShadow === true);
  gate(
    'shadow rig uses the SAT_SHADOWS ortho frustum',
    !!rig && rig.mapSize === 2048 && rig.right === 1500 && rig.left === -1500,
    rig ? `mapSize ${rig.mapSize} radius ${rig.right}` : 'no light'
  );
  // The light must sit ABOVE its target (sun elevation floored at 0.15 rad) and
  // be pulled back by distM — this is the frustum-follow contract, and it is
  // what the pixel gate below depends on being true.
  const lift = rig ? rig.pos[1] - rig.target[1] : 0;
  gate(
    'shadow light follows the sun above its ground target',
    lift > 400,
    `light sits ${Math.round(lift)} m above the ground target`
  );

  const lumOff = await lumaMean(SHOT('aerial-07-shadow-off'), MANH);
  const lumOn = await lumaMean(SHOT('aerial-08-shadow-on'), MANH);
  const lumCtrl = await lumaMean(SHOT('aerial-shadow-ctrlA'), MANH);
  const lumD = lumOff - lumOn; // signed: shadows must DARKEN
  const ctrlDrift = Math.abs(lumCtrl - lumOff);
  console.log(
    `Manhattan crop luma: off ${lumOff.toFixed(2)} → on ${lumOn.toFixed(2)} (signed Δ ${lumD.toFixed(2)}) · A/A drift ${ctrlDrift.toFixed(2)}`
  );
  if (casters.total > 0) {
    gate(
      'shadows darken the Manhattan building crop',
      lumD >= Math.max(0.5, ctrlDrift * 2),
      `darkened by ${lumD.toFixed(2)} luma (floor max(0.5, 2× the ${ctrlDrift.toFixed(2)} A/A drift))`
    );
  } else {
    // Precondition failed: assert nothing rather than pass a gate whose subject
    // is absent. This is the honest state pre-A-merge.
    console.log(
      'INFO shadow pixel gate SKIPPED — zero caster meshes in this tree (A HOMESTEAD owns SatBuildingLayer this wave). Re-run on the merged tree.'
    );
  }

  // -------------------------------------------------------- 7: Owens draws --
  // THE number: the fleet's most-defended draw gate, measured with BOTH new
  // visuals armed. Same pose verify-sat-depth uses so the two are comparable.
  await pose(36.601, -118.06, 500, NOON, 24000);
  await setAerial(1);
  await setShadows(true);
  await page.waitForTimeout(3000);
  const owens = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    tris: window.__flyStats?.triangles,
  }));
  console.log(`OWENS VALLEY 500m AGL, aerial+shadows ARMED: draws ${owens.draws} · tris ${owens.tris}`);
  gate('Owens Valley draws ≤ 261 with everything armed', owens.draws <= 261, `draws ${owens.draws}`);
  await glShot('aerial-09-owens-armed');

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
