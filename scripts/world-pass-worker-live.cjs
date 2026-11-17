/**
 * World Pass W0 (worker split): does the webpack worker bundle still load and
 * stream the satellite world? Boots the running dev server in installed
 * Chrome (the look-pass-capture.cjs launch), Enhanced satellite at a quality
 * tier, warps to Midtown and waits for building / skyline / road / veg chunks
 * to go ready. Reports page errors and every console error / warning naming a
 * worker, a module or an import.
 *
 *   node scripts/world-pass-worker-live.cjs [--url http://localhost:3320] [--quality high] [--wait 120000]
 * Exit 0 when buildings stream (ready >= 3) with no worker / page errors.
 * Since 2026-11-17 the World Pass streams ship ON, so at High / Ultra this boots the new world.
 */
const { chromium } = require('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const url = args.url || 'http://localhost:3320';
const quality = args.quality || 'high';
const waitMs = Number(args.wait || 120000);
const POSE = { lat: 40.754, lon: -73.984, altM: 600, headingDeg: 0 };

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  const notes = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && /worker|import|module|is not defined|is not a function|ReferenceError|TypeError|SyntaxError|stale/i.test(t)) errors.push(`console.error: ${t.slice(0, 400)}`);
    else if ((m.type() === 'warning' || m.type() === 'error') && /worker|protocol|stale|sat-/i.test(t)) notes.push(`${m.type()}: ${t.slice(0, 300)}`);
  });
  page.on('worker', (w) => notes.push(`worker started: ${w.url().split('/').pop()}`));
  await page.addInitScript(({ quality }) => {
    window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
    window.__flyWeatherOverride = 'baseline';
    try {
      localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
    } catch { /* storage optional */ }
  }, { quality });
  await page.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'world pass' } }));
  await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
  await page.goto(`${url}/?graphicsReview=1`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
  const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  await page.evaluate((p) => {
    const r = window.__fly, s = window.__flyStore.getState();
    r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
    r.warpToGeo(p.lat, p.lon, { altM: p.altM, headingRad: p.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
  }, POSE);
  const read = () => page.evaluate(() => {
    const st = (k) => { const s = window.__fly?.[k]?.stats; return s ? { ready: s.ready ?? null, chunks: s.chunks ?? null, queued: s.queued ?? null, building: s.building ?? null } : null; };
    const sb = window.__satBuildings;
    let metaChunks = 0, kept = 0, v = null;
    if (sb?.chunks) for (const c of sb.chunks.values()) { if (c.meta) { metaChunks += 1; kept += c.meta.kept ?? 0; } }
    return { satBuildings: st('satBuildings'), satSkyline: st('satSkyline'), satRoads: st('satRoads'), satVeg: st('satVeg'), satClutter: st('satClutter'), metaChunks, kept, worldPass: window.__flyStats?.worldPass?.request?.key ?? null };
  });
  let last = null;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    last = await read();
    if ((last.satBuildings?.ready ?? 0) >= 3 && (last.satSkyline?.ready ?? 0) >= 1 && (last.satRoads?.ready ?? 0) >= 1 && (last.satVeg?.ready ?? 0) >= 1) break;
  }
  await page.waitForTimeout(3000);
  last = await read();
  console.log(JSON.stringify({ gpu, quality, secs: Math.round((Date.now() - t0) / 1000), world: last, errors, notes: notes.slice(0, 30) }, null, 1));
  await browser.close();
  const ok = (last?.satBuildings?.ready ?? 0) >= 3 && errors.length === 0;
  console.log(ok ? 'LIVE OK' : 'LIVE FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('LIVE ERROR', e.stack || e.message);
  process.exit(2);
});
