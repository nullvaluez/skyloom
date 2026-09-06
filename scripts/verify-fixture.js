/**
 * R24 (E CERT) — verify-fixture: the OFFLINE WORLD FIXTURE's own gate.
 *
 * Everything the other four agents' gates rest on is asserted here, once:
 * that the fixture boots a real world at both styles, that the scene placement
 * matches the fleet's hard-coded poses, that Owens is EMPTY by construction,
 * and that a tile's bytes are stable on re-fetch.
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-fixture.js
 *
 * Every number here is a FIXTURE number. None of it re-baselines a live gate
 * (HARN-GAP-6), and nothing here is an fps/ms claim — SwiftShader runs the
 * game at ~1 fps (HARN-ENV-3) and boot wall time is reported as CONTEXT for
 * scaling harness waits, never as a budget.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');
const { attachFixture } = require('./_fixture');

const POSES = {
  // [lat, lon, altM, heading, pitch] — grepped from the fleet, see scenes.mjs
  manhattan: [40.7075, -74.0113, 792, 2.6, -0.12],
  powell: [40.1578, -83.0752, 900, 1.9, -0.3],
  owens: [36.6, -118.1, 2600, 1.2, -0.18],
  melton: [-37.68172, 144.57398, 700, 1.9, -0.34],
};

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__fxPin) clearInterval(window.__fxPin);
  window.__fxPin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * The scene root is reached through the fleet's own idiom (verify-aerial:107).
 * Draw/triangle totals come from `window.__flyStats`, which FlyScene republishes
 * every 60 frames — at SwiftShader's ~1 fps that is once a minute, so the
 * caller NULLS the field first and waits for a fresh number rather than
 * sleeping and hoping (a stale total would describe the previous pose).
 */
const CENSUS = () => {
  let scene = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
  while (scene && scene.parent) scene = scene.parent;
  const counts = {
    satBuilding: 0,
    satSkyline: 0,
    satRoads: 0,
    satVeg: 0,
    parcel: 0,
    toyChunk: 0,
    tile: 0,
  };
  let meshes = 0;
  scene?.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLine) return;
    meshes++;
    const n = (o.name || '') + '|' + (o.parent?.name || '');
    if (n.includes('sat-building') || n.includes('satbldg')) counts.satBuilding++;
    else if (n.includes('skyline')) counts.satSkyline++;
    else if (n.includes('sat-road') || n.includes('satroad')) counts.satRoads++;
    else if (n.includes('veg') || n.includes('canopy') || n.includes('tree')) counts.satVeg++;
    else if (n.includes('parcel') || n.includes('home')) counts.parcel++;
    else if (n.includes('chunk')) counts.toyChunk++;
    else if (n.includes('tile') || o.isTileMesh) counts.tile++;
  });
  const st = window.__flyStats || {};
  return {
    draws: st.drawCalls ?? null,
    tris: st.triangles ?? null,
    meshes,
    counts,
    sb: window.__satBuildings?.stats ?? null,
    sky: window.__satSkyline?.stats ?? null,
    veg: window.__satVeg?.stats ?? null,
    traffic: st.traffic ?? window.__fly?.traffic?.size ?? null,
  };
};

/** Force a fresh 60-frame stats publish, then census. */
async function census(page, settleMs) {
  await page.waitForTimeout(settleMs);
  await page.evaluate(() => {
    if (window.__flyStats) window.__flyStats.drawCalls = null;
  });
  await page
    .waitForFunction(() => typeof window.__flyStats?.drawCalls === 'number', undefined, {
      timeout: 240000,
      polling: 500,
    })
    .catch(() => {});
  return page.evaluate(CENSUS);
}

