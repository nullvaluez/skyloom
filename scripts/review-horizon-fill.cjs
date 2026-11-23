// HORIZON FILL (FLY_HORIZON_FILL.md): the owner's review harness for the RTX 5080.
// Boots a fixed pose with ?flags=HORIZON_FILL (or -HORIZON_FILL), waits for
// the world to settle, records the Horizon Fill and skyline statistics, the
// renderer's draw and triangle counts (one composer frame, and the same frame
// with the procedural layer hidden), screenshots, then flies a fixed straight
// segment at a fixed speed and records the frame-interval percentiles.
//
//   node scripts/review-horizon-fill.cjs <server-url> <label> [place] [preset] [on|off]
//     place   powell | melton | phoenix | denver | paris   (default powell)
//     preset  high | ultra                                (default high)
//     arm     on (?flags=HORIZON_FILL) | off (?flags=-HORIZON_FILL); default
//             on, or off when the label starts with off / base / before
//   node scripts/review-horizon-fill.cjs compare <labelA> <labelB>
//     prints the two runs side by side and writes compare-<A>-<B>.png
//
// Output: .graphics-review/horizon-fill/<label>/ (report.json, start.png,
// end.png). It runs against a server the owner starts; it never starts one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.graphics-review', 'horizon-fill');
const PLACES = {
  // An Ohio suburb the map has few footprints for, 3,000 ft, heading over the town.
  powell: { lat: 40.199, lon: -83.128, altM: 915, headingDeg: 130, sunUtc: '2026-06-21T15:00:00Z' },
  // A Melbourne fringe suburb: mostly unmapped houses.
  melton: { lat: -37.683, lon: 144.585, altM: 915, headingDeg: 110, sunUtc: '2026-06-21T02:00:00Z' },
  // Phoenix sprawl to the horizon.
  phoenix: { lat: 33.42, lon: -111.94, altM: 1500, headingDeg: 270, sunUtc: '2026-06-21T17:00:00Z' },
  // Denver from the west: a city past the stand-in reach.
  denver: { lat: 39.74, lon: -105.25, altM: 2700, headingDeg: 90, sunUtc: '2026-06-21T16:00:00Z' },
  // Paris: dense mapping, where the census should hide most procedural cells.
  paris: { lat: 48.83, lon: 2.25, altM: 900, headingDeg: 60, sunUtc: '2026-06-21T10:00:00Z' },
};
const SEGMENT_M = 6000; // the moving segment, true metres
const SPEED = 180; // m/s along the segment
const SETTLE_MAX_S = 150;

function sample() {
  const r = window.__fly, s = window.__flyStats ?? {};
  const sk = r.satSkyline?.stats ?? null, near = r.satBuildings?.stats ?? null;
  const hf = s.horizonFill ?? null;
  const settled = (x) => !!x && !x.queued && !x.building && !x.draping;
  return {
    t: Math.round(performance.now()),
    travelled: window.__hfRail?.travelled ?? 0,
    loading: !!r.worldLoading,
    sharp: r.terraStats?.sharp ?? null,
    nearSettled: settled(near),
    skylineSettled: settled(sk),
    fillPending: hf && Number.isFinite(hf.pending) ? hf.pending : null,
    horizonFill: hf ? JSON.parse(JSON.stringify(hf)) : null,
    skyline: sk ? {
      chunks: sk.chunks, ready: sk.ready, drawn: sk.drawn, empty: sk.empty, queued: sk.queued, building: sk.building, draping: sk.draping,
      standInsResident: sk.standInsResident, standInsDrawn: sk.standInsDrawn, standInTris: sk.standInTris, standInMinPx: sk.standInMinPx,
      horizonFill: sk.horizonFill ? JSON.parse(JSON.stringify(sk.horizonFill)) : null,
    } : null,
    near: near ? { chunks: near.chunks, ready: near.ready, queued: near.queued, building: near.building } : null,
    position: r.flight.pos.toArray(),
  };
}

// One synchronous composer frame, then the same frame with the procedural
// layer hidden: the layer's own draws and triangles in the main view.
function frameCounts() {
  const r = window.__fly, composer = window.__flyComposer, gl = composer.renderer;
  const info = gl.info.render;
  const draw = () => {
    const c0 = info.calls, t0 = info.triangles;
    composer.render(0);
    return { calls: info.calls - c0, triangles: info.triangles - t0 };
  };
  const full = draw();
  const layer = r.horizonFill?.object ?? null;
  let without = null;
  if (layer) {
    const was = layer.visible;
    try {
      layer.visible = false;
      without = draw();
    } finally {
      layer.visible = was;
    }
  }
  const ctx = gl.getContext(), ext = ctx.getExtension('WEBGL_debug_renderer_info');
  return {
    calls: full.calls, triangles: full.triangles,
    fillCalls: without ? full.calls - without.calls : 0, fillTriangles: without ? full.triangles - without.triangles : 0,
    programs: gl.info.programs?.length ?? null, geometries: gl.info.memory?.geometries ?? null, textures: gl.info.memory?.textures ?? null,
    gpu: ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER),
    width: gl.domElement.width, height: gl.domElement.height,
  };
}

