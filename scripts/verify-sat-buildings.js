/**
 * Round 13 Phase 3 — CENTERPIECE: 3D extruded buildings in satellite.
 * Gates (satellite boot, tier high unless noted):
 * (A) MOUNT — over Manhattan at 2.6k ft the SatBuildingEngine streams: at least
 *     a handful of merged building chunks go 'ready' (window.__satBuildings.ready),
 *     __flyStats.satBuildings reports chunk/draw stats, AND the toy pipeline is
 *     NEVER built (window.__toyWorld undefined — verify-round11 gate A invariant).
 * (B) BUDGET — total draws ≤ 375 at the Manhattan 2.6k ft worst case; the building
 *     layer's own cost is measured via a visibility toggle (report the Δ).
 * (C) BYTE-NOOP — (i) the building meshes toggle cleanly to a control draw count;
 *     (ii) at CRUISE (eye AGL past the cull band) the ring evicts → ready 0, no
 *     building draws; (iii) switching mapStyle away from satellite unmounts the
 *     layer → window.__satBuildings undefined (the same mount gate SAT_BUILDINGS
 *     .enabled:false takes — one boolean in the FlyScene &&-chain).
 * (D) GROUND ANCHOR — over hilly SAN FRANCISCO (Nob Hill ~100m) a building base
 *     sits on RAW DEM (base+baseSink ≈ DEM, and well below the toy ×1.7 drawn
 *     ground) — mirrors verify-monuments-sat's raw-DEM discriminator.
 * (E) zero page/console errors. Screenshots: Manhattan 2.6k ft + Tokyo warp.
 * Run against the dev server on :3000 (dev-only globals).
 *
 * ---------------------------------------------------------------------------
 * ROUND 20 (A "SPRAWL") — APPENDED GATE (F): THE PER-POLYGON BUNDLE CONTRACT
 * ---------------------------------------------------------------------------
 * SAT_POLY_COVER explodes a multipolygon `building` feature into one item per
 * polygon. Two things downstream depend on that being TRUE and not merely
 * intended, and neither had a gate:
 *
 *  (F1) THE CAP IS A POLYGON CAP. Before the flag a kept ITEM emitted every
 *       polygon of its feature, so SAT_BUILDINGS.maxPerChunk (500) bounded
 *       FEATURES and the geometry was unbounded — Manhattan's 9-tile block
 *       measured 510,984 worker triangles against 400,551 after. The gate:
 *       no chunk's meta.kept may exceed the cap, and the ring total must be
 *       large enough that the cap is actually binding somewhere.
 *
 *  (F2) ONE DRAPE ANCHOR PER BUILDING — the half of the defect with no visible
 *       symptom until you look for it. sat-building-engine samples the DEM
 *       once per ANCHOR RUN and derives the R18 collision cylinder from the
 *       same run, so a feature carrying a subdivision produced ONE cylinder
 *       whose radius spanned the whole subdivision (hundreds of metres) and
 *       one ground height for every house in it. Per polygon, the cylinder is
 *       a building again. The gate reads the widest collision radius the ring
 *       holds. MEASURED on the Manhattan pose, same 16 chunks: flag ON 306
 *       world units, flag OFF 3391 — the control's widest "building" cylinder
 *       is wider than a city block, which is the latent R18 collision defect
 *       this fix retires as a side effect.
 *
 *  (F3) COVERAGE — the ring's total kept footprints at Manhattan: 3483 -> 6990.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

// = SAT_BUILDINGS.baseSinkM (walls extrude this far below the anchor ground so
// slope/hill gaps hide). Hardcoded because fly-constants.js is ESM (the harness
// is CommonJS) — keep in sync if the constant moves.
const BASE_SINK_M = 6;
// Round 20 (A). = SAT_POLY_COVER.maxPerChunk — the POLYGON cap that replaces
// SAT_BUILDINGS.maxPerChunk's feature cap under the flag.
const POLY_CAP = 500;
// Widest collision cylinder the ring may hold (gate F2), in WORLD (mercator)
// units — the frame the engine stores columns in. A single long building can
// legitimately reach a few hundred (a 600x100 plate at the 60,000 m² footprint
// ceiling has a 304 half-diagonal), so this is not an analytic bound; it is a
// MEASURED gap. On the Manhattan pose below: flag ON 306, flag OFF 3391 — an
// 11x separation, because a feature-wide cylinder spans a whole city block.
// 800 sits 2.6x above the armed reading and 4.2x under the control.
const COLUMN_R_MAX_M = 800;
// Ring-total footprints at Manhattan (gate F3). Measured: flag ON 6990, flag
// OFF 3483 — the same 16 chunks, twice the buildings, because a kept item is
// now a building instead of a whole merged feature.
const MANHATTAN_KEPT_MIN = 5000;

// Warp + pin a fixed pose, then dwell for the imagery/DEM/OFM stream-in.
// (single array arg — page.evaluate passes exactly one argument)
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

// Scan every streamed building, compare its baked base-Y to the EXACT DEM under
// its own footprint, and return the one on the HIGHEST DEM (the most elevated
// building = the strongest raw-vs-toy-exaggeration discriminator on a hill).
const groundProbe = () => {
  const eng = window.__satBuildings;
  if (!eng) return { err: 'no engine' };
  const V = window.__fly.flight.pos.constructor; // THREE.Vector3
  let best = null;
  for (const c of eng.chunks.values()) {
    if (!c.mesh) continue;
    const g = c.mesh.geometry;
    const anch = g.getAttribute('aBendAnchor');
    const pos = g.getAttribute('position');
    let ax = NaN;
    let az = NaN;
    let minY = Infinity;
    const flush = () => {
      if (!Number.isFinite(ax)) return;
      const wx = c.mesh.position.x + ax; // absolute mercator (mesh.position = tile center)
      const wz = c.mesh.position.z + az;
      const geo = window.__fly.engine.worldToGeo(new V(wx, 0, wz));
      const grd = window.__fly.engine.getGroundAt(geo.x, geo.y);
      if (grd && grd.tileZ >= 12 && (!best || grd.elev > best.dem)) {
        best = { base: minY, dem: grd.elev, demZ: grd.tileZ, lon: geo.x, lat: geo.y };
      }
    };
    for (let i = 0; i < pos.count; i++) {
      const a = anch.getX(i);
      const b = anch.getY(i);
      if (a !== ax || b !== az) {
        flush();
        ax = a;
        az = b;
        minY = Infinity;
      }
      const y = pos.getY(i);
      if (y < minY) minY = y;
    }
    flush();
  }
  return best || { err: 'no elevated building sampled' };
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
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });

  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);

  // --- (A/B) Manhattan lower, 2.6k ft (792m absolute), nosed down over downtown
  await page.evaluate(pinScene, [40.7075, -74.0113, 792, 2.6, -0.12]);
  await page.waitForTimeout(22000);
  await page.mouse.move(800, 450);
  const man = await page.evaluate(() => {
    // Round 20 (A): per-chunk kept + the widest collision cylinder. Both come
    // off the ENGINE's own records (chunk.meta is the worker's per-tile
    // telemetry; chunk.columns.data is [x, z, topY, r] per anchor run), so
    // this measures what actually shipped, not what the worker intended.
    let maxKept = 0;
    let totKept = 0;
    let metaChunks = 0;
    let maxR = 0;
    let nCol = 0;
    const eng = window.__satBuildings;
    if (eng) {
      for (const c of eng.chunks.values()) {
        if (c.meta) {
          metaChunks += 1;
          totKept += c.meta.kept ?? 0;
          if ((c.meta.kept ?? 0) > maxKept) maxKept = c.meta.kept;
        }
        const col = c.columns;
        if (col) {
          nCol += col.count;
          for (let i = 0; i < col.count; i++) {
            const r = col.data[i * 4 + 3];
            if (r > maxR) maxR = r;
          }
        }
      }
    }
    return {
      sb: window.__flyStats?.satBuildings ?? null,
      engReady: window.__satBuildings ? window.__satBuildings.stats.ready : -1,
      draws: window.__flyStats?.drawCalls,
      toyBuilt: typeof window.__toyWorld !== 'undefined',
      heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
      eyeAgl: Math.round(window.__fly.flight.pos.y - window.__fly.flight.groundElev),
      maxKept,
      totKept,
      metaChunks,
      maxR,
      nCol,
    };
  });
  await glShot('r13-bldg-manhattan.png');
  console.log('MANHATTAN:', JSON.stringify(man));
  gate('buildings stream in satellite (ready ≥ 3)', (man.sb?.ready ?? 0) >= 3, `ready=${man.sb?.ready}`);
  gate('stats reported (__flyStats.satBuildings)', man.sb !== null && typeof man.sb.chunks === 'number');
  gate('toy pipeline NEVER built in satellite (gate A)', man.toyBuilt === false);
  gate('eye AGL is the low-AGL worst case (~2.6k ft)', man.eyeAgl > 600 && man.eyeAgl < 1000, `agl=${man.eyeAgl}`);
  // --- Round 20 (A SPRAWL): the per-polygon bundle contract ----------------
  console.log(
    `PER-POLY: chunks=${man.metaChunks} keptTotal=${man.totKept} keptMax/chunk=${man.maxKept} ` +
      `columns=${man.nCol} maxColumnR=${man.maxR.toFixed(1)} m`
  );
  gate(
    `(F1) per-chunk kept never exceeds the POLYGON cap (${POLY_CAP})`,
    man.metaChunks > 0 && man.maxKept > 0 && man.maxKept <= POLY_CAP,
    `max kept/chunk=${man.maxKept} over ${man.metaChunks} chunks (total ${man.totKept})`
  );
  gate(
    '(F1) the cap is actually binding over Manhattan (precondition)',
    man.maxKept === POLY_CAP,
    `max kept/chunk=${man.maxKept}`
  );
  gate(
    `(F2) one collision cylinder per BUILDING — widest radius <= ${COLUMN_R_MAX_M} (control: 3391)`,
    man.nCol > 0 && man.maxR > 0 && man.maxR <= COLUMN_R_MAX_M,
    `maxR=${man.maxR.toFixed(1)} across ${man.nCol} columns`
  );
  gate(
    `(F3) per-polygon coverage over Manhattan (kept >= ${MANHATTAN_KEPT_MIN}; control 3483)`,
    man.totKept >= MANHATTAN_KEPT_MIN,
    `kept=${man.totKept} across ${man.metaChunks} chunks`
  );

  // Building draw cost via the visibility toggle (verify-monuments-sat recipe)
  const before = man.draws;
  await page.evaluate(() => {
    window.__satBuildings.object.traverse((o) => {
      if (o.isMesh) o.visible = false;
    });
  });
  await page.waitForTimeout(2000);
  const control = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
  await page.evaluate(() => {
    window.__satBuildings.object.traverse((o) => {
      if (o.isMesh) o.visible = true;
    });
  });
  const delta = before - control;
  console.log(`building draw cost: ${before} → ${control} (Δ ${delta}) · control(base) ${control}`);
  gate('total draws ≤ 375 at Manhattan 2.6k ft', (before ?? 999) <= 375, `draws=${before}`);
  gate('building layer draws measurably (Δ ≥ 1)', delta >= 1, `Δ=${delta}`);
  gate('control (buildings-off) draws are a clean baseline ≤ 375', control <= 375, `control=${control}`);

  // --- (C-ii) cruise eviction: climb high → the altitude ring disarms ---------
  await page.evaluate(pinScene, [40.7075, -74.0113, 6000, 0, 0]);
  await page.waitForTimeout(6000);
  const cruise = await page.evaluate(() => ({
    ready: window.__satBuildings?.stats.ready ?? -1,
    ringOn: window.__satBuildings?.stats.ringOn ?? null,
    chunks: window.__satBuildings?.stats.chunks ?? -1,
  }));
  console.log('CRUISE (eyeAGL≫cull):', JSON.stringify(cruise));
  gate('buildings evict at cruise (ready 0, ring off)', cruise.ready === 0 && cruise.ringOn === false, JSON.stringify(cruise));

  // --- (D) hilly-city ground anchor: San Francisco / Nob Hill (~100m) ---------
  await page.evaluate(pinScene, [37.793, -122.4161, 800, 1.4, -0.14]);
  await page.waitForTimeout(22000);
  await page.mouse.move(800, 450);
  const sf = await page.evaluate(groundProbe);
  await glShot('r13-bldg-sf.png');
  console.log('SF ground probe:', JSON.stringify(sf));
  const g = sf;
  const groundOk =
    !g.err &&
    typeof g.dem === 'number' &&
    g.dem > 25 && // a genuinely elevated building streamed in (SF relief, not sea level)
    g.demZ >= 12 &&
    Math.abs(g.base + BASE_SINK_M - g.dem) <= 25 && // base+sink ≈ raw DEM (allows z-refine jitter)
    g.base < g.dem * 1.4; // toy drawn ground would be ×1.7 — this stays raw
  gate('buildings sit on RAW DEM on a hill (no toy exaggeration)', groundOk, `base=${g.base?.toFixed(0)} dem=${g.dem?.toFixed(0)} z=${g.demZ}`);

  // --- (E) Tokyo warp screenshot (buildings mount at a second dense metro) ----
  await page.evaluate(pinScene, [35.6812, 139.7671, 820, 3.9, -0.13]);
  await page.waitForTimeout(22000);
  await page.mouse.move(800, 450);
  const tok = await page.evaluate(() => ({
    ready: window.__satBuildings?.stats.ready ?? -1,
    draws: window.__flyStats?.drawCalls,
  }));
  await glShot('r13-bldg-tokyo.png');
  console.log('TOKYO:', JSON.stringify(tok));
  gate('buildings stream at Tokyo too (ready ≥ 3)', tok.ready >= 3, `ready=${tok.ready}`);
  gate('Tokyo draws ≤ 375', (tok.draws ?? 999) <= 375, `draws=${tok.draws}`);

  // --- (C-iii) style-switch byte-noop: leave satellite → layer unmounts -------
  await page.evaluate(() => {
    if (window.__pin) clearInterval(window.__pin);
    window.__flyStore.getState().setMapStyle('toy');
  });
  await page.waitForTimeout(4000);
  const off = await page.evaluate(() => ({
    satEng: typeof window.__satBuildings !== 'undefined',
  }));
  console.log('BYTE-NOOP (style→toy):', JSON.stringify(off));
  gate('layer unmounts off-satellite → no __satBuildings global', off.satEng === false);

  gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
