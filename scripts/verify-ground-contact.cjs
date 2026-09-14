/* Production contact diagnostic. Root runs the browser sequentially.
 * node scripts/verify-ground-contact.cjs --url=http://localhost:3034 --build-id=ID --output=.graphics-review/ground-contact
 * No application/helper code is injected. Only the aircraft pose is held.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const groundBuildReceipt = require('./ground-build-receipt.cjs');
const { captureSceneCensus } = require('./graphics-capture-census.cjs');

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const text = argv[i]; if (!text.startsWith('--')) continue;
    const at = text.indexOf('=');
    if (at >= 0) result[text.slice(2, at)] = text.slice(at + 1);
    else result[text.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return result;
}

// Serialized into the page. Matrix transforms use the installed Three objects;
// CPU positions are unbent, just like the terrain engine's raw support query.
function contactCensus() {
  const rt = window.__fly, f = rt.flight, origin = rt.origin.anchor;
  let scene = rt.engine.object; while (scene.parent) scene = scene.parent;
  scene.updateMatrixWorld(true);
  const scale = 1 / Math.max(.25, Math.cos(f.latDeg * Math.PI / 180));
  const meshes = [], core = [], point = f.pos.clone(), instance = rt.camera.matrixWorld.clone();
  scene.traverse(object => {
    const kind = object.userData?.__satVegInit ? 'canopy' : object.name === 'sat-ground-detail' ? 'detail' : null;
    if (!kind || !object.isInstancedMesh) return;
    let visible = object.visible;
    for (let parent = object.parent; parent; parent = parent.parent) visible &&= parent.visible;
    const positions = object.geometry.attributes.position;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.count; i++) { minY = Math.min(minY, positions.getY(i)); maxY = Math.max(maxY, positions.getY(i)); }
    const matrix = object.instanceMatrix;
    const mesh = { id: object.id, kind, count: object.count, visible, coreCount: 0,
      geometryMinY: minY, geometryMaxY: maxY, matrixVersion: matrix.version,
      pendingRanges: matrix.updateRanges.map(range => ({ ...range })),
      pendingBytes: matrix.updateRanges.reduce((n, range) => n + range.count * matrix.array.BYTES_PER_ELEMENT, 0) };
    meshes.push(mesh);
    if (!visible) return;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, instance);
      point.set(0, 0, 0).applyMatrix4(instance).applyMatrix4(object.matrixWorld).add(origin);
      const distanceM = Math.hypot(point.x - f.pos.x, point.z - f.pos.z) / scale;
      if (distanceM > 300) continue;
      const base = point.clone();
      point.set(0, maxY - minY, 0).applyMatrix4(instance).applyMatrix4(object.matrixWorld).add(origin);
      mesh.coreCount++;
      core.push({ meshId: object.id, kind, index: i, x: base.x, z: base.z, baseY: base.y,
        distanceM, heightM: point.y - base.y, geometryMinY: minY, geometryMaxY: maxY,
        refinement: 'unknown: production bus exposes aggregate support only' });
    }
  });
  core.sort((a, b) => a.distanceM - b.distanceM || a.meshId - b.meshId || a.index - b.index);
  const sampled = ['canopy', 'detail'].flatMap(kind => core.filter(row => row.kind === kind).slice(0, 48));
  const stats = rt.satVeg?.stats, support = stats?.nearSupport;
  const busy = ['satBuildings', 'satRoads', 'satSkyline', 'satVeg'].some(key => {
    const s = rt[key]?.stats; return s && ['queued', 'building', 'sampling'].some(field => Number(s[field] ?? 0) !== 0);
  });
  const geo = rt.engine.worldToGeo(f.pos);
  const signature = JSON.stringify(core.map(row => [row.meshId, row.index, row.x, row.z, Math.round(row.baseY * 100)]));
  return { atMs: performance.now(), tier: window.__flyStore.getState().qualityTier,
    epoch: window.__flyStore.getState().warpEpoch, terrain: window.__graphicsReview?.terrain,
    sharp: !!window.__graphicsReview?.terrain?.sharp, streamersSettled: !busy && !rt.groundDetail?.scanning,
    support: support ? { ...support, byKind: { ...support.byKind } } : null,
    vegetation: stats ? { ready: stats.ready, vegPts: stats.vegPts, supportRevision: stats.supportRevision } : null,
    detail: rt.groundDetail ? { ...rt.groundDetail } : null, meshes, sampled, coreCount: core.length, signature,
    pose: { position: f.pos.toArray(), heading: f.heading, latDeg: f.latDeg, geo: geo.toArray(),
      rawGroundM: f.groundElev, actualAglM: f.pos.y - f.groundElev, derivedAglM: f.agl,
      origin: origin.toArray(), mercatorScale: scale },
    pins: Object.fromEntries(['__flyTerraPin', '__flyTerraForce', '__flyGovPin', '__flyDepthPin', '__flyAerialOverride',
      '__flyGroundFeatures', '__flyVisualsArm', '__flyVisualsFeatures'].map(key => [key, window[key] ?? null])) };
}

function evaluateContactReport(report) {
  const timeline = report.timeline ?? [], snapshots = timeline.map(row => row.support).filter(Boolean);
  const checks = [];
  const check = (name, status, detail) => checks.push({ name, status, detail });
  const observed = snapshots.length === timeline.length && timeline.length >= 10;
  check('sampled cache/query bounds', !observed ? 'BLOCKED' : snapshots.every(s => s.queries <= 8 && s.work <= 64 && s.cached <= 512
    && s.byKind.canopy <= 256 && s.byKind.detail <= 256) ? 'PASS' : 'FAIL',
  '500ms observations only; not a claim about every frame. The 0.5ms deadline permits one atomic query overrun.');
  const acceptedBeforeWarp = report.supportBeforeWarp?.accepted;
  check('accepted active support', Number.isFinite(acceptedBeforeWarp)
    && snapshots.some(s => s.active && s.accepted > acceptedBeforeWarp) ? 'PASS' : 'BLOCKED',
    'Requires a positive accepted-count increase after this warp. Aggregate acceptance does not identify individual cache entries.');
  const firstPose = timeline[0]?.pose;
  check('stable actual pose', timeline.length && timeline.every(row => Math.abs(row.pose.actualAglM - 91.44) < 2
    && Math.abs(row.pose.derivedAglM - row.pose.actualAglM) < .1 && row.tier === 'high'
    && row.sharp && row.epoch === timeline[0].epoch
    && row.pose.position.every((value, i) => Math.abs(value - firstPose.position[i]) < .01)
    && Math.abs(row.pose.heading - 339 * Math.PI / 180) < .0001
    && Math.abs(row.pose.geo[0] + 83.0811) < .00001 && Math.abs(row.pose.geo[1] - 40.199) < .00001) ? 'PASS' : 'BLOCKED',
  '300ft actual AGL, fixed XYZ and 339deg heading at Powell, high tier, sharp terrain, unchanged epoch.');
  for (const kind of ['canopy', 'detail']) {
    const rows = (report.contacts ?? []).filter(row => row.kind === kind);
    const trusted = rows.filter(row => row.tileZ >= 16 && Number.isFinite(row.groundY)
      && Number.isFinite(row.baseY) && Number.isFinite(row.errorM) && Number.isFinite(row.heightM) && row.heightM > 0
      && row.distanceM <= 300 && Math.abs(row.geometryMinY) < .001 && row.sameInstance && row.currentlyVisible);
    const errors = trusted.map(row => Math.abs(row.errorM));
    check(`${kind} sampled geometry contact`, !rows.length || trusted.length !== rows.length ? 'BLOCKED'
      : errors.every(error => error <= .5) ? 'PASS' : 'FAIL',
    { measured: rows.length, trusted: trusted.length, withinHalfMetre: errors.filter(error => error <= .5).length,
      maxAbsErrorM: errors.length ? Math.max(...errors) : null,
      scope: 'Only the listed sampled instances; <=300 true metres. Refinement admission is not inferred from proximity or a small contact error.' });
  }
  report.checks = checks;
  report.status = report.errors.length || checks.some(row => row.status === 'FAIL') ? 'FAIL'
    : checks.some(row => row.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = path.resolve(args.output || '.graphics-review/ground-contact');
  const url = new URL(String(args.url || 'http://localhost:3000'));
  url.searchParams.set('graphics', 'cinematic'); url.searchParams.set('graphicsReview', '1');
  const report = { recordedAt: new Date().toISOString(), status: 'BLOCKED', errors: [], timeline: [], contacts: [],
    site: { name: 'Powell reference', lat: 40.199, lon: -83.0811, headingDeg: 339, requestedAglFt: 300 },
    policy: { terrain: 'live production; no terrain/depth/aerial pins', governor: 'held at high for reproducible contact diagnosis',
      motion: 'only aircraft pose held; terrain, sources, clouds and animation continue',
      limits: 'stationary contact evidence, never flight/frame-time performance certification',
      sampling: '500ms snapshots over five seconds; at most 48 nearest core instances per kind; raw terrain queries follow telemetry collection',
      attribution: 'No per-point cache membership is exposed in production. Saturation/admission remains an explicit coverage limit; no whole-pool refinement PASS.' } };
  fs.mkdirSync(output, { recursive: true });
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  let browser, page;
  try {
    if (!args['build-id']) throw Error('--build-id is required for a production-bound diagnosis');
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /shader|WebGL|ReferenceError|TypeError/.test(message.text())) report.errors.push(message.text().slice(0, 2500)); });
    await page.addInitScript(() => {
      localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-quality-tier', 'high'); localStorage.setItem('fly-sound-on', '0');
      window.__flyGovPin = 'hold'; window.__flyVisualsArm = 1;
      window.__flyWeatherOverride = 'baseline'; window.__flySunOverride = Date.UTC(2026, 6, 18, 18);
    });
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
    report.servedBuild = await groundBuildReceipt(page, url.href, args['build-id']);
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__fly?.satVeg && window.__flyStore,
      null, { timeout: 90000 });
    report.hardware = await page.evaluate(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: !!gl, renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), userAgent: navigator.userAgent };
    });
    if (!report.hardware.renderer || /swiftshader|llvmpipe|software/i.test(report.hardware.renderer)) throw Error('Hardware WebGL required for the contact capture');
    report.supportBeforeWarp = await page.evaluate(() => {
      const rt = window.__fly, f = rt.flight;
      const before = { accepted: rt.satVeg?.stats?.nearSupport?.accepted ?? null };
      window.__flyStore.getState().setQualityTier('high'); window.__flyStore.getState().setCameraMode('chase');
      rt.warpToGeo(40.199, -83.0811, { altM: 280 + 91.44, headingRad: 339 * Math.PI / 180, name: null });
      const hold = window.__groundContactHold = f.pos.clone();
      window.__groundContactOriginalStep = f.step;
      f.step = function () {
        this.pos.copy(hold); this.heading = 339 * Math.PI / 180; this.pitch = -.08; this.bank = 0;
        this.speed = this.turnRate = this.pitchRate = 0; this.boosting = false; this.floorContact = null;
        const geo = rt.engine.worldToGeo(this.pos); this.latDeg = geo.y; rt.geo = geo;
        this.agl = this.pos.y - this.groundElev;
      };
      f.step(); rt.chaseRig?.snap?.(); rt.chaseCam?.snap?.(); return before;
    });
    await page.waitForFunction(() => window.__graphicsReview?.terrain?.sharp && (window.__fly.satVeg?.stats?.ready ?? 0) > 0,
      null, { timeout: 90000, polling: 500 });
    report.initialGround = await page.evaluate(() => {
      const rt = window.__fly, geo = rt.engine.worldToGeo(rt.flight.pos), ground = rt.engine.getGroundAt(geo.x, geo.y);
      if (!Number.isFinite(ground?.elev) || ground.tileZ < 16) throw Error('Trusted terrain under the requested pose is unavailable');
      window.__groundContactHold.y = ground.elev + 91.44;
      return ground;
    });
    // Wait for actual streamer readiness AND stable core instance Y values,
    // rather than assuming a fixed delay settles a large terrain correction.
    const began = Date.now(); let stableAt = Date.now(), signature = null, settled;
    while (Date.now() - began < 90000) {
      const state = await page.evaluate(contactCensus);
      if (state.sharp && Math.abs(state.pose.actualAglM - 91.44) > .5) {
        // A later detailed DEM may replace the initial bootstrap support.
        // Correct only during setup; the five-second observation stays fixed.
        const corrected = await page.evaluate(() => {
          const rt = window.__fly, geo = rt.engine.worldToGeo(rt.flight.pos), ground = rt.engine.getGroundAt(geo.x, geo.y);
          if (!Number.isFinite(ground?.elev) || ground.tileZ < 16) return null;
          window.__groundContactHold.y = ground.elev + 91.44; return ground;
        });
        if (corrected) (report.setupAltitudeCorrections ??= []).push(corrected);
        stableAt = Date.now(); await page.waitForTimeout(500); continue;
      }
      const ready = state.sharp && state.streamersSettled && state.support?.active
        && Number.isFinite(report.supportBeforeWarp.accepted) && state.support.accepted > report.supportBeforeWarp.accepted
        && state.meshes.some(mesh => mesh.kind === 'canopy' && mesh.coreCount > 0)
        && state.meshes.some(mesh => mesh.kind === 'detail' && mesh.coreCount > 0);
      if (!ready || state.signature !== signature) stableAt = Date.now();
      signature = state.signature;
      report.lastReadiness = { ...state, signature: undefined, sampled: undefined };
      if (ready && Date.now() - stableAt >= 3000) { settled = state; break; }
      await page.waitForTimeout(500);
    }
    if (!settled) throw Error('Sharp terrain, active accepted support and stable populated core contacts did not settle within 90s');
    report.settledMs = Date.now() - began;
    report.census = await page.evaluate(captureSceneCensus);
    report.captures = ['powell-reference-noon-300-before.png', 'powell-reference-noon-300-after.png'];
    await page.screenshot({ path: path.join(output, report.captures[0]) });
    for (let sample = 0; sample <= 10; sample++) {
      const state = await page.evaluate(contactCensus);
      const { signature: ignored, sampled, ...telemetry } = state; void ignored;
      report.timeline.push(telemetry);
      if (sample === 10) report.selected = sampled;
      if (sample < 10) await page.waitForTimeout(500);
    }
    // Query six already-selected contacts per evaluate, yielding between
    // batches. These diagnostic rays are outside the telemetry interval.
    for (let start = 0; start < report.selected.length; start += 6) {
      const rows = await page.evaluate(selected => {
        const rt = window.__fly, origin = rt.origin.anchor, point = rt.flight.pos.clone(), instance = rt.camera.matrixWorld.clone();
        let scene = rt.engine.object; while (scene.parent) scene = scene.parent;
        scene.updateMatrixWorld(true);
        return selected.map(row => {
          const mesh = scene.getObjectById(row.meshId);
          if (!mesh || row.index >= mesh.count) return { ...row, sameInstance: false };
          let currentlyVisible = mesh.visible;
          for (let parent = mesh.parent; parent; parent = parent.parent) currentlyVisible &&= parent.visible;
          mesh.getMatrixAt(row.index, instance);
          point.set(0, 0, 0).applyMatrix4(instance).applyMatrix4(mesh.matrixWorld).add(origin);
          const sameInstance = Math.hypot(point.x - row.x, point.z - row.z) < .01;
          const geo = rt.engine.worldToGeo(point), ground = rt.engine.getGroundAt(geo.x, geo.y);
          const expectedSinkM = row.kind === 'detail' ? -.05 : 0, baseY = point.y;
          point.set(0, row.geometryMaxY - row.geometryMinY, 0).applyMatrix4(instance).applyMatrix4(mesh.matrixWorld).add(origin);
          return { ...row, baseY, heightM: point.y - baseY, sameInstance, currentlyVisible, geo: geo.toArray(), expectedSinkM,
            groundY: ground?.elev ?? null, tileZ: ground?.tileZ ?? null,
            errorM: Number.isFinite(ground?.elev) ? baseY - expectedSinkM - ground.elev : null };
        });
      }, report.selected.slice(start, start + 6));
      report.contacts.push(...rows); await page.waitForTimeout(20);
    }
    await page.screenshot({ path: path.join(output, report.captures[1]) });
    report.final = await page.evaluate(contactCensus);
    delete report.final.signature; delete report.final.sampled;
    report.coverage = { selectedBy: 'nearest true horizontal distance, then mesh id and instance index',
      coreRadiusM: 300, sampleCapPerKind: 48, exactRefinementMembership: 'unavailable',
      saturated: Math.max(...report.timeline.map(row => row.support?.saturated ?? 0)),
      meshCounts: report.timeline.at(-1).meshes.map(mesh => ({ kind: mesh.kind, visible: mesh.visible, count: mesh.count, coreCount: mesh.coreCount })),
      pendingRangeLimit: 'Post-render snapshots may see cleared ranges; observed ranges are recorded, not a complete upload trace.' };
    evaluateContactReport(report);
  } catch (error) {
    report.status = report.errors.length ? 'FAIL' : 'BLOCKED'; report.reason = error.stack || error.message;
    if (page) await page.screenshot({ path: path.join(output, 'blocked.png') }).catch(() => {});
  } finally {
    await page?.evaluate(() => { if (window.__groundContactOriginalStep && window.__fly) window.__fly.flight.step = window.__groundContactOriginalStep; }).catch(() => {});
    await browser?.close(); save(); console.log(`VERIFY: ${report.status} (${output})`);
    process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
  }
}

if (require.main === module) main();
module.exports = { parseArgs, contactCensus, evaluateContactReport };
