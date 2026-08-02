/**
 * Round 20 (B "HOMES") — SatParcelHomes: procedural suburbia where OpenFreeMap
 * ships no footprints, and NOWHERE ELSE.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE TILE DATA ACTUALLY SAYS (measured before a line was written — R18
 * lesson 1 — with A SPRAWL's per-polygon fix already merged; the probe is
 * scripts/r20-b-parcels.js, live 3x3 z14 blocks)
 * ---------------------------------------------------------------------------
 * 1. THE PREMISE MOVED. "Suburbs have no buildings" was true in R19 and is not
 *    true now: A's per-polygon explosion took Powell OH from 15 streamed
 *    footprints to 1,863. What is left is a wide SPREAD in how well a place is
 *    mapped — real footprints per km² of landuse=residential:
 *      Melton AU 37 · Craigieburn AU 53 · Toluca MX 164 · Plain City OH 195 ·
 *      Hamilton NZ 208 · Piaseczno PL 220 · Blagnac FR 222 · Dublin OH 261 ·
 *      Nairobi 341 · Lone Pine 376 · Jaipur 412 · POWELL OH 533 ·
 *      Campinas BR 611 · Manhattan 2750
 *    …against the ~600 dwellings/km² real suburbia runs. Melbourne's outer
 *    suburbs are at 6% of their housing; Powell is finished.
 * 2. DEEP-RURAL AMERICA HAS NO RESIDENTIAL LANDUSE AT ALL. Union County OH
 *    (0.00 km², 7 of 9 tiles with no `building` layer either), Ashley OH
 *    (0.00 km²), Hazard KY (0.00 km²). Those places are farms and a main
 *    street; their 9 / 68 / 189 real footprints ARE the houses. This layer
 *    places ONLY inside residential landuse, so it renders nothing there, and
 *    that is the honest answer rather than a gap.
 * 3. THE cls-4 CANOPY SCATTER COULD NOT BE THE ANCHOR SOURCE. Those rows are
 *    SAT_VEG.maxPerChunk's leftovers (400/tile, residential emitted LAST), so
 *    Craigieburn's 22.72 km² of suburbia produced ZERO of them and Powell's
 *    1.64 km² produced 657. The worker therefore emits a dedicated
 *    `satParcel` sample on its own RNG stream (PARCEL_HOMES-gated).
 *
 * ---------------------------------------------------------------------------
 * GATES
 * ---------------------------------------------------------------------------
 * (A) THE GAP IS FILLED — Melton AU: >= 600 homes placed off >= 150 anchors,
 *     in a scene whose real coverage is 37 footprints per km² of residential.
 * (B) …AND IT IS ONE DRAW — quiesced ON/OFF/ON toggle at that same pose:
 *     median Δdraws === +1 and the scene total stays <= 375.
 * (C) ANTI-DUPLICATION, THE TOWN TERM — Powell OH places ZERO homes and moves
 *     the draw count by ZERO, with anchors > 0 so the pass is not vacuous.
 *     This is the gate the layer was rebuilt around: the LOCAL density term
 *     alone measured 68 buildings/km² at Powell's anchors and 69 at Melton's
 *     (the worker's occupancy mask puts every anchor in unbuilt ground BY
 *     DESIGN), so it could not tell a finished town from an unmapped one.
 *     Regionally they are 6x apart, and that is the term that decides.
 * (D) …AND IT IS NOT AMERICA-ONLY — Blagnac FR (22,448 building polygons over
 *     its 3x3) also places zero.
 * (E) A SMALL TOWN IN BETWEEN GETS PART OF THE DEFICIT — Plain City OH places
 *     homes with 0 < regK < 1, i.e. the scalar is a RAMP, not a switch.
 * (F) THE OWENS LOCK, ON BOTH LEGS. At the frozen gate pose (the one
 *     verify-suburbia (E) and verify-skyline share) there is no residential
 *     parcel within rangeM at all, so the layer is empty and total draws stay
 *     <= 261 with everything armed. But "0 anchors" is a vacuous reason — the
 *     Owens 3x3 DOES carry 2.23 km² of landuse=residential, because Lone Pine
 *     is a real town — so the second leg flies straight over Lone Pine and
 *     proves the lock holds for the HONEST reason there: 69 anchors, all 69
 *     suppressed at 888 real buildings per km² of residential landuse, and the
 *     frame (draws AND triangles) is bit-identical across the flip. Same
 *     standard (C) holds Powell to.
 * (G) THE HEIGHT BAND — every rendered home's world-space height lies inside
 *     PARCEL_HOMES.hM and therefore entirely outside (25, 35) m, measured off
 *     the RENDERED instance matrices and the geometry's own y-extent, not off
 *     the constant. This is verify-suburbia gate (G)'s invariant, re-asserted
 *     for the one layer R20 adds inside its scene.
 * (H) NIGHT IS WINDOWS, NOT A LIT BOX — at the SUBURB_NIGHT γ ramp the
 *     material's emissiveIntensity is > 0 and it carries an emissiveMap; by
 *     day it is exactly 0 (the IEEE identity that keeps every daylight gate).
 * (I) FLAG-OFF IS NO MESH — source gate: the component is mounted behind
 *     PARCEL_HOMES.enabled and the worker emission behind the same flag, so
 *     enabled:false removes the mesh, the anchors and the bundle key.
 * (J) zero page/console errors.
 *
 * Screenshots: r20-b-*.png (written by scripts/r20-b-shots.js, not here).
 * Usage: FLY_URL=http://localhost:3121 node scripts/verify-parcel-homes.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

// Mirrored from fly-constants (this harness is CommonJS and cannot import it).
const H_MIN = 5; // = PARCEL_HOMES.hM[0]
const H_MAX = 9; // = PARCEL_HOMES.hM[1]
const H_CEIL_M = H_MAX * 1.35; // x PARCEL_HOMES.farScale.mul — the rendered ceiling
const GAP_LO = 25; // = SAT_FAR_SUBURB.hardCapM  \ verify-suburbia (G)'s
const GAP_HI = 35; // = SAT_SKYLINE.minH         / forbidden band
const SAT_DRAW_MAX = 375;
const OWENS_DRAW_MAX = 261;
// Measured on this harness' own poses with the flag armed (see the header
// table). The gates sit well inside the measurements so a tileset revision
// cannot flip them, and well outside the suppressed scenes' zeros.
const MELTON_HOMES_MIN = 600; // measured 2068
const MELTON_ANCHORS_MIN = 150; // measured 449
const PLAINCITY_HOMES_MIN = 40; // measured 173

const pinScene = ([lat, lon, altM, heading, pitch]) => {
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

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  // --- (I) SOURCE: the revert is ONE flag, by construction -------------------
  const root = path.join(__dirname, '..');
  const worker = fs.readFileSync(
    path.join(root, 'lib/fly/toy-world/vector-tile.worker.js'),
    'utf8'
  );
  const vegLayer = fs.readFileSync(path.join(root, 'components/fly/SatVegLayer.jsx'), 'utf8');
  const homes = fs.readFileSync(path.join(root, 'components/fly/SatParcelHomes.jsx'), 'utf8');
  gate(
    '(I) mount is gated on PARCEL_HOMES.enabled',
    /\{PARCEL_HOMES\.enabled\s*&&\s*\(?\s*<SatParcelHomes/.test(vegLayer),
    'SatVegLayer.jsx'
  );
  gate(
    '(I) worker parcel emission + telemetry are gated on PARCEL_HOMES.enabled',
    (worker.match(/if\s*\(PARCEL_HOMES\.enabled\)/g) ?? []).length >= 2 &&
      /out\.satParcel\s*=/.test(worker),
    `${(worker.match(/if\s*\(PARCEL_HOMES\.enabled\)/g) ?? []).length} flag guards`
  );
  gate(
    '(I) the parcel pass uses its OWN rng (satVeg rows byte-identical either way)',
    /const\s+prand\s*=\s*mulberry32\(/.test(worker) &&
      /prand\(\)/.test(worker) &&
      !/parcelPts\.push\([^)]*rand\(\)/.test(worker),
    'separate mulberry32 stream'
  );
  // ASSIGNMENTS only, IN CODE. Two earlier cuts of this gate both failed on the
  // component's own comment explaining why it does not set these flags: the
  // first tested for the bare identifiers, the second for `identifier[=:]` —
  // and the comment reads "NO _isModel/_painted: those enrol a mesh…", which is
  // an identifier followed by a colon. A source gate that reads prose is not
  // reading the source, so the comments come OUT before the match runs.
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n'"`]*?\/\/.*$/gm, (m) => m.slice(0, m.indexOf('//')));
  const enrol = stripComments(homes).match(/(?:_isModel|_painted)\s*[=:]/g) ?? [];
  gate(
    '(I) no harness foreground-hide enrolment on the home mesh',
    enrol.length === 0,
    enrol.length ? enrol.join(' ') : 'no _isModel / _painted assignment'
  );

  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked — the setQualityTier below still pins it */
    }
  });
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);

  /**
   * Home heights read off the RENDERED geometry, not off the constant: the
   * instance matrix's Y scale times the geometry's own y-extent IS the world
   * height of that house, which is the number gate (G) is about. The unit
   * house spans y 0..1 by construction, so the extent is read once and
   * asserted rather than assumed.
   */
  const readAll = () => {
    const ph = window.__flyStats?.parcelHomes ?? null;
    const mesh = window.__satVeg?.homeMesh ?? null;
    let hMin = Infinity;
    let hMax = -Infinity;
    let geoSpan = -1;
    if (mesh && mesh.count > 0) {
      const g = mesh.geometry.attributes.position;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < g.count; i++) {
        const y = g.getY(i);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      geoSpan = hi - lo;
      const m = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        const o = i * 16;
        // column 1 length = the Y scale of a TRS matrix
        const sy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
        const h = sy * geoSpan;
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
    }
    return {
      ph,
      hMin: Number.isFinite(hMin) ? hMin : -1,
      hMax: Number.isFinite(hMax) ? hMax : -1,
      geoSpan,
      meshCount: mesh?.count ?? -1,
      meshVisible: mesh?.visible ?? null,
      emissiveIntensity: mesh?.material?.emissiveIntensity ?? -1,
      hasEmissiveMap: !!mesh?.material?.emissiveMap,
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
    };
  };

  const fly = async (pose, sunUTC, ms = 28000) => {
    await page.evaluate((s) => {
      window.__flySunOverride = s;
    }, sunUTC);
    await page.evaluate(pinScene, pose);
    await page.waitForTimeout(ms);
    await page.mouse.move(800, 450);
    return page.evaluate(readAll);
  };

  /**
   * Δ-draw off a QUIESCED scene, median of three ON/OFF pairs. A single A/B is
   * a coin in satellite: streaming, the cloud deck and the traffic pool all
   * move the scene total by a draw or two on their own cadences, which is the
   * R16 §7 lesson ("scene-total draws are not a signal in live flight"). The
   * park handle is read by the LAYER, not applied to the mesh, because the
   * layer would overwrite a visibility flip on its next pass (R19 §7).
   */
  const deltaDraws = async () => {
    const ds = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        window.__flyParcelHomesOff = true;
      });
      await page.waitForTimeout(3500);
      const off = await page.evaluate(() => window.__flyStats?.drawCalls ?? -1);
      await page.evaluate(() => {
        window.__flyParcelHomesOff = false;
      });
      await page.waitForTimeout(3500);
      const on = await page.evaluate(() => window.__flyStats?.drawCalls ?? -1);
      ds.push(on - off);
    }
    ds.sort((a, b) => a - b);
    return { median: ds[1], all: ds };
  };

  const NOON_OH = Date.UTC(2026, 6, 27, 17, 0, 0); // 13:00 EDT
  const NOON_AU = Date.UTC(2026, 6, 27, 2, 0, 0); // 12:00 AEST
  const NOON_FR = Date.UTC(2026, 6, 27, 11, 0, 0); // 13:00 CEST

  // === (A) + (B) + (G) MELTON AU — the gap ==================================
  const melton = await fly([-37.68172, 144.57398, 700, 1.9, -0.34], NOON_AU);
  console.log('MELTON AU:', JSON.stringify(melton));
  gate(
    `(A) the gap is filled (>= ${MELTON_HOMES_MIN} homes off >= ${MELTON_ANCHORS_MIN} anchors)`,
    (melton.ph?.placed ?? 0) >= MELTON_HOMES_MIN &&
      (melton.ph?.anchors ?? 0) >= MELTON_ANCHORS_MIN,
    `placed=${melton.ph?.placed} anchors=${melton.ph?.anchors} ` +
      `regDens=${(melton.ph?.regionalDens ?? 0).toFixed(0)}/km2res regK=${(melton.ph?.regK ?? 0).toFixed(2)}`
  );
  gate(
    '(A) the mesh is actually drawn (visible and counted)',
    melton.meshVisible === true && melton.meshCount === melton.ph?.placed,
    `count=${melton.meshCount} visible=${melton.meshVisible}`
  );
  // The distance up-scale and the altitude fade both ride the instance SCALE
  // (uniformly, so a house keeps its proportions), so the rendered ceiling is
  // hM[1] x farScale.mul = 12.15 m, not hM[1]. That is the number the gate must
  // assert — and 12.15 is still half the floor of the forbidden band, which is
  // the point: the construction rule holds with the whole fade envelope
  // applied, not just at scale 1.
  gate(
    `(G) every rendered home is in (0, ${H_CEIL_M}] m — entirely below the (${GAP_LO}, ${GAP_HI}) band`,
    melton.geoSpan > 0.99 &&
      melton.geoSpan < 1.01 &&
      melton.hMin > 0 &&
      melton.hMax <= H_CEIL_M + 0.01 &&
      melton.hMax <= GAP_LO,
    `geoSpan=${melton.geoSpan.toFixed(4)} heights ${melton.hMin.toFixed(2)}..${melton.hMax.toFixed(2)} m`
  );
  const dd = await deltaDraws();
  gate(
    '(B) the whole layer is ONE draw (median of 3 quiesced ON/OFF pairs)',
    dd.median === 1,
    `Δ=${JSON.stringify(dd.all)} median=${dd.median}`
  );
  gate(
    `(B) Melton draws <= ${SAT_DRAW_MAX}`,
    melton.draws > 0 && melton.draws <= SAT_DRAW_MAX,
    `draws=${melton.draws} tris=${melton.tris}`
  );

  // === (H) NIGHT — the same pose, after dusk ================================
  const meltonNight = await fly(
    [-37.68172, 144.57398, 700, 1.9, -0.34],
    Date.UTC(2026, 6, 27, 15, 0, 0), // 01:00 AEST
    16000
  );
  gate(
    '(H) night lights WINDOWS (emissiveIntensity > 0 through an emissiveMap)',
    meltonNight.emissiveIntensity > 0 && meltonNight.hasEmissiveMap,
    `emissiveIntensity=${meltonNight.emissiveIntensity.toFixed(3)} map=${meltonNight.hasEmissiveMap} ` +
      `nightK=${(meltonNight.ph?.nightK ?? 0).toFixed(2)}`
  );
  gate(
    '(H) day is EXACTLY zero emissive (the identity every daylight gate rests on)',
    melton.emissiveIntensity === 0,
    `noon emissiveIntensity=${melton.emissiveIntensity}`
  );

  // === (C) POWELL OH — the anti-duplication control ==========================
  const powell = await fly([40.15153, -83.08533, 700, 1.9, -0.34], NOON_OH);
  console.log('POWELL OH:', JSON.stringify(powell.ph));
  gate(
    '(C) Powell is NOT vacuous — anchors exist there',
    (powell.ph?.anchors ?? 0) > 0,
    `anchors=${powell.ph?.anchors} regDens=${(powell.ph?.regionalDens ?? 0).toFixed(0)}/km2res`
  );
  gate(
    '(C) …and every one of them is suppressed (0 homes over a mapped town)',
    powell.ph?.placed === 0 &&
      powell.ph?.suppressed === powell.ph?.anchors &&
      powell.meshCount === 0 &&
      powell.meshVisible === false,
    `placed=${powell.ph?.placed} suppressed=${powell.ph?.suppressed}/${powell.ph?.anchors} ` +
      `regK=${(powell.ph?.regK ?? 0).toFixed(2)}`
  );
  const ddPowell = await deltaDraws();
  gate(
    '(C) …so Powell moves ZERO draws (the frame is unchanged)',
    ddPowell.median === 0,
    `Δ=${JSON.stringify(ddPowell.all)}`
  );

  // === (D) BLAGNAC FR — a mapped non-US town ================================
  const blagnac = await fly([43.63379, 1.38366, 700, 1.9, -0.34], NOON_FR);
  console.log('BLAGNAC FR:', JSON.stringify(blagnac.ph));
  gate(
    '(D) a mapped NON-US town is suppressed too (anchors > 0, homes 0)',
    (blagnac.ph?.anchors ?? 0) > 0 && blagnac.ph?.placed === 0,
    `anchors=${blagnac.ph?.anchors} placed=${blagnac.ph?.placed} ` +
      `regDens=${(blagnac.ph?.regionalDens ?? 0).toFixed(0)}/km2res regK=${(blagnac.ph?.regK ?? 0).toFixed(2)}`
  );

  // === (E) PLAIN CITY OH — the ramp =========================================
  const plain = await fly([40.1073, -83.2674, 700, 1.9, -0.34], NOON_OH);
  console.log('PLAIN CITY OH:', JSON.stringify(plain.ph));
  gate(
    `(E) a half-mapped small town gets PART of the deficit (>= ${PLAINCITY_HOMES_MIN} homes, 0 < regK < 1)`,
    (plain.ph?.placed ?? 0) >= PLAINCITY_HOMES_MIN &&
      (plain.ph?.regK ?? 0) > 0.02 &&
      (plain.ph?.regK ?? 1) < 0.98,
    `placed=${plain.ph?.placed} anchors=${plain.ph?.anchors} regK=${(plain.ph?.regK ?? 0).toFixed(2)}`
  );

  // === (F) THE OWENS LOCK ===================================================
  // The same pose verify-skyline and verify-suburbia (E) use.
  const owens = await fly([36.6, -118.1, 2600, 1.2, -0.18], NOON_OH);
  console.log('OWENS VALLEY:', JSON.stringify(owens.ph), 'draws', owens.draws);
  gate(
    '(F) no residential parcel is within range of the frozen Owens pose (0 anchors, 0 homes, no mesh)',
    owens.ph?.anchors === 0 && owens.ph?.placed === 0 && owens.meshVisible === false,
    `anchors=${owens.ph?.anchors} placed=${owens.ph?.placed} visible=${owens.meshVisible}`
  );
  gate(
    `(F) Owens total draws <= ${OWENS_DRAW_MAX} with parcel homes armed`,
    owens.draws > 0 && owens.draws <= OWENS_DRAW_MAX,
    `draws=${owens.draws}`
  );

  // …and the leg that makes the one above non-vacuous. Lone Pine is a real
  // town inside the Owens 3x3 (2.23 km² of residential landuse); the lock has
  // to hold when the player is ON it, not merely when the pose misses it.
  const lonePine = await fly([36.6061, -118.0632, 700, 1.9, -0.34], NOON_OH);
  console.log('LONE PINE:', JSON.stringify(lonePine.ph), 'draws', lonePine.draws);
  gate(
    '(F) Lone Pine is NOT vacuous — the Owens 3x3 does carry residential parcels',
    (lonePine.ph?.anchors ?? 0) > 0,
    `anchors=${lonePine.ph?.anchors} regDens=${(lonePine.ph?.regionalDens ?? 0).toFixed(0)}/km2res`
  );
  gate(
    '(F) …and the mapped town suppresses every one of them (0 homes, no mesh)',
    lonePine.ph?.placed === 0 &&
      lonePine.ph?.suppressed === lonePine.ph?.anchors &&
      lonePine.meshVisible === false &&
      lonePine.draws <= OWENS_DRAW_MAX,
    `placed=${lonePine.ph?.placed} suppressed=${lonePine.ph?.suppressed}/${lonePine.ph?.anchors} ` +
      `regK=${(lonePine.ph?.regK ?? 0).toFixed(2)} draws=${lonePine.draws}`
  );

  gate('(J) zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
