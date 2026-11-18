const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { enterFlight } = require('./_skip-menus');

const [origin, arm, requestedTier, requestedSun, venue = 'manhattan'] = process.argv.slice(2);
const paris = venue === 'paris';
const sunUtc = requestedSun ?? (paris ? '2026-06-21T14:00:00Z' : '2026-06-21T16:00:00Z');
const pose = paris
  ? { lat: 48.835, lon: 2.246, altM: 1160, headingDeg: 17, speed: 200, pitch: 0, bank: .115 }
  : { lat: 40.7692, lon: -73.9810, altM: 1931 * .3048, headingDeg: 36, speed: 163 / 1.94384449, pitch: 0, bank: 0 };
const view = paris ? { yawDeg: 380 / 1672 * 2.8 * 180 / Math.PI, pitchDeg: -55 / 1224 * 1.9 * 180 / Math.PI } : { yawDeg: 70, pitchDeg: -4 };
const movement = { courseDeg: 106, distanceM: 1800 };
const tier = (origin === 'compare' ? arm : requestedTier) ?? 'high';
const output = path.resolve('.graphics-review/city-continuity');
const baseline = process.env.CITY_REVIEW_BASELINE ?? 'before';

function compare() {
  if (tier === 'paris') {
    const [before, after] = ['before', 'after'].map(label =>
      JSON.parse(fs.readFileSync(path.join(output, 'paris', label, 'high', 'flight.json'))).capture);
    assert.notEqual(before.flags?.CITY_CONTINUITY, true);
    assert.equal(after.flags?.CITY_CONTINUITY, true);
    for (const key of ['pos', 'orientation', 'speed', 'heading', 'bank', 'pitch', 'fov', 'dpr']) {
      const a = [].concat(before[key]), b = [].concat(after[key]);
      assert.ok(a.every((value, index) => Math.abs(value - b[index]) < .0001), 'Paris: matched ' + key);
    }
    for (const key of ['sinEl', 'az']) assert.ok(Math.abs(before.sun[key] - after.sun[key]) < .0001, 'Paris: matched sun ' + key);
    assert.equal(before.sharp && after.sharp, true);
    assert.equal(before.tier, after.tier);
    console.log(JSON.stringify({ parisNear: [before.near?.ready, after.near?.ready],
      parisFar: [before.far?.ready, after.far?.ready], handoff: after.handoff }, null, 2));
    return;
  }
  const reports = [baseline, 'after'].map(label =>
    JSON.parse(fs.readFileSync(path.join(output, label, tier, 'flight.json'))));
  const tileDifferences = {};
  for (const shot of ['capture', 'endpoint']) {
    const [before, after] = reports.map(report => report[shot]);
    for (const field of ['pos', 'speed', 'heading', 'pitch', 'bank', 'orientation', 'fov', 'dpr']) {
      const left = [].concat(before[field]), right = [].concat(after[field]);
      assert.ok(left.every((value, i) => Math.abs(value - right[i]) < .0001), shot + ': matched ' + field);
    }
    assert.equal(before.tier, after.tier);
    assert.equal(before.sharp && after.sharp, true);
    for (const field of ['sinEl', 'az']) assert.ok(Math.abs(before.sun[field] - after.sun[field]) < .0001, shot + ': matched sun ' + field);
    const beforeOnly = before.nearKeys.filter(key => !after.nearKeys.includes(key));
    const afterOnly = after.nearKeys.filter(key => !before.nearKeys.includes(key));
    if (beforeOnly.length || afterOnly.length) tileDifferences[shot] = { beforeOnly, afterOnly };
    assert.deepEqual(before.nearPendingKeys ?? [], after.nearPendingKeys ?? [], shot + ': matched pending detailed tile keys');
    for (const sample of [before, after]) assert.equal(sample.nearPendingKeys?.length ?? 0, sample.near.draping);
  }
  assert.equal(reports[0].sunUtc, reports[1].sunUtc);
  const [before, after] = reports.map(report => report.capture);
  assert.notEqual(before.flags?.CITY_CONTINUITY, true);
  assert.equal(after.flags?.CITY_CONTINUITY, true);
  function routeStats(report) {
    const frames = report.motion;
    assert.ok(frames.length >= 4 && report.endpoint.routeM === movement.distanceM);
    return {
      samples: frames.length,
      minDetailed: Math.min(...frames.map(frame => frame.near?.ready ?? 0)),
      minSkyline: Math.min(...frames.map(frame => frame.far?.ready ?? 0)),
      minCoverM: Math.min(...frames.map(frame => frame.far?.standInCoverM ?? 0)),
      thresholdsPx: [...new Set(frames.map(frame => frame.coverage?.thresholdPx).filter(Number.isFinite))],
      pixelFloors: [...new Set(frames.map(frame => frame.coverage?.pixelFloor).filter(Number.isFinite))],
      settledDetailGapsOnRoute: frames.filter(frame =>
        frame.coverage?.nearFade >= .99 && frame.coverage.detailGaps.some(([from, to]) =>
          from < 3000 && to !== null)).length,
      settledEndpointCoverM: report.endpoint.far?.standInCoverM,
    };
  }
  console.log(JSON.stringify({
    tileDifferences,
    before: { near: before.near?.ready, far: before.far?.ready, coverM: before.far?.standInCoverM,
      handoff: before.handoff, lowRise: before.lowRiseCensus, endpointLowRise: reports[0].endpoint.lowRiseCensus,
      route: routeStats(reports[0]) },
    after: { near: after.near?.ready, far: after.far?.ready, coverM: after.far?.standInCoverM,
      handoff: after.handoff, lowRise: after.lowRiseCensus, endpointLowRise: reports[1].endpoint.lowRiseCensus,
      route: routeStats(reports[1]) },
  }, null, 2));
  assert.deepEqual(tileDifferences, {}, 'matched detailed tile keys');
}

