/* Production Neon budget check; root runs GPU jobs sequentially.
 * node scripts/verify-ground-neon.cjs --url=http://localhost:3038 --build-id=ID
 * The three locations/absolute altitudes and 480 draw/2M triangle ceilings
 * come from verify-neon-cover.js. No inherited _boot or development handles.
 */
const fs = require('node:fs');
const path = require('node:path');
const groundBuildReceipt = require('./ground-build-receipt.cjs');

const POSES = Object.freeze([
  { name: 'cruise', lat: 40.7549, lon: -73.984, y: 7925, ultra: true },
  { name: 'powell', lat: 40.1578, lon: -83.0752, y: 1470, ultra: false },
  { name: 'nyclow', lat: 40.7549, lon: -73.984, y: 1200, ultra: false },
]);
const LIMITS = Object.freeze({ draws: 480, triangles: 2000000 });
const WORLD_PINS = ['__flyTerraPin', '__flySettlePin', '__flyClutterPin', '__flyDepthPin',
  '__flyAerialOverride', '__flySatShadowOverride', '__flyTerraForce', '__flyGroundFeatures'];

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (!match || !['url', 'build-id', 'output', 'self-test'].includes(match[1])) throw Error(`Unknown argument ${raw}`);
    if (Object.hasOwn(args, match[1])) throw Error(`Duplicate argument ${match[1]}`);
    args[match[1]] = match[2] ?? true;
  }
  if (args['self-test']) return { selfTest: true };
  if (typeof args.url !== 'string' || typeof args['build-id'] !== 'string' || !/^[\w-]+$/.test(args['build-id'])) {
    throw Error('--url=ORIGIN and --build-id=ID are required');
  }
  const url = new URL(args.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw Error('--url must be an HTTP(S) app origin');
  }
  if (args.output !== undefined && (typeof args.output !== 'string' || !args.output)) throw Error('--output requires a path');
  return { url: url.origin, buildId: args['build-id'], output: path.resolve(args.output || '.graphics-review/ground-final-neon') };
}

// Serialized into the browser. Read the existing production bus and actual
// scene objects; do not expose or reconstruct the private ToyWorldEngine.
function snapshot() {
  const rt = window.__fly, state = window.__flyStore?.getState(), review = window.__graphicsReview;
  if (!rt?.flight || !state || !review) return null;
  let scene = rt.engine?.object;
  while (scene?.parent) scene = scene.parent;
  const toy = scene?.getObjectByName('toy-world');
  let visibleMeshes = 0;
  if (toy) toy.traverse(object => {
    if (!object.isMesh || (object.isInstancedMesh && object.count <= 0)) return;
    for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
    const vertices = object.geometry?.index?.count ?? object.geometry?.attributes?.position?.count ?? 0;
    if (vertices > 0 && object.geometry.drawRange.count > 0) visibleMeshes++;
  });
  const renderer = window.__flyComposer?.getRenderer?.();
  const f = rt.flight, geo = rt.engine.worldToGeo(f.pos);
  return { atMs: performance.now(), reviewAtMs: review.nextAt - 500,
    style: state.mapStyle, tier: state.qualityTier, effectsTier: review.effectsTier,
    dpr: review.dpr, width: renderer?.domElement.width, height: renderer?.domElement.height,
    draws: review.drawCalls, triangles: review.triangles, toy: rt.toyStats ? { ...rt.toyStats } : null,
    visibleMeshes, cloudPass: !!window.__flyComposer?.passes.some(p => p.name === 'ImmersiveClouds'),
    ground: rt.groundImmersion ? { ...rt.groundImmersion } : null,
    groundLighting: rt.groundLighting ? { active: rt.groundLighting.active, bytes: rt.groundLighting.bytes } : null,
    pose: { position: f.pos.toArray(), heading: f.heading, lat: geo.y, lon: geo.x,
      actualAglM: f.pos.y - f.groundElev, derivedAglM: f.agl, epoch: state.warpEpoch },
    pins: Object.fromEntries(['__flyTerraPin', '__flySettlePin', '__flyClutterPin', '__flyDepthPin',
      '__flyAerialOverride', '__flySatShadowOverride', '__flyTerraForce', '__flyGroundFeatures', '__flyGovPin',
      '__flyWeatherOverride', '__flySunOverride', '__flyBoostInfinite'].map(key => [key, window[key] ?? null])) };
}

