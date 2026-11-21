// Run each arm against a production build with live imagery. The layer
// difference uses the game's composer at one simulation instant, including
// normal depth testing, atmospheric attenuation and the near-tile handoff.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { enterFlight } = require('./_skip-menus');

const [origin, arm = 'baseline', location = 'powell', tier = 'high'] = process.argv.slice(2);
const arms = {
  baseline: '-BUILDING_APPROACH,-CANOPY_VIEW_LOD',
  buildings: 'BUILDING_APPROACH,-CANOPY_VIEW_LOD',
  combined: 'BUILDING_APPROACH,CANOPY_VIEW_LOD',
};
const routes = {
  powell: { lat: 40.199, lon: -83.128, altM: 820, headingDeg: 130 },
  phoenix: { lat: 33.355, lon: -111.84, altM: 1140, headingDeg: 0 },
  brooklyn: { lat: 40.678, lon: -73.970, altM: 780, headingDeg: 300 },
  melton: { lat: -37.683, lon: 144.585, altM: 730, headingDeg: 125 },
};
const distance = 4200;
const speed = 180;

function sample() {
  const r = window.__fly, c = window.__wpCanopy?.stats, near = r.satBuildings.stats, far = r.satSkyline.stats;
  const settled = s => s.chunks > 0 && !s.queued && !s.building && !s.draping && !s.births && !s.dying;
  let root = r.satBuildings.object;
  while (root.parent) root = root.parent;
  const parcels = root.getObjectByName('sat-parcel-homes');
  const mercator = Math.cosh(r.flight.pos.z / 6378137), halfWorld = Math.PI * 6378137;
  const tileAhead = metres => {
    const span = halfWorld * 2 / 16384;
    const tx = Math.floor((r.flight.pos.x + Math.sin(r.flight.heading)*metres*mercator + halfWorld)/span);
    const ty = Math.floor((r.flight.pos.z - Math.cos(r.flight.heading)*metres*mercator + halfWorld)/span);
    const chunk = r.satBuildings.chunks.get('14/' + tx + '/' + ty);
    return chunk?.mesh ? 'detailed' : chunk?.state ?? 'absent';
  };
  const quail = window.__approach.quail;
  let outerHomes = 0, quailHomes = 0;
  if (parcels?.visible) {
    const a = parcels.instanceMatrix.array;
    for (let i = 0; i < parcels.count; i++) {
      const x = parcels.position.x + a[i*16 + 12] - r.flight.pos.x, z = parcels.position.z + a[i*16 + 14] - r.flight.pos.z;
      if (a[i*16 + 5] <= .1) continue;
      if (Math.hypot(x, z) / mercator >= 2500) outerHomes++;
      if (quail && Math.hypot(parcels.position.x + a[i*16+12] - quail.x,
        parcels.position.z + a[i*16+14] - quail.z) <= 250 * quail.k) quailHomes++;
    }
  }
  return { travelled: window.__approach.travelled, sharp: r.terraStats?.sharp, loading: r.worldLoading,
    settled: settled(near) && settled(far), near: near.ready, columns: near.columns, far: far.ready,
    groups: far.chunks, at1500: tileAhead(1500), at3000: tileAhead(3000),
    pending: [near.queued, near.building, near.draping, far.queued, far.building, far.draping],
    farResident: far.standInsResident, farIssued: far.standInsDrawn, farPhotos: far.standInPhotos,
    farThresholdPx: far.standInMinPx, canopyTriangles: c?.triangles, crownShadowTriangles: c?.shadowTriangles,
    parcelHomes: r.parcelSettle?.placed, homesResolved: r.parcelSettle?.resolved,
    outerHomes, quailHomes: quail ? quailHomes : undefined,
    position: r.flight.pos.toArray(), camera: r.camera.quaternion.toArray(),
    cameraPosition: r.camera.position.toArray(), fov: r.camera.fov, sun: r.sun.sinEl };
}

