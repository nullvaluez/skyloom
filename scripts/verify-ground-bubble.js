/**
 * ROUND 25 (A GROUND) — verify-ground-bubble
 *
 * What this gate defends, in the order the bug would cost:
 *
 * (1) THE SIGNAL. `runtime.groundBubble.k` — §2's shared substrate, which A, C
 *     and F all key on — is 1 at the deck, 0 at cruise, and its input DEADBAND
 *     really is a deadband. A signal three owners band on that ratchets with a
 *     DEM refinement is the R24 MOTION lesson repeating in a new place.
 * (2) THE CONTENT GATE IS THE BUDGET. At the Owens desert — zero landcover,
 *     one motorway — the scrub and hedge pools place ZERO, both meshes read
 *     `count 0 / visible false`, and the frame's draw census is no higher than
 *     the same pose on the flag-off tree and inside the frozen 261. That is
 *     the plan §0 promise ("0 by construction"), asserted rather than argued.
 * (3) THE SUBURB HAS SOMETHING. At Powell the same two pools are non-zero —
 *     because a content gate that is always 0 also passes (2), and a gate that
 *     only proves the cheap half is a gate that ships nothing.
 * (4) THE OVERLAY MOVES PIXELS. A ground crop at a pinned noon Powell 80 m
 *     pose must move by more than 2/255 between `uGroundDetail` 1 and 0 —
 *     measured with the scrub and hedge layers PARKED for both arms, because a
 *     pixel gate must not contain an actor it does not control (R17 §7.1), and
 *     on the on→on→off layout so the control pair and the signal pair get the
 *     same interval (verify-veg / verify-groundlife).
 * (5) FLAG-OFF CARRIES NO 'd'. The FINAL tile key on the un-armed tree is the
 *     R24 literal, character for character, and the armed one is that plus the
 *     single token. The byte-level GLSL proof is a NODE gate (it compares this
 *     tree's `applyHillshade` output against the W0 base's); this leg is the
 *     BROWSER witness that the tree actually running is the tree that was
 *     proven.
 * (6) THE BUBBLE CLOSES. At 3500 ft `uGroundDetail` is exactly 0, both pools
 *     are parked, and the tint alpha is back at SAT_TINT's own.
 *
 * RED FIRST. `FLY_GD_ARM=0` boots WITHOUT the two pins; legs 1, 3, 4 and 6
 * then fail and leg 5 passes, which is the calibration this gate ships with
 * (scripts/r25-a-ground.md §0). The flag-off run is ALSO the control the armed
 * run's Owens draw census is compared against, so the red run is not a
 * ceremony — its numbers are inputs.
 *
 * VENUE. Offline fixture only (Esri/OFM/adsb are 403-blocked here), SwiftShader
 * at 1–3 fps. Draw counts, instance counts, uniform values, cache keys and
 * fixed-pose pixel crops are measurable here. NO fps / ms / stutter number in
 * this file means anything — there are none, on purpose.
 *
 *   FLY_TILE_FIXTURE=1 FLY_BOOT_SCALE=6 FLY_URL=http://localhost:3130 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-ground-bubble.js
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');
// R24 E's capper, and it is not optional here: `locator.screenshot` runs
// Playwright's actionability check, which waits for two consecutive frames at
// the same bounding box — a continuously rendering canvas on a 1-3 fps venue
// never settles it, and the FIRST run of this gate duly died on exactly that
// (`locator.screenshot: Timeout 30000ms exceeded`, r25-a-ground.md §7). The
// R24 night gates paid the same bill; `page.screenshot({ clip })` has no
// actionability check.
const { makeCanvasShot } = require('./_canvasshot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const OUT = path.join(__dirname, 'r25-out');
require('fs').mkdirSync(OUT, { recursive: true });

// Powell OH ≈ UTC-4 in July: 17:00 UTC ≈ 13:00 EDT.
const NOON_MS = Date.UTC(2026, 6, 27, 17, 0, 0);
// [lat, lon, heading, pitch] — altitude is pinned as AGL, see PIN below.
const POWELL = [40.1578, -83.0752, 1.9, -1.15]; // looking steeply DOWN: the crop
// must be ground, not sky — at a cruise pitch a 2 s A/B interval is cloud drift
// and the sky bands carry ~95 % of every frame-to-frame difference
// (verify-groundlife's measured note, reused).
const OWENS = [36.6, -118.1, 1.5, -0.28];

const OWENS_DRAW_MAX = 261; // the frozen Owens ceiling (verify-sat-depth)
const K_DECK_MIN = 0.95; // k at 80 m AGL
const K_CRUISE_MAX = 0.02; // k at 900 m AGL
const OVERLAY_DELTA_MIN = 2 / 255; // the charter's pixel bound, in 0..1 luma
const CROP = { left: 260, top: 430, width: 1080, height: 400 };

const ARM = process.env.FLY_GD_ARM !== '0';

/**
 * Warp, then hold a pose with the altitude expressed as AGL. Pinning AGL (not
 * y) is the whole point: the DEM refines under the aircraft and a pinned y
 * would be a drifting AGL, which is the one input the bubble is supposed to be
 * insensitive to. `window.__gdPin.agl` is writable from the gate, so an
 * altitude sweep costs no second warp — and that matters, because a warp SNAPS
 * the bubble state (a cut is not a ramp) and would erase the deadband.
 */
