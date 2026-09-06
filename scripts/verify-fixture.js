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
const { settleWorld } = require('./_settle');

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
 * The census reads the ENGINE HANDLES rather than guessing at mesh names:
 * `window.__satBuildings.object` is named 'sat-buildings'
 * (sat-building-engine.js:304) and `__satSkyline.object` 'sat-skyline'
 * (:121), but their per-chunk children are unnamed, so a name scan over the
 * scene finds nothing. Draw/triangle totals come from `window.__flyStats`,
 * which FlyScene republishes every 60 frames (FlyScene.jsx:1737) — at
 * SwiftShader's ~1 fps that is once a minute, so the caller NULLS the field
 * first and waits for a fresh number rather than sleeping and hoping.
 */
const CENSUS = () => {
  const drawable = (o) => o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine;
  const countIn = (root) => {
    let n = 0;
    root?.traverse?.((o) => {
      if (drawable(o) && o.visible) n++;
    });
    return n;
  };
  let scene = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
  while (scene && scene.parent) scene = scene.parent;
  let meshes = 0;
  scene?.traverse((o) => {
    if (drawable(o)) meshes++;
  });
  const st = window.__flyStats || {};
  return {
    draws: st.drawCalls ?? null,
    tris: st.triangles ?? null,
    meshes,
    counts: {
      satBuilding: countIn(window.__satBuildings?.object),
      satSkyline: countIn(window.__satSkyline?.object),
      satVeg: countIn(window.__satVeg?.object ?? window.__satVeg?.group),
      parcel: st.parcelHomes?.placed ?? 0,
      toyChunk: countIn(window.__toyWorld?.object ?? window.__fly?.engine?.object),
    },
    sb: window.__satBuildings?.stats
      ? { chunks: window.__satBuildings.stats.chunks, ready: window.__satBuildings.stats.ready, empty: window.__satBuildings.stats.empty }
      : null,
    sky: window.__satSkyline?.stats
      ? { chunks: window.__satSkyline.stats.chunks, ready: window.__satSkyline.stats.ready }
      : null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    remounts: st.sceneRemounts ?? null,
    traffic: st.traffic ?? window.__fly?.traffic?.size ?? null,
  };
};

/**
 * Pin a pose and census it.
 *
 * `runtime.warpToGeo` is NULLED on FlyScene's effect cleanup (FlyScene.jsx:745)
 * and re-registered on the next run, so any remount leaves a window in which
 * it is not a function. Waiting for it (rather than calling it blind) is the
 * difference between a gate that measures the world and a gate that reports
 * "warpToGeo is not a function". MEASURED here: editing a source file while a
 * browser gate runs triggers exactly that remount through Next's HMR — do not
 * edit during a run (the R13 lesson, re-learned).
 */
async function pose(page, p, settleMs) {
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(PIN_POSE, p);
  // "Settled" is a CONDITION, not a duration — see scripts/_settle.js for the
  // two ways a fixed sleep gets it wrong here (a z6 ground at 45 s; a chunk
  // that reached `ready` at 13 s with coarse:true because its drape exhausted
  // drapeMaxTries on a shallow DEM). settleMs is the CAP, not the wait.
  const st = await settleWorld(page, { capMs: settleMs });
  const c = await page.evaluate(CENSUS);
  return { ...c, settle: { settled: st.settled, why: st.why, ms: st.ms, maxZ: st.maxZ, tiles: st.tiles, groundElev: st.groundElev } };
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

  // A CAP now, not a sleep. Content poses under SwiftShader need the terrain
  // to reach z14+ (~150 s at Powell) before a building drape can commit.
  const settle = Number(process.env.FLY_FIXTURE_SETTLE_MS || 420000);
  const scenes = {};
  for (const [name, pose_] of Object.entries(POSES)) {
    scenes[name] = await pose(page, pose_, settle);
    const sc = scenes[name];
    console.log(
      `  ${name.padEnd(10)} draws=${sc.draws} tris=${sc.tris} meshes=${sc.meshes} ` +
        `counts=${JSON.stringify(sc.counts)} sb=${JSON.stringify(sc.sb)}\n` +
        `             settled=${sc.settle.settled} in ${(sc.settle.ms / 1000).toFixed(0)}s ` +
        `(${sc.settle.why}) · maxZ=${sc.settle.maxZ} tiles=${sc.settle.tiles} ground=${sc.settle.groundElev?.toFixed?.(1)}m`
    );
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
  const toy = await pose(page2, POSES.powell, settle);
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
