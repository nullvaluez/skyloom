/* Receiver-only visual proof. Fixed poses are instruments, never performance
 * certification. Run against an immutable production build with --build-id. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const vm = require('node:vm');
const sourceReceipt = require('./ground-night-source.cjs');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('='); return at < 0 ? [arg.slice(2), true] : [arg.slice(2, at), arg.slice(at + 1)];
}));
const sites = {
  manhattan: { lat: 40.7028, lon: -74.017, ground: 0, heading: 0.3, noon: 17, night: 4 },
  powell: { lat: 40.2083, lon: -83.0701, ground: 280, heading: 1.9, noon: 18, night: 5 },
  melton: { lat: -37.683, lon: 144.582, ground: 135, heading: 1.9, noon: 2, night: 15 },
};
const url = String(args.url || 'http://localhost:3000').replace(/\/$/, '');
const output = path.resolve(args.output || '.graphics-review/ground-appearance');
const viewport = { width: Number(args.width || 1600), height: Number(args.height || 900) };
const sleepMs = Number(args.settle || 18000);
const quietMs = Number(args['quiet-ms'] || 6000);
const quietCapMs = Number(args['quiet-timeout'] || 90000);
const quantile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : 0;

// Read-only, on-demand expansion of the rig's 16-row telemetry sample. This
// uses the SAME collector over live geometry, without touching its map/rig.
// A served/local source hash and the completed collector/map signature must
// both agree before its sources can support a pixel classification.
function sourceBootstrap(root) {
  const read = (file) => fs.readFileSync(path.join(root, 'lib/fly', file), 'utf8').replace(/^export /gm, '');
  const constants = vm.runInNewContext(`${read('fly-constants.js')}\n;({SAT_ROADS,SUBURB_NIGHT})`);
  const collector = read('night-ground-sources.js').replace(/^import .*;\r?\n/gm, '');
  return `(()=>{const {SAT_ROADS,SUBURB_NIGHT}=${JSON.stringify(constants)};
${read('building-profiles.js')}
${read('night-lighting-policy.js')}
${collector}
window.__groundProofCollector=createNightSourceCollector();})();`;
}

function quietState(previous, state, now, duration = quietMs) {
  const key = JSON.stringify([state.signature, state.sources, state.epoch, state.tier]);
  const next = previous?.key === key ? previous : { key, since: now, revision: state.sourceRevision };
  // Same-signature map refreshes briefly blend every two seconds. They must
  // not reset the quiet interval, but capture still starts at a settled blend.
  return { ...next, ready: state.sources > 0 && state.sharp && state.blend >= 0.99
    && state.sourceRevision > next.revision && now - next.since >= duration };
}

async function waitForQuiet(page) {
  const started = Date.now(); let quiet, last;
  while (Date.now() - started < quietCapMs) {
    last = await page.evaluate(() => ({ ...window.__flyGroundLighting.read(), sharp: !!window.__graphicsReview?.terrain?.sharp }));
    quiet = quietState(quiet, last, Date.now());
    if (quiet.ready) return { waitedMs: Date.now() - started, stableMs: Date.now() - quiet.since,
      signature: last.signature, sourceRevision: last.sourceRevision, sources: last.sources };
    await page.waitForTimeout(500);
  }
  throw Error(`Source quiescence not reached in ${quietCapMs} ms (signature ${last?.signature}, ${last?.sources} sources)`);
}

async function expandSources(page) {
  return page.evaluate(async () => {
    const rt = window.__fly, collector = window.__groundProofCollector, start = window.__flyGroundLighting.read();
    let scene = rt.engine.object; while (scene.parent) scene = scene.parent;
    const scale = 1 / Math.max(0.25, Math.cos(rt.flight.latDeg * Math.PI / 180));
    collector.reset(); collector.start(rt, scene, rt.flight.pos.x, rt.flight.pos.z, start.profile.spanM * scale, start.profile.sources);
    const began = performance.now(); let result;
    do {
      result = collector.step();
      if (performance.now() - began > 20000) throw Error('On-demand source decode exceeded 20 seconds');
      if (result.pending) await new Promise(requestAnimationFrame);
    } while (result.pending);
    const end = window.__flyGroundLighting.read();
    if (start.signature !== end.signature || result.result.signature !== end.signature) {
      window.__groundProofSourceSet = null;
      return { matched: false, signature: result.result.signature, installedSignature: end.signature };
    }
    window.__groundProofSourceSet = result.result;
    return { matched: true, signature: end.signature, counts: result.result.counts, sources: result.result.sources.length, ms: performance.now() - began };
  });
}

async function compareImages(files, points, diffFile) {
  const images = await Promise.all(files.map((file) => sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width, height, channels } = images[0].info;
  if (images.some((im) => im.info.width !== width || im.info.height !== height || im.info.channels !== channels)) throw Error('Capture dimensions changed during A/B/A');
  const mask = new Set();
  // Each point was independently ray-classified as visible opaque terrain.
  // Restrict measurements to its center pixel; nearby unclassified pixels
  // (for example an adjacent facade edge) cannot manufacture a ground proof.
  for (const p of points) mask.add(Math.round(p.py) * width + Math.round(p.px));
  const delta = [], noise = [], categories = {}, display = Buffer.alloc(width * height * 3);
  const luma = (buffer, index) => buffer[index] * 0.2126 + buffer[index + 1] * 0.7152 + buffer[index + 2] * 0.0722;
  const pointByPixel = new Map(points.map((p) => [Math.round(p.py) * width + Math.round(p.px), p]));
  for (const pixel of mask) {
    const offset = pixel * channels;
    const a = luma(images[0].data, offset), b = luma(images[1].data, offset), c = luma(images[2].data, offset);
    const d = Math.min(b - a, b - c), n = Math.abs(c - a);
    delta.push(d); noise.push(n);
    const category = pointByPixel.get(pixel).category;
    const row = categories[category] ??= { samples: 0, aboveNoise: 0, positiveSum: 0, noiseSum: 0 };
    row.samples++; row.positiveSum += d; row.noiseSum += n;
    if (d > n + 1) row.aboveNoise++;
    const value = Math.max(0, Math.min(255, Math.round(Math.max(0, d - n) * 24)));
    const x = pixel % width, y = Math.floor(pixel / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const o = ((y + dy) * width + x + dx) * 3;
      display[o] = value; display[o + 1] = value; display[o + 2] = value;
    }
  }
  await sharp(display, { raw: { width, height, channels: 3 } }).png().toFile(diffFile);
  for (const row of Object.values(categories)) {
    row.meanPositive = row.positiveSum / row.samples; row.meanNoise = row.noiseSum / row.samples;
    delete row.positiveSum; delete row.noiseSum;
  }
  const aboveNoise = delta.filter((d, i) => d > noise[i] + 1).length;
  return { samples: mask.size, aboveNoise, fractionAboveNoise: aboveNoise / Math.max(1, mask.size),
    deltaMedian: quantile(delta, 0.5), deltaP95: quantile(delta, 0.95), noiseMedian: quantile(noise, 0.5), noiseP95: quantile(noise, 0.95), categories,
    rule: 'At least three independently terrain-classified pixels must brighten above BOTH off images and exceed their own off/off absolute noise by >1 luma code value. This proves detectable spill, not aesthetic quality.' };
}

async function snapshot(page) {
  return page.evaluate(() => {
    const rt = window.__fly, f = rt.flight, read = window.__flyGroundLighting?.read?.();
    let scene = rt.engine.object; while (scene.parent) scene = scene.parent;
    const detailMesh = scene.getObjectByName('sat-ground-detail');
    return { ground: { ...rt.groundImmersion }, detail: rt.groundDetail ? { ...rt.groundDetail } : null,
      detailMesh: detailMesh ? { visible: detailMesh.visible, count: detailMesh.count } : null,
      lighting: read ?? null, review: window.__graphicsReview, mapPixels: window.__flyGroundLighting?.readPixels?.(),
      tier: window.__flyStore.getState().qualityTier, epoch: window.__flyStore.getState().warpEpoch,
      actualAglM: f.pos.y - f.groundElev, position: { x: f.pos.x, y: f.pos.y, z: f.pos.z },
      derivedAglM: f.agl, latDeg: f.latDeg, geo: rt.geo?.toArray?.(),
      camera: { p: rt.camera.position.toArray(), q: rt.camera.quaternion.toArray(), fov: rt.camera.fov },
      pins: Object.fromEntries(['__flyTerraPin', '__flyDepthPin', '__flyGovPin', '__flyAerialOverride', '__flyGroundFeatures'].map((key) => [key, window[key] ?? null])) };
  });
}

async function settlePose(page, site, time, aglFt, tier = 'high') {
  await page.evaluate(({ site, time, aglFt, tier }) => {
    const rt = window.__fly, f = rt.flight;
    window.__groundProofAim = null;
    window.__flySunOverride = Date.UTC(2026, 6, 18) + site[time] * 3600000;
    window.__flyStore.getState().setQualityTier(tier);
    window.__flyStore.getState().setCameraMode('chase');
    rt.warpToGeo(site.lat, site.lon, { altM: site.ground + aglFt * 0.3048, name: null });
    const hold = window.__groundAppearanceHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: site.heading };
    // Freeze only the aircraft model for matched pictures. No world, terrain,
    // light, source, material, cloud or animation is disabled between legs.
    window.__groundAppearanceOriginalStep ??= f.step;
    f.step = function () {
      Object.assign(this.pos, { x: hold.x, y: hold.y, z: hold.z });
      this.heading = hold.heading; this.pitch = -0.35; this.bank = 0; this.speed = 0; this.boosting = false;
      this.turnRate = 0; this.pitchRate = 0; this.floorContact = null;
      this.agl = this.pos.y - this.groundElev;
    };
    f.step(); rt.chaseRig?.snap?.();
  }, { site, time, aglFt, tier });
  await page.waitForTimeout(sleepMs);
  await page.waitForFunction(() => window.__graphicsReview?.terrain?.sharp && (window.__fly.satRoads?.stats?.ready ?? 0) > 0,
    null, { timeout: 45000 });
  await page.evaluate((ft) => { window.__groundAppearanceHold.y = window.__fly.flight.groundElev + ft * 0.3048; }, aglFt);
  await page.waitForTimeout(3500);
}

async function frameSource(page, preferred) {
  const framing = await page.evaluate((preferred) => {
    const rt = window.__fly, f = rt.flight, { Vector3 } = window.__groundProofMath;
    const sources = window.__groundProofSourceSet?.sources ?? [];
    const scale = 1 / Math.max(0.25, Math.cos(f.latDeg * Math.PI / 180));
    const cameraWorld = rt.camera.position.clone(); cameraWorld.x += rt.origin.anchor.x; cameraWorld.z += rt.origin.anchor.z;
    const ranked = [];
    for (const source of sources) {
      if (preferred === 'homes' && !source.id.startsWith('h')) continue;
      const distance = Math.hypot(source.x - cameraWorld.x, source.z - cameraWorld.z);
      if (distance > 700 * scale || distance < 70 * scale) continue;
      const geo = rt.engine.worldToGeo(new Vector3(source.x, source.y, source.z)), dem = rt.engine.getGroundAt(geo.x, geo.y);
      if (!Number.isFinite(dem?.elev) || dem.tileZ < 14 || Math.abs(source.y - dem.elev) > 3) continue;
      // Select using physical support and geometry only, before any A/B image.
      // A near procedural home occupies enough pixels to test its surroundings.
      ranked.push({ ...source, groundY: dem.elev, distance, score: Math.abs(distance / scale - 170) });
    }
    ranked.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    const chosen = ranked[0]; if (!chosen) return { found: false, preferred };
    const drop = ((chosen.x - f.pos.x) ** 2 + (chosen.z - f.pos.z) ** 2) / (2 * 1000000 * scale * scale);
    window.__groundProofAim = new Vector3(chosen.x, chosen.groundY - drop, chosen.z);
    if (!window.__groundProofOriginalChaseUpdate) {
      const rig = rt.chaseRig;
      window.__groundProofOriginalChaseUpdate = rig.update;
      rig.update = function (...params) {
        const result = window.__groundProofOriginalChaseUpdate.apply(this, params);
        // At this hook the application camera is still in absolute world
        // space; FlyScene applies the origin rebase immediately afterwards.
        if (window.__groundProofAim) params[2].lookAt(window.__groundProofAim);
        return result;
      };
    }
    return { found: true, preferred, id: chosen.id, sourceY: chosen.y, groundY: chosen.groundY,
      x: chosen.x, z: chosen.z, distanceM: chosen.distance / scale,
      instrument: 'Source-facing camera orientation only; fixed aircraft, AGL, FOV and ordinary scene updates retained throughout A/B/A.' };
  }, preferred);
  if (!framing.found) throw Error(`No grounded ${preferred} source available for receiver framing`);
  await page.waitForTimeout(2000);
  return framing;
}

async function receiverPoints(page) {
  return page.evaluate(() => {
    const rt = window.__fly, { Raycaster, Vector3, Vector2 } = window.__groundProofMath;
    const f = rt.flight, camera = rt.camera, origin = rt.origin.anchor, scale = 1 / Math.cos(f.latDeg * Math.PI / 180);
    const state = window.__flyGroundLighting.read(), sourceSet = window.__groundProofSourceSet;
    if (!sourceSet || sourceSet.signature !== state.signature) throw Error('Source set changed before receiver selection');
    const samples = sourceSet.sources;
    const canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect();
    const width = rect.width, height = rect.height, terrainMeshes = new Set(), occluders = [];
    rt.engine.object.traverse((o) => { if (o.isMesh) terrainMeshes.add(o); });
    let scene = rt.engine.object; while (scene.parent) scene = scene.parent;
    scene.updateMatrixWorld(true);
    scene.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry || !o.material) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      if (terrainMeshes.has(o) || materials.some((m) => m.visible !== false && !m.transparent && !m.userData?.isCloud)) occluders.push(o);
    });
    const ray = new Raycaster(), points = [], support = [], pixels = new Set(), categoryCounts = {};
    const rejected = { outside: 0, dem: 0, occluded: 0, dimMap: 0, unsupported: 0, duplicate: 0 };
    ray.near = 0; ray.far = 800 * scale;
    const bendK = 1 / (2 * 1000000 * scale * scale);
    const categoryOf = (id) => ({ b: 'buildings', r: 'roads', l: 'lamps', h: 'homes', p: 'porches' }[id[0]] ?? 'unknown');
    const smooth = (a, b, n) => { const k = Math.max(0, Math.min(1, (n - a) / (b - a))); return k * k * (3 - 2 * k); };
    let rays = 0;
    const classify = (px, py, expected) => {
      px = Math.round(px); py = Math.round(py);
      if (px < width * 0.12 || px >= width * 0.88 || py < height * 0.22 || py > height * 0.82) { rejected.outside++; return; }
      const key = py * width + px;
      if (pixels.has(key)) { rejected.duplicate++; return; }
      if (rays >= 1200 || points.length >= 192) return;
      rays++;
      ray.setFromCamera(new Vector2(px / width * 2 - 1, 1 - py / height * 2), camera);
      const first = ray.intersectObjects(occluders, false)[0];
      if (!first || !terrainMeshes.has(first.object)) { rejected.occluded++; return; }
      const x = first.point.x + origin.x, z = first.point.z + origin.z;
      if (expected && Math.hypot(x - expected.x, z - expected.z) > 3 * scale) { rejected.occluded++; return; }
      const geo = rt.engine.worldToGeo(new Vector3(x, first.point.y, z)), dem = rt.engine.getGroundAt(geo.x, geo.y);
      if (!Number.isFinite(dem?.elev) || dem.tileZ < 14 || Math.abs(dem.elev - first.point.y) > 1) { rejected.dem++; return; }
      const drop = ((x - f.pos.x) ** 2 + (z - f.pos.z) ** 2) * bendK;
      // A viewport ray hits unbent CPU triangles. Re-project its bent surface
      // and require <0.75px agreement before calling that pixel terrain.
      const clip = new Vector3(first.point.x, dem.elev - drop, first.point.z).project(camera);
      const bendPx = Math.hypot((clip.x * 0.5 + 0.5) * width - px, (-clip.y * 0.5 + 0.5) * height - py);
      if (bendPx > 0.75) { rejected.occluded++; return; }
      const mapped = window.__flyGroundLighting.sampleAt(x, z);
      if (!mapped || Math.max(...mapped.rgba.slice(0, 3)) === 0) { rejected.dimMap++; return; }
      // Match the map's complete source snapshot. Attribute proximity to its
      // strongest supported analytic contributor, not merely the first source
      // in telemetry (which can be buried or overlapped by another category).
      const contributors = [];
      for (const source of samples) {
        const d = ((x - source.x) ** 2 + (z - source.z) ** 2) / (source.r * source.r);
        if (d >= 1 || Math.abs(source.y - dem.elev) > 3) continue;
        const potential = source.gain * Math.exp(-d * 3.5) * (1 - smooth(0.55, 1, d))
          * (source.color[0] * 0.2126 + source.color[1] * 0.7152 + source.color[2] * 0.0722);
        if (potential > 0) contributors.push({ source, potential });
      }
      contributors.sort((a, b) => b.potential - a.potential);
      const strongest = contributors[0];
      if (!strongest || Math.abs(mapped.sourceY - dem.elev) >= 6.5) { rejected.unsupported++; return; }
      const category = categoryOf(strongest.source.id);
      if ((categoryCounts[category] ?? 0) >= 48) return;
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1; pixels.add(key);
      points.push({ px, py, x, z, groundY: dem.elev, category, id: strongest.source.id, mapRgb: mapped.rgba.slice(0, 3), mapSourceY: mapped.sourceY, bendPx,
        contributors: contributors.slice(0, 3).map(({ source, potential }) => ({ id: source.id, category: categoryOf(source.id), sourceY: source.y, potential })) });
    };
    const visibleSources = [];
    for (const source of samples) {
      const drop = ((source.x - f.pos.x) ** 2 + (source.z - f.pos.z) ** 2) * bendK;
      const clip = new Vector3(source.x - origin.x, source.y - drop, source.z - origin.z).project(camera);
      if (clip.z >= -1 && clip.z <= 1 && Math.abs(clip.x) < 0.85 && clip.y > -0.7 && clip.y < 0.65) visibleSources.push(source);
    }
    const categories = ['homes', 'buildings', 'lamps', 'roads', 'porches'];
    const byCategory = Object.fromEntries(categories.map((kind) => [kind, visibleSources.filter((s) => categoryOf(s.id) === kind).slice(0, 12)]));
    const selected = [];
    for (let i = 0; i < 12; i++) for (const kind of categories) if (byCategory[kind][i]) selected.push(byCategory[kind][i]);
    // Retain the original nearest rows too: their support errors remain visible
    // even when a valid, better-framed source is chosen for the actual proof.
    const supportSources = new Map([...samples.slice(0, 16), ...selected].map((s) => [s.id, s]));
    for (const source of supportSources.values()) {
      const id = source.id, category = categoryOf(id);
      const geo = rt.engine.worldToGeo(new Vector3(source.x, source.y, source.z));
      const ground = rt.engine.getGroundAt(geo.x, geo.y);
      support.push({ id, category, sourceY: source.y, groundY: ground?.elev ?? null, tileZ: ground?.tileZ ?? null,
        aboveDemM: Number.isFinite(ground?.elev) ? source.y - ground.elev : null,
        map: window.__flyGroundLighting.sampleAt(source.x, source.z) });
    }
    for (const source of selected) {
      for (const radiusK of [0.42, 0.65, 0.84]) for (let angle = 0; angle < 16; angle++) {
        const a = angle * Math.PI / 8, x = source.x + Math.cos(a) * source.r * radiusK, z = source.z + Math.sin(a) * source.r * radiusK;
        const geo = rt.engine.worldToGeo(new Vector3(x, source.y, z)), dem = rt.engine.getGroundAt(geo.x, geo.y);
        if (!Number.isFinite(dem?.elev) || dem.tileZ < 14) { rejected.dem++; continue; }
        const drop = ((x - f.pos.x) ** 2 + (z - f.pos.z) ** 2) * bendK;
        const clip = new Vector3(x - origin.x, dem.elev - drop, z - origin.z).project(camera);
        const px = Math.round((clip.x * 0.5 + 0.5) * width), py = Math.round((-clip.y * 0.5 + 0.5) * height);
        if (clip.z < -1 || clip.z > 1) { rejected.outside++; continue; }
        classify(px, py, { x, z });
      }
      if (rays >= 950 || points.length >= 160) break;
    }
    for (let y = 0.26; y <= 0.78; y += 0.04) for (let x = 0.14; x <= 0.86; x += 0.04) classify(x * width, y * height);
    return { points, support, rejected, rays, totalSources: samples.length, visibleSources: visibleSources.length, signature: sourceSet.signature,
      note: 'Exact installed source snapshot; category is strongest supported analytic contributor at a first-hit opaque terrain pixel. Map brightness is only a precondition. A/B/A pixels prove spill; category association does not isolate an individual emitter.' };
  });
}

async function poolLeg(page, enabled, file) {
  await page.evaluate((enabled) => { window.__flyGroundFeatures = { ...(window.__flyGroundFeatures ?? {}), pools: enabled }; }, enabled);
  await page.waitForFunction((enabled) => window.__flyGroundLighting?.read?.().pools === enabled, enabled, { timeout: 10000 });
  await page.waitForTimeout(550);
  const before = await snapshot(page);
  await page.locator('canvas').first().screenshot({ path: file });
  const state = await snapshot(page);
  state.captureSourceStable = before.lighting.signature === state.lighting.signature;
  state.preCaptureSignature = before.lighting.signature;
  return state;
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const report = { status: 'BLOCKED', kind: 'pool-only A/B/A visible terrain receiver proof', recordedAt: new Date().toISOString(),
    viewport, url, requestedBuildId: args['build-id'], errors: [], networkFailures: [], poses: [], resources: [], cleanup: [],
    limits: 'Fixed-pose visual difference only. No FPS/GPU-cost or aesthetic certification. Raycast tests opaque terrain visibility; DEM mismatch on bridges is recorded, not automatically a defect.' };
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  let browser;
  try {
    if (!args['build-id']) throw Error('Required --build-id missing; appearance proof must identify the served production build');
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => report.errors.push(error.message));
    page.on('console', (m) => { if (m.type() === 'error' && /shader|WebGL|ReferenceError|TypeError/.test(m.text())) report.errors.push(m.text().slice(0, 2000)); });
    page.on('response', (response) => { if (response.status() >= 400 && /arcgis|esri|openfreemap/i.test(response.url()) && report.networkFailures.length < 80) report.networkFailures.push({ url: response.url(), status: response.status() }); });
    await page.addInitScript(() => {
      localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', 'high');
      localStorage.setItem('fly-controls-seen', '1'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-crash-mode', 'forgiving');
      window.__flyWeatherOverride = 'baseline'; window.__flySunOverride = Date.UTC(2026, 6, 18, 4);
      window.__flyGovPin = 'hold'; // Explicit fixed-tier image instrument only.
      window.__flyGroundFeatures = { pools: true };
    });
    await page.goto(`${url}/?graphics=cinematic&graphicsReview=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const receipt = await page.request.get(`${url}/_next/static/${encodeURIComponent(args['build-id'])}/ground-source.json`);
    if (!receipt.ok()) throw Error('Served build receipt unavailable');
    report.servedBuild = await receipt.json();
    if (report.servedBuild.buildId !== args['build-id']) throw Error('Served build identity mismatch');
    const sourceRoot = path.resolve(__dirname, '..');
    report.instrumentSource = sourceReceipt(sourceRoot);
    if (report.instrumentSource.sourceSha256 !== report.servedBuild.sourceSha256) throw Error('Local source differs from served build; cannot safely expand its source telemetry');
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__fly && window.__flyGroundLighting, null, { timeout: 90000 });
    report.hardware = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: !!gl, renderer: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), userAgent: navigator.userAgent };
    });
    if (!report.hardware.webgl2 || !report.hardware.renderer || /swiftshader|llvmpipe|software/i.test(report.hardware.renderer)) throw Error('Hardware WebGL renderer unavailable');
    // Reuse the installed Three revision for math/raycast only. No renderer,
    // materials or application modules are replaced by this test instrument.
    const threeSource = fs.readFileSync(require.resolve('three'), 'utf8');
    await page.addScriptTag({ content: `(()=>{const exports={};${threeSource}\nwindow.__groundProofMath={Raycaster:exports.Raycaster,Vector2:exports.Vector2,Vector3:exports.Vector3};})();` });
    await page.addScriptTag({ content: sourceBootstrap(sourceRoot) });
    for (const name of (args.sites ? args.sites.split(',') : ['manhattan', 'powell', 'melton'])) {
      const row = { name, status: 'BLOCKED', requestedAglFt: Number(args.alt || 300), captures: {} }; report.poses.push(row); save();
      try {
        if (!sites[name]) throw Error(`Unknown site ${name}`);
        await settlePose(page, sites[name], 'night', row.requestedAglFt);
        row.quiescence = []; row.expansions = []; row.attempts = [];
        const readySources = async () => {
          for (let i = 0; i < 3; i++) {
            row.quiescence.push(await waitForQuiet(page));
            const expanded = await expandSources(page); row.expansions.push(expanded);
            if (expanded.matched) return;
          }
          throw Error('On-demand source snapshot did not match the installed map after three settled scans');
        };
        await readySources();
        row.framing = await frameSource(page, name === 'melton' ? 'homes' : 'ground');
        for (let attempt = 1; attempt <= 3; attempt++) {
          await readySources();
          row.receivers = await receiverPoints(page);
          const files = ['off1', 'on', 'off2'].map((leg) => path.join(output, `${name}-attempt${attempt}-${leg}.png`));
          row.captures = {};
          for (let i = 0; i < files.length; i++) row.captures[['off1', 'on', 'off2'][i]] = { file: path.basename(files[i]), state: await poolLeg(page, i === 1, files[i]) };
          row.comparison = await compareImages(files, row.receivers.points, path.join(output, `${name}-attempt${attempt}-receiver-delta.png`));
          const signatures = [row.receivers.signature, ...Object.values(row.captures).map((c) => c.state.lighting.signature)];
          const stable = new Set(signatures).size === 1 && Object.values(row.captures).every((c) => c.state.captureSourceStable);
          row.attempts.push({ attempt, stable, signatures, captures: row.captures, comparison: row.comparison }); save();
          // Retry changes in source state, never a stable image that failed its
          // pixel/noise test. This avoids picking a lucky positive comparison.
          if (stable) break;
        }
        const states = Object.values(row.captures).map((capture) => capture.state);
        const cameraGap = (a, b) => Math.max(...a.camera.p.map((v, i) => Math.abs(v - b.camera.p[i])), ...a.camera.q.map((v, i) => Math.abs(v - b.camera.q[i])), Math.abs(a.camera.fov - b.camera.fov));
        row.cameraMaxDelta = Math.max(cameraGap(states[0], states[1]), cameraGap(states[0], states[2]));
        row.sameSourceSignature = new Set([row.receivers.signature, ...states.map((s) => s.lighting.signature)]).size === 1 && states.every((s) => s.captureSourceStable);
        row.proceduralSourceSupported = states.some((s) => (s.lighting.counts.homes ?? 0) + (s.lighting.counts.porches ?? 0) > 0);
        const ready = row.comparison.samples >= 8 && row.sameSourceSignature && row.cameraMaxDelta < 0.02 && states.every((s) => s.review?.terrain?.sharp
          && Math.abs(s.actualAglM - row.requestedAglFt * 0.3048) < 2 && Math.abs(s.derivedAglM - s.actualAglM) < 0.1);
        const homes = row.comparison.categories.homes, porches = row.comparison.categories.porches;
        const proceduralPixels = (homes?.samples ?? 0) + (porches?.samples ?? 0);
        const proceduralDelta = (homes?.aboveNoise ?? 0) + (porches?.aboveNoise ?? 0);
        row.status = !ready || (name === 'melton' && (!row.proceduralSourceSupported || proceduralPixels < 3)) ? 'BLOCKED'
          : row.comparison.aboveNoise >= 3 && (name !== 'melton' || proceduralDelta >= 1) ? 'PASS' : 'FAIL';
        row.reason = row.status === 'BLOCKED' ? 'Insufficient stable visible terrain samples, settled pose/source state, or procedural-neighborhood source support' : row.status === 'FAIL' ? 'No receiver response above the measured off/off noise floor' : undefined;
      } catch (error) { row.reason = error.message; }
      save(); console.log(`Ground appearance ${name}: ${row.status}${row.reason ? ` (${row.reason})` : ''}`);
    }
    if (!args['skip-extras']) {
      await page.evaluate(() => { window.__flyGroundFeatures.pools = true; });
      await settlePose(page, sites.powell, 'noon', 50);
      report.lowDay = await snapshot(page); report.lowDay.file = 'powell-noon-50ft.png';
      await page.locator('canvas').first().screenshot({ path: path.join(output, report.lowDay.file) });
      report.cleanup.push({ kind: 'day clears night maps', status: report.lowDay.lighting.bytes === 0 && report.lowDay.lighting.active === false ? 'PASS' : 'FAIL', state: report.lowDay.lighting });
      await settlePose(page, sites.powell, 'noon', 3500);
      report.highDay = await snapshot(page);
      report.cleanup.push({ kind: '3500ft ground signal/detail vanishes', status: report.highDay.ground.k < 0.001 && (!report.highDay.detailMesh?.visible || report.highDay.detailMesh.count === 0) ? 'PASS' : 'FAIL', state: report.highDay });
      await settlePose(page, sites.powell, 'night', 300);
      for (const [tier, size] of [['high', 1024], ['medium', 512], ['low', 256]]) {
        await page.evaluate((tier) => window.__flyStore.getState().setQualityTier(tier), tier); await page.waitForTimeout(3500);
        const state = await snapshot(page), bytes = size * size * 8;
        report.resources.push({ tier, expectedSize: size, expectedBytes: bytes, status: !state.lighting.active ? 'BLOCKED' : state.lighting.size === size && state.lighting.bytes === bytes ? 'PASS' : 'FAIL', state });
      }
      await page.evaluate(() => {
        const rt = window.__fly; rt.warpToGeo(36.601, -118.06, { altM: 1350, name: null });
        Object.assign(window.__groundAppearanceHold, { x: rt.flight.pos.x, y: rt.flight.pos.y, z: rt.flight.pos.z });
      });
      await page.waitForTimeout(250);
      const warped = await snapshot(page), map = warped.lighting?.map;
      const stale = map && Math.hypot(map.x - warped.position.x, map.z - warped.position.z) > map.span;
      report.cleanup.push({ kind: 'warp cannot retain previous-city map coordinates', status: stale ? 'FAIL' : 'PASS', state: warped });
    }
    const visibleCategories = {};
    for (const row of report.poses.filter((r) => r.status === 'PASS')) for (const [category, metric] of Object.entries(row.comparison?.categories ?? {})) {
      const sum = visibleCategories[category] ??= { samples: 0, aboveNoise: 0 };
      sum.samples += metric.samples; sum.aboveNoise += metric.aboveNoise;
    }
    report.visibleCategories = visibleCategories;
    // The default three-site run explicitly proves both mapped building bases
    // and road-adjacent ground, not merely an unlocated frame-wide difference.
    if (!args.sites) for (const [kind, categories] of [['building-base spill', ['buildings']], ['road-adjacent spill', ['roads', 'lamps']]]) {
      const samples = categories.reduce((n, c) => n + (visibleCategories[c]?.samples ?? 0), 0);
      const aboveNoise = categories.reduce((n, c) => n + (visibleCategories[c]?.aboveNoise ?? 0), 0);
      report.cleanup.push({ kind, samples, aboveNoise, status: samples < 3 ? 'BLOCKED' : aboveNoise > 0 ? 'PASS' : 'FAIL' });
    }
    const verdicts = [...report.poses, ...report.resources, ...report.cleanup].map((row) => row.status);
    report.status = report.errors.length || verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('BLOCKED') ? 'BLOCKED' : 'PASS';
  } catch (error) { report.reason = error.stack || error.message; report.status = report.errors.length ? 'FAIL' : 'BLOCKED'; }
  finally { await browser?.close(); save(); console.log(`VERIFY: ${report.status} (${output})`); process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2; }
}
if (require.main === module) main();
module.exports = { compareImages, sourceBootstrap, quietState };