const pinPose = async ([lat, lon, heading, pitch, agl]) => {
  for (let i = 0; i < 200 && !window.__fly?.flight?.pos; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!window.__fly?.flight?.pos) throw new Error('flight handle never returned');
  window.__fly.warpToGeo(lat, lon, { altM: agl + 400, name: null });
  const f = window.__fly.flight;
  window.__gdPin = { agl, heading, pitch, x: f.pos.x, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    const p = window.__gdPin;
    f.pos.x = p.x;
    f.pos.z = p.z;
    f.pos.y = (f.groundElev ?? 0) + p.agl;
    f.heading = p.heading;
    f.pitch = p.pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

async function cropStats(file) {
  const { data, info } = await sharp(file)
    .extract(CROP)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const luma = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    luma[i] = l;
    sum += l;
  }
  return { luma, n, mean: sum / n };
}

/**
 * ABSOLUTE mean |Δ| per pixel. Deliberately NOT the signed metric
 * verify-groundlife uses: an additive light can only add and a multiply tint
 * can only subtract, but this overlay is a ZERO-MEAN grain — it brightens half
 * the pixels and darkens the other half by construction, so a signed mean is
 * the one metric guaranteed to score it ~0 whatever it does. The control pair
 * measures the same quantity on the same interval, so drift is still bounded.
 */
function meanAbsDelta(a, b) {
  const n = Math.min(a.n, b.n);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a.luma[i] - b.luma[i]);
  return s / n / 255;
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  // THE PAGE DEFAULT, and it is load-bearing on this venue — see r25-a-ground.md
  // §7.4. `scripts/_boot.js:181` calls
  //   page.waitForFunction(fn, { timeout: 30000 * bootScale })
  // with the options object in the SECOND parameter, which Playwright reads as
  // `arg`, not as options — so the boot-screen wait silently falls back to the
  // 30 s PAGE DEFAULT and FLY_BOOT_SCALE does not reach it. That is precisely
  // the defect the comment four lines above it warns about ("options are
  // waitForFunction's THIRD parameter"), present in the very next call. It is
  // E's file and I have not touched it; raising the page default fixes it from
  // the caller's side for every wait in the file at once, and is the right
  // default here anyway at 1-3 fps under a load average over 20.
  page.setDefaultTimeout(Math.max(30000, 30000 * SCALE));
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/CORS policy|net::ERR_FAILED|Failed to load resource/.test(t))
      errs.push(`console: ${t.slice(0, 200)}`);
  });

  const fails = [];
  const notes = [];
  let ran = 0;
  const gate = (name, ok, detail = '') => {
    ran += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const note = (name, detail) => {
    console.log(`NOTE ${name} — ${detail}`);
    notes.push(`${name}: ${detail}`);
  };

  // Tier high BEFORE the app mounts: SatGroundDetailLayer resolves its pools as
  // a STATIC gate at mount and a later PerformanceMonitor step cannot move them
  // (R16 §7/§10).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked — the setQualityTier below still pins it */
    }
  });
  if (ARM) {
    // The two pins, BEFORE boot, through r25-pins' shallow merge — which is why
    // `{ enabled: true }` is the whole arm: it keeps the owner's SHIPPED
    // sub-switches rather than a harness's copy of them.
    await page.addInitScript(() => {
      window.__flyGroundBubbleOverride = { enabled: true };
      window.__flyGroundDetailOverride = { enabled: true };
    });
  }
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  console.log(`ARMED: ${ARM} (FLY_GD_ARM=0 runs the flag-off / RED leg)`);

  const read = () =>
    page.evaluate(() => {
      const gd = window.__flyGroundDetail?.read?.() ?? null;
      const gb = window.__fly?.groundBubble ?? null;
      const s = window.__flyStats ?? {};
      const probe =
        window.__flyPlayer ?? window.__satBuildings?.object ?? window.__satRoads?.object ?? null;
      const gl = probe?.__r3f?.root?.getState?.()?.gl ?? null;
      let scrub = null;
      let hedge = null;
      let root = probe;
      while (root && root.parent) root = root.parent;
      root?.traverse?.((o) => {
        if (o.name === 'sat-ground-scrub') scrub = { count: o.count, visible: o.visible };
        if (o.name === 'sat-ground-hedge') hedge = { count: o.count, visible: o.visible };
      });
      return {
        gd,
        bubble: gb ? { k: gb.k, aglM: gb.aglM, aglVisM: gb.aglVisM } : null,
        agl: Math.round((window.__fly?.flight?.pos?.y ?? 0) - (window.__fly?.flight?.groundElev ?? 0)),
        draws: s.drawCalls ?? -1,
        tris: s.triangles ?? -1,
        tint: s.satTint ?? null,
        vegTint: window.__satVeg?.stats?.tintChunks ?? null,
        vegTintVerts: window.__satVeg?.stats?.tintVerts ?? null,
        programs: gl?.info?.programs?.length ?? -1,
        scrub,
        hedge,
      };
    });

  const setAgl = async (agl, ms) => {
    await page.evaluate((a) => {
      if (window.__gdPin) window.__gdPin.agl = a;
    }, agl);
    await page.waitForTimeout(ms);
    return read();
  };

  const fly = async (pose, agl, ms = 30000) => {
    await page.evaluate((t) => {
      window.__flySunOverride = t; // BEFORE the warp: warpEpoch re-runs the day cycle
    }, NOON_MS);
    await page.evaluate(pinPose, [...pose, agl]);
    await page.waitForTimeout(ms * SCALE);
    await page.mouse.move(800, 450);
    return read();
  };

  const cap = makeCanvasShot(page);
  const shotStats = async (n) => {
    await cap.shot(path.join(OUT, n));
    return cropStats(path.join(OUT, n));
  };

  // =========================================================================
  // (1) THE SIGNAL
  // =========================================================================
  let r = await fly(POWELL, 80);
  console.log(
    `  Powell 80 m: agl=${r.agl} bubble=${JSON.stringify(r.bubble)} gd=${JSON.stringify(r.gd)}`
  );
  gate(
    '(1a) the bubble rig is publishing runtime.groundBubble',
    ARM ? !!r.bubble : r.bubble === null,
    ARM ? JSON.stringify(r.bubble) : 'flag off ⇒ the rig is unmounted and readers see 0'
  );
  const kOf = (x) => (x.bubble ? `k=${x.bubble.k.toFixed(4)} at aglVis ${Math.round(x.bubble.aglVisM)} m` : 'no runtime.groundBubble — the rig is unmounted (flag off)');
  gate(
    `(1b) k >= ${K_DECK_MIN} at 80 m AGL`,
    !!r.bubble && r.bubble.k >= K_DECK_MIN,
    kOf(r)
  );
  const deck = r;

  r = await setAgl(900, 6000 * SCALE);
  gate(
    `(1c) k <= ${K_CRUISE_MAX} at 900 m AGL`,
    !!r.bubble && r.bubble.k <= K_CRUISE_MAX,
    kOf(r)
  );

  // THE DEADBAND. The charter's sweep is 480 → 560 → 480; at aglInM 500 BOTH
  // endpoints sit on the flat top of the ramp (k = 1 at 480 and at the filtered
  // 500), so that sweep proves NO RATCHET but cannot make the deadband visible
  // in k. The second sweep straddles the ramp, where it can: with a 60 m band,
  // 560 → 640 moves the filtered AGL by exactly 20 m (the excess) and 640 → 560
  // moves it not at all, so the final k must be BELOW the first one and equal
  // to the filtered-580 target — while a no-deadband implementation returns
  // exactly to where it started. Both legs are asserted; the second is the one
  // that can fail.
  await setAgl(480, 5000 * SCALE);
  const a1 = await read();
  const s1 = a1.bubble?.k ?? NaN;
  await setAgl(560, 5000 * SCALE);
  await setAgl(480, 5000 * SCALE);
  const s2 = (await read()).bubble?.k ?? NaN;
  gate(
    '(1d) 480 → 560 → 480 does not ratchet (k returns to its start)',
    Number.isFinite(s1) && Number.isFinite(s2) && Math.abs(s1 - s2) < 1e-3,
    Number.isFinite(s1)
      ? `k ${s1.toFixed(4)} → … → ${s2.toFixed(4)}`
      : 'no runtime.groundBubble — the rig is unmounted (flag off)'
  );
  await setAgl(560, 5000 * SCALE);
  const t1 = (await read()).bubble?.k ?? NaN;
  await setAgl(640, 5000 * SCALE);
  await setAgl(560, 5000 * SCALE);
  const t2 = (await read()).bubble?.k ?? NaN;
  gate(
    '(1e) the 60 m INPUT DEADBAND is real: 560 → 640 → 560 does not come back',
    Number.isFinite(t1) && Number.isFinite(t2) && t2 < t1 - 0.02,
    Number.isFinite(t1)
      ? `k ${t1.toFixed(4)} → (640) → ${t2.toFixed(4)}; a no-deadband bubble returns to ${t1.toFixed(4)}`
      : 'no runtime.groundBubble — the rig is unmounted (flag off)'
  );

  // =========================================================================
  // (6) THE BUBBLE CLOSES — measured at cruise before we leave this pose.
  // =========================================================================
  r = await setAgl(1066.8, 8000 * SCALE); // 3500 ft
  gate(
    '(6a) uGroundDetail === 0 at 3500 ft',
    (r.gd?.overlay ?? 0) === 0,
    `overlay=${r.gd?.overlay ?? 'n/a'} k=${(r.bubble?.k ?? 0).toFixed(4)}`
  );
  gate(
    '(6b) both pools are parked at 3500 ft (count 0, visible false)',
    (r.scrub?.count ?? 0) === 0 &&
      (r.hedge?.count ?? 0) === 0 &&
      (r.scrub ? r.scrub.visible === false : true) &&
      (r.hedge ? r.hedge.visible === false : true),
    `scrub=${JSON.stringify(r.scrub)} hedge=${JSON.stringify(r.hedge)}`
  );
  gate(
    '(6c) the landcover drape alpha is back at SAT_TINT.alpha at 3500 ft',
    !ARM || Math.abs((r.gd?.tintAlpha ?? 0) - 0.1) < 1e-6,
    `tintAlpha=${r.gd?.tintAlpha ?? 'n/a'}`
  );

  // =========================================================================
  // (3) THE SUBURB HAS SOMETHING
  // =========================================================================
  r = await setAgl(80, 12000 * SCALE);
  console.log(
    `  Powell 80 m armed: tintChunks=${r.vegTint} tintVerts=${r.vegTintVerts} ` +
      `tintPolys=${r.tint?.polys ?? 'n/a'} scrub=${JSON.stringify(r.scrub)} ` +
      `hedge=${JSON.stringify(r.hedge)} draws=${r.draws} tris=${r.tris} ` +
      `tintAlpha=${r.gd?.tintAlpha} roads=${JSON.stringify(
        await page.evaluate(() => window.__flyStats?.groundDetail ?? null)
      )}`
  );
  // PRECONDITIONS FIRST. A zero count with zero landcover in range is the
  // VENUE having nothing to place on; a zero count with landcover in range is
  // a defect. An instrument that cannot tell those apart reports a coin, so
  // both legs state their precondition and read NOT CALIBRATED — never PASS —
  // when it is unmet (the R24 §7 rule).
  const areaM2 = r.gd?.scrubAreaM2 ?? 0;
  const roadCells = (await page.evaluate(() => window.__flyStats?.groundDetail?.roads ?? 0)) | 0;
  if (!ARM) {
    note('(3a/3b) flag-off leg', 'the layer is not mounted — this is the RED calibration');
    gate('(3a) the suburb places SCRUB (count > 0, mesh visible)', false, 'layer not mounted');
    gate('(3b) the suburb places HEDGES (count > 0, mesh visible)', false, 'layer not mounted');
  } else if (areaM2 <= 0) {
    note(
      '(3a) NOT CALIBRATED',
      `the fixture has ${areaM2} m² of grass/farmland/wood landcover inside the ` +
        `${300} m disc at this pose (${r.vegTint} tint chunks / ${r.vegTintVerts} verts in the ` +
        `whole ring) — the venue has nothing to place on, which is not a statement about the feature`
    );
  } else {
    gate(
      '(3a) the suburb places SCRUB (count > 0, mesh visible)',
      (r.scrub?.count ?? 0) > 0 && r.scrub?.visible === true,
      `${JSON.stringify(r.scrub)} over ${areaM2} m² of in-disc landcover ` +
        `(${r.vegTint} tint chunks / ${r.vegTintVerts} verts)`
    );
  }
  if (ARM) {
    if (roadCells <= 0) {
      note(
        '(3b) NOT CALIBRATED',
        'the parcel-road index is empty at this pose — no cls 5/6 centreline has streamed, ' +
          'so there is nothing to set a hedge beside'
      );
    } else {
      gate(
        '(3b) the suburb places HEDGES (count > 0, mesh visible)',
        (r.hedge?.count ?? 0) > 0 && r.hedge?.visible === true,
        `${JSON.stringify(r.hedge)} over ${roadCells} indexed road cells`
      );
    }
  }
  gate(
    '(3c) the drape alpha is LIFTED inside the bubble',
    !ARM || (r.gd?.tintAlpha ?? 0) > 0.17,
    `tintAlpha=${r.gd?.tintAlpha ?? 'n/a'} (SAT_TINT.alpha 0.1, lowAglAlpha 0.18)`
  );
  const powellArmed = r;

  // =========================================================================
  // (4) THE OVERLAY MOVES PIXELS — on → on → off, both layers PARKED.
  // =========================================================================
  // EVERY ACTOR THE A/B DOES NOT CONTROL IS PARKED FOR BOTH ARMS (R17 §7.1),
  // and that includes one this gate's own feature owns: `__flyGroundDetail.set`
  // pins the SHARED bubble k, which the landcover drape alpha also reads — so
  // toggling it moves the tint as well as the overlay, and the crop would be
  // measuring two things. SatTintLayer does not rewrite `material.visible`, so
  // verify-groundlife's park holds here; with the drape and both instancers
  // parked, the only difference between the arms is `uGroundDetail`.
  await page.evaluate(() => {
    globalThis.__flyGroundDetailLayerOff = true; // the owner-read park
    if (window.__satVeg?.tintMesh) window.__satVeg.tintMesh.material.visible = false;
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
  });
  await page.waitForTimeout(4000 * SCALE);
  const gap = 2500 * SCALE;
  const onA = await shotStats('gd-overlay-on.png');
  await page.waitForTimeout(gap);
  const onB = await shotStats('gd-overlay-onb.png');
  await page.evaluate(() => window.__flyGroundDetail?.set?.(0));
  await page.waitForTimeout(gap);
  const offS = await shotStats('gd-overlay-off.png');
  await page.evaluate(() => window.__flyGroundDetail?.set?.(null));
  await page.evaluate(() => {
    globalThis.__flyGroundDetailLayerOff = false;
    if (window.__satVeg?.tintMesh) window.__satVeg.tintMesh.material.visible = true;
    if (window.__flyPlayer) window.__flyPlayer.visible = true;
  });
  const signal = meanAbsDelta(onB, offS);
  const control = meanAbsDelta(onA, onB);
  console.log(
    `  A/B overlay: signal |dL| ${(signal * 255).toFixed(3)}/255 vs control ` +
      `${(control * 255).toFixed(3)}/255 · means ${onB.mean.toFixed(2)} / ${offS.mean.toFixed(2)}`
  );
  gate(
    `(4a) the overlay moves a ground crop by > ${(OVERLAY_DELTA_MIN * 255).toFixed(0)}/255` +
      (ARM ? '' : ' (RED: the flag-off tree must read ~0)'),
    ARM ? signal > OVERLAY_DELTA_MIN : signal <= OVERLAY_DELTA_MIN,
    `${(signal * 255).toFixed(3)}/255`
  );
  gate(
    '(4b) …and it beats the same-interval control (causation, not drift)',
    ARM ? signal > control * 2 : true,
    `signal ${(signal * 255).toFixed(3)} vs control ${(control * 255).toFixed(3)}` +
      (ARM ? '' : ' — flag off, informational')
  );

  // =========================================================================
  // (5) THE KEY
  // =========================================================================
  const key = powellArmed.gd?.hillKey ?? null;
  gate(
    ARM
      ? "(5) the FINAL tile key carries the 'd' token when armed"
      : "(5) the FINAL tile key carries NO 'd' token with the flag off",
    ARM ? /-[a-z]*d[a-z]*24$/.test(key ?? '') : !/d/.test((key ?? '').replace(/^world-bend-fade-hill-r19/, '')),
    `key=${key}`
  );

  // =========================================================================
  // (2) THE OWENS CONTENT GATE
  // =========================================================================
  r = await fly(OWENS, 95, 40000);
  const census = [];
  for (let i = 0; i < 8; i++) {
    census.push((await read()).draws);
    await page.waitForTimeout(800 * SCALE);
  }
  const owens = await read();
  const drawMax = Math.max(...census.filter((d) => d > 0));
  console.log(
    `  Owens: draws ${census.join('/')} max ${drawMax} tris ${owens.tris} ` +
      `scrub=${JSON.stringify(owens.scrub)} hedge=${JSON.stringify(owens.hedge)} ` +
      `tintChunks=${owens.vegTint} programs=${owens.programs}`
  );
  gate(
    '(2a) Owens places ZERO scrub and ZERO hedges (the content gate)',
    (owens.scrub?.count ?? 0) === 0 && (owens.hedge?.count ?? 0) === 0,
    `scrub=${JSON.stringify(owens.scrub)} hedge=${JSON.stringify(owens.hedge)}`
  );
  gate(
    '(2b) …and both meshes report visible === false, so the draw is not issued',
    (owens.scrub ? owens.scrub.visible === false : true) &&
      (owens.hedge ? owens.hedge.visible === false : true),
    `scrub=${JSON.stringify(owens.scrub)} hedge=${JSON.stringify(owens.hedge)}`
  );
  gate(
    `(2c) Owens draws <= ${OWENS_DRAW_MAX} (the frozen ceiling)`,
    drawMax <= OWENS_DRAW_MAX,
    `max ${drawMax} over ${census.length} samples`
  );

  // The flag-off control for (2d) is the OTHER run of this same file. It is
  // written to disk so the armed run can read it — a number measured in a
  // different process on the same fixture at the same pose is a control; a
  // number remembered from a different day is not.
  const ctlFile = path.join(OUT, 'gd-owens-control.json');
  const fs = require('fs');
  if (!ARM) {
    fs.writeFileSync(
      ctlFile,
      JSON.stringify({ drawMax, census, programs: owens.programs, at: Date.now() }, null, 2)
    );
    note('(2d) flag-off control WRITTEN', `Owens drawMax ${drawMax} → ${ctlFile}`);
  } else if (fs.existsSync(ctlFile)) {
    const ctl = JSON.parse(fs.readFileSync(ctlFile, 'utf8'));
    gate(
      '(2d) Owens armed draws <= the flag-off control measured on this same fixture',
      drawMax <= ctl.drawMax,
      `armed ${drawMax} vs flag-off ${ctl.drawMax}`
    );
    note(
      '(2e) program delta armed − flag-off',
      `${owens.programs} − ${ctl.programs} = ${owens.programs - ctl.programs} ` +
        `(expected +2: the scrub and hedge materials are warmed at boot even where ` +
        `they place nothing; the 'd' tile program REPLACES the un-'d' one)`
    );
  } else {
    note('(2d) NOT CALIBRATED', `no flag-off control at ${ctlFile} — run FLY_GD_ARM=0 first`);
  }

  gate('(0) zero page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(
    `\n${ran - fails.length} passed, ${fails.length} failed` +
      `${notes.length ? ` · ${notes.length} note(s) / NOT CALIBRATED` : ''}`
  );
  if (fails.length) console.log('FAILED: ' + fails.join(', '));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