function ready(state, pose) {
  const toy = state?.toy;
  return !!toy && Number.isFinite(toy.ready) && toy.ready > 0 && Number.isFinite(toy.fullTotal) && toy.fullTotal > 0
    && Number.isFinite(toy.fullDone) && toy.fullDone === toy.fullTotal
    // fullDone/ultraReady include empty chunks. Only a decoded, verified
    // zero is valid absence; no-data and legacy empties can hide failed loads.
    && toy.emptyByReason?.noData === 0 && toy.emptyByReason?.legacy === 0
    && ['queued', 'building', 'draping'].every(key => toy[key] === 0)
    && (!pose.ultra || (toy.ultraArmed === true && Number.isFinite(toy.ultraReady) && toy.ultraReady >= 8))
    && state.visibleMeshes > 0 && state.style === 'toy' && state.tier === 'high' && state.effectsTier === 'high'
    && state.dpr === 1 && state.width === 1600 && state.height === 900
    && state.cloudPass === false && state.ground?.k === 0 && state.groundLighting?.active === false && state.groundLighting.bytes === 0
    && Number.isFinite(state.draws) && state.draws > 0 && Number.isFinite(state.triangles) && state.triangles > 0
    && Number.isFinite(state.reviewAtMs) && state.atMs - state.reviewAtMs >= 0 && state.atMs - state.reviewAtMs < 1500
    && Math.abs(state.pose?.position?.[1] - pose.y) < .01
    && Math.abs(state.pose?.lat - pose.lat) < 1e-6 && Math.abs(state.pose?.lon - pose.lon) < 1e-6
    && Math.abs(state.pose?.heading) < .001
    && Number.isInteger(state.pose?.epoch) && state.pose.epoch >= 0
    && WORLD_PINS.every(key => Object.hasOwn(state.pins ?? {}, key) && state.pins[key] === null)
    && state.pins.__flyGovPin === 'hold' && state.pins.__flyWeatherOverride === 'baseline'
    && state.pins.__flySunOverride === Date.UTC(2026, 6, 17, 16) && state.pins.__flyBoostInfinite === null;
}

function evaluatePose(row, pose) {
  const samples = row.samples ?? [], valid = samples.length === 24 && samples.every(s => ready(s, pose));
  const uniqueReviews = new Set(samples.filter(Boolean).map(s => s.reviewAtMs)).size;
  const epochs = new Set(samples.filter(Boolean).map(s => s.pose?.epoch));
  const finite = samples.filter(s => Number.isFinite(s?.draws) && Number.isFinite(s?.triangles));
  const maxDraws = finite.length ? Math.max(...finite.map(s => s.draws)) : null;
  const maxTriangles = finite.length ? Math.max(...finite.map(s => s.triangles)) : null;
  const exceeds = finite.some(s => s.draws > LIMITS.draws || s.triangles > LIMITS.triangles);
  return { status: exceeds ? 'FAIL' : !valid || uniqueReviews < 8 || epochs.size !== 1 ? 'BLOCKED' : 'PASS',
    maxDraws, maxTriangles, samples: samples.length, uniqueReviews,
    reason: exceeds ? 'Observed frozen draw/triangle ceiling exceeded' : !valid ? 'Missing or unready production content/counter/pose/control evidence'
      : uniqueReviews < 8 || epochs.size !== 1 ? 'Stale review observations or a warp during sampling' : undefined };
}

