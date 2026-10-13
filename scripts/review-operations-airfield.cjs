// GATE TO GATE — airfield review captures (desktop Chrome, real GPU, live feeds).
//
//   node scripts/review-operations-airfield.cjs --port 3311
//        [--airport KCMH,KJFK,LOWI,YSSY,EGLL | <catalog id, e.g. KJFK:04L-22R>]
//        [--sun day,golden,night] [--date 2026-10-13] [--utc <ISO | epoch ms | UTC hour>]
//        [--poses lineup,roll40,rotate,final3nm,final1nm,flare,rollout]
//        [--aircraft auto|airliner|bizjet|...] [--arm off|on|both] [--tier full|registry]
//        [--cam chase[,side]] [--census 1] [--clean 1] [--reverse 0|1]
//        [--weather baseline|live] [--quality high] [--settle 4] [--settleMax 30]
//        [--out .graphics-review/operations-airfield]
//
// One run = one airport x one sun x one arm, on a fresh page:
//   ?graphicsReview=1&sunUtc=<instant>&weather=baseline   (arm off)
//   ...&flags=OPS_AIRFIELD,OPS_APRON,GATE_TO_GATE,PLAYER_GLOW_LIGHTS   (arm on;
//   the W0 flag names — nothing reads them until W1)
// then runtime.launchSetup({flightMode:'ops', aircraftId, airportId,
// start:'runway'}) after runtime.reviewOps.ensureAirport() has loaded a catalog
// airport's runway rows, a wait for the world, and for each pose
// runtime.reviewOps.pose(name) (lib/fly/airport-service/review-poses.js, dev
// builds only: the sim is held while posed), a readiness settle, then per
// camera a PNG of the frame as the player sees it plus a "-clean" PNG of the
// GL canvas alone (HUD hidden), and with --census 1 the renderer census:
// __flyStats draw calls / triangles sampled across five 60-frame refreshes
// (median), frame p50/p95/p99 over 120 frames (__flyStats.frame), the
// AirportOperationsLayer meshes visible, __graphicsReview tier/dpr/textures/
// geometries/programs, and the page / console errors raised during the pose.
//
// Suns are computed per airport for --date (default today, UTC) with the
// app's own sun maths (lib/fly/airport-watch-sky.mjs -> sun-model.js):
// day = solar noon, golden = sun +5° descending, night = −15° descending
// (after sunset). --utc overrides with one instant for every airport.
//
// Output: <out>/<IDENT>-<sun>-<arm>/<pose>-<cam>.png, <pose>-<cam>-clean.png
// and report.json, plus <out>/index.json (one row per run, merged across
// invocations). --tier is recorded and pinned as window.__flyOpsTierOverride
// for the W1 airfield tiers; nothing reads it in W0.
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const { registerHooks } = require('node:module');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};
const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
const port = arg('port', '3311');
const base = arg('url', `http://localhost:${port}/`);
const airports = list(arg('airport', 'KCMH'));
const suns = list(arg('sun', 'day'));
const date = arg('date', new Date().toISOString().slice(0, 10));
const utcArg = arg('utc', '');
const ALL_POSES = ['lineup', 'roll40', 'rotate', 'final3nm', 'final1nm', 'flare', 'rollout'];
const poses = list(arg('poses', ALL_POSES.join(',')));
const aircraftArg = arg('aircraft', 'auto');
const armArg = arg('arm', 'off');
const arms = armArg === 'both' ? ['off', 'on'] : [armArg];
const tier = arg('tier', 'full');
const cams = list(arg('cam', 'chase'));
const census = arg('census', '1') === '1';
const clean = arg('clean', '1') === '1';
const reverse = arg('reverse', '0') === '1';
const weather = arg('weather', 'baseline');
const quality = arg('quality', 'high');
const settleMin = Number(arg('settle', '4')) * 1000;
const settleMax = Number(arg('settleMax', '30')) * 1000;
const outRoot = path.resolve(arg('out', '.graphics-review/operations-airfield'));
const headed = arg('headed', '0') === '1';
const ARM_FLAGS = 'OPS_AIRFIELD,OPS_APRON,GATE_TO_GATE,PLAYER_GLOW_LIGHTS';
// Airliner-class first; a short catalog runway falls back down the list (LOWI 08/26 is 1996 m).
const AUTO_AIRCRAFT = ['airliner', 'bizjet', 'fighter', 'prop'];