async function run(origin, label, place = 'powell', preset = 'high', armArg) {
  const { chromium } = require('playwright');
  const { enterFlight } = require('./_skip-menus');
  assert.ok(origin && /^https?:\/\//.test(origin), 'Supply the server URL the owner started');
  assert.ok(/^[\w.-]+$/.test(label || ''), 'Supply a run label (letters, digits, - _ .)');
  assert.ok(Object.hasOwn(PLACES, place), `place: ${Object.keys(PLACES).join(' | ')}`);
  assert.ok(['high', 'ultra'].includes(preset), 'preset: high | ultra (Horizon Fill is off on Medium and Low)');
  const arm = armArg ?? (/^(off|base|before)/i.test(label) ? 'off' : 'on');
  assert.ok(arm === 'on' || arm === 'off', 'arm: on | off');
  const out = path.join(OUT, label);
  fs.mkdirSync(out, { recursive: true });
  const pose = PLACES[place];
  const url = new URL(origin);
  url.search = new URLSearchParams({
    at: [pose.lat, pose.lon, Math.round(pose.altM / 0.3048)].join(','),
    aircraft: 'airliner', graphicsReview: '1', sunUtc: pose.sunUtc, weather: 'baseline',
    flags: arm === 'on' ? 'HORIZON_FILL' : '-HORIZON_FILL',
  }).toString();
  const report = { label, place, preset, arm, url: url.href, pose, segmentM: SEGMENT_M, speed: SPEED, errors: [], samples: [], motion: [] };
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => report.errors.push(err.message));
    page.on('console', (m) => { if (m.type() === 'error' && /WebGLProgram|shader error|context lost/i.test(m.text())) report.errors.push(m.text()); });
    await page.route('**/api/aircraft?*', (route) => route.fulfill({ json: { ac: [], now: 1782054000 } }));
    await page.addInitScript((quality) => {
      localStorage.setItem('fly-quality-tier', quality);
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      window.__flyGovPin = 'hold';
      window.__flyCloudFreeze = true;
    }, preset);
    const t0 = Date.now();
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__flyStore?.getState().screen === 'flight', null, { timeout: 180000, polling: 500 });
    report.bootSec = (Date.now() - t0) / 1000;
    await enterFlight(page, { ...pose, name: null });
    // A rail: the aircraft holds the pose until `since` is set, then moves
    // straight along the heading at SPEED; frame intervals are recorded only
    // while it moves.
    await page.evaluate(({ pose, distance, speed }) => {
      const r = window.__fly, f = r.flight, h = (pose.headingDeg * Math.PI) / 180;
      r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: h, name: null });
      const start = f.pos.clone(), step = f.step.bind(f), k = 1 / Math.cos((pose.lat * Math.PI) / 180);
      const rail = (window.__hfRail = { travelled: 0, frameMs: [], since: 0 });
      f.step = (dt, controls) => {
        step(dt, controls);
        if (rail.since && rail.travelled < distance) rail.travelled = Math.min(distance, ((performance.now() - rail.since) * speed) / 1000);
        f.pos.set(start.x + Math.sin(h) * k * rail.travelled, start.y, start.z - Math.cos(h) * k * rail.travelled);
        f.heading = h; f.speed = speed; f.bank = 0; f.pitch = -0.03; f.turnRate = 0; f.pitchRate = 0;
      };
      const frame = (now) => {
        if (rail.since && rail.travelled < distance && rail.last) rail.frameMs.push(now - rail.last);
        rail.last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      window.__flyStore.getState().setSpotting?.(false);
    }, { pose, distance: SEGMENT_M, speed: SPEED });
    report.active = await page.evaluate(() => ({
      flags: window.__flyUrlFlags ?? null,
      preset: window.__flyStore.getState().qualityPreset,
      tier: window.__flyStore.getState().qualityTier,
      horizonFillState: window.__flyStats?.horizonFill?.state ?? null,
    }));

    async function settle(name) {
      const t = Date.now();
      let stable = 0;
      let previous = '';
      let row;
      while ((Date.now() - t) / 1000 < SETTLE_MAX_S) {
        row = await page.evaluate(sample);
        report.samples.push({ phase: name, ...row });
        const key = JSON.stringify([row.skyline?.ready, row.skyline?.standInsResident, row.horizonFill?.resident, row.horizonFill?.chunks]);
        const quiet = !row.loading && row.sharp !== false && row.nearSettled && row.skylineSettled && (row.fillPending === null || row.fillPending === 0);
        stable = quiet && key === previous ? stable + 1 : 0;
        previous = key;
        if (stable >= 6) break;
        await page.waitForTimeout(750);
      }
      return { settled: stable >= 6, settleSec: (Date.now() - t) / 1000, ...row };
    }
    async function capture(name) {
      const state = await settle(name);
      const counts = await page.evaluate(frameCounts);
      await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 20000 });
      report[name] = { ...state, frame: counts };
      console.log(name, JSON.stringify({ settled: state.settled, settleSec: state.settleSec, calls: counts.calls, triangles: counts.triangles, fillCalls: counts.fillCalls, fillTriangles: counts.fillTriangles, horizonFill: state.horizonFill }));
    }

    await capture('start');
    await page.evaluate(() => { window.__hfRail.since = performance.now(); });
    do {
      await page.waitForTimeout(1000);
      report.motion.push(await page.evaluate(sample));
    } while (report.motion.at(-1).travelled < SEGMENT_M && report.motion.length < 120);
    const frames = await page.evaluate(() => window.__hfRail.frameMs.slice());
    frames.sort((a, b) => a - b);
    const pct = (p) => (frames.length ? Math.round(frames[Math.min(frames.length - 1, Math.floor((frames.length - 1) * p))] * 100) / 100 : null);
    report.frames = { n: frames.length, p50: pct(0.5), p90: pct(0.9), p95: pct(0.95), p99: pct(0.99), max: frames.length ? Math.round(frames[frames.length - 1] * 100) / 100 : null, over33: frames.filter((v) => v > 33.4).length, over50: frames.filter((v) => v > 50).length };
    console.log('motion', JSON.stringify(report.frames));
    await capture('end');
    report.complete = report.motion.at(-1).travelled >= SEGMENT_M && report.errors.length === 0;
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(path.join(out, 'report.json'));
}