async function main() {
  if (origin === 'compare') return compare();
  assert.ok(['before', 'after'].includes(arm));
  assert.ok(['auto', 'medium', 'high'].includes(tier));
  assert.ok(['manhattan', 'paris'].includes(venue));
  const label = arm === 'before' ? baseline : arm;
  const out = paris ? path.join(output, venue, label, tier) : path.join(output, label, tier);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const width = 1672, height = 1224;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const report = { pose, view, movement, tier, sunUtc, errors: [], sampled: [], motion: [] };
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', e => {
    if (e.type() === 'error' && /shader|WebGL|GLSL|wp-reach/i.test(e.text())) report.errors.push(e.text());
  });
  const link = new URL(origin);
  const spawn = paris ? '48.8784,2.2539,1103' : [pose.lat, pose.lon, Math.round(pose.altM / .3048)].join(',');
  link.search = new URLSearchParams({ graphicsReview: '1', at: spawn, aircraft: 'f35',
    flags: 'F35_COCKPIT,FLIGHT_CLARITY,FLIGHT_RELIEF' + (arm === 'after' ? ',CITY_CONTINUITY' : ''),
    sunUtc, weather: 'baseline' });
  const snapshot = (census = false) => page.evaluate(({ courseDeg, census }) => {
    const r = window.__fly, f = r.flight, s = window.__flyStore.getState();
    const canvas = [...document.querySelectorAll('canvas')].find(c => c.getContext('webgl2'));
    const gl = canvas.getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const skyline = r.satSkyline, buildings = r.satBuildings, rail = window.__cityReviewRail;
    const coverage = skyline?.material?.userData?.architecture?.uniforms;
    const direction = courseDeg * Math.PI / 180;
    const scale = 1 / Math.cos(f.latDeg * Math.PI / 180);
    const tileCount = coverage?.uArchitectureTileCount?.value ?? 0;
    const bounds = coverage?.uArchitectureTiles?.value ?? [];
    const weights = coverage?.uArchitectureTileK?.value ?? [];
    const x0 = f.pos.x - (r.origin?.anchor?.x ?? 0);
    const z0 = f.pos.z - (r.origin?.anchor?.z ?? 0);
    const detailGaps = [];
    let inGap = false;
    for (let distance = 0; distance <= 6500; distance += 100) {
      const x = x0 + Math.sin(direction) * scale * distance;
      const z = z0 - Math.cos(direction) * scale * distance;
      const covered = bounds.slice(0, tileCount).some((tile, i) =>
        weights[i] >= .8 && x >= tile.x && x < tile.z && z >= tile.y && z < tile.w);
      if (tileCount && !covered && !inGap) detailGaps.push([distance, null]);
      if (tileCount && covered && inGap) detailGaps.at(-1)[1] = distance;
      inGap = !covered;
    }
    function visibleLowRise() {
      const view = skyline?._standInU?.uStandInView?.value;
      if (!view) return null;
      const result = [[3000, 5000], [5000, 8000], [8000, 12000]].map(([fromM, toM]) =>
        ({ fromM, toM, visible: 0, fadeAtLeastHalf: 0 }));
      const { x: qx, y: qy, z: qz, w: qw } = r.camera.quaternion;
      const forwardX = -2 * (qx * qz + qw * qy), forwardZ = 2 * (qx * qx + qy * qy) - 1;
      const cone = Math.cos(24 * Math.PI / 180) * Math.hypot(forwardX, forwardZ);
      const horizon = skyline._horizonLiveEnd ?? Infinity;
      const footprintK = skyline._reachCfg?.worker?.footprintK ?? .5;
      const pixelFloor = skyline._standInU?.uCityPixelFloor?.value ?? view.y;
      const smooth = (from, to, value) => {
        const k = Math.max(0, Math.min(1, (value - from) / (to - from)));
        return k * k * (3 - 2 * k);
      };
      const origin = r.camera.position;
      const activeMasks = bounds.slice(0, tileCount).filter((_, i) =>
        weights[i] * (coverage?.uArchitectureNearFade?.value ?? 0) >= .96875);
      for (const { mesh } of skyline.chunks.values()) {
        if (!mesh?.visible || !(mesh.geometry.instanceCount > 0)) continue;
        const { aBendAnchor: anchor, aStandInBase: base, aStandInDim: box, aCityRank: rank } = mesh.geometry.attributes;
        if (!anchor || !box || !base) continue;
        const m = mesh.matrixWorld.elements;
        for (let i = 0; i < mesh.geometry.instanceCount; i++) {
          const h = Math.max(.5, 1000 * box.getZ(i));
          if (h > 24) continue;
          const ax = anchor.getX(i), ay = base.getX(i) + h * .5, az = anchor.getY(i);
          const x = m[0] * ax + m[4] * ay + m[8] * az + m[12];
          const y = m[1] * ax + m[5] * ay + m[9] * az + m[13];
          const z = m[2] * ax + m[6] * ay + m[10] * az + m[14];
          const dx = x - origin.x, dz = z - origin.z, horizontal = Math.hypot(dx, dz);
          const distance = Math.hypot(horizontal / view.w, y - origin.y);
          const bucket = result.find(({ fromM, toM }) => distance >= fromM && distance < toM);
          if (!bucket || dx * forwardX + dz * forwardZ < horizontal * cone) continue;
          const horizonDistance = Math.hypot(x - x0, z - z0);
          if (horizonDistance >= horizon || activeMasks.some(tile =>
            x >= tile.x && x < tile.z && z >= tile.y && z < tile.w)) continue;
          const size = Math.max(h, 2000 * footprintK * Math.sqrt(box.getX(i) * box.getY(i)) / view.w);
          const px = view.x * size / distance;
          const rankFade = rank ? smooth(view.y, view.y + view.z, view.x * rank.getX(i) / distance) : 1;
          const horizonFade = Number.isFinite(horizon) ? 1 - smooth(horizon * .76, horizon, horizonDistance) : 1;
          const fade = smooth(pixelFloor, pixelFloor + view.z, px) * rankFade * horizonFade;
          if (fade <= 0) continue;
          bucket.visible++;
          if (fade >= .5) bucket.fadeAtLeastHalf++;
        }
      }
      return result;
    }
    return {
      atMs: Math.round(performance.now()), gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      flags: window.__flyUrlFlags, geo: r.geo?.toArray(), pos: f.pos.toArray(), speed: f.speed,
      heading: f.heading, pitch: f.pitch, bank: f.bank, cameraPos: r.camera.position.toArray(),
      orientation: r.camera.quaternion.toArray(), fov: r.camera.fov, cameraMode: s.cameraMode,
      pilot: s.f35PilotSeat, tier: s.qualityTier, qualityPreset: s.qualityPreset, dpr: canvas.width / canvas.clientWidth,
      sun: r.sun, sharp: r.terraStats?.sharp, loading: r.worldLoading,
      near: buildings?.stats, far: skyline?.stats, photos: skyline?._photos?.stat,
      nearKeys: Array.from(buildings?.chunks ?? []).filter(([, tile]) => tile.mesh).map(([key]) => key).sort(),
      nearPendingKeys: (buildings?.pendingFinalize ?? []).map(tile => tile.key).sort(),
      coverage: coverage ? { nearFade: coverage.uArchitectureNearFade?.value,
        tileCount, detailGaps,
        pixelFloor: skyline?._standInU?.uCityPixelFloor?.value,
        thresholdPx: skyline?._standInU?.uStandInView?.value?.y } : undefined,
      handoff: r.cityContinuity ?? skyline?.handoffStats ?? window.__flyStats?.cityContinuity,
      routeM: rail.travelM,
      lowRiseCensus: census ? visibleLowRise() : undefined,
    };
  }, { courseDeg: movement.courseDeg, census });
  async function settle(samples) {
    let lastDetailed, stable = 0;
    for (let i = 0; i < 120; i++) {
      const sample = await snapshot();
      samples.push(sample);
      const key = sample.nearKeys.join(',') + '|' + sample.nearPendingKeys.join(',');
      stable = key === lastDetailed ? stable + 1 : 0;
      lastDetailed = key;
      const massReady = arm === 'before' || (sample.handoff?.ready >= 12 && sample.handoff?.nonzeroCells > 0);
      const idle = stats => stats && !stats.queued && !stats.building && !stats.draping;
      const durableMissingCoarse = tier === 'medium' && stable >= 40 && sample.near.draping > 0 &&
        !sample.near.queued && !sample.near.building;
      if (i >= 8 && stable >= 4 && sample.sharp && sample.nearKeys.length && sample.far?.ready > 0 &&
          (idle(sample.near) || durableMissingCoarse) && idle(sample.far) && massReady) return;
      await page.waitForTimeout(800);
    }
    throw Error('streaming queues or the resident detail tile set did not settle');
  }
  try {
    await page.route('**/api/aircraft?*', route => route.fulfill({ json: { ac: [], now: 1782050400, source: 'review' } }));
    await page.addInitScript(selected => {
      if (selected !== 'auto') localStorage.setItem('fly-quality-tier', selected);
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({version:1,settings:{tutorial:'done'}}));
      if (selected !== 'auto') window.__flyGovPin = 'hold';
      window.__flyCloudFreeze = true;
    }, tier);
    report.stage = 'boot';
    await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 150000 });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__flyStore?.getState().screen === 'flight', null, { timeout: 180000 });
    await enterFlight(page, pose);
    report.stage = 'pose';
    await page.evaluate(p => {
      const r = window.__fly, f = r.flight, step = f.step.bind(f), heading = p.headingDeg * Math.PI / 180;
      r.warpToGeo(p.lat, p.lon, { altM: p.altM, headingRad: heading, name: null });
      const pos = f.pos.clone();
      const rail = { travelM: 0, startMs: null };
      window.__cityReviewRail = rail;
      window.__flyStore.getState().setSpotting(false);
      f.step = (dt, cmd) => {
        step(dt, cmd);
        if (rail.startMs !== null) {
          rail.travelM = Math.min(rail.distanceM, (performance.now() - rail.startMs) * p.speed / 1000);
        }
        f.pos.set(pos.x + (rail.dx || 0) * rail.travelM, pos.y, pos.z + (rail.dz || 0) * rail.travelM);
        f.heading = heading;
        f.speed = p.speed;
        f.pitch = p.pitch;
        f.bank = p.bank;
        f.turnRate = f.pitchRate = 0;
        if (r.weather?.wx) r.weather.wx.windX = r.weather.wx.windZ = 0;
      };
    }, pose);
    await page.waitForFunction(() => !window.__fly.worldLoading &&
      !document.querySelector('[data-testid="warp-hold"]'), null, { timeout: 120000 });
    report.stage = 'right-look';
    const start = paris ? { x: 470, y: 300 } : { x: 420, y: 390 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(start.x + width * (view.yawDeg * Math.PI / 180) / 2.8,
      start.y - height * (view.pitchDeg * Math.PI / 180) / 1.9, { steps: 12 });
    await settle(report.sampled);
    report.capture = await snapshot(true);
    assert.ok(report.capture.pilot && report.capture.cameraMode === 'chase');
    assert.ok(Math.abs(report.capture.heading * 180 / Math.PI - pose.headingDeg) < .01);
    assert.ok(Math.abs(report.capture.speed - pose.speed) < .01);
    if (tier !== 'auto') assert.equal(report.capture.tier, tier);
    if (arm === 'after') {
      assert.equal(report.capture.flags?.CITY_CONTINUITY, true);
      assert.ok(report.capture.handoff?.ready >= 12 && report.capture.handoff.nonzeroCells > 0,
        'city-height data must be uploaded before the settled capture');
    }
    await page.screenshot({ path: path.join(out, 'right-look.png'), style: 'nextjs-portal{display:none!important}' });
    console.log(JSON.stringify({ stage: 'right-look', out, near: report.capture.near?.ready,
      far: report.capture.far?.ready, handoff: report.capture.handoff, lowRise: report.capture.lowRiseCensus }));
    if (paris) {
      const reference = JSON.parse(fs.readFileSync('.graphics-review/paris-relief/after/flight.json')).shots.seine;
      assert.ok(report.capture.pos.every((value, index) => Math.abs(value - reference.pos[index]) < .0001), 'Paris matches prior position');
      assert.ok(report.capture.orientation.every((value, index) => Math.abs(value - reference.orientation[index]) < .0001), 'Paris matches prior optical axis');
      await page.mouse.up({ button: 'right' });
      assert.deepEqual(report.errors, []);
      report.stage = 'complete';
      return;
    }
    report.stage = 'moving-leg';
    await page.evaluate(({ courseDeg, distanceM, lat }) => {
      // Move the real flight and streaming queries along a deterministic rail.
      // The pose changes with monotonic time even if one build renders fewer frames.
      const rad = Math.PI / 180;
      const k = 1 / Math.cos(lat * rad);
      Object.assign(window.__cityReviewRail, { startMs: performance.now(),
        distanceM, dx: Math.sin(courseDeg * rad) * k, dz: -Math.cos(courseDeg * rad) * k });
    }, { ...movement, lat: pose.lat });
    let midflight = false;
    for (;;) {
      const sample = await snapshot();
      report.motion.push(sample);
      if (!midflight && sample.routeM >= movement.distanceM * .5) {
        midflight = true;
        report.midflight = sample;
        await page.screenshot({ path: path.join(out, 'queens-midflight.png'), style: 'nextjs-portal{display:none!important}' });
      }
      if (sample.routeM >= movement.distanceM) break;
      assert.ok(report.motion.length < 75, 'moving leg did not finish');
      await page.waitForTimeout(650);
    }
    report.endpointSamples = [];
    await settle(report.endpointSamples);
    report.endpoint = await snapshot(true);
    await page.screenshot({ path: path.join(out, 'queens-endpoint.png'), style: 'nextjs-portal{display:none!important}' });
    await page.mouse.up({ button: 'right' });
    assert.deepEqual(report.errors, []);
    report.stage = 'complete';
    console.log(JSON.stringify({ out, ready: report.capture.near?.ready, far: report.capture.far?.ready, tier: report.capture.tier }));
  } finally {
    fs.writeFileSync(path.join(out, 'flight.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