// ---------------------------------------------------------------- sun maths
registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('@/')) s = pathToFileURL(path.join(ROOT, s.slice(2))).href;
    if (s.startsWith('.') || s.startsWith('file:')) {
      const u = new URL(s, c.parentURL);
      if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c);
    }
    return next(s, c);
  },
});
let sky = null;
const loadSky = async () => (sky ??= await import(pathToFileURL(path.join(ROOT, 'lib/fly/airport-watch-sky.mjs')).href));

/** {lat, lon, name} for an authored id, a catalog id or a catalog ident (its longest runway). */
async function airportPlace(id) {
  const reg = await import(pathToFileURL(path.join(ROOT, 'lib/fly/operations-airports.js')).href);
  const a = reg.airportById(id);
  if (a) return { lat: (a.a.lat + a.b.lat) / 2, lon: (a.a.lon + a.b.lon) / 2, name: a.name };
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/runways/v1/index.json'), 'utf8')).runways;
  const row = index.find((r) => r.id === id) || index.filter((r) => r.ident === id).sort((x, y) => (y.length || 0) - (x.length || 0))[0];
  if (!row) throw new Error(`unknown airport ${id}`);
  return { lat: row.lat, lon: row.lon, name: row.name };
}

/** The UTC instant for a named sun at a place on a date (minute resolution). */
async function sunInstant(kind, lat, lon) {
  const { sunElevationDeg } = await loadSky();
  if (utcArg) {
    const ms = /^\d+(\.\d+)?$/.test(utcArg) && Number(utcArg) < 48 ? Date.parse(date + 'T00:00:00Z') + Number(utcArg) * 3600e3 : /^\d+$/.test(utcArg) ? Number(utcArg) : Date.parse(utcArg);
    if (!Number.isFinite(ms)) throw new Error(`bad --utc ${utcArg}`);
    return { ms, elevationDeg: sunElevationDeg(lat, lon, ms) };
  }
  const MIN = 60000;
  // The local mean-solar day of --date: [00:00, 24:00) local mean time.
  const start = Math.round((Date.parse(date + 'T00:00:00Z') - (lon / 15) * 3600e3) / MIN) * MIN;
  let noon = start, best = -Infinity;
  for (let t = start; t < start + 24 * 3600e3; t += MIN) {
    const el = sunElevationDeg(lat, lon, t);
    if (el > best) { best = el; noon = t; }
  }
  if (kind === 'day') return { ms: noon, elevationDeg: best };
  const target = kind === 'golden' ? 5 : kind === 'night' ? -15 : NaN;
  if (!Number.isFinite(target)) throw new Error(`unknown sun ${kind} (day|golden|night)`);
  if (best < target) throw new Error(`the sun never reaches ${target}° at ${lat},${lon} on ${date}`);
  for (let t = noon; t < noon + 24 * 3600e3; t += MIN) {
    const el = sunElevationDeg(lat, lon, t);
    if (el <= target) return { ms: t, elevationDeg: el };
  }
  throw new Error(`the sun never descends to ${target}° at ${lat},${lon} on ${date}`);
}