function evaluateReport(report) {
  const rows = report.poses ?? [];
  for (const row of rows) {
    const pose = POSES.find(p => p.name === row.name);
    row.verdict = pose ? evaluatePose(row, pose) : { status: 'BLOCKED', reason: 'Unexpected pose' };
  }
  const complete = rows.length === POSES.length && POSES.every(p => rows.filter(r => r.name === p.name).length === 1);
  const receipt = report.servedBuild;
  const bound = receipt?.buildId === report.requestedBuildId && /^[a-f0-9]{64}$/.test(receipt?.sourceSha256 ?? '')
    && receipt?.document?.buildId === report.requestedBuildId;
  const gpu = typeof report.hardware?.renderer === 'string' && report.hardware.renderer.length > 0
    && !/swiftshader|software|llvmpipe/i.test(report.hardware.renderer);
  report.status = report.errors?.length || rows.some(r => r.verdict.status === 'FAIL') ? 'FAIL'
    : report.caughtError || report.reason || !complete || !bound || !gpu || report.networkFailures?.length || rows.some(r => r.verdict.status !== 'PASS') ? 'BLOCKED' : 'PASS';
  return report;
}

function recordTileFailure(report, url, details) {
  if (/arcgis|esri|openfreemap/i.test(url) && report.networkFailures.length < 80) report.networkFailures.push({ url, ...details });
}