// The capture and controls run synchronously. No flight, tile, tree or
// lighting update can occur between the repeated render and layer removal.
function captureLayers() {
  const r = window.__fly, composer = window.__flyComposer, gl = composer.renderer;
  const canvas = document.createElement('canvas');
  canvas.width = gl.domElement.width;
  canvas.height = gl.domElement.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const grain = composer.passes.flatMap(pass => Array.from(pass.effects ?? []))
    .find(effect => effect.uniforms?.has('uFilmSeed'));
  const grainFrame = grain?.frame;
  const draw = () => {
    const info = gl.info.render;
    const calls = info.calls, triangles = info.triangles;
    if (grain) grain.frame = 0;
    composer.render(0);
    ctx.drawImage(gl.domElement, 0, 0);
    return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      calls: info.calls - calls, triangles: info.triangles - triangles };
  };
  const full = draw(), reference = draw();
  const flight = canvas.toDataURL('image/png').split(',')[1];
  const skyline = r.satSkyline.object, original = skyline.visible;
  let hidden;
  try {
    skyline.visible = false;
    hidden = draw();
  } finally {
    skyline.visible = original;
  }
  const restored = draw(), mask = ctx.createImageData(canvas.width, canvas.height);
  let root = skyline;
  while (root.parent) root = root.parent;
  const homes = root.getObjectByName('sat-parcel-homes');
  const quail = window.__approach.quail;
  const matrices = homes?.instanceMatrix;
  const saved = [];
  const beforeHomes = draw();
  let withoutHomes;
  try {
    if (quail && homes?.visible) {
      for (let i = 0; i < homes.count; i++) {
        const offset = 16*i, a = matrices.array;
        if (Math.hypot(homes.position.x + a[offset+12] - quail.x,
          homes.position.z + a[offset+14] - quail.z) > 250 * quail.k) continue;
        saved.push({ offset, values: a.slice(offset, offset + 12) });
        a.fill(0, offset, offset + 12);
      }
      if (saved.length) matrices.needsUpdate = true;
    }
    withoutHomes = draw();
  } finally {
    for (const { offset, values } of saved) matrices.array.set(values, offset);
    if (saved.length) matrices.needsUpdate = true;
  }
  const afterHomes = draw();
  const delta = (a, b, i) => Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2]));
  const controls = new Uint8Array(canvas.width * canvas.height);
  const homeMask = ctx.createImageData(canvas.width, canvas.height);
  let repeatPixels = 0, affectedPixels = 0, quailAffectedPixels = 0;
  for (let i = 0; i < mask.data.length; i += 4) {
    const noisy = delta(full.data, reference.data, i) >= 6 || delta(reference.data, restored.data, i) >= 6;
    const changed = !noisy && delta(reference.data, hidden.data, i) >= 6;
    controls[i / 4] = noisy;
    if (noisy) repeatPixels++;
    if (changed) affectedPixels++;
    mask.data[i] = changed ? 251 : 22;
    mask.data[i+1] = changed ? 189 : 28;
    mask.data[i+2] = changed ? 73 : 39;
    mask.data[i+3] = 255;
    const house = saved.length && !noisy && delta(beforeHomes.data, afterHomes.data, i) < 6 &&
      delta(beforeHomes.data, withoutHomes.data, i) >= 6 && delta(afterHomes.data, withoutHomes.data, i) >= 6;
    if (house) quailAffectedPixels++;
    homeMask.data[i] = house ? 251 : 22;
    homeMask.data[i+1] = house ? 189 : 28;
    homeMask.data[i+2] = house ? 73 : 39;
    homeMask.data[i+3] = 255;
  }
  // Collapse only the boxes anchored inside one true-distance band. Depth,
  // haze, near geometry and the real shaders still decide every output pixel.
  const boxes = [];
  const k = Math.cosh(r.flight.pos.z / 6378137);
  for (const chunk of r.satSkyline.chunks.values()) {
    const geo = chunk.mesh?.geometry;
    if (!geo?.attributes.aStandInDim || !chunk.mesh.visible) continue;
    const dim = geo.attributes.aStandInDim, centers = geo.attributes.aBendAnchor;
    const range = new Float32Array(geo.instanceCount);
    for (let i = 0; i < range.length; i++) {
      range[i] = Math.hypot(chunk.cx + centers.getX(i) - r.flight.pos.x, chunk.cz + centers.getY(i) - r.flight.pos.z) / k;
    }
    boxes.push({ dim, range, original: dim.array.slice() });
  }
  const bands = [];
  for (const [from, to] of [[0, 3000], [3000, 6000], [6000, 10000], [10000, Infinity]]) {
    const beforeBand = draw();
    let withoutBand;
    try {
      for (const { dim, range } of boxes) {
        for (let i = 0; i < range.length; i++) {
          if (range[i] >= from && range[i] < to) { dim.array[i*4] = 0; dim.array[i*4+1] = 0; }
        }
        dim.needsUpdate = true;
      }
      withoutBand = draw();
    } finally {
      for (const { dim, original } of boxes) { dim.array.set(original); dim.needsUpdate = true; }
    }
    const afterBand = draw();
    let pixels = 0;
    for (let i = 0; i < withoutBand.data.length; i += 4) {
      if (!controls[i/4] && delta(beforeBand.data, afterBand.data, i) < 6 &&
          delta(beforeBand.data, withoutBand.data, i) >= 6 && delta(afterBand.data, withoutBand.data, i) >= 6) pixels++;
    }
    bands.push({ from, to: Number.isFinite(to) ? to : null, pixels });
  }
  if (grain) grain.frame = grainFrame;
  ctx.putImageData(homeMask, 0, 0);
  const parcels = canvas.toDataURL('image/png').split(',')[1];
  ctx.putImageData(mask, 0, 0);
  const gpu = gl.getContext(), ext = gpu.getExtension('WEBGL_debug_renderer_info');
  return { flight, parcels, mask: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height,
    position: r.flight.pos.toArray(), camera: r.camera.quaternion.toArray(), cameraPosition: r.camera.position.toArray(),
    fov: r.camera.fov, sun: r.sun.sinEl,
    gpu: ext && gpu.getParameter(ext.UNMASKED_RENDERER_WEBGL), affectedPixels, repeatPixels, quailAffectedPixels, bands: boxes.length ? bands : null,
    composerCalls: reference.calls, composerTriangles: reference.triangles,
    skylineCalls: reference.calls - hidden.calls, skylineTriangles: reference.triangles - hidden.triangles };
}