// ---------------------------------------------------------------- in-page helpers
const CENSUS_FN = async ({ wantFrames }) => {
  const frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const out = {};
  // __flyStats.drawCalls/triangles refresh every 60 frames (FlyScene): five refreshes, median by draws.
  const xs = [];
  for (let i = 0; i < 5; i++) { await frames(61); const s = window.__flyStats || {}; xs.push([s.drawCalls ?? null, s.triangles ?? null]); }
  const sorted = xs.filter((x) => x[0] != null).sort((a, b) => a[0] - b[0]);
  out.samples = xs;
  out.draws = sorted.length ? sorted[sorted.length >> 1][0] : null;
  out.tris = sorted.length ? sorted[sorted.length >> 1][1] : null;
  const fr = window.__flyStats?.frame;
  if (fr && typeof fr.reset === 'function') {
    fr.reset();
    await frames(wantFrames);
    const s = fr.sample();
    out.frame = { count: s.count, p50: s.p50, p95: s.p95, p99: s.p99, worst: s.worstDtRecent, long33: s.long33, long100: s.long100 };
  } else out.frame = null;
  // AirportOperationsLayer: meshes whose whole ancestor chain is visible.
  const composer = window.__flyComposer;
  const pass = composer?.passes?.find((p) => p.mainScene || p.scene);
  let scene = pass?.mainScene || pass?.scene || null;
  if (!scene) { let o = window.__flyPlayer; while (o?.parent) o = o.parent; scene = o || null; }
  const names = ['operations-pavement', 'operations-hangar', 'operations-runway', 'operations-taxi'];
  const aol = Object.fromEntries(names.map((n) => [n, { nodes: 0, visibleMeshes: 0, meshes: 0 }]));
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  scene?.traverse?.((o) => {
    if (!names.includes(o.name)) return;
    const row = aol[o.name];
    row.nodes++;
    o.traverse((m) => { if (m.isMesh) { row.meshes++; if (shown(m)) row.visibleMeshes++; } });
  });
  out.aol = aol;
  out.aolVisibleMeshes = names.reduce((n, k) => n + aol[k].visibleMeshes, 0);
  out.sceneFound = !!scene;
  const g = window.__graphicsReview;
  out.review = g ? { tier: g.tier, effectsTier: g.effectsTier, dpr: g.dpr, textures: g.textures, geometries: g.geometries, programs: g.programs, drawCalls: g.drawCalls, triangles: g.triangles } : null;
  const info = window.__flyGl?.info;
  out.gl = info ? { textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs?.length ?? null } : null;
  return out;
};

const CLEAN_CSS = '*{visibility:hidden!important} canvas[data-engine]{visibility:visible!important}';

