/** WORLD PASS C (REACH) motion probe, adapted from the review probe
 * .graphics-review-era scripts/wp-probe-stream-motion.cjs (stream lens): the same flights, plus the
 * skyline stand-in counters (births, fade-budget misses, drawn stand-ins, minPx) every 0.25 s.
 * Summarise with: node scripts/wp-reach-motion-summary.cjs <out>/probe.json
 * Read-only probe (copied from scripts/look-pass-capture.cjs, keeps its GPU slot lock).
 *
 *   node scripts/wp-probe-stream-motion.cjs --url=http://localhost:3320 --scenarios=settle-nyc,nyc-cruise-500 --out=<dir>
 *
 * Scenarios:
 *   settle-<place>            warp to the place at 500 m, sample every 0.5 s for --settleSec (default 75)
 *   <place>-<speed>-<altM>    warp 15 km out on a fixed bearing, let it settle (max 60 s), then fly a
 *                             straight line to the place at cruise (180 m/s) or boost (750 m/s), holding
 *                             the altitude; sample every 0.25 s and save a frame every --frameSec.
 * In-page instruments (runtime monkeypatches on engine INSTANCES, no source edits):
 *   worker latency + tessMs per tile, finalize/drape main-thread ms, chunk births/deaths with the
 *   true-metre distance of the tile at birth, building bodies drawn, gl.info calls/triangles, rAF dt.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const sharp = require('sharp');

const args = Object.fromEntries(process.argv.slice(2).map(s => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const url = args.url || 'http://localhost:3320';
const out = path.resolve(String(args.out || '.graphics-review/world-pass/review/stream/motion'));
const scenarios = String(args.scenarios || 'settle-nyc').split(',');
const frameSec = Number(args.frameSec || 3);
const settleSec = Number(args.settleSec || 75);
const flags = typeof args.flags === 'string' ? args.flags : '';
fs.mkdirSync(out, { recursive: true });

// Targets and approach bearings (the flight heads along `bearing` and ends over the target).
const PLACES = {
  nyc: { lat: 40.7549, lon: -73.9840, bearing: 20, note: 'Midtown, approached from the harbour (SSW)' },
  powell: { lat: 40.1590, lon: -83.0750, bearing: 0, note: 'Powell OH suburb, approached from the south' },
  paris: { lat: 48.8584, lon: 2.2945, bearing: 300, note: 'Eiffel Tower, approached from the ESE over central Paris' },
};
const SPEEDS = { cruise: 180, boost: 750 };

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); }
catch { home = path.resolve(__dirname, '..'); }
const lockDir = path.join(home, '.graphics-review', 'look-pass', '.locks');
fs.mkdirSync(lockDir, { recursive: true });
let heldSlot = null;
async function acquireSlot() {
  const slots = 3, staleMs = 25 * 60 * 1000, t0 = Date.now();
  for (;;) {
    for (let i = 0; i < slots; i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `stream-probe pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return Date.now() - t0; }
      catch { try { if (Date.now() - fs.statSync(p).mtimeMs > staleMs) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw Error('No GPU capture slot within 40 minutes');
    await new Promise(r => setTimeout(r, 4000));
  }
}
const releaseSlot = () => { if (heldSlot) { try { fs.rmSync(heldSlot, { recursive: true, force: true }); } catch {} heldSlot = null; } };
process.on('exit', releaseSlot);
process.on('SIGINT', () => { releaseSlot(); process.exit(130); });

const HIDE = 'body *{visibility:hidden!important}canvas[data-look-canvas]{visibility:visible!important}';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- in-page instrument, installed once per page and re-armed per scenario -------------
function pageInstrument() {
  const R = 6378137, half = Math.PI * R, WORLD = 2 * Math.PI * R;
  const r = window.__fly;
  const P = window.__probe = window.__probe || { samples: [], tiles: [], births: [], deaths: [], t0: performance.now(), dts: [], fin: { bld: 0, bldMax: 0, sky: 0, skyMax: 0, drape: 0 } };
  P.samples.length = 0; P.tiles.length = 0; P.births.length = 0; P.deaths.length = 0; P.dts.length = 0; P.t0 = performance.now();
  P.alive = { bld: new Map(), sky: new Map() };
  const wrapWorker = (eng, tag) => {
    if (!eng?.worker || eng.__probeWorker) return; eng.__probeWorker = true;
    const orig = eng.worker;
    const wrapped = (...a) => {
      const t0 = performance.now();
      return orig.buildTile(...a).then((res) => {
        const sb = res?.satBuilding, sk = res?.satSkyline;
        P.tiles.push({ tag, z: a[0], x: a[1], y: a[2], t: (performance.now() - P.t0) / 1000, latMs: performance.now() - t0, tessMs: res?.tessMs ?? null, empty: !!res?.empty,
          tris: sb ? sb.idx.length / 3 : sk ? sk.idx.length / 3 : 0, kept: sb?.meta?.kept ?? null, total: sb?.meta?.total ?? null,
          horizon: res?.horizonMeta ?? null });
        return res;
      }, (e) => { P.tiles.push({ tag, z: a[0], x: a[1], y: a[2], t: (performance.now() - P.t0) / 1000, latMs: performance.now() - t0, error: String(e?.message ?? e) }); throw e; });
    };
    eng.worker = new Proxy(orig, { get(t, p) { if (p === 'buildTile') return wrapped; return t[p]; } });
  };
  const wrapMs = (eng, fn, key) => {
    if (!eng || eng[`__probe_${fn}`]) return;
    const o = eng[fn].bind(eng);
    eng[fn] = (...a) => { const t = performance.now(); const v = o(...a); const d = performance.now() - t; P.fin[key] += d; P.fin[key + 'Max'] = Math.max(P.fin[key + 'Max'] || 0, d); return v; };
    eng[`__probe_${fn}`] = true;
  };
  wrapWorker(r.satBuildings, 'bld'); wrapWorker(r.satSkyline, 'sky');
  wrapMs(r.satBuildings, '_finalizePending', 'bld'); wrapMs(r.satSkyline, '_finalizePending', 'sky');
  wrapMs(r.satBuildings, '_drapePending', 'drape'); wrapMs(r.satSkyline, '_drapePending', 'skyDrape');
  if (!P.rafOn) {
    P.rafOn = true; let last = performance.now();
    const loop = () => { const n = performance.now(); P.dts.push(n - last); last = n; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  let scene = r.engine.object; while (scene.parent) scene = scene.parent;
  const gl = scene.__r3f?.root?.getState()?.gl;
  const tileDist = (key, g, px, pz) => {
    const [z, x, y] = key.split('/').map(Number);
    const span = WORLD / 2 ** z * g;
    const minX = -half + x * span, minZ = -half + y * span;
    const dx = Math.max(minX - px, 0, px - (minX + span)), dz = Math.max(minZ - pz, 0, pz - (minZ + span));
    const cx = minX + span / 2, cz = minZ + span / 2;
    return { near: Math.hypot(dx, dz), center: Math.hypot(cx - px, cz - pz) };
  };
  if (P.timer) clearInterval(P.timer);
  P.timer = setInterval(() => {
    const f = r.flight, b = r.satBuildings, s = r.satSkyline;
    const lat = (2 * Math.atan(Math.exp(-f.pos.z / R)) - Math.PI / 2);
    const cosLat = Math.cos(lat);
    const t = (performance.now() - P.t0) / 1000;
    let bodies = 0, bTris = 0, bReady = 0;
    const seenB = new Set();
    if (b) for (const [key, c] of b.chunks) {
      if (!c.mesh) continue;
      bReady++; seenB.add(key); bodies += c.meta?.kept ?? 0; bTris += c.mesh.geometry.index ? c.mesh.geometry.index.count / 3 : 0;
      if (!P.alive.bld.has(key)) { const d = tileDist(key, 1, f.pos.x, f.pos.z); P.alive.bld.set(key, t); P.births.push({ tag: 'bld', key, t, nearM: d.near * cosLat, centerM: d.center * cosLat, bodies: c.meta?.kept ?? 0, aglM: f.pos.y - f.groundElev }); }
    }
    for (const [key, bt] of P.alive.bld) if (!seenB.has(key)) { const d = tileDist(key, 1, f.pos.x, f.pos.z); P.deaths.push({ tag: 'bld', key, t, life: t - bt, nearM: d.near * cosLat, centerM: d.center * cosLat }); P.alive.bld.delete(key); }
    const g = s?._horizon?.groupN ?? 2;
    let sReady = 0, sDrawn = 0, sTris = 0;
    const seenS = new Set();
    if (s) for (const [key, c] of s.chunks) {
      if (!c.mesh) continue;
      sReady++; if (c.mesh.visible) sDrawn++; sTris += c.mesh.geometry.index ? c.mesh.geometry.index.count / 3 : 0; seenS.add(key);
      if (!P.alive.sky.has(key)) { const d = tileDist(key, g, f.pos.x, f.pos.z); P.alive.sky.set(key, t); P.births.push({ tag: 'sky', key, t, nearM: d.near * cosLat, centerM: d.center * cosLat, aglM: f.pos.y - f.groundElev }); }
    }
    for (const [key, bt] of P.alive.sky) if (!seenS.has(key)) { const d = tileDist(key, g, f.pos.x, f.pos.z); P.deaths.push({ tag: 'sky', key, t, life: t - bt, nearM: d.near * cosLat, centerM: d.center * cosLat }); P.alive.sky.delete(key); }
    const dts = P.dts.splice(0).sort((a, z) => a - z);
    const q = (p) => dts.length ? Math.round(dts[Math.min(dts.length - 1, Math.floor(p * dts.length))] * 10) / 10 : null;
    const bs = b?.stats ?? {}, ss = s?.stats ?? {};
    const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o?.[k]]));
    P.samples.push({ t: Math.round(t * 100) / 100, aglM: Math.round(f.pos.y - f.groundElev), lat: lat * 180 / Math.PI,
      bld: { ...pick(bs, ['chunks', 'ready', 'empty', 'queued', 'building', 'draping', 'births', 'dying', 'ringOn', 'evictions', 'heals']), bodies, tris: bTris, liveReady: bReady, band: bs.cityBand ?? null },
      sky: { ...pick(ss, ['chunks', 'ready', 'drawn', 'empty', 'queued', 'building', 'draping', 'tris', 'ringOn', 'maxChunks', 'births', 'dying', 'fadeBudgetMiss', 'evictions', 'heals', 'standInsResident', 'standInsDrawn', 'standInTris', 'standInMinPx', 'standInsWanted', 'standInCoverM', 'geomBytes']), waitingTiles: ss.horizon?.waitingTiles ?? null, liveEnd: ss.horizon?.liveEnd ?? null, sTris, sDrawn, sReady },
      roads: pick(r.satRoads?.stats, ['ready', 'chunks', 'building', 'queued']), veg: pick(r.satVeg?.stats, ['ready', 'chunks', 'placed', 'building']),
      clutter: pick(r.satClutter?.stats, ['ready', 'chunks']), parcel: r.parcelHomes?.stats ? pick(r.parcelHomes.stats, ['placed', 'drawn', 'count']) : null,
      gl: gl ? { calls: gl.info.render.calls, tris: gl.info.render.triangles, geoms: gl.info.memory.geometries } : null,
      dt: { n: dts.length, p50: q(0.5), p95: q(0.95), max: dts.length ? Math.round(dts[dts.length - 1] * 10) / 10 : null },
      fin: { bldMs: Math.round(P.fin.bld * 100) / 100, bldMax: Math.round((P.fin.bldMax || 0) * 100) / 100, skyMs: Math.round(P.fin.sky * 100) / 100, skyMax: Math.round((P.fin.skyMax || 0) * 100) / 100, drapeMs: Math.round(P.fin.drape * 100) / 100, skyDrapeMs: Math.round((P.fin.skyDrape || 0) * 100) / 100 } });
    P.fin = { bld: 0, bldMax: 0, sky: 0, skyMax: 0, drape: 0, skyDrape: 0 };
  }, Number(window.__probeSampleMs || 250));
  return true;
}

(async () => {
  const waited = await acquireSlot();
  console.log(`SLOT ${path.basename(heldSlot)} after ${waited}ms`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const report = { url, flags, scenarios: {}, errors: [] };
  const save = () => fs.writeFileSync(path.join(out, 'probe.json'), JSON.stringify(report, null, 1));
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => { report.errors.push(e.message.slice(0, 400)); });
    await page.addInitScript(() => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
      window.__flySunOverride = Date.parse('2026-09-22T17:00:00Z'); window.__flyWeatherOverride = 'baseline'; window.__flyWorldPassCounters = true; // World Pass W0 arrival counters on engine stats (worldPassCounters)
      try {
        localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', 'ultra'); localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      } catch {}
    });
    await page.route('**/api/aircraft?**', r => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'probe' } }));
    await page.route('**/api/weather**', r => r.fulfill({ json: { found: false } }));
    await page.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore && !!window.__fly.satBuildings && !!window.__fly.satSkyline, undefined, { timeout: 240000 });
    report.gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
    console.log('BOOT', report.gpu);
    await page.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => {
        const h = window.__lookHold;
        step(dt, { ...c, turn: 0, pitch: 0, boost: false });
        if (h) {
          if (h.v) { const k = 1 / Math.cos(2 * Math.atan(Math.exp(-h.z / 6378137)) - Math.PI / 2); h.x += Math.sin(h.heading) * h.v * k * dt; h.z += -Math.cos(h.heading) * h.v * k * dt; }
          f.pos.x = h.x; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02;
          f.pos.y = h.agl != null ? f.groundElev + h.agl : h.y; f.agl = f.pos.y - f.groundElev;
        }
      };
      let scene = r.engine.object; while (scene.parent) scene = scene.parent;
      scene.__r3f.root.getState().gl.domElement.setAttribute('data-look-canvas', '');
      Object.defineProperty(r.camera, 'fov', { configurable: true, get: () => 60, set: () => {} }); r.camera.updateProjectionMatrix();
    });
    await page.waitForTimeout(3000);

    for (const sc of scenarios) {
      const m = sc.match(/^settle-(\w+)$/) || sc.match(/^(\w+)-(cruise|boost)-(\d+)$/);
      if (!m) { console.log('skip', sc); continue; }
      const settle = sc.startsWith('settle-');
      const place = PLACES[settle ? m[1] : m[1]];
      const speed = settle ? 0 : SPEEDS[m[2]];
      const altM = settle ? Number(args.settleAlt || 500) : Number(m[3]);
      const distM = settle ? 0 : Number(args.distM || 15000);
      const brg = place.bearing * Math.PI / 180;
      const start = { lat: place.lat - distM * Math.cos(brg) / 111320, lon: place.lon - distM * Math.sin(brg) / (111320 * Math.cos(place.lat * Math.PI / 180)) };
      const dir = `${out}/${sc}`; fs.mkdirSync(dir, { recursive: true });
      console.log('SCENARIO', sc, JSON.stringify(start), 'alt', altM, 'speed', speed);
      // Move somewhere neutral first so the engines evict, then warp to the start.
      await page.evaluate(({ s, altM, brg }) => {
        const r = window.__fly; window.__lookHold = null;
        r.warpToGeo(s.lat, s.lon, { altM, headingRad: brg, name: null }); r.autopilot?.disengage?.();
        const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: brg, agl: null }; r.chaseCam?.snap?.();
      }, { s: start, altM, brg });
      await page.evaluate(pageInstrument);
      const t0 = Date.now();
      const frames = [];
      const shoot = async (tag) => {
        const png = await page.screenshot({ timeout: 60000, style: HIDE });
        const file = path.join(dir, `${tag}.png`);
        await sharp(png).resize(800, 450).png().toFile(file);
        const tt = await page.evaluate(() => (performance.now() - (window.__probe?.t0 ?? 0)) / 1000);
        frames.push({ file, t: tt });
      };
      if (settle) {
        // Warp-to-city settle log: sample until the world is quiet for 8 s or settleSec elapses.
        let shotAt = 0;
        while ((Date.now() - t0) / 1000 < settleSec) {
          await sleep(1000);
          const el = (Date.now() - t0) / 1000;
          if (el - shotAt >= Number(args.settleFrameSec || 6)) { shotAt = el; await shoot(`t${String(Math.round(el)).padStart(3, '0')}`); }
        }
      } else {
        // Pre-settle at the start (the player has been flying here already), capped at 60 s.
        await page.waitForFunction(() => {
          const r = window.__fly; if (!r || r.worldLoading) return false;
          for (const k of ['satBuildings', 'satSkyline']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'draping', 'births'].some(f => Number(s[f] || 0) !== 0)) return false; }
          return true;
        }, undefined, { timeout: 60000, polling: 1000 }).catch(() => {});
        // Freeze terrain-relative altitude so the line is level over the ground, then go.
        await page.evaluate(({ v, altM }) => { const h = window.__lookHold; if (!h) return; h.agl = altM; h.v = v; window.__probeGo = (performance.now() - (window.__probe?.t0 ?? 0)) / 1000; }, { v: speed, altM });
        const flySec = distM / speed + 6;
        const tGo = Date.now();
        let shotAt = -999;
        while ((Date.now() - tGo) / 1000 < flySec) {
          const el = (Date.now() - tGo) / 1000;
          if (el - shotAt >= frameSec) { shotAt = el; await shoot(`f${String(Math.round(el * 10)).padStart(4, '0')}`); }
          else await sleep(200);
        }
        await page.evaluate(() => { const h = window.__lookHold; if (h) h.v = 0; });
      }
      const data = await page.evaluate(() => { const P = window.__probe; if (!P) return { reloaded: true, samples: [], tiles: [], births: [], deaths: [] }; clearInterval(P.timer); P.timer = null; return { go: window.__probeGo ?? null, samples: P.samples, tiles: P.tiles, births: P.births, deaths: P.deaths }; });
      report.scenarios[sc] = { place, start, altM, speed, distM, frames, ...data };
      save();
      console.log('DONE SCENARIO', sc, 'samples', data.samples.length, 'tiles', data.tiles.length, 'births', data.births.length, 'frames', frames.length);
    }
  } catch (e) {
    report.errors.push('fatal: ' + e.message);
    console.error(e);
  } finally {
    save(); await browser.close(); releaseSlot();
    console.log('DONE ->', out);
  }
})();
