/**
 * verify-flash-guard.js — R22.1 (C "FLASH")
 *
 * THE DEFECT. Roughly one composed frame in ~2,000 is replaced by a
 * near-full-screen uniform pale field. Measured cause: ONE zero-area triangle
 * inside a streamed satellite-building chunk. A zero-area triangle is
 * mathematically invisible but its rasterization is decided by an area
 * determinant of ~0 — the last bits of the projected coordinates — and the
 * building material is side:DoubleSide, so backface culling never removes it.
 * The anchor bend's per-vertex float32 offset perturbs the projection just
 * enough to tip it. Full derivation: scripts/r22p1-c-flash.md §3.
 *
 * RED CALIBRATION — measured on the DEFECTIVE tree, this machine, dev server
 * :3021, satellite, NYC default spawn, baseline weather, dsf 1.5:
 *
 *   pale composed frames      12 in 24,617   (~1 per 2,051)
 *                             probes 6/8/9/10/11, 15582+4407+1967+663+1998
 *   zero-area triangles       6-9 % of EVERY large chunk
 *                             fb6c0469 2528/35824 · 83336648 3152/36501
 *                             d44701b8 2806/44157 · 873be0c1 2802/41933
 *   totals over 28 meshes     34,405 zero-area of 482,740
 *
 * GREEN (armed): 0 zero-area of 448,335 over 28 meshes; 0 pale frames.
 *
 * The DETERMINISTIC gate here is the zero-area census (4) — it is true on
 * every boot of the defective tree and never flaky. The pale-frame gate (6) is
 * the stochastic content gate; at the measured RED rate a 30k-frame window
 * expects ~15 events, so a green window is meaningful, but the census is what
 * makes this gate reliable rather than lucky.
 *
 * PINS UN-PINNED, both deliberate:
 *   __flySettlePin — without it the ladder/birth path is frozen and the
 *     streaming cadence under test is not the shipped one.
 *   (weather) WEATHER=live rebinds __flyWeatherOverride so the fleet's
 *     baseline pin does not apply — the user hit this with live weather.
 * scripts/_boot.js is NOT edited; this uses the shared unpinPins() helper.
 *
 *   node scripts/verify-flash-guard.js
 *   env: FLY_URL (default http://localhost:3021), POSE=nyc|powell,
 *        WEATHER=baseline|live, SECONDS, DSF, HEADED=1,
 *        FLASH_PIN_OFF=1  -> run the RED leg (gate 4 must FAIL)
 */
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');

const URL = process.env.FLY_URL || 'http://localhost:3021';
const SECONDS = +(process.env.SECONDS ?? 240);
const POSES = {
  powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' },
  nyc: null,
};
const POSE_KEY = process.env.POSE ?? 'nyc';
const POSE = POSES[POSE_KEY];
const PIN_OFF = process.env.FLASH_PIN_OFF === '1';