// ---------------------------------------------------------------- one run
async function run(browser, airportArg, sunKind, arm) {
  const place = await airportPlace(airportArg);
  const sun = await sunInstant(sunKind, place.lat, place.lon);
  const sunIso = new Date(sun.ms).toISOString();
  const sunLabel = utcArg ? 'utc' : sunKind;
  const ident = airportArg.split(':')[0];
  const dir = path.join(outRoot, `${airportArg.replace(':', '_')}-${sunLabel}-${arm}`);
  fs.mkdirSync(dir, { recursive: true });
  const q = new URLSearchParams({ graphicsReview: '1', sunUtc: sunIso });
  if (weather !== 'live') q.set('weather', weather);
  if (arm === 'on') q.set('flags', ARM_FLAGS);
  const url = `${base}?${q.toString().replace(/%2C/g, ',')}`;
  const report = {
    harness: 'review-operations-airfield', version: 1, airportArg, ident, place, arm, flags: arm === 'on' ? ARM_FLAGS.split(',') : [],
    tier, sun: { kind: sunLabel, date, utc: sunIso, elevationDeg: +sun.elevationDeg.toFixed(2) }, weather, quality, reverse,
    url, cams, startedAt: new Date().toISOString(), poses: [], pageErrors: [], consoleErrors: [],
  };
  const t0 = Date.now();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => report.pageErrors.push({ at: Date.now() - t0, message: String(e.message).slice(0, 400), stack: String(e.stack || '').split('\n').slice(0, 4).join(' | ') }));
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ at: Date.now() - t0, text: m.text().slice(0, 300) }); });
  const errMark = () => ({ p: report.pageErrors.length, c: report.consoleErrors.length });
  const errSince = (m) => ({ pageErrors: report.pageErrors.slice(m.p), consoleErrors: report.consoleErrors.slice(m.c).length });
  try {
    await page.addInitScript(([qual, opsTier]) => {
      window.__flyTitleBypass = true; // straight to the hangar; launchSetup closes it
      window.__flyVisualsOverride = 'enhanced'; // the shipped player look, pinned
      window.__flyGovPin = 'hold'; // no mid-run tier steps under a capture
      window.__flyOpsTierOverride = opsTier; // W1 airfield tiers (nothing reads it in W0)
      try {
        localStorage.setItem('fly-map-style-2', 'satellite');
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-quality-tier', qual);
        // The first-flight tips card would sit over every capture.
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { sensitivity: 1, invertPitch: false, master: 1, effects: 1, music: 0.65, tutorial: 'done' } }));
      } catch { /* storage blocked: defaults */ }
    }, [quality, tier]);
    await page.goto(url, { timeout: 240000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__fly?.launchSetup && !!window.__fly?.reviewOps, undefined, { timeout: 240000, polling: 250 });
    report.renderer = await page.evaluate(() => {
      const gl = window.__flyGl?.getContext?.();
      const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    });
    const airportId = await page.evaluate((id) => window.__fly.reviewOps.ensureAirport(id), airportArg);
    if (!airportId) throw new Error(`ensureAirport(${airportArg}) found nothing`);
    let aircraftId = aircraftArg;
    if (aircraftArg === 'auto') {
      aircraftId = await page.evaluate(([id, order]) => order.find((a) => window.__fly.reviewOps.eligible(id, a)) ?? null, [airportId, AUTO_AIRCRAFT]);
      if (!aircraftId) throw new Error(`no eligible aircraft at ${airportId}`);
    }
    report.airportId = airportId;
    report.aircraftId = aircraftId;
    const launched = await page.evaluate(([airportId, aircraftId]) => window.__fly.launchSetup({ flightMode: 'ops', aircraftId, airportId, start: 'runway' }), [airportId, aircraftId]);
    if (!launched) throw new Error(`launchSetup refused ${aircraftId} at ${airportId}`);
    const bootT = Date.now();
    await page.waitForFunction(() => window.__flyBoot?.pct === 100 && window.__fly?.worldLoading === false, undefined, { timeout: 240000, polling: 250 });
    await page.getByTestId('warp-hold').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
    report.boot = { ms: Date.now() - bootT, readiness: await page.evaluate(() => window.__fly.worldReadiness ?? null), degraded: await page.evaluate(() => window.__fly.worldDegraded ?? null) };
    console.log(`[${airportId} ${sunLabel} ${arm}] ${aircraftId} · sun ${sunIso} (${sun.elevationDeg.toFixed(1)}°) · world in ${report.boot.ms} ms`);

    for (const name of poses) {
      const mark = errMark();
      const row = { name };
      const pt = Date.now();
      row.pose = await page.evaluate(([n, rev]) => window.__fly.reviewOps.pose(n, { reverse: rev }), [name, reverse]);
      if (!row.pose?.ok) { row.skipped = row.pose?.reason ?? 'pose refused'; report.poses.push(row); console.log(`  ${name}: SKIP ${row.skipped}`); continue; }
      // Settle: at least settleMin, then until every readiness part is in (or settleMax).
      await page.waitForTimeout(settleMin);
      let ready = null;
      while (Date.now() - pt < settleMax) {
        ready = await page.evaluate(() => { const r = window.__fly.reviewOps.readiness(); return { ready: r.ready, missing: r.missing }; });
        if (ready.ready) break;
        await page.waitForTimeout(500);
      }
      row.settleMs = Date.now() - pt;
      row.readiness = ready;
      row.sun = await page.evaluate(() => { const s = window.__fly.sun; return s ? { frac: s.frac, sinEl: s.sinEl, el: s.el } : null; });
      row.shots = [];
      for (const cam of cams) {
        const c = await page.evaluate((cm) => window.__fly.reviewOps.camera(cm), cam);
        if (!c?.ok) { row.shots.push({ cam, skipped: c?.reason }); continue; }
        await page.waitForTimeout(cam === 'chase' ? 900 : 1500);
        const file = path.join(dir, `${name}-${cam}.png`);
        await page.screenshot({ path: file, timeout: 60000 });
        const shot = { cam, file: path.relative(outRoot, file) };
        if (clean) {
          const style = await page.addStyleTag({ content: CLEAN_CSS });
          await page.waitForTimeout(150);
          const cf = path.join(dir, `${name}-${cam}-clean.png`);
          await page.screenshot({ path: cf, timeout: 60000 });
          await style.evaluate((n) => n.remove());
          shot.clean = path.relative(outRoot, cf);
        }
        row.shots.push(shot);
      }
      await page.evaluate(() => window.__fly.reviewOps.camera('chase'));
      if (census) row.census = await page.evaluate(CENSUS_FN, { wantFrames: 120 });
      row.state = await page.evaluate(() => window.__fly.reviewOps.state());
      Object.assign(row, errSince(mark));
      report.poses.push(row);
      const cs = row.census;
      console.log(`  ${name}: ${row.pose.runwayName} along ${row.pose.along} m h ${row.pose.heightM} m · settle ${row.settleMs} ms${ready?.ready ? '' : ' (missing ' + (ready?.missing || []).join('/') + ')'}` +
        (cs ? ` · draws ${cs.draws} tris ${cs.tris} · p50 ${cs.frame?.p50?.toFixed?.(1)} p95 ${cs.frame?.p95?.toFixed?.(1)} ms · AOL meshes ${cs.aolVisibleMeshes}` : '') +
        (row.pageErrors.length ? ` · PAGE ERRORS ${row.pageErrors.length}` : ''));
    }
    await page.evaluate(() => window.__fly.reviewOps.hold(false));
  } catch (e) {
    report.failure = String(e.stack || e);
    console.error(`[${airportArg} ${sunLabel} ${arm}] FAILED: ${String(e.message || e).slice(0, 300)}`);
    await page.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    report.durationMs = Date.now() - t0;
    report.captures = report.poses.reduce((n, p) => n + (p.shots || []).filter((s) => s.file).length, 0);
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    await context.close();
  }
  return { dir: path.relative(outRoot, dir), report };
}

(async () => {
  fs.mkdirSync(outRoot, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: !headed, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const indexFile = path.join(outRoot, 'index.json');
  let index = { runs: {} };
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { /* new */ }
  index.runs ??= {};
  try {
    for (const a of airports) for (const s of suns) for (const arm of arms) {
      const { dir, report } = await run(browser, a, s, arm);
      const lineup = report.poses.find((p) => p.name === 'lineup')?.census;
      index.runs[dir] = {
        airportId: report.airportId ?? null, aircraftId: report.aircraftId ?? null, arm, sun: report.sun, captures: report.captures,
        poses: report.poses.filter((p) => !p.skipped).length, skipped: report.poses.filter((p) => p.skipped).map((p) => p.name),
        pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length, failure: report.failure ? String(report.failure).slice(0, 200) : null,
        lineup: lineup ? { draws: lineup.draws, tris: lineup.tris, p50: lineup.frame?.p50 ?? null, p95: lineup.frame?.p95 ?? null, aolVisibleMeshes: lineup.aolVisibleMeshes, tier: lineup.review?.tier ?? null } : null,
        renderer: report.renderer ?? null, at: report.startedAt,
      };
      index.updatedAt = new Date().toISOString();
      fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