async function run(config) {
  const { chromium } = require('playwright');
  const report = { status: 'BLOCKED', recordedAt: new Date().toISOString(), url: config.url,
    requestedBuildId: config.buildId, viewport: [1600, 900], limits: LIMITS, poses: [], errors: [], networkFailures: [],
    scope: 'Three fixed aircraft poses; 24 polls at 250ms per pose of the production 2Hz full-render counters. Sampled maxima, not every-frame peaks or a performance/soak certification.',
    controls: 'High tier and governor hold intentionally retain full content. Baseline weather and 2026-07-17 16:00 UTC sun. Exact inherited absolute Y, not AGL. Pose-only hold at north heading; world, terrain, settle, depth, clutter and aerial remain live. No _boot, source helpers, private engine or forced infinite boost.',
    networkScope: 'Tile HTTP 204/4xx/5xx and transport failures block the run, including cancellations during boot/warps/sampling. Intentional browser teardown is outside the observation window.',
    provenance: 'verify-neon-cover.js POSES, DRAW_CEIL=480 and TRI_MAX=2000000; worker fingerprint gates are not rerun.' };
  fs.mkdirSync(config.output, { recursive: true });
  const save = () => fs.writeFileSync(path.join(config.output, 'report.json'), JSON.stringify(report, null, 2));
  let browser, closing = false;
  try {
    save();
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|ReferenceError|TypeError/.test(message.text())) report.errors.push(message.text().slice(0, 2500)); });
    page.on('response', response => {
      if (!closing && (response.status() >= 400 || response.status() === 204)) recordTileFailure(report, response.url(), { status: response.status() });
    });
    page.on('requestfailed', request => { if (!closing) recordTileFailure(report, request.url(), { error: request.failure()?.errorText ?? 'Transport request failed' }); });
    await page.addInitScript(() => {
      localStorage.setItem('fly-map-style-2', 'toy'); localStorage.setItem('fly-quality-tier', 'high');
      localStorage.setItem('fly-controls-seen', '1'); localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-crash-mode', 'forgiving');
      window.__flyGovPin = 'hold'; window.__flyWeatherOverride = 'baseline';
      window.__flySunOverride = Date.UTC(2026, 6, 17, 16);
    });
    await page.goto(`${config.url}/?graphicsReview=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    report.servedBuild = await groundBuildReceipt(page, config.url, config.buildId);
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__fly?.toyStats && window.__graphicsReview,
      null, { timeout: 120000 });
    report.hardware = await page.evaluate(() => {
      const gl = window.__flyComposer.getRenderer().getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
    });
    if (!report.hardware.renderer || /swiftshader|software|llvmpipe/i.test(report.hardware.renderer)) throw Error('Hardware GPU unavailable');
    for (const pose of POSES) {
      const row = { name: pose.name, requested: pose, samples: [] }; report.poses.push(row);
      await page.evaluate(p => {
        const rt = window.__fly, f = rt.flight, store = window.__flyStore.getState();
        store.setPhase('flying'); store.setCameraMode('chase'); store.setQualityTier('high');
        rt.warpToGeo(p.lat, p.lon, { altM: p.y, headingRad: 0, name: null });
        const hold = { x: f.pos.x, y: p.y, z: f.pos.z };
        f.step = function () {
          Object.assign(this.pos, hold); this.heading = 0; this.pitch = 0; this.bank = 0;
          this.speed = 0; this.boosting = false; this.turnRate = 0; this.pitchRate = 0;
          this.floorContact = null; this.agl = this.pos.y - this.groundElev;
        };
        f.step(); rt.chaseRig?.snap?.();
      }, pose);
      const started = Date.now(); let stableAt = null;
      while (Date.now() - started < 150000) {
        const state = await page.evaluate(snapshot); row.readiness = state;
        if (ready(state, pose)) stableAt ??= Date.now(); else stableAt = null;
        if (stableAt !== null && Date.now() - stableAt >= 3000) break;
        await page.waitForTimeout(500);
      }
      row.settleMs = Date.now() - started;
      if (stableAt === null || Date.now() - stableAt < 3000) {
        row.reason = 'Content, pose and counters did not settle within 150 seconds'; break;
      }
      for (let i = 0; i < 24; i++) { row.samples.push(await page.evaluate(snapshot)); await page.waitForTimeout(250); }
      row.verdict = evaluatePose(row, pose); save();
      console.log(`NEON ${pose.name}: ${row.verdict.status} ${row.verdict.maxDraws} draws, ${row.verdict.maxTriangles} triangles`);
      if (row.verdict.status !== 'PASS' || report.errors.length || report.networkFailures.length) break;
    }
  } catch (error) { report.caughtError = true; report.reason = error?.stack || error?.message || String(error); }
  finally {
    closing = true;
    try { await browser?.close(); } catch (error) { report.caughtError = true; report.reason ??= error?.stack || error?.message || String(error); }
    evaluateReport(report); save();
    console.log(`VERIFY: ${report.status} (${path.join(config.output, 'report.json')})`);
  }
  return report;
}

function selfTest() {
  const assert = require('node:assert/strict');
  const sample = (p, i) => ({ atMs: 1000 + i * 250, reviewAtMs: 1000 + Math.floor(i / 2) * 500,
    style: 'toy', tier: 'high', effectsTier: 'high', dpr: 1, width: 1600, height: 900,
    draws: 480, triangles: 2000000, visibleMeshes: 12, cloudPass: false, ground: { k: 0 }, groundLighting: { active: false, bytes: 0 },
    toy: { ready: 20, fullTotal: 10, fullDone: 10, queued: 0, building: 0, draping: 0, ultraArmed: true, ultraReady: 8,
      emptyByReason: { noData: 0, zero: 0, legacy: 0 } },
    pose: { position: [0, p.y, 0], lat: p.lat, lon: p.lon, heading: 0, epoch: 1 },
    pins: { ...Object.fromEntries(WORLD_PINS.map(key => [key, null])), __flyGovPin: 'hold',
      __flyWeatherOverride: 'baseline', __flySunOverride: Date.UTC(2026, 6, 17, 16), __flyBoostInfinite: null } });
  const fixture = () => ({ requestedBuildId: 'test', servedBuild: { buildId: 'test', sourceSha256: 'a'.repeat(64), document: { buildId: 'test' } },
    hardware: { renderer: 'NVIDIA test' }, errors: [], networkFailures: [],
    poses: POSES.map(p => ({ name: p.name, samples: Array.from({ length: 24 }, (_, i) => sample(p, i)) })) });
  const tests = [
    ['boundary ceilings pass', 'PASS', () => {}],
    ['draw over ceiling fails', 'FAIL', r => { r.poses[0].samples[3].draws++; }],
    ['triangles over ceiling fail', 'FAIL', r => { r.poses[1].samples[3].triangles++; }],
    ['missing draw counter blocks', 'BLOCKED', r => { delete r.poses[0].samples[0].draws; }],
    ['zero triangles block', 'BLOCKED', r => { r.poses[0].samples[0].triangles = 0; }],
    ['partial all-green matrix blocks', 'BLOCKED', r => { r.poses.pop(); }],
    ['duplicate pose blocks', 'BLOCKED', r => { r.poses[1].name = 'cruise'; }],
    ['missing ready content blocks', 'BLOCKED', r => { r.poses[0].samples[0].toy.ready = 0; }],
    ['late caught exception cannot green completed matrix', 'BLOCKED', r => { r.reason = 'Target closed during final wait after last sample'; }],
    ['caught non-Error cannot green completed matrix', 'BLOCKED', r => { r.caughtError = true; }],
    ['failed empty chunks cannot fill readiness', 'BLOCKED', r => {
      const toy = r.poses[0].samples[0].toy; toy.ready = 1; toy.fullDone = toy.fullTotal = 10; toy.emptyByReason.noData = 9;
    }],
    ['legacy empty chunks block', 'BLOCKED', r => { r.poses[0].samples[0].toy.emptyByReason.legacy = 1; }],
    ['unobserved empty reasons block', 'BLOCKED', r => { delete r.poses[0].samples[0].toy.emptyByReason; }],
    ['verified zero chunks remain allowed', 'PASS', r => { r.poses[0].samples[0].toy.emptyByReason.zero = 9; }],
    ['missing lighting telemetry blocks', 'BLOCKED', r => { r.poses[0].samples[0].groundLighting = null; }],
    ['missing warp epoch blocks', 'BLOCKED', r => { delete r.poses[0].samples[0].pose.epoch; }],
    ['unready ultra ring blocks', 'BLOCKED', r => { r.poses[0].samples[0].toy.ultraReady = 7; }],
    ['stale counter stream blocks', 'BLOCKED', r => { r.poses[0].samples.forEach(s => { s.reviewAtMs = s.atMs = 1000; }); }],
    ['wrong tier blocks', 'BLOCKED', r => { r.poses[0].samples[0].tier = 'medium'; }],
    ['hidden terrain pin blocks', 'BLOCKED', r => { r.poses[0].samples[0].pins.__flyTerraPin = 1; }],
    ['wrong pose blocks', 'BLOCKED', r => { r.poses[0].samples[0].pose.lat += .01; }],
    ['wrong document blocks', 'BLOCKED', r => { r.servedBuild.document.buildId = 'other'; }],
    ['software GPU blocks', 'BLOCKED', r => { r.hardware.renderer = 'SwiftShader'; }],
    ['tile failure blocks', 'BLOCKED', r => { r.networkFailures.push({ status: 403 }); }],
    ['transport failure blocks', 'BLOCKED', r => { recordTileFailure(r, 'https://tiles.openfreemap.org/planet/z/x/y.pbf', { error: 'net::ERR_FAILED' }); }],
    ['204 no-data response blocks', 'BLOCKED', r => { recordTileFailure(r, 'https://tiles.openfreemap.org/planet/z/x/y.pbf', { status: 204 }); }],
    ['shader errors fail', 'FAIL', r => { r.errors.push('shader compile failed'); }],
  ];
  for (const [name, expected, edit] of tests) { const r = fixture(); edit(r); assert.equal(evaluateReport(r).status, expected, name); }
  assert.throws(() => parseArgs(['--url=http://localhost:3038']));
  assert.throws(() => parseArgs(['--url=http://localhost:3038/path', '--build-id=test']));
  assert.equal(parseArgs(['--url=http://localhost:3038', '--build-id=test']).url, 'http://localhost:3038');
  console.log(`PASS: ${tests.length + 3} Neon verdict/CLI fixtures`);
}

module.exports = { POSES, LIMITS, parseArgs, ready, snapshot, evaluatePose, evaluateReport, recordTileFailure };
if (require.main === module) {
  try {
    const config = parseArgs(process.argv.slice(2));
    if (config.selfTest) selfTest();
    else run(config).then(report => { process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2; })
      .catch(error => { console.error(error.stack); process.exitCode = 2; });
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