function row(name, a, b) {
  const f = (v) => (v === null || v === undefined ? '-' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v));
  console.log(`${name.padEnd(34)} ${f(a).padStart(14)} ${f(b).padStart(14)}`);
}

async function compare(labelA, labelB) {
  assert.ok(labelA && labelB, 'compare <labelA> <labelB>');
  const [A, B] = [labelA, labelB].map((l) => JSON.parse(fs.readFileSync(path.join(OUT, l, 'report.json'), 'utf8')));
  if (A.place !== B.place || A.preset !== B.preset) console.log(`note: different runs (${A.place}/${A.preset} vs ${B.place}/${B.preset})`);
  console.log(`${''.padEnd(34)} ${labelA.padStart(14)} ${labelB.padStart(14)}`);
  row('arm', A.arm, B.arm);
  row('complete', A.complete, B.complete);
  row('errors', A.errors.length, B.errors.length);
  row('boot (s)', A.bootSec, B.bootSec);
  for (const key of ['start', 'end']) {
    const a = A[key] ?? {}, b = B[key] ?? {};
    row(`${key}: settled`, a.settled, b.settled);
    row(`${key}: settle (s)`, a.settleSec, b.settleSec);
    row(`${key}: draw calls`, a.frame?.calls, b.frame?.calls);
    row(`${key}: triangles`, a.frame?.triangles, b.frame?.triangles);
    row(`${key}: fill draw calls`, a.frame?.fillCalls, b.frame?.fillCalls);
    row(`${key}: fill triangles`, a.frame?.fillTriangles, b.frame?.fillTriangles);
    row(`${key}: programs`, a.frame?.programs, b.frame?.programs);
    row(`${key}: skyline stand-ins drawn`, a.skyline?.standInsDrawn, b.skyline?.standInsDrawn);
    row(`${key}: skyline groups ready`, a.skyline?.ready, b.skyline?.ready);
    for (const k of ['tiles', 'chunks', 'resident', 'drawn', 'triangles', 'minPx', 'pending', 'missing', 'uploads', 'swaps', 'uploadMsMax']) {
      row(`${key}: fill ${k}`, a.horizonFill?.[k], b.horizonFill?.[k]);
    }
    const ca = a.skyline?.horizonFill, cb = b.skyline?.horizonFill;
    row(`${key}: census z11 tiles`, ca?.coverageTiles, cb?.coverageTiles);
    row(`${key}: bundle hits`, ca?.bundle?.hits, cb?.bundle?.hits);
    row(`${key}: bundle misses`, ca?.bundle?.misses, cb?.bundle?.misses);
    row(`${key}: bundle puts`, ca?.bundle?.puts, cb?.bundle?.puts);
    row(`${key}: pre-builds issued`, ca?.prebuild?.issued, cb?.prebuild?.issued);
  }
  for (const k of ['n', 'p50', 'p90', 'p95', 'p99', 'max', 'over33', 'over50']) row(`frame interval ${k} (ms)`, A.frames?.[k], B.frames?.[k]);
  try {
    const sharp = require('sharp');
    const parts = [];
    let width = 0, height = 0;
    for (const [i, l] of [labelA, labelB].entries()) {
      const file = path.join(OUT, l, 'end.png');
      if (!fs.existsSync(file)) continue;
      const meta = await sharp(file).metadata();
      parts.push({ input: file, left: i * meta.width, top: 0 });
      width = Math.max(width, (i + 1) * meta.width);
      height = Math.max(height, meta.height);
    }
    if (parts.length === 2) {
      const file = path.join(OUT, `compare-${labelA}-${labelB}.png`);
      await sharp({ create: { width, height, channels: 3, background: '#161c27' } }).composite(parts).png().toFile(file);
      console.log(file);
    }
  } catch (e) {
    console.log(`(no side-by-side image: ${e.message})`);
  }
}

const argv = process.argv.slice(2);
(argv[0] === 'compare' ? compare(argv[1], argv[2]) : run(...argv)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