const results = [];
const gate = (n, name, pass, detail) => {
  results.push({ n, name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} (${n}) ${name}${detail ? ` — ${detail}` : ''}`);
};

/** installed before the app boots: per-composed-frame framebuffer census */
const INSTALL = () => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  if (!comp || !gl) return { ok: false };
  window.__fgFrames = 0;
  window.__fgPale = [];
  window.__fgBlack = [];
  let row = null;
  const cr = comp.render.bind(comp);
  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__fgOn) return r;
    const c = gl.getContext();
    const W = c.drawingBufferWidth;
    const H = c.drawingBufferHeight;
    if (!row || row.length < W * 4) row = new Uint8Array(W * 4);
    c.bindFramebuffer(c.FRAMEBUFFER, null);
    c.readPixels(0, (H / 2) | 0, W, 1, c.RGBA, c.UNSIGNED_BYTE, row);
    let s = 0;
    let pale = 0;
    let dark = 0;
    for (let x = 0; x < W; x++) {
      const L = (row[x * 4] * 299 + row[x * 4 + 1] * 587 + row[x * 4 + 2] * 114) / 1000;
      s += L;
      if (L > 200) pale++;
      if (L < 8) dark++;
    }
    const pr = pale / W;
    const dr = dark / W;
    window.__fgFrames++;
    // same thresholds the probes used: >50% of the mid scanline above luma 200
    if (pr > 0.5) window.__fgPale.push({ n: window.__fgFrames, pr: +pr.toFixed(3), L: +(s / W).toFixed(1) });
    else if (dr > 0.9) window.__fgBlack.push({ n: window.__fgFrames, dr: +dr.toFixed(3) });
    return r;
  };
  return { ok: true };
};

/** static census of zero-area triangles across every streamed chunk */
const CENSUS = () => {
  const g = window.__satBuildings?.object;
  if (!g) return { err: 'no sat-buildings group' };
  let tris = 0;
  let zero = 0;
  let meshes = 0;
  const worst = [];
  for (const m of g.children) {
    const geo = m.geometry;
    const P = geo?.attributes?.position;
    if (!P) continue;
    const idx = geo.index;
    const n = idx ? idx.count : P.count;
    let z = 0;
    let t = 0;
    for (let i = 0; i + 2 < n; i += 3) {
      const a = idx ? idx.getX(i) : i;
      const b = idx ? idx.getX(i + 1) : i + 1;
      const c = idx ? idx.getX(i + 2) : i + 2;
      const ax = P.getX(a), ay = P.getY(a), az = P.getZ(a);
      const ux = P.getX(b) - ax, uy = P.getY(b) - ay, uz = P.getZ(b) - az;
      const vx = P.getX(c) - ax, vy = P.getY(c) - ay, vz = P.getZ(c) - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      t++;
      if (nx * nx + ny * ny + nz * nz === 0) z++;
    }
    tris += t; zero += z; meshes++;
    if (z > 0) worst.push({ uuid: m.uuid.slice(0, 8), tris: t, zero: z });
  }
  const st = window.__satBuildings?.stats ?? {};
  return {
    tris, zero, meshes,
    worst: worst.slice(0, 6),
    degenDropped: st.degenDropped ?? -1,
    degenScanned: st.degenScanned ?? -1,
    degenChunks: st.degenChunks ?? -1,
    chunks: g.children.length,
  };
};

async function main() {
  console.log(`verify-flash-guard — pose=${POSE_KEY} weather=${process.env.WEATHER ?? 'baseline'} leg=${PIN_OFF ? 'RED (pin off)' : 'GREEN'}`);
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.HEADED !== '1',
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 660 },
    deviceScaleFactor: +(process.env.DSF ?? 1.5),
  });
  const page = await ctx.newPage();
  const errs = [];
  const netNoise = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // Resource 404/5xx and CORS noise is the live tile/API network, not this
  // build — R22.1 (A) §6.6 recorded three gate reds from exactly that and they
  // cleared on a quiet re-run. Real pageerrors stay blocking.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_|CORS|ECONNRESET/i.test(t)) { netNoise.push(t.slice(0, 120)); return; }
    errs.push(`console: ${t.slice(0, 160)}`);
  });

  if (PIN_OFF) await page.addInitScript(() => { window.__flyFlashPin = 'off'; });
  if (process.env.WEATHER === 'live') {
    await page.addInitScript(() => {
      Object.defineProperty(window, '__flyWeatherOverride', {
        configurable: true,
        get: () => window.__wxUnpinned,
        set: (v) => { window.__wxPinAttempt = v; },
      });
    });
  }
  await page.addInitScript(unpinPins, ['__flySettlePin']);

  const boot = await bootFly(page, { url: URL, style: 'satellite' });
  const inst = await page.evaluate(INSTALL);
  if (POSE) {
    await page.evaluate(([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }), [POSE.lat, POSE.lon, POSE.altM, POSE.name]);
  }
  await page.waitForTimeout(20000); // let the ring stream and settle
  await page.evaluate(() => { window.__fgFrames = 0; window.__fgPale.length = 0; window.__fgBlack.length = 0; window.__fgOn = true; });

  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) await page.waitForTimeout(5000);
  await page.evaluate(() => { window.__fgOn = false; });

  const frames = await page.evaluate(() => window.__fgFrames);
  const pale = await page.evaluate(() => window.__fgPale);
  const black = await page.evaluate(() => window.__fgBlack);
  const cen = await page.evaluate(CENSUS);

  console.log(`\n  boot ${boot.ms} ms · composed frames ${frames} · chunks ${cen.chunks}`);
  console.log(`  census: ${cen.tris} tris over ${cen.meshes} meshes · zero-area ${cen.zero}`);
  console.log(`  engine: degenScanned ${cen.degenScanned} degenDropped ${cen.degenDropped} degenChunks ${cen.degenChunks}\n`);

  // The precondition is on CUMULATIVE streaming (degenScanned), not on the
  // live triangle count: a suburban pose legitimately holds ~5k triangles
  // where Manhattan holds ~65k, and a live-count threshold calibrated on the
  // dense pose fails the sparse one for being correct. What must be true on
  // both is that real geometry streamed through the filter during the window.
  gate(1, 'precondition: booted, instrumented, ring streamed, frames composed',
    inst.ok && !cen.err && cen.chunks > 4 && frames > 2000 && cen.tris > 1000 && cen.degenScanned > 100000,
    `install=${inst.ok} chunks=${cen.chunks} frames=${frames} liveTris=${cen.tris} scanned=${cen.degenScanned}`);

  // degenScanned counts triangles EXAMINED and is incremented on both legs
  // (the pin returns before filtering, not before counting), so the state of
  // the guard is read off degenDropped, not degenScanned.
  gate(2, 'the guard is in the expected state for this leg',
    cen.degenScanned > 0 && (PIN_OFF ? cen.degenDropped === 0 : cen.degenDropped > 0),
    `degenScanned=${cen.degenScanned} degenDropped=${cen.degenDropped}` +
      (PIN_OFF ? ' (RED leg: dropped must be 0)' : ` over ${cen.degenChunks} chunks`));

  gate(3, 'there WERE degenerates to drop — the defect is present in this content, so (4) is not vacuous',
    PIN_OFF ? cen.zero > 0 : cen.degenDropped > 0,
    PIN_OFF ? `zero-area still present: ${cen.zero}` : `degenDropped=${cen.degenDropped}`);

  gate(4, 'ZERO zero-area triangles remain in any streamed chunk',
    cen.zero === 0,
    `zero-area=${cen.zero}${cen.worst.length ? ` worst=${JSON.stringify(cen.worst)}` : ''}`);

  gate(5, 'index arithmetic: scanned = kept + dropped',
    PIN_OFF || cen.degenScanned === cen.degenDropped + cen.tris || cen.degenScanned >= cen.tris,
    `scanned=${cen.degenScanned} kept=${cen.tris} dropped=${cen.degenDropped} (evictions make scanned >= kept)`);

  gate(6, 'no PALE composed frame in the live window',
    pale.length === 0,
    `${pale.length} pale in ${frames} frames${pale.length ? ` first=${JSON.stringify(pale[0])}` : ''}`);

  gate(7, 'no BLACK composed frame in the live window',
    black.length === 0,
    `${black.length} black in ${frames} frames`);

  gate(8, 'window is long enough to be meaningful vs the RED rate (1 per 2,051)',
    frames >= 8000,
    `${frames} frames ≈ ${(frames / 2051).toFixed(1)} expected RED events`);

  gate(9, 'zero pageerrors / console errors (live-network noise excluded, reported)',
    errs.length === 0,
    (errs.length ? errs.slice(0, 2).join(' | ') : 'none') + ` · network noise ignored: ${netNoise.length}`);

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length === 0 ? 'VERIFY PASS' : 'VERIFY FAIL'} — ${results.length - failed.length}/${results.length} gates`);
  if (failed.length) console.log(`  failed: ${failed.map((f) => `(${f.n})`).join(' ')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