async function run() {
  assert.ok(origin && Object.hasOwn(arms, arm) && Object.hasOwn(routes, location));
  assert.ok(['low', 'medium', 'high', 'ultra'].includes(tier));
  const out = path.resolve('.graphics-review/building-approach', location, tier, arm);
  fs.mkdirSync(out, { recursive: true });
  const pose = routes[location], url = new URL(origin);
  const sun = location === 'melton' ? '2026-06-21T02:00:00Z' : location === 'phoenix' ? '2026-06-21T17:00:00Z' : '2026-06-21T15:00:00Z';
  url.search = new URLSearchParams({ at: [pose.lat, pose.lon, Math.round(pose.altM / .3048)].join(','),
    aircraft: 'airliner', graphicsReview: '1', sunUtc: sun, weather: 'baseline', flags: arms[arm] });
  const report = { pose, tier, flags: arms[arm], sun, distance, speed, motion: [], errors: [] };
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', err => report.errors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error' && /WebGLProgram|shader error|context lost/i.test(msg.text())) report.errors.push(msg.text()); });
    await page.route('**/api/aircraft?*', route => route.fulfill({ json: { ac: [], now: 1782054000 } }));
    await page.addInitScript(quality => {
      localStorage.setItem('fly-quality-tier', quality);
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      window.__flyGovPin = 'hold';
      window.__flyCloudFreeze = true;
    }, tier);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__flyStore?.getState().screen === 'flight',
      null, { timeout: 180000, polling: 500 });
    await enterFlight(page, { ...pose, name: null });
    await page.evaluate(({ pose, distance, speed, location }) => {
      const r = window.__fly, f = r.flight, h = pose.headingDeg * Math.PI / 180;
      r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: h, name: null });
      const start = f.pos.clone(), step = f.step.bind(f), k = 1 / Math.cos(pose.lat * Math.PI / 180);
      const rail = window.__approach = { travelled: 0, frameMs: [] };
      if (location === 'powell') {
        const lat = 40.1734 * Math.PI / 180;
        rail.quail = { x: 6378137 * -83.0747 * Math.PI / 180, z: -6378137 * Math.asinh(Math.tan(lat)), k: 1/Math.cos(lat) };
      }
      f.step = (dt, controls) => {
        step(dt, controls);
        const now = performance.now();
        if (rail.since && rail.travelled < distance) {
          rail.travelled = Math.min(distance, (now - rail.since) * speed / 1000);
        }
        f.pos.set(start.x + Math.sin(h)*k*rail.travelled, start.y, start.z - Math.cos(h)*k*rail.travelled);
        f.heading = h; f.speed = speed; f.bank = 0; f.pitch = -.035; f.turnRate = 0; f.pitchRate = 0;
      };
      const frame = now => {
        if (rail.travelled > 0 && rail.travelled < distance && rail.last) rail.frameMs.push(now - rail.last);
        rail.last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      window.__flyStore.getState().setSpotting(false);
    }, { pose, speed, distance, location });
    async function capture(name) {
      let stable = 0, previous;
      for (let i = 0; i < 210; i++) {
        const row = report[name] = await page.evaluate(sample);
        const key = [row.near, row.columns, row.far, row.farResident, row.farPhotos, row.parcelHomes, row.outerHomes, row.quailHomes].join('/');
        stable = key === previous && !row.loading && row.sharp && row.settled && row.homesResolved !== false && row.near && row.far ? stable + 1 : 0;
        if (stable >= 8) break;
        previous = key;
        await page.waitForTimeout(700);
      }
      assert.ok(stable >= 8, 'Buildings and terrain must settle for ' + name);
      const { flight, mask, parcels, ...stats } = await page.evaluate(captureLayers);
      for (const [kind, data] of Object.entries({ flight, mask, parcels })) {
        fs.writeFileSync(path.join(out, name + '-' + kind + '.png'), Buffer.from(data, 'base64'));
      }
      Object.assign(report[name], stats);
      assert.ok(stats.repeatPixels < stats.width * stats.height * .001, 'same-frame control noise');
      console.log(name, JSON.stringify(report[name]));
    }
    await capture('start');
    report.active = await page.evaluate(() => ({ tier: window.__flyStore.getState().qualityTier,
      preset: window.__flyStore.getState().qualityPreset, flags: window.__flyUrlFlags }));
    assert.equal(report.active.preset, tier);
    assert.equal(report.active.tier, tier === 'ultra' ? 'high' : tier);
    assert.equal(report.active.flags?.BUILDING_APPROACH, arm !== 'baseline');
    assert.equal(report.active.flags?.CANOPY_VIEW_LOD, arm === 'combined');
    await page.evaluate(() => { window.__approach.since = performance.now(); });
    do {
      await page.waitForTimeout(850);
      report.motion.push(await page.evaluate(sample));
    } while (report.motion.at(-1).travelled < distance && report.motion.length < 100);
    assert.equal(report.motion.at(-1).travelled, distance);
    report.frames = await page.evaluate(() => window.__approach.frameMs);
    await capture('end');
    assert.deepEqual(report.errors, []);
    report.complete = true;
  } finally {
    fs.writeFileSync(path.join(out, 'flight.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}
async function compare() {
  const sharp = require('sharp');
  const folder = path.resolve('.graphics-review/building-approach', location, tier);
  const labels = ['baseline', arm];
  const records = labels.map(label => JSON.parse(fs.readFileSync(path.join(folder, label, 'flight.json'))));
  for (const [i, record] of records.entries()) {
    assert.equal(record.complete, true);
    assert.deepEqual(record.errors, []);
    assert.deepEqual(record.pose, routes[location]);
    assert.equal(record.flags, arms[labels[i]]);
    assert.equal(record.active.preset, tier);
    assert.equal(record.distance, distance);
    assert.equal(record.speed, speed);
  }
  for (const key of ['start', 'end']) {
    const [a,b] = records.map(record => record[key]);
    for (const field of ['width', 'height', 'gpu', 'fov']) assert.equal(a[field], b[field], field);
    for (const field of ['position', 'cameraPosition', 'camera', 'sun']) {
      const tolerance = field === 'cameraPosition' ? .05 : .0001;
      [].concat(a[field]).forEach((value, i) => assert.ok(Math.abs(value - [].concat(b[field])[i]) < tolerance, key + ' ' + field));
    }
  }
  // The two crops use the same source rectangle and the same pixel scale.
  const size = records[0].end;
  const neighborhood = process.argv[6] === 'quail';
  if (neighborhood) assert.equal(location, 'powell');
  const layer = neighborhood ? 'parcels' : 'mask';
  // Include the altitude band containing the middle 95% of both sets of
  // marked pixels. A fixed middle-of-screen crop can miss the city at the horizon.
  const rows = new Uint32Array(size.height), cols = new Uint32Array(size.width);
  for (const label of labels) {
    const { data, info } = await sharp(path.join(folder, label, 'end-' + layer + '.png')).raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels] === 251) { rows[y]++; cols[x]++; }
    }
  }
  const sum = rows.reduce((a,b) => a+b, 0);
  assert.ok(sum > 0, 'The city must contribute visible pixels to at least one arm');
  const quantile = (axis, frac) => {
    let total = 0;
    return axis.findIndex(n => { total += n; return total >= sum * frac; });
  };
  const top = Math.max(0, quantile(rows,.025) - 35);
  let crop = { left: Math.round(size.width*.18), top,
    width: Math.round(size.width*.64), height: Math.min(size.height-top, Math.max(155, quantile(rows,.975)+36-top)) };
  if (neighborhood) {
    const width = Math.min(size.width, Math.max(525, quantile(cols,1) - quantile(cols,.001) + 60));
    const height = Math.min(size.height, Math.max(240, quantile(rows,1) - quantile(rows,.001) + 60));
    const center = (axis) => (quantile(axis,.001) + quantile(axis,1)) / 2;
    crop = { left: Math.max(0, Math.min(size.width-width, Math.round(center(cols)-width/2))),
      top: Math.max(0, Math.min(size.height-height, Math.round(center(rows)-height/2))), width, height };
  }
  const w = crop.width, h = crop.height;
  const parts = [];
  const font = 'Arial, sans-serif';
  const labelImage = (message, width, height, color = '#f3f7fa', fontSize = 18) =>
    Buffer.from('<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg"><text x="10" y="' +
      (height-9) + '" font-family="' + font + '" font-size="' + fontSize + '" fill="' + color + '">' + message + '</text></svg>');
  for (const [i, label] of labels.entries()) {
    const x = i * w, record = records[i].end;
    const title = i === 0 ? 'Current defaults' : arm === 'combined' ? 'Building approach + canopy view LOD' : 'Building approach';
    parts.push({ input: labelImage(title, w, 38), left: x, top: 0 });
    for (const [row, kind] of ['flight', layer].entries()) {
      const input = await sharp(path.join(folder, label, 'end-' + kind + '.png')).extract(crop).png().toBuffer();
      parts.push({ input, left: x, top: row === 0 ? 38 : h + 76 });
    }
    const caption = neighborhood ? 'Quail Crossing  ·  ' + record.quailHomes + ' procedural houses  ·  ' +
      record.quailAffectedPixels.toLocaleString('en-US') + ' affected pixels' : 'Distant building layer  ·  ' +
      record.affectedPixels.toLocaleString('en-US') + ' affected pixels in the full frame';
    parts.push({ input: labelImage(caption, w, 38, '#ffcf7a', 16), left: x, top: h + 38 });
  }
  const credits = 'Same endpoint, native scale  ·  Esri, Maxar, Earthstar Geographics  ·  ESA WorldCover  ·  © OpenStreetMap contributors, OpenMapTiles / OpenFreeMap';
  parts.push({ input: labelImage(credits, w*2, 32, '#c4cdd8', neighborhood ? 12 : 14), left: 0, top: 2*h + 76 });
  const file = path.join(folder, 'comparison-' + arm + (neighborhood ? '-quail' : '') + '.png');
  await sharp({ create: { width: w*2, height: 2*h + 108, channels: 3, background: '#161c27' } })
    .composite(parts).png().toFile(file);
  if (process.argv.includes('--publish')) {
    const dest = path.resolve('docs/reviews/building-approach');
    fs.mkdirSync(dest, { recursive: true });
    const name = neighborhood ? 'quail-crossing' : location + '-' + tier + (arm === 'combined' ? '-canopy' : '');
    await sharp(file).webp({ quality: 92 }).toFile(path.join(dest, name + '.webp'));
  }
  console.log(file);
}
(origin === 'compare' ? compare() : run()).catch(error => { console.error(error); process.exitCode = 1; });