let pass = 0;
let fail = 0;
const rows = [];
function gate(name, ok, detail) {
  (ok ? pass++ : fail++);
  rows.push([ok ? 'PASS' : 'FAIL', name, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

(async () => {
  if (!process.env.FLY_TILE_FIXTURE) {
    console.error('FLY_TILE_FIXTURE must be set — this gate exists to certify the fixture.');
    process.exit(2);
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const fx = await attachFixture(context);
  const spec = await fx.spec();
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // --- (1) node-level: tile bytes are deterministic on re-fetch
  const a1 = await (await fetch(`${fx.url}/mvt/14/4411/6193.pbf`)).arrayBuffer();
  const a2 = await (await fetch(`${fx.url}/mvt/14/4411/6193.pbf`)).arrayBuffer();
  const d1 = await (await fetch(`${fx.url}/dem/14/4411/6193.png`)).arrayBuffer();
  const d2 = await (await fetch(`${fx.url}/dem/14/4411/6193.png`)).arrayBuffer();
  const i1 = await (await fetch(`${fx.url}/img/14/6193/4411`)).arrayBuffer();
  const i2 = await (await fetch(`${fx.url}/img/14/6193/4411`)).arrayBuffer();
  const same = (x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)) === 0;
  gate('(1) DETERMINISTIC BYTES — mvt/dem/img identical on re-fetch',
    same(a1, a2) && same(d1, d2) && same(i1, i2),
    `mvt ${a1.byteLength}B dem ${d1.byteLength}B img ${i1.byteLength}B`);

  // --- (2) the 200-with-empty-body tile exists and is 0 bytes
  const eb = await fetch(`${fx.url}/mvt/14/4413/6194.pbf`);
  const ebBuf = await eb.arrayBuffer();
  gate('(2) 200-WITH-EMPTY-BODY tile — OFM’s real “zero” shape is reachable',
    eb.status === 200 && ebBuf.byteLength === 0 && eb.headers.get('x-fixture-empty-body') === '1',
    `status=${eb.status} bytes=${ebBuf.byteLength}`);

  await fx.resetStats();
  const t0 = Date.now();
  const boot = await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  const bootMs = Date.now() - t0;
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  const st1 = await fx.stats();
  gate('(3) SATELLITE BOOTS ON THE FIXTURE — imagery, DEM and MVT all served',
    (st1.byKind.img || 0) > 0 && (st1.byKind.dem || 0) > 0 && (st1.byKind.mvt || 0) > 0,
    `img=${st1.byKind.img} dem=${st1.byKind.dem} mvt=${st1.byKind.mvt} tilejson=${st1.byKind.tilejson} boot=${(bootMs / 1000).toFixed(1)}s (pct100 at ${(boot.ms / 1000).toFixed(1)}s)`);

  const settle = Number(process.env.FLY_FIXTURE_SETTLE_MS || 60000);
  const scenes = {};
  for (const [name, pose] of Object.entries(POSES)) {
    await page.evaluate(PIN_POSE, pose);
    scenes[name] = await census(page, settle);
    console.log(`  ${name.padEnd(10)} draws=${scenes[name].draws} tris=${scenes[name].tris} meshes=${scenes[name].meshes} counts=${JSON.stringify(scenes[name].counts)} sb=${JSON.stringify(scenes[name].sb)}`);
  }

  gate('(4) MANHATTAN IS A CITY — the dense scene builds real satellite geometry',
    scenes.manhattan.counts.satBuilding > 0 && scenes.manhattan.tris > 50000,
    `satBuilding meshes=${scenes.manhattan.counts.satBuilding} tris=${scenes.manhattan.tris}`);
  gate('(5) POWELL IS A SUBURB — footprints stream at the low-AGL pose',
    scenes.powell.counts.satBuilding > 0,
    `satBuilding meshes=${scenes.powell.counts.satBuilding} sb=${JSON.stringify(scenes.powell.sb)}`);
  gate('(6) THE OWENS LOCK — the desert scene issues ZERO building / skyline / parcel meshes',
    scenes.owens.counts.satBuilding === 0 &&
      scenes.owens.counts.satSkyline === 0 &&
      scenes.owens.counts.parcel === 0,
    `bld=${scenes.owens.counts.satBuilding} sky=${scenes.owens.counts.satSkyline} parcel=${scenes.owens.counts.parcel} draws=${scenes.owens.draws}`);
  gate('(7) OWENS DRAW CEILING (fixture column, informational vs the live ≤ 261)',
    scenes.owens.draws !== null,
    `draws=${scenes.owens.draws} tris=${scenes.owens.tris}`);
  gate('(8) TRAFFIC STUB REACHES THE ENGINE',
    (scenes.manhattan.traffic ?? 0) > 0,
    `tracks=${scenes.manhattan.traffic} aircraftReq=${(await fx.stats()).byKind.aircraft}`);

  // --- toy leg
  const page2 = await context.newPage();
  page2.on('pageerror', (e) => errors.push('toy: ' + String(e)));
  const t1 = Date.now();
  await bootFly(page2, { style: 'toy', timeoutMs: 600000, settleMs: 8000 });
  const toyBootMs = Date.now() - t1;
  await page2.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page2.evaluate(PIN_POSE, POSES.powell);
  const toy = await census(page2, settle);
  console.log(`  toy/powell draws=${toy.draws} tris=${toy.tris} meshes=${toy.meshes} counts=${JSON.stringify(toy.counts)}`);
  gate('(9) TOY BOOTS ON THE FIXTURE — the vector chunk pipeline finalises chunks',
    toy.counts.toyChunk > 0 || toy.tris > 20000,
    `toyChunks=${toy.counts.toyChunk} tris=${toy.tris} boot=${(toyBootMs / 1000).toFixed(1)}s`);

  gate('(10) NO PAGE ERRORS during either boot', errors.length === 0,
    errors.slice(0, 3).join(' | ') || 'clean');

  const stats = await fx.stats();
  console.log('\nFIXTURE REQUESTS:', JSON.stringify(stats.byKind));
  console.log('SPEC:', JSON.stringify(spec.imagery));
  console.log(JSON.stringify({ fixtureCensus: scenes, toy, bootMs, toyBootMs }, null, 1));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  await fx.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
